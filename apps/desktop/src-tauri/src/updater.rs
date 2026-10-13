// NexusLink Desktop — المحدّث الموقّع + سجل الإصدارات (FA-harden — عقد §16 بند 2)
// ============================================================
// · الفحص عند الإقلاع: tauri-plugin-updater ضد latest.json على GitHub Releases
//   (توقيع minisign/Ed25519 — pubkey في tauri.conf.json والمفتاح الخاص سر CI).
//   الإصدار مقفول 1.0.0: latest.json الحالي يعيد 1.0.0 ⇒ «أنت على الأحدث» —
//   لا حلقة ترقية/تخفيض. عند صدور إصدار مستقبلي (موقّع بCI) يتقدم الفحص تلقائيًا.
// · autoCheck من المخزن المشترك (نفس SQLite — بند 6)؛ الإقلاع ينتظر جاهزية
//   السيرفر المضمّن ثم يقرأه — أوفلاين = تخطٍ بلا ضجيج (الفحص هو الاتصال
//   الخارجي الوحيد للتطبيق).
// · سجل الإصدارات: GitHub Releases API (مستودع عام) — كاش 10 دقائق.
use serde_json::json;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

const RELEASES_API: &str = "https://api.github.com/repos/CTO-DRS/NexusLink/releases?per_page=12";

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// سجل الإصدارات — كاش 10 دقائق
// ---------------------------------------------------------------------------

fn history_cache() -> &'static Mutex<Option<(Instant, Vec<serde_json::Value>)>> {
    static C: Mutex<Option<(Instant, Vec<serde_json::Value>)>> = Mutex::new(None);
    &C
}

pub fn fetch_history() -> Vec<serde_json::Value> {
    {
        let c = history_cache().lock().unwrap();
        if let Some((at, v)) = c.as_ref() {
            if at.elapsed() < Duration::from_secs(600) {
                return v.clone();
            }
        }
    }
    let empty: Vec<serde_json::Value> = Vec::new();
    let resp = ureq::AgentBuilder::new()
        .timeout(Duration::from_secs(8))
        .build()
        .get(RELEASES_API)
        // GitHub API تشترط User-Agent
        .set("User-Agent", "NexusLink-Desktop/1.0.0")
        .set("Accept", "application/vnd.github+json")
        .call();
    let list = match resp {
        Ok(r) => {
            let body: serde_json::Value = r.into_json().unwrap_or(json!([]));
            let mut out = Vec::new();
            if let Some(arr) = body.as_array() {
                for rel in arr.iter().take(12) {
                    let draft = rel.get("draft").and_then(|d| d.as_bool()).unwrap_or(false);
                    if draft {
                        continue;
                    }
                    out.push(json!({
                        "tag": rel.get("tag_name").and_then(|v| v.as_str()).unwrap_or(""),
                        "name": rel.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                        // body = ملاحظات الإصدار (Markdown نصي)
                        "notes": rel.get("body").and_then(|v| v.as_str()).unwrap_or(""),
                        "date": rel.get("published_at").and_then(|v| v.as_str()).unwrap_or(""),
                        "prerelease": rel.get("prerelease").and_then(|v| v.as_bool()).unwrap_or(false),
                    }));
                }
            }
            out
        }
        Err(_) => {
            // أوفلاين/محدود المعدل — القائمة الفارغة بصدق (لا كاش لفشل)
            return empty;
        }
    };
    if !list.is_empty() {
        *history_cache().lock().unwrap() = Some((Instant::now(), list.clone()));
    }
    list
}

// ---------------------------------------------------------------------------
// الفحص والتثبيت
// ---------------------------------------------------------------------------

/// فحص واحد للتحديث — النتيجة قياسية قابلة للتسلسل
async fn check_once(app: &AppHandle) -> Result<(bool, String, String), String> {
    let updater = app.updater().map_err(|e| format!("updater: {e}"))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("فحص التحديث: {e}"))?;
    match update {
        Some(u) => {
            // Update.body = ملاحظات الإصدار (متحقق من مصدر 2.9.0 — لا حقل notes)
            let notes = u.body.clone().unwrap_or_default();
            Ok((true, u.version.clone(), notes))
        }
        None => Ok((false, env!("CARGO_PKG_VERSION").to_string(), String::new())),
    }
}

#[tauri::command]
pub fn updater_state(app: AppHandle) -> serde_json::Value {
    let auto = crate::settings::get().updater_auto_check;
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "autoCheck": auto,
        "endpoint": "https://github.com/CTO-DRS/NexusLink/releases/latest/download/latest.json",
        "history": fetch_history(),
    })
}

/// فحص يدوي من الواجهة (بطاقة الإعدادات) — يكتب تدقيقًا ويبث حدث الواجهة
#[tauri::command]
pub fn updater_check_now(app: AppHandle) -> serde_json::Value {
    let res = tauri::async_runtime::block_on(check_once(&app));
    match res {
        Ok((available, version, notes)) => {
            if available {
                crate::audit::audit(
                    "updater",
                    "warn",
                    format!("يتوفر تحديث موقّع جديد: {version}"),
                );
                let _ = app.emit(
                    "desktop://update",
                    json!({ "available": true, "version": version, "notes": notes, "at": now_ms() }),
                );
            } else {
                crate::audit::audit(
                    "updater",
                    "info",
                    format!("فحص التحديث: {} أحدث إصدار", env!("CARGO_PKG_VERSION")),
                );
            }
            json!({ "ok": true, "available": available, "version": version, "notes": notes })
        }
        Err(e) => {
            // فشل الفحص (أوفلاين/معدل) — بلا انكسار، بصدق
            json!({ "ok": false, "error": e })
        }
    }
}

/// تنزيل الإصدار الجديد وتثبيته (يتحقق التوقيع قبل التثبيت — سلوك البرنامج
/// المساعد نفسه). لن يُستدعى عمليًا طالما الإصدار مقفول 1.0.0 وlatest.json
/// يعيد 1.0.0 — المسار موجود ومكتمل لوقت صدور أول إصدار موقّع مستقبلًا.
#[tauri::command]
pub fn updater_install(app: AppHandle) -> serde_json::Value {
    let res = tauri::async_runtime::block_on(async {
        let updater = app.updater().map_err(|e| format!("updater: {e}"))?;
        let update = updater.check().await.map_err(|e| format!("فحص: {e}"))?;
        let Some(update) = update else {
            return Err("لا تحديث متاح".to_string());
        };
        let ver = update.version.clone();
        let mut downloaded: usize = 0;
        update
            .download_and_install(
                |chunk, total| {
                    // tauri-plugin-updater: chunk هو طول الجزء (usize) لا شريحة بايتات
                    downloaded += chunk;
                    let _ = (total, downloaded);
                },
                || {},
            )
            .await
            .map_err(|e| format!("تنزيل/تثبيت: {e}"))?;
        Ok(ver)
    });
    match res {
        Ok(ver) => {
            crate::audit::audit("updater", "warn", format!("ثُبّت التحديث {ver} — إعادة تشغيل"));
            json!({ "ok": true, "version": ver })
        }
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

/// فحص الإقلاع — ينتظر جاهزية السيرفر المضمّن (حتى 90ث) ثم يقرأ autoCheck
/// من المخزن المشترك ويفحص. كل المسارات بلا هلع.
pub fn startup_check(app: AppHandle) {
    std::thread::Builder::new()
        .name("updater-check".into())
        .spawn(move || {
            // انتظار جاهزية السيرفر (sidecar) — محاولات متباعدة
            let mut auto = true;
            for _ in 0..18 {
                std::thread::sleep(Duration::from_secs(5));
                if let Ok(cfg) = crate::procman::get_json("/api/desktop/settings") {
                    auto = cfg
                        .get("updater")
                        .and_then(|u| u.get("autoCheck"))
                        .and_then(|v| v.as_bool())
                        .unwrap_or(true);
                    break;
                }
            }
            if !auto {
                println!("[updater] autoCheck معطل من الإعدادات المشتركة — تخطي");
                return;
            }
            match tauri::async_runtime::block_on(check_once(&app)) {
                Ok((false, v, _)) => {
                    crate::audit::audit(
                        "updater",
                        "info",
                        format!("فحص إقلاعي: {v} أحدث إصدار"),
                    );
                    let _ = app.emit(
                        "desktop://update",
                        json!({ "available": false, "version": v, "at": now_ms() }),
                    );
                }
                Ok((true, v, notes)) => {
                    crate::audit::audit("updater", "warn", format!("يتوفر تحديث: {v}"));
                    let _ = app.emit(
                        "desktop://update",
                        json!({ "available": true, "version": v, "notes": notes, "at": now_ms() }),
                    );
                    crate::notify::plain(
                        &app,
                        "NexusLink — تحديث جديد",
                        &format!("يتوفر الإصدار الموقّع {v} — افتح الإعدادات للتثبيت"),
                    );
                }
                Err(e) => println!("[updater] فحص الإقلاع فشل بلا أثر: {e}"),
            }
        })
        .expect("updater check thread");
}

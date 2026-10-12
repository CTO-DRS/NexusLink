// FA-files (عقد §14) — دمج الملفات في نظام التشغيل (طبقة Tauri)
// ============================================================
// · قائمة الزر الأيمن Windows: HKCU Registry (بلا صلاحيات مدير) + تنظيف عند إزالة التثبيت
//   عبر hooks المثبّت (installer-hooks.nsh) وعند تعطيل الإعداد.
// · «--send» من سطر الأوامر (من قائمة السياق) — المثيل الثاني يمررها للمثيل الأول
//   عبر إضافة single-instance، والأول يجهز الملف في Inbox ويعرض نقلًا فوريًا.
// · «إظهار في Explorer/Finder» — لكل إدخال محلي حقيقي.
// · بث فيديو الهاتف: تنزيل تقدّمي إلى ملف مؤقت + فتح تلقائي بالمشغّل الافتراضي
//   عند العتبة (2MB أو 1.5ث) + استكمال حتى الاكتمال + تنظيف عند الخروج.
use serde_json::json;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::AppHandle;

pub use crate::files_menu_core::{
    collect_send_paths, menu_spec, open_decision, parse_content_range, range_header,
    sanitize_stream_name, OpenDecision, DEFAULT_THRESHOLD,
};
use crate::procman;

// ---------------------------------------------------------------------------
// قائمة الزر الأيمن — Windows Registry (HKCU)
// ---------------------------------------------------------------------------

#[cfg(windows)]
fn apply_menu_windows() -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let exe = std::env::current_exe()
        .map_err(|e| format!("current_exe: {e}"))?
        .to_string_lossy()
        .to_string();
    let spec = menu_spec(&exe);
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for key in [&spec.key_file, &spec.key_dir] {
        let (k, _) = hkcu
            .create_subkey(key)
            .map_err(|e| format!("create {key}: {e}"))?;
        k.set_value("", &spec.verb).map_err(|e| format!("verb: {e}"))?;
        k.set_value("Icon", &spec.icon).map_err(|e| format!("icon: {e}"))?;
        let (ck, _) = k.create_subkey("command").map_err(|e| format!("cmdkey: {e}"))?;
        ck.set_value("", &spec.command).map_err(|e| format!("cmd: {e}"))?;
    }
    Ok(())
}

#[cfg(windows)]
fn remove_menu_windows() -> Result<(), String> {
    use winreg::enums::*;
    use winreg::RegKey;
    let spec = menu_spec("");
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    for key in [&spec.key_file, &spec.key_dir] {
        // الغياب ليس خطأ — المفتاح قد يكون أُزيل سابقًا
        if let Err(e) = hkcu.delete_tree(key) {
            if e.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("{key}: {e}"));
            }
        }
    }
    Ok(())
}

/// حالة قائمة السياق الحالية (نص عربي صادق لكل منصة).
pub fn menu_status() -> &'static str {
    #[cfg(windows)]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let spec = menu_spec("");
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let open = hkcu
            .open_subkey_with_flags(&spec.key_file, KEY_READ)
            .is_ok();
        if open {
            "مسجّلة"
        } else {
            "غير مسجّلة"
        }
    }
    #[cfg(not(windows))]
    {
        "غير متاحة على هذه المنصة"
    }
}

/// أوامر Tauri: تسجيل/إلغاء/حالة قائمة السياق.
#[tauri::command]
pub fn files_context_menu(action: String) -> serde_json::Value {
    match action.as_str() {
        "register" => {
            #[cfg(windows)]
            {
                match apply_menu_windows() {
                    Ok(()) => json!({"ok": true, "status": "مسجّلة"}),
                    Err(e) => json!({"ok": false, "error": e}),
                }
            }
            #[cfg(not(windows))]
            {
                json!({"ok": false, "error": "قائمة الزر الأيمن متاحة على Windows فقط"})
            }
        }
        "unregister" => {
            #[cfg(windows)]
            {
                match remove_menu_windows() {
                    Ok(()) => json!({"ok": true, "status": "أُزيلت"}),
                    Err(e) => json!({"ok": false, "error": e}),
                }
            }
            #[cfg(not(windows))]
            {
                json!({"ok": false, "error": "قائمة الزر الأيمن متاحة على Windows فقط"})
            }
        }
        "status" => json!({"ok": true, "status": menu_status()}),
        _ => json!({"ok": false, "error": "action غير معروف"}),
    }
}

/// التطبيق عند الإقلاع حسب الإعداد (افتراضيًا: مسجّلة).
pub fn apply_startup() {
    if !crate::settings::get().context_menu {
        return;
    }
    #[cfg(windows)]
    {
        if let Err(e) = apply_menu_windows() {
            println!("[files] context-menu register failed: {e}");
        } else {
            println!("[files] context-menu registered (HKCU)");
        }
    }
}

// ---------------------------------------------------------------------------
// --send — مسارات قائمة السياق (المثيل الأول يجهز ويرسل)
// ---------------------------------------------------------------------------

/// طابور إرسال معلّق (من إقلاع أول بوسائط --send، أو تمرير المثيل الثاني)
static PENDING_SENDS: OnceLock<Mutex<Vec<PathBuf>>> = OnceLock::new();

fn pending() -> &'static Mutex<Vec<PathBuf>> {
    PENDING_SENDS.get_or_init(|| Mutex::new(Vec::new()))
}

/// إضافة مسارات من أرجف (سواء عند الإقلاع الأول أو من callback المثيل الوحيد)
pub fn queue_send_args(argv: &[String]) {
    let paths = collect_send_paths(argv);
    if paths.is_empty() {
        return;
    }
    let mut q = pending().lock().unwrap();
    q.extend(paths);
    let n = q.len();
    drop(q);
    println!("[files] queued --send paths: {n} total");
}

/// يُستدعى من دورة المراقبة بعد جاهزية السيرفر — تجهيز + عرض + إشعار صادق.
pub fn flush_pending_sends(app: &AppHandle) {
    let paths = {
        let mut q = pending().lock().unwrap();
        if q.is_empty() {
            return;
        }
        std::mem::take(&mut *q)
    };
    let app2 = app.clone();
    std::thread::spawn(move || {
        let mut sent = 0usize;
        for p in paths {
            match stage_and_offer(&app2, &p) {
                Ok(name) => {
                    sent += 1;
                    crate::notify::plain(&app2, "إرسال عبر NexusLink", &format!("بدأ نقل {name} إلى الهاتف"));
                }
                Err(e) => {
                    crate::notify::plain(&app2, "تعذّر الإرسال عبر NexusLink", &e);
                }
            }
        }
        if sent > 0 {
            procman::open_main(&app2);
        }
    });
}

/// تجهيز ملف/مجلد محلي في Inbox + عرض نقل حي (نفس عقد السحب والإفلات §8.3)
fn stage_and_offer(app: &AppHandle, p: &PathBuf) -> Result<String, String> {
    // مجلد؟ ضغطه إلى zip مؤقت في temp ثم إرساله (قائمة السياق تقبل مجلدات)
    let file: PathBuf = if p.is_dir() {
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("folder").to_string();
        let zip_path = std::env::temp_dir()
            .join(format!("NexusLink-send-{}.zip", std::process::id()));
        zip_dir(p, &zip_path).map_err(|e| format!("ضغط المجلد: {e}"))?;
        let final_name = format!("{name}.zip");
        let moved = zip_path.with_file_name(&final_name);
        std::fs::rename(&zip_path, &moved).map_err(|e| format!("rename: {e}"))?;
        moved
    } else {
        p.clone()
    };
    let name = file
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("اسم الملف غير صالح")?
        .to_string();
    let bytes = std::fs::read(&file).map_err(|e| format!("قراءة الملف: {e}"))?;
    let (vname, size) = procman::stage_file_to_inbox(app, &name, &bytes)?;
    let agent = procman::current_agent_id();
    let body = json!({
        "action": "send-file",
        "deviceId": agent,
        "deviceName": agent,
        "direction": "out",
        "srcDeviceId": "pc-office",
        "srcPath": format!("/Inbox/{vname}"),
        "fileName": vname,
        "size": size,
    });
    match procman::post_json("/api/devices", &body) {
        Ok(v) if v["ok"] == true => Ok(vname),
        Ok(v) => Err(format!("رفض السيرفر الإرسال: {v}")),
        Err(e) => Err(format!("فشل الاتصال بالسيرفر: {e}")),
    }
}

/// ضغط مجلد إلى zip (خوارزمية store — بلا اعتماديات إضافية)
fn zip_dir(dir: &PathBuf, out: &PathBuf) -> Result<(), String> {
    use std::io::Write as _;
    let file = std::fs::File::create(out).map_err(|e| e.to_string())?;
    let mut w = zip::ZipWriter::new(file);
    let opts: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let base = dir.parent().unwrap_or(dir).to_path_buf();
    let mut stack = vec![dir.clone()];
    while let Some(d) = stack.pop() {
        let entries = std::fs::read_dir(&d).map_err(|e| e.to_string())?;
        for e in entries.flatten() {
            let p = e.path();
            let rel = p.strip_prefix(&base).map_err(|e| e.to_string())?;
            if p.is_dir() {
                w.add_directory(rel.to_string_lossy().as_ref(), opts).map_err(|e| e.to_string())?;
                stack.push(p);
            } else {
                w.start_file(rel.to_string_lossy().as_ref(), opts).map_err(|e| e.to_string())?;
                let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
                w.write_all(&bytes).map_err(|e| e.to_string())?;
            }
        }
    }
    w.finish().map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// «إظهار في Explorer/Finder»
// ---------------------------------------------------------------------------

/// كشف مسار حقيقي في مدير ملفات النظام (تحديد الملف داخل مجلده).
pub fn reveal(path: &str) -> Result<(), String> {
    let p = PathBuf::from(path);
    if !p.exists() {
        return Err(format!("المسار غير موجود: {path}"));
    }
    let p = p.canonicalize().unwrap_or(p);
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", p.to_string_lossy()))
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &p.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        // Linux: FileManager1 عبر dbus ثم fallback إلى فتح المجلد
        let dir = if p.is_dir() {
            p.clone()
        } else {
            p.parent().map(|x| x.to_path_buf()).unwrap_or(p.clone())
        };
        let ok = std::process::Command::new("dbus-send")
            .args([
                "--session", "--dest=org.freedesktop.FileManager1",
                "--type=method_call", "/org/freedesktop/FileManager1",
                "org.freedesktop.FileManager1.ShowItems",
                &format!("array:string:file://{}", p.to_string_lossy()),
                "string:",
            ])
            .spawn()
            .is_ok();
        if !ok {
            std::process::Command::new("xdg-open")
                .arg(dir)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}

#[tauri::command]
pub fn files_reveal(path: String) -> serde_json::Value {
    match reveal(&path) {
        Ok(()) => json!({"ok": true}),
        Err(e) => json!({"ok": false, "error": e}),
    }
}

// ---------------------------------------------------------------------------
// بث فيديو الهاتف — تنزيل تقدّمي مؤقت + فتح تلقائي + تنظيف
// ---------------------------------------------------------------------------

struct StreamState {
    cancel: std::sync::Arc<AtomicBool>,
}

static STREAMS: OnceLock<Mutex<std::collections::HashMap<u64, StreamState>>> = OnceLock::new();
static STREAM_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
static TEMP_STREAM_DIR: OnceLock<PathBuf> = OnceLock::new();

fn streams() -> &'static Mutex<std::collections::HashMap<u64, StreamState>> {
    STREAMS.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn temp_stream_dir() -> PathBuf {
    TEMP_STREAM_DIR
        .get_or_init(|| std::env::temp_dir().join("NexusLink-stream"))
        .clone()
}

/// تنظيف كل البثوث + المجلد المؤقت — عند الخروج (kill_all مسار موحد)
pub fn cleanup_all() {
    if let Some(map) = STREAMS.get() {
        let map = map.lock().unwrap();
        for st in map.values() {
            st.cancel.store(true, Ordering::Relaxed);
        }
    }
    let _ = std::fs::remove_dir_all(temp_stream_dir());
}

/// بدء بث: HTTP Range تقدّمي → ملف مؤقت → فتح بالمشغّل الافتراضي عند العتبة →
/// استكمال حتى الاكتمال. يعيد معرّف البث للإلغاء الفوري.
#[tauri::command]
pub fn files_stream_open(
    app: AppHandle,
    url: String,
    file_name: String,
    size: u64,
) -> serde_json::Value {
    if url.is_empty() || file_name.is_empty() {
        return json!({"ok": false, "error": "url و file_name مطلوبان"});
    }
    // سقف بثوث متزامنة = 4
    if streams().lock().unwrap().len() >= 4 {
        return json!({"ok": false, "error": "هناك 4 بثوث جارية — ألغِ واحدًا أولًا"});
    }
    let id = STREAM_SEQ.fetch_add(1, Ordering::Relaxed);
    let safe = sanitize_stream_name(&file_name);
    let dir = temp_stream_dir();
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return json!({"ok": false, "error": format!("مجلد مؤقت: {e}")});
    }
    let temp = dir.join(format!("{id}-{safe}"));
    let cancel = std::sync::Arc::new(AtomicBool::new(false));
    streams().lock().unwrap().insert(id, StreamState { cancel: cancel.clone() });
    let app2 = app.clone();
    let name2 = safe.clone();
    let temp_resp = temp.clone();
    std::thread::spawn(move || {
        let res = run_stream(&url, &temp, size, &name2, cancel.clone());
        streams().lock().unwrap().remove(&id);
        match res {
            Ok(total) => {
                println!("[files] stream #{id} done: {total} bytes → {}", temp.display());
                if cancel.load(Ordering::Relaxed) {
                    let _ = std::fs::remove_file(&temp);
                } else {
                    crate::notify::plain(
                        &app2,
                        "اكتمل البث المؤقت",
                        &format!("{name2} — النسخة الكاملة متاحة مؤقتًا حتى الخروج"),
                    );
                }
            }
            Err(e) => {
                println!("[files] stream #{id} failed: {e}");
                crate::notify::plain(&app2, "فشل بث الفيديو", &e);
                let _ = std::fs::remove_file(&temp);
            }
        }
    });
    json!({"ok": true, "streamId": id, "tempPath": temp_resp.to_string_lossy()})
}

#[tauri::command]
pub fn files_stream_cancel(stream_id: u64) -> serde_json::Value {
    if let Some(st) = streams().lock().unwrap().get(&stream_id) {
        st.cancel.store(true, Ordering::Relaxed);
        json!({"ok": true})
    } else {
        json!({"ok": false, "error": "لا يوجد بث بهذا المعرّف"})
    }
}

/// حلقة التنزيل التقدّمي — المضخة النقية من files_menu_core (نفس منطق محرك التحقق)
fn run_stream(
    url: &str,
    temp: &PathBuf,
    total_hint: u64,
    name: &str,
    cancel: std::sync::Arc<AtomicBool>,
) -> Result<u64, String> {
    let agent = ureq::AgentBuilder::new()
        .timeout_read(Duration::from_secs(30))
        .timeout_connect(Duration::from_secs(5))
        .build();
    let resp = agent
        .get(url)
        .set("Range", &range_header(0))
        .call()
        .map_err(|e| format!("تعذر الاتصال بالهاتف: {e}"))?;
    let total = parse_content_range(
        resp.header("Content-Range").unwrap_or("bytes 0-0/0"),
    )
    .map(|(_, t)| t)
    .unwrap_or(total_hint);
    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(temp).map_err(|e| format!("ملف مؤقت: {e}"))?;
    let mut opened = false;
    let (written, known) = crate::files_menu_core::pump_stream(
        &mut reader,
        &mut file,
        total,
        &|| cancel.load(Ordering::Relaxed),
        &mut |at| {
            opened = true;
            match open_with_default_player(temp) {
                Ok(()) => println!(
                    "[files] stream of {name} opened in default player at {at} bytes"
                ),
                Err(e) => println!("[files] player open failed: {e}"),
            }
        },
        DEFAULT_THRESHOLD,
    )?;
    let _ = opened;
    let _ = file.sync_all();
    if known > 0 && written < known {
        return Err(format!("انقطع البث عند {written}/{known}"));
    }
    Ok(written)
}

/// فتح ملف بالمشغّل الافتراضي عبر ربط الامتداد (ملف حقيقي على القرص — يعمل مع كل المشغلات)
fn open_with_default_player(p: &PathBuf) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &p.to_string_lossy()])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(p)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// بث الأحداث للواجهة (اختياري)
pub fn emit_stream_progress(app: &AppHandle, id: u64, written: u64, total: u64) {
    use tauri::Emitter;
    let _ = app.emit("desktop://stream", json!({"id": id, "written": written, "total": total}));
}

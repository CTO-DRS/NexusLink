// NexusLink Desktop — مراقب الحافظة الحي على مستوى النظام (FA-clipboard-sync)
// ============================================================================
// «حافظة موحدة على مستوى نظام التشغيل» — العقد في docs/protocol-contract.md §11:
//
//  (اتجاه الكمبيوتر → الهاتف) خيط مراقبة خلفي باستقصاء كل 1 ثانية عبر arboard:
//    · ملفات منسوخة (Ctrl+C على ملف) → get().file_list() → اقتراح نقل للهاتف
//      (نسخ إلى pc-fs/Inbox + POST /api/devices send-file → tx:offer للوكيل الحقيقي
//      + عنصر تاريخ kind=file في الحافظة الموحدة).
//    · نص → get().text() → في الوضع التلقائي وحده وبحد maxAutoBytes:
//      POST /api/prod/clipboard (mode=auto) → prodEmit(clip:new) → الهاتف يكتب
//      حافظته فورًا (عقد §11.ب).
//    · صورة → get().image() (RGBA) → ترميز PNG → ملف صورة في Inbox → إرسال
//      كملف تلقائيًا + عنصر تاريخ kind=image (dataURL مختصر إن سَع).
//    · الوضع اليدوي: كل التدفقات التلقائية تتوقف — الإرسال صراحة فقط
//      (Ctrl+Shift+N / زر الواجهة عبر clip_send_now).
//
//  (اتجاه الهاتف → الكمبيوتر) الويبفيو يستقبل clip:new (deviceId غريب) ويستدعي
//    الأمر الأصلي clip_apply → arboard set_text / set_image — يعمل والنافذة
//    مخفية في الـ Tray. الأوامر تعلّم بصمة المحتوى المطبّق (APPLIED_*) كي لا
//    يعيد المراقب إرساله (حرس الاسترجاع التعاقدي §11.ج — بلا حلقات).
//
//  التواقيع المستعملة مُتحقَّق منها من مصدر arboard 3.6 (src/lib.rs):
//    Clipboard::new() / get().text() / get().image() / get().file_list()
//    set().text(Cow<str>) / set().image(ImageData{width,height,bytes RGBA})
use serde_json::json;
use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;

const MODE_AUTO: u8 = 0;
const MODE_MANUAL: u8 = 1;

static MODE: AtomicU8 = AtomicU8::new(MODE_AUTO);
static MAX_AUTO_BYTES: AtomicUsize = AtomicUsize::new(1_048_576);

// بصمات الحرس — تمنع الاسترجاع (المراقب لا يعيد إرسال ما وصل من الهاتف،
// ولا يكرر إرسال ما أرسله للتو) مع مهلة بين إرسال القوائم المتطابقة
static SENT_TEXT: Mutex<Option<u64>> = Mutex::new(None);
static APPLIED_TEXT: Mutex<Option<u64>> = Mutex::new(None);
static LAST_IMG_SENT: Mutex<Option<u64>> = Mutex::new(None);
static APPLIED_IMG: Mutex<Option<(usize, usize, Instant)>> = Mutex::new(None);
static SENT_FILES: Mutex<Option<(u64, Instant)>> = Mutex::new(None);
static LAST_CFG: Mutex<u64> = Mutex::new(0);

/// صورة dataURL تُخزن في عنصر التاريخ فقط إذا كان ترميزها تحت هذا الحد
const IMAGE_PREVIEW_CAP: usize = 300_000;
/// أقصى عدد ملفات في حدث نسخ واحد (منع جريان من مجلد كامل)
const MAX_FILES_PER_EVENT: usize = 10;
/// مهلة كبت صورة المطبّق من الهاتف (تحويلات DIB قد تغيّر البايتات)
const APPLIED_IMG_SUPPRESS: Duration = Duration::from_secs(10);

fn fnv64(parts: &[&[u8]]) -> u64 {
    let mut h = DefaultHasher::new();
    for p in parts {
        p.hash(&mut h);
    }
    h.finish()
}

fn auto_mode() -> bool {
    MODE.load(Ordering::Relaxed) == MODE_AUTO
}

fn max_auto() -> usize {
    MAX_AUTO_BYTES.load(Ordering::Relaxed)
}

/// تحديث الإعدادات من استطلاع الحالة (poll_native_events ← status.desktop.clip)
pub fn update_cfg(clip: &serde_json::Value) {
    let mode = clip.get("mode").and_then(|v| v.as_str()).unwrap_or("auto");
    let max = clip
        .get("maxAutoBytes")
        .and_then(|v| v.as_u64())
        .unwrap_or(1_048_576) as usize;
    let sig = fnv64(&[mode.as_bytes(), max.to_le_bytes().as_slice()]);
    {
        let last = LAST_CFG.lock().unwrap();
        if *last == sig {
            return;
        }
    }
    MODE.store(
        if mode == "manual" { MODE_MANUAL } else { MODE_AUTO },
        Ordering::Relaxed,
    );
    MAX_AUTO_BYTES.store(max.clamp(1024, 20_971_520), Ordering::Relaxed);
    *LAST_CFG.lock().unwrap() = sig;
    println!("[clip] cfg: mode={mode} maxAutoBytes={max}");
}

/// إقلاع خيط المراقبة الخلفية (مرة واحدة من setup)
pub fn spawn_monitor(app: AppHandle) {
    std::thread::Builder::new()
        .name("clipboard-monitor".into())
        .spawn(move || {
            println!("[clip] monitor started (1s poll, arboard)");
            loop {
                std::thread::sleep(Duration::from_millis(1000));
                let _ = poll_once(&app);
            }
        })
        .expect("clipboard monitor thread");
}

/// دورة مراقبة واحدة: ملفات ← نص ← صورة (أول ما ينطبق يكفي)
fn poll_once(app: &AppHandle) -> Result<(), String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;

    // (1) ملفات منسوخة — Windows: CF_HDROP · macOS: NSPasteboard URLs · Linux X11: text/uri-list
    if let Ok(files) = cb.get().file_list() {
        let real: Vec<PathBuf> = files
            .into_iter()
            .filter(|p| p.is_file())
            .take(MAX_FILES_PER_EVENT)
            .collect();
        if !real.is_empty() {
            let mut h = DefaultHasher::new();
            for f in &real {
                f.to_string_lossy().hash(&mut h);
            }
            let sig = h.finish();
            let dup = {
                let mut g = SENT_FILES.lock().unwrap();
                match *g {
                    Some((s, at)) if s == sig && at.elapsed() < Duration::from_secs(3) => true,
                    _ => {
                        *g = Some((sig, Instant::now()));
                        false
                    }
                }
            };
            if !dup && auto_mode() {
                // الوضع اليدوي: لا اقتراح نقل تلقائي — الإرسال صراحة فقط
                flow_files(app, &real);
            }
            return Ok(()); // وجود قائمة ملفات يغلب النص — لا نقرأ النص في نفس الدورة
        }
    }

    // (2) نص
    if let Ok(text) = cb.get().text() {
        if !text.trim().is_empty() {
            let sig = fnv64(&[text.as_bytes()]);
            let guard = {
                let sent = *SENT_TEXT.lock().unwrap();
                let applied = *APPLIED_TEXT.lock().unwrap();
                sent == Some(sig) || applied == Some(sig)
            };
            if !guard && auto_mode() && text.len() <= max_auto() {
                match crate::procman::push_clipboard_text_mode(&text, "auto") {
                    Ok(_) => {
                        *SENT_TEXT.lock().unwrap() = Some(sig);
                        println!("[clip] auto-sent text ({} chars)", text.len());
                    }
                    Err(e) => println!("[clip] auto-send text failed: {e}"),
                }
            }
            return Ok(());
        }
    }

    // (3) صورة
    if let Ok(img) = cb.get().image() {
        let sig = img_signature(&img);
        if !img_suppressed(&img, sig) {
            flow_image(app, &img, "auto", false);
        }
    }
    Ok(())
}

/// بصمة صورة رخيصة: الأبعاد + الحجم + رأس/ذيل البايتات
fn img_signature(img: &arboard::ImageData<'static>) -> u64 {
    let b = &img.bytes;
    let head = &b[..b.len().min(96)];
    let tail = &b[b.len().saturating_sub(96)..];
    fnv64(&[
        img.width.to_le_bytes().as_slice(),
        img.height.to_le_bytes().as_slice(),
        b.len().to_le_bytes().as_slice(),
        head,
        tail,
    ])
}

/// هل هذه الصورة هي التي طُبّقت للتو من الهاتف (نفس الأبعاد داخل مهلة الكبت)؟
fn img_suppressed(img: &arboard::ImageData<'static>, sig: u64) -> bool {
    if let Some((aw, ah, at)) = *APPLIED_IMG.lock().unwrap() {
        if aw == img.width && ah == img.height && at.elapsed() < APPLIED_IMG_SUPPRESS {
            return true;
        }
    }
    *LAST_IMG_SENT.lock().unwrap() == Some(sig)
}

/// تدفق الصورة: ترميز PNG → ملف في Inbox → إرسال كملف + عنصر تاريخ + إشعار
/// mode: "auto" (المراقب) | "manual" (زر الإرسال الصريح) — force يتجاوز حرس التكرار
fn flow_image(app: &AppHandle, img: &arboard::ImageData<'static>, mode: &str, force: bool) {
    if !force && mode == "auto" && !auto_mode() {
        return;
    }
    let sig = img_signature(img);
    if !force {
        *LAST_IMG_SENT.lock().unwrap() = Some(sig);
    }
    let png = match encode_png(img) {
        Ok(p) => p,
        Err(e) => {
            println!("[clip] image flow skipped: {e}");
            return;
        }
    };
    let name = format!(
        "clipboard-{}.png",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    match stage_to_inbox(app, &name, &png) {
        Ok((vname, size)) => {
            send_file_to_agent(&vname, size as u64);
            // عنصر تاريخ في الحافظة الموحدة — dataURL مختصر إن سَع
            use base64::Engine as _;
            let preview = base64::engine::general_purpose::STANDARD.encode(&png);
            let content = if preview.len() <= IMAGE_PREVIEW_CAP {
                format!("data:image/png;base64,{preview}")
            } else {
                String::new()
            };
            let _ = post_clip(json!({
                "kind": "image",
                "content": content,
                "fileName": vname,
                "filePath": format!("/Inbox/{vname}"),
                "size": size,
                "mode": mode,
            }));
            crate::notify::plain(app, "صورة من حافظة الكمبيوتر", &format!("{vname} — أُرسلت للهاتف"));
            println!("[clip] sent image {vname} ({size} bytes png, mode={mode})");
        }
        Err(e) => println!("[clip] image stage failed: {e}"),
    }
}

fn encode_png(img: &arboard::ImageData<'static>) -> Result<Vec<u8>, String> {
    let buf = image::RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.to_vec())
        .ok_or("حجم مخزن الصورة لا يطابق الأبعاد")?;
    let mut out = Vec::new();
    buf.write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .map_err(|e| format!("png encode: {e}"))?;
    Ok(out)
}

/// تدفق الملفات المنسوخة: نسخ إلى Inbox + اقتراح نقل للهاتف + عناصر تاريخ
fn flow_files(app: &AppHandle, files: &[PathBuf]) {
    let mut sent = 0usize;
    for p in files {
        let Some(name) = p.file_name().and_then(|s| s.to_str()).map(String::from) else {
            continue;
        };
        let bytes = match std::fs::read(p) {
            Ok(b) => b,
            Err(e) => {
                println!("[clip] read {p:?}: {e}");
                continue;
            }
        };
        match stage_to_inbox(app, &name, &bytes) {
            Ok((vname, size)) => {
                send_file_to_agent(&vname, size as u64);
                let _ = post_clip(json!({
                    "kind": "file",
                    "content": "",
                    "fileName": vname,
                    "filePath": format!("/Inbox/{vname}"),
                    "size": size,
                    "mode": "auto",
                }));
                sent += 1;
            }
            Err(e) => println!("[clip] stage {name}: {e}"),
        }
    }
    if sent > 0 {
        crate::notify::plain(app, "ملفات منسوخة — اقتراح نقل", &format!("أُرسلت {sent} كاقتراح نقل إلى الهاتف"));
        println!("[clip] auto-sent {sent} file(s) as transfer suggestion");
    }
}

/// كتابة بايتات داخل pc-fs/Inbox باسم بديل غير حائزي — يعيد (الاسم، الحجم)
fn stage_to_inbox(app: &AppHandle, name: &str, bytes: &[u8]) -> Result<(String, usize), String> {
    let inbox = crate::procman::server_root(app)
        .join("data")
        .join("nexus-storage")
        .join("pc-fs")
        .join("Inbox");
    std::fs::create_dir_all(&inbox).map_err(|e| format!("mkdir: {e}"))?;
    let dest = crate::procman::unique_dest(&inbox, name);
    std::fs::write(&dest, bytes).map_err(|e| format!("write: {e}"))?;
    let vname = dest
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(name)
        .to_string();
    Ok((vname, bytes.len()))
}

/// POST /api/devices send-file — نفس عقد السحب والإفلات (tx:offer للوكيل الحقيقي)
fn send_file_to_agent(vname: &str, size: u64) {
    let agent = crate::procman::current_agent_id();
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
    match crate::procman::post_json("/api/devices", &body) {
        Ok(v) if v["ok"] == true => {}
        Ok(v) => println!("[clip] send-file refused: {v}"),
        Err(e) => println!("[clip] send-file failed: {e}"),
    }
}

/// POST /api/prod/clipboard — عنصر حافظة موحدة (يُبث clip:new للجميع)
fn post_clip(mut body: serde_json::Value) -> Result<(), String> {
    let obj = body.as_object_mut().ok_or("body")?;
    obj.entry("deviceId").or_insert(json!("pc-office"));
    obj.entry("deviceName").or_insert(json!(crate::procman::machine_name()));
    crate::procman::post_json("/api/prod/clipboard", &body)
        .map(|_| ())
        .map_err(|e| format!("clip post: {e}"))
}

/// تطبيق عنصر قادم من الهاتف على حافظة النظام (يستدعيه الويبفيو عبر clip_apply)
pub fn apply_incoming(kind: &str, content: &str) -> Result<(), String> {
    match kind {
        "text" => {
            if content.trim().is_empty() {
                return Err("نص فارغ".into());
            }
            let mut cb = arboard::Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
            cb.set()
                .text(content.to_string())
                .map_err(|e| format!("set text: {e}"))?;
            *APPLIED_TEXT.lock().unwrap() = Some(fnv64(&[content.as_bytes()]));
            println!("[clip] applied text from phone ({} chars)", content.len());
            Ok(())
        }
        "image" => {
            let b64 = content
                .strip_prefix("data:image/png;base64,")
                .ok_or("dataURL صورة غير مدعوم")?;
            use base64::Engine as _;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| format!("base64: {e}"))?;
            let dyn_img = image::load_from_memory(&bytes).map_err(|e| format!("decode: {e}"))?;
            let rgba = dyn_img.to_rgba8();
            let (w, h) = (rgba.width() as usize, rgba.height() as usize);
            let mut cb = arboard::Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
            cb.set()
                .image(arboard::ImageData {
                    width: w,
                    height: h,
                    bytes: Cow::Owned(rgba.into_raw()),
                })
                .map_err(|e| format!("set image: {e}"))?;
            *APPLIED_IMG.lock().unwrap() = Some((w, h, Instant::now()));
            println!("[clip] applied image from phone ({w}x{h})");
            Ok(())
        }
        other => Err(format!("نوع غير مدعوم: {other}")),
    }
}

/// زر الإرسال اليدوي الحالي: قراءة حافظة النظام الآن وإرسال نصها (بلا حد الحجم)
pub fn send_now_text() -> Result<usize, String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
    let text = cb.get().text().map_err(|e| format!("read: {e}"))?;
    if text.trim().is_empty() {
        return Err("الحافظة لا تحتوي نصًا".into());
    }
    crate::procman::push_clipboard_text_mode(&text, "manual")?;
    *SENT_TEXT.lock().unwrap() = Some(fnv64(&[text.as_bytes()]));
    Ok(text.len())
}

/// زر الإرسال اليدوي — صورة: قراءة صورة الحافظة وإرسالها كملف (يتجاوز حرس التكرار)
pub fn send_now_image(app: &AppHandle) -> Result<usize, String> {
    let mut cb = arboard::Clipboard::new().map_err(|e| format!("clipboard: {e}"))?;
    let img = cb.get().image().map_err(|e| format!("read image: {e}"))?;
    let n = img.bytes.len();
    flow_image(app, &img, "manual", true);
    Ok(n)
}

// ==================== أوامر Tauri (عقد §11 — يستدعيها الويبفيو) ====================

/// تطبيق عنصر حافظة قادم من الهاتف على حافظة النظام (text | image-dataURL)
#[tauri::command]
pub fn clip_apply(app: AppHandle, kind: String, content: String) -> Result<(), String> {
    let _ = &app; // التطبيق متاح للتوسعات (إشعارات مثلاً) — التطبيق فوري هنا
    apply_incoming(&kind, &content)
}

/// زر «إرسال الحافظة الحالية»: نص فورًا، وإلا صورة → ملف في خيط منفصل
#[tauri::command]
pub fn clip_send_now(app: AppHandle) -> Result<String, String> {
    match send_now_text() {
        Ok(n) => Ok(format!("text:{n}")),
        Err(te) => {
            let app2 = app.clone();
            std::thread::spawn(move || {
                if let Err(e) = send_now_image(&app2) {
                    println!("[clip] send-now image failed: {e}");
                }
            });
            Err(te) // الواجهة تعرض الرسالة؛ الصورة تُجرّب خلفيًا
        }
    }
}

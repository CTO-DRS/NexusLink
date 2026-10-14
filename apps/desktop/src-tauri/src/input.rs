// NexusLink Desktop — جلسة التحكم بالكمبيوتر من الهاتف (FA-input — عقد §13)
// ============================================================================
// «شاشة Touchpad تتحكم بالكمبيوتر فعليًا»: أحداث الإدخال قادمة من الهاتف عبر
// جسر 3004 (rc:move/click/scroll/pinch/key/presenter/media) → الويبفيو الدائم
// (desktop-bridge) → قناة رسائل → خيط input-exec (enigo) → النظام الحقيقي.
//
// الأمان (متطلبات البند 7):
//  · قصرها على الأجهزة الموثوقة: أحداث مصدرها "controller" تُنفَّذ فقط خلال
//    جلسة نشطة بدأها جهاز موثوق (حاجز الثقة على الجسر يسبقنا)؛ أحداث
//    "desktop-local" هي واجهة الكمبيوتر نفسها (صاحب الجهاز).
//  · إشعار مرئي دائم: أيقونة Tray تتحول بنفسجيًا + عنصر «جلسة تحكم: <اسم>»
//    + tooltip حي + إشعار نظام عند البدء/الانتهاء + لافتة داخل الواجهة.
//  · القطع الفوري: زر «إنهاء جلسة التحكم» في الـ Tray يقطع فورًا ويرفض ما بعده،
//    + watchdog محلي (بلا أحداث 15ث → إنهاء) فوق watchdog الجسر (6ث نبض).
//  · لا زر معلق على المستخدم: نهاية الجلسة تحرر زر السحب إن كان معلقًا.
//
// ماك: حقن الإدخال يتطلب صلاحية Accessibility — تدفق الإذن (بند 6):
//  · input_permission: فحص AXIsProcessTrustedWithOptions (FFI مباشر بلا crates)
//  · input_open_permissions: فتح System Settings ← Privacy ← Accessibility
//  · فشل الحقن يبث desktop://input-error → الواجهة تعرض الإرشاد العربي
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// الجولة 4 مرحلة ② — الوحدة عليا في main.rs (crate::input_exec) وتُعاد
// هنا بالاسم التاريخي exec — ترجمة واحدة وstatics واحدة (بلا نسخة موازية)
pub use crate::input_exec as exec;

use enigo::{Enigo, Settings};

struct SessionInfo {
    name: String,
    device_id: Option<String>,
    #[allow(dead_code)]
    started_at: u64,
}

static SESSION: Mutex<Option<SessionInfo>> = Mutex::new(None);
static LAST_EVENT_MS: AtomicU64 = AtomicU64::new(0);
static WATCHDOG: OnceLock<()> = OnceLock::new();

// ---------------------------------------------------------------------------
// خيط التنفيذ المخصص — Enigo يعيش داخل خيط واحد فقط (لا static Mutex):
// أنواع CG على ماك (CGEventSource/CGDisplay) غير مضمونة Send — قناة الرسائل
// تغلب المشكلة كليًا وتمنح دفعات الحركة مسارًا واحدًا مرتبًا (عقد §13).
// ---------------------------------------------------------------------------
enum InputMsg {
    Exec { events: Vec<serde_json::Value>, app: tauri::AppHandle },
    /// NexusLive (عقد §18) — دفعة قناة حية: نفس التنفيذ + إشعار اكتمال الحقن
    /// الفعلي في خيط enigo (قياس كمون طرف-إلى-طرف صادق — لا جدولة فقط).
    ExecSync { events: Vec<serde_json::Value>, app: tauri::AppHandle, done: mpsc::Sender<()> },
    ResetDrag,
}

static INPUT_TX: OnceLock<mpsc::Sender<InputMsg>> = OnceLock::new();

fn exec_channel(app: &tauri::AppHandle) -> mpsc::Sender<InputMsg> {
    INPUT_TX
        .get_or_init(|| {
            let (tx, rx) = mpsc::channel::<InputMsg>();
            let _ = std::thread::Builder::new().name("input-exec".into()).spawn(move || {
                let mut enigo: Option<Enigo> = None;
                for msg in rx {
                    // بناء المحرك كسولًا عند أول استخدام (X11/نظام الإدخال)
                    if enigo.is_none() {
                        let s = Settings { release_keys_when_dropped: false, ..Default::default() };
                        match Enigo::new(&s) {
                            Ok(e) => enigo = Some(e),
                            Err(e) => {
                                println!("[input] enigo init failed: {e}");
                                if let InputMsg::Exec { app, .. } = &msg {
                                    emit(
                                        app,
                                        "desktop://input-error",
                                        json!({"op": "init", "error": format!("تعذر تهيئة محرك الإدخال: {e}")}),
                                    );
                                }
                                continue; // إعادة المحاولة مع الدفعة التالية
                            }
                        }
                    }
                    let en = enigo.as_mut().unwrap();
                    match msg {
                        InputMsg::Exec { events, app } => {
                            exec_events(en, &events, &app);
                        }
                        InputMsg::ExecSync { events, app, done } => {
                            exec_events(en, &events, &app);
                            let _ = done.send(()); // اكتمل الحقن الفعلي — المستدعي يقيس المدة
                        }
                        InputMsg::ResetDrag => {
                            exec::reset_drag(en);
                            // §20 — تصفير حالة الفرشاة/اللوحة مع نهاية الجلسة
                            exec::brush_reset();
                            crate::tablet::session_ended();
                        }
                    }
                }
            });
            tx
        })
        .clone()
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// حلقة تنفيذ دفعة واحدة مشتركة بين المسارين (الجسر وNexusLive) — مصدر واحد
fn exec_events(en: &mut Enigo, events: &[serde_json::Value], app: &tauri::AppHandle) {
    for ev in events {
        if let Err(e) = exec::apply_event(en, ev) {
            // فشل الحقن (مثال: بلا صلاحية Accessibility على ماك) — يُبث للواجهة
            emit(app, "desktop://input-error", json!({"op": ev.get("kind"), "error": e}));
        }
    }
}

pub fn is_active() -> bool {
    SESSION.lock().unwrap().is_some()
}

/// ضبط مفوّض الصوت لكل منصة (يستدعى من setup — عقد §13)
pub fn init() {
    #[cfg(target_os = "macos")]
    exec::set_volume_override(macos_volume);
    #[cfg(windows)]
    exec::set_volume_override(windows_volume);
    println!("[input] ready");
}

// ---------------------------------------------------------------------------
// ضبط الصوت المطلق — macOS عبر osascript (مستوى 0..100 دقيق) — ينفَّذ داخل
// خيط input-exec (القناة ترسل الرسائل فقط؛ المفوّض يُستدعى من apply_media)
// ---------------------------------------------------------------------------
#[cfg(target_os = "macos")]
fn macos_volume(_enigo: &mut Enigo, v: f64) -> Result<(), String> {
    let out = std::process::Command::new("osascript")
        .args(["-e", &format!("set volume output volume {:.0}", v)])
        .output()
        .map_err(|e| format!("osascript: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

// ---------------------------------------------------------------------------
// ضبط الصوت المطلق — Windows عبر نقرات مفاتيح الصوت مع مرآة مستوى مُتبَّعة
// (بلا COM: كل نقرة VK_VOLUME_UP/DOWN = 2% — انزياح ممكن إن غيّر المستخدم
// الصوت فعليًا؛ يُصحّح تلقائيًا عند 0/100 — موثق بصدق في العقد §13)
// ---------------------------------------------------------------------------
#[cfg(windows)]
static VOL_MIRROR: AtomicU64 = AtomicU64::new(50);

#[cfg(windows)]
fn windows_volume(enigo: &mut Enigo, v: f64) -> Result<(), String> {
    use enigo::{Direction, Key, Keyboard};
    let cur = VOL_MIRROR.load(Ordering::Relaxed) as f64;
    let steps = ((v - cur) / 2.0).round() as i32;
    let key = if steps >= 0 { Key::VolumeUp } else { Key::VolumeDown };
    for _ in 0..steps.abs().min(50) {
        enigo.key(key, Direction::Click).map_err(|e| format!("مفتاح صوت فشل: {e}"))?;
    }
    VOL_MIRROR.store(v.round().clamp(0.0, 100.0) as u64, Ordering::Relaxed);
    Ok(())
}

fn emit(app: &tauri::AppHandle, event: &str, payload: serde_json::Value) {
    use tauri::Emitter;
    let _ = app.emit(event, payload);
}

// ---------------------------------------------------------------------------
// الجلسة — بدء/إنهاء + watchdog + Tray + إشعارات
// ---------------------------------------------------------------------------

pub fn start(app: &tauri::AppHandle, name: &str, device_id: Option<String>) -> Result<String, String> {
    // فحص جاهزية مبكر — يفشل واضحًا إن تعذّر النظام (بلا جلسة وهمية).
    // غياب إذن Accessibility على ماك لا يمنع البدء: فشل الحقن يُدرَك لاحقًا عبر
    // desktop://input-error → الويبفيو يفتح الإعدادات + الإرشاد العربي (بند 6).
    ensure_exec_ready(app)?;
    {
        let mut g = SESSION.lock().unwrap();
        if g.is_some() {
            // نفس الجهاز يعيد البدء → تحديث فقط
            if g.as_ref().and_then(|s| s.device_id.clone()) == device_id {
                let started_at = g.as_ref().map(|s| s.started_at).unwrap_or(0);
                *g = Some(SessionInfo { name: name.to_string(), device_id: device_id.clone(), started_at });
                return Ok("جلسة التحكم مستمرة".into());
            }
            return Err("جلسة تحكم أخرى نشطة — أنهِها أولًا".into());
        }
        *g = Some(SessionInfo { name: name.to_string(), device_id: device_id.clone(), started_at: now_ms() });
    }
    LAST_EVENT_MS.store(now_ms(), Ordering::Relaxed);
    spawn_watchdog(app.clone());
    crate::tray::update_session(app, Some(name));
    crate::notify::plain(
        app,
        "جلسة تحكم نشطة",
        &format!("الهاتف «{name}» يتحكم بالكمبيوتر — الإنهاء الفوري من أيقونة الشريط"),
    );
    emit(app, "desktop://input-session", json!({"active": true, "name": name, "deviceId": device_id}));
    println!("[input] session started: {name}");
    Ok(format!("بدأت جلسة التحكم من {name}"))
}

pub fn stop(app: &tauri::AppHandle, reason: &str) -> bool {
    let had = SESSION.lock().unwrap().take().is_some();
    if !had {
        return false;
    }
    // لا زر معلق على المستخدم بعد انتهاء الجلسة
    let _ = exec_channel(app).send(InputMsg::ResetDrag);
    crate::tray::update_session(app, None);
    if reason == "timeout" || reason == "disconnected" {
        // الإنهاء من الشريط فعله المستخدم (بلا إشعار)؛ فقدان الهاتف/الانقطاع
        // يستحق بلاغًا — عاد التحكم الحصري للكمبيوتر
        crate::notify::plain(app, "انتهت جلسة التحكم", "عاد التحكم الحصري إلى الكمبيوتر");
    }
    emit(app, "desktop://input-session", json!({"active": false, "reason": reason}));
    println!("[input] session stopped: {reason}");
    true
}

/// إنهاء من قائمة الـ Tray — القطع الفوري (بند 7)
pub fn stop_from_tray(app: &tauri::AppHandle) {
    if stop(app, "desktop-stop") {
        println!("[input] session cut from tray");
    }
}

/// watchdog محلي: جلسة نشطة بلا أي أحداث 15ث → إنهاء تلقائي (حارس ثانٍ فوق
/// نبض الجسر 6ث — يغطي انقطاع الويبفيو نفسه)
fn spawn_watchdog(app: tauri::AppHandle) {
    if WATCHDOG.set(()).is_err() {
        return; // أُطلق مسبقًا
    }
    std::thread::Builder::new()
        .name("input-watchdog".into())
        .spawn(move || loop {
            std::thread::sleep(Duration::from_secs(2));
            if SESSION.lock().unwrap().is_some() {
                let last = LAST_EVENT_MS.load(Ordering::Relaxed);
                if last != 0 && now_ms().saturating_sub(last) > 15_000 {
                    stop(&app, "timeout");
                }
            }
        })
        .ok();
}

// ---------------------------------------------------------------------------
// التنفيذ — دفعات أحداث من الويبفيو (عقد §13) → خيط input-exec عبر قناة
// ---------------------------------------------------------------------------

/// فحص جاهزية مبكر عند بدء الجلسة (بناء محرك تجريبي في خيط عابر):
/// يكشف أخطاء النظام الحقيقية (بلا X11 مثلاً) قبل قبول الجلسة.
fn ensure_exec_ready(app: &tauri::AppHandle) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<Result<(), String>>();
    let _ = std::thread::Builder::new().name("input-probe".into()).spawn(move || {
        let s = Settings { release_keys_when_dropped: false, ..Default::default() };
        let r = Enigo::new(&s).map(|_| ()).map_err(|e| format!("تعذر تهيئة محرك الإدخال: {e}"));
        let _ = tx.send(r);
    });
    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(res) => res,
        Err(_) => {
            // الخيط معلق (نادر) — لا نمنع الجلسة؛ القناة المعتادة ستتولى
            let _ = exec_channel(app);
            Ok(())
        }
    }
}

/// NexusLive (عقد §18) — حقن متزامن: يحجب حتى اكتمال تنفيذ الدفعة في خيط
/// enigo فعلًا (المدة يقيسها live.rs بساعتها). نفس بوابة الجلسة الأصلية §13 —
/// بلا مسار حقن موازٍ: نفس القناة ونفس المحرك ونفس فشل الـ Accessibility.
pub fn execute_sync(app: &tauri::AppHandle, events: &[serde_json::Value], source: &str) -> Result<(), String> {
    // بوابة الأمان نفسها في execute (مرآة حرفية — مسار واحد للثقة)
    if source != "desktop-local" && !is_active() {
        return Err("لا جلسة تحكم نشطة — ابدأ الجلسة من الهاتف الموثوق أولًا".into());
    }
    LAST_EVENT_MS.store(now_ms(), Ordering::Relaxed);
    let (tx, rx) = mpsc::channel::<()>();
    exec_channel(app)
        .send(InputMsg::ExecSync { events: events.to_vec(), app: app.clone(), done: tx })
        .map_err(|e| format!("قناة التنفيذ مغلقة: {e}"))?;
    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|_| "انتهت مهلة اكتمال الحقن (خيط enigo مشغول/معلق)".to_string())
}

pub fn execute(app: &tauri::AppHandle, events: &[serde_json::Value], source: &str) -> Result<String, String> {
    // بوابة الأمان: أحداث هاتف (controller) خلال جلسة نشطة فقط؛
    // desktop-local = واجهة الكمبيوتر نفسها (صاحب الجهاز).
    if source != "desktop-local" && !is_active() {
        return Err("لا جلسة تحكم نشطة — ابدأ الجلسة من الهاتف الموثوق أولًا".into());
    }
    LAST_EVENT_MS.store(now_ms(), Ordering::Relaxed);
    let tx = exec_channel(app);
    tx.send(InputMsg::Exec { events: events.to_vec(), app: app.clone() })
        .map_err(|e| format!("قناة التنفيذ مغلقة: {e}"))?;
    Ok(format!("جدولة تنفيذ {} حدثًا", events.len()))
}

// ---------------------------------------------------------------------------
// صلاحية Accessibility على ماك (FFI مباشر — بلا crates جديدة)
// ---------------------------------------------------------------------------
#[cfg(target_os = "macos")]
mod ax {
    // أنواع معتمة — مؤشرات CF فقط
    #[repr(C)]
    struct __CFString([u8; 0]);
    type CFStringRef = *const __CFString;
    type CFDictionaryRef = *const std::ffi::c_void;
    type CFBooleanRef = *const std::ffi::c_void;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        /// CFBooleanTrue الثابت — القيمة نفسها مؤشر معتم (لا كائن نُنشئه)
        static kCFBooleanTrue: CFBooleanRef;
    }

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        static kAXTrustedCheckOptionPrompt: CFStringRef;
        fn AXIsProcessTrustedWithOptions(options: CFDictionaryRef) -> u8;
        fn CFDictionaryCreateMutable(
            allocator: *const std::ffi::c_void,
            capacity: isize,
            key_callbacks: *const std::ffi::c_void,
            value_callbacks: *const std::ffi::c_void,
        ) -> CFDictionaryRef;
        fn CFDictionarySetValue(dict: CFDictionaryRef, key: CFStringRef, value: CFBooleanRef);
    }

    /// فحص إذن Accessibility — prompt=true يطلب من النظام عرض حوار الإذن
    pub fn trusted(prompt: bool) -> bool {
        unsafe {
            if !prompt {
                // قاموس فارغ = فحص قراءة فقط بلا حوار
                return AXIsProcessTrustedWithOptions(std::ptr::null()) != 0;
            }
            let dict = CFDictionaryCreateMutable(std::ptr::null(), 1, std::ptr::null(), std::ptr::null());
            if dict.is_null() {
                return false;
            }
            CFDictionarySetValue(dict, kAXTrustedCheckOptionPrompt, kCFBooleanTrue);
            AXIsProcessTrustedWithOptions(dict) != 0
        }
    }
}

#[cfg(target_os = "macos")]
fn ax_trusted(prompt: bool) -> bool {
    ax::trusted(prompt)
}
#[cfg(not(target_os = "macos"))]
fn ax_trusted(_prompt: bool) -> bool {
    true // ويندوز/لينكس لا يحتاجان إذن Accessibility
}

// ---------------------------------------------------------------------------
// أوامر Tauri (يستدعيها الويبفيو — عقد §13)
// ---------------------------------------------------------------------------

/// دفعة أحداث إدخال: source = "desktop-local" (واجهة الكمبيوتر) | "controller"
#[tauri::command]
pub fn input_exec(
    app: tauri::AppHandle,
    events: Vec<serde_json::Value>,
    source: Option<String>,
) -> Result<String, String> {
    execute(&app, &events, source.as_deref().unwrap_or("controller"))
}

/// حالة جلسة التحكم (بدء من الجسر / إنهاء من أي طرف)
#[tauri::command]
pub fn input_session(
    app: tauri::AppHandle,
    active: bool,
    name: Option<String>,
    device_id: Option<String>,
) -> Result<String, String> {
    if active {
        start(&app, name.as_deref().unwrap_or("جهاز تحكم"), device_id)
    } else {
        if stop(&app, "phone-stop") {
            Ok("انتهت جلسة التحكم".into())
        } else {
            Ok("لا جلسة نشطة".into())
        }
    }
}

/// فحص إذن Accessibility (ماك) — true على بقية المنصات
#[tauri::command]
pub fn input_permission() -> serde_json::Value {
    json!({"granted": ax_trusted(false), "platform": std::env::consts::OS})
}

/// فتح إعدادات الأمان ← Accessibility (ماك) — بلا فعل على بقية المنصات
#[tauri::command]
pub fn input_open_permissions() -> bool {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
        true
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

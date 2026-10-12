// NexusLink Desktop — جلسة التحكم بالكمبيوتر من الهاتف (FA-input — عقد §13)
// ============================================================================
// «شاشة Touchpad تتحكم بالكمبيوتر فعليًا»: أحداث الإدخال قادمة من الهاتف عبر
// جسر 3004 (rc:move/click/scroll/pinch/key/presenter/media) → الويبفيو الدائم
// (desktop-bridge) → input_exec (enigo) → النظام الحقيقي.
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
//  · فشل enigo يبث desktop://input-error → الواجهة تعرض الإرشاد العربي
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[path = "input_exec.rs"]
pub mod exec;

use enigo::{Enigo, Settings};

struct SessionInfo {
    name: String,
    device_id: Option<String>,
    started_at: u64,
}

static SESSION: Mutex<Option<SessionInfo>> = Mutex::new(None);
static LAST_EVENT_MS: AtomicU64 = AtomicU64::new(0);
static WATCHDOG: OnceLock<()> = OnceLock::new();
static ENIGO: Mutex<Option<Enigo>> = Mutex::new(None);

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn is_active() -> bool {
    SESSION.lock().unwrap().is_some()
}

pub fn session_name() -> Option<String> {
    SESSION.lock().unwrap().as_ref().map(|s| s.name.clone())
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
// ضبط الصوت المطلق — macOS عبر osascript (مستوى 0..100 دقيق)
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

// ---------------------------------------------------------------------------
// محرك enigo — يُنشأ عند أول استخدام (اتصال X11/نظام عند البناء)
// ---------------------------------------------------------------------------
fn with_enigo<T>(f: impl FnOnce(&mut Enigo) -> Result<T, String>) -> Result<T, String> {
    let mut guard = ENIGO.lock().unwrap();
    if guard.is_none() {
        // release_keys_when_dropped=false — ندير المفاتيح بأنفسنا (Ctrl للقرص)
        let s = Settings { release_keys_when_dropped: false, ..Default::default() };
        *guard = Some(Enigo::new(&s).map_err(|e| format!("تعذر تهيئة محرك الإدخال: {e}"))?);
    }
    f(guard.as_mut().unwrap())
}

fn emit(app: &tauri::AppHandle, event: &str, payload: serde_json::Value) {
    use tauri::Emitter;
    let _ = app.emit(event, payload);
}

// ---------------------------------------------------------------------------
// الجلسة — بدء/إنهاء + watchdog + Tray + إشعارات
// ---------------------------------------------------------------------------

pub fn start(app: &tauri::AppHandle, name: &str, device_id: Option<String>) -> Result<String, String> {
    // تهيئة محرك الإدخال الآن (يفشل مبكرًا وواضحًا — مثلاً بلا صلاحية على ماك)
    with_enigo(|_| Ok(()))?;
    {
        let mut g = SESSION.lock().unwrap();
        if g.is_some() {
            // نفس الجهاز يعيد البدء → تحديث فقط
            if g.as_ref().map(|s| s.device_id.clone()).flatten() == device_id {
                let started_at = g.as_ref().unwrap().started_at;
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
    let _ = with_enigo(|e| exec::reset_drag(e).map(|_| ()));
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
// التنفيذ — دفعات أحداث من الويبفيو (عقد §13)
// ---------------------------------------------------------------------------
pub fn execute(app: &tauri::AppHandle, events: &[serde_json::Value], source: &str) -> Result<String, String> {
    // بوابة الأمان: أحداث هاتف (controller) خلال جلسة نشطة فقط؛
    // desktop-local = واجهة الكمبيوتر نفسها (صاحب الجهاز).
    if source != "desktop-local" && !is_active() {
        return Err("لا جلسة تحكم نشطة — ابدأ الجلسة من الهاتف الموثوق أولًا".into());
    }
    LAST_EVENT_MS.store(now_ms(), Ordering::Relaxed);
    let mut done = 0usize;
    let mut first_err: Option<String> = None;
    for ev in events {
        let r = with_enigo(|e| exec::apply_event(e, ev));
        match r {
            Ok(_) => done += 1,
            Err(e) => {
                // فشل الحقن (مثال: بلا صلاحية Accessibility على ماك) — يُبث للواجهة
                if first_err.is_none() {
                    first_err = Some(e.clone());
                }
                emit(app, "desktop://input-error", json!({"op": ev.get("kind"), "error": e}));
            }
        }
    }
    if let Some(e) = first_err {
        return Err(e);
    }
    Ok(format!("نُفِّذ {done} حدثًا"))
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

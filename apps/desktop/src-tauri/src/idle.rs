// NexusLink Desktop — كشف الخمول ووضع توفير النشاط (FA-harden — عقد §16)
// ============================================================
// بند 1 (قفل عند الخمول) + بند 4 (تحسين الخمول) معًا من مصدر حقيقة واحد:
// · idle_secs() — ثوانٍ منذ آخر إدخال فعلي لكل منصة:
//     Windows GetLastInputInfo (user32) · macOS CGEventSource · Linux X11 XScreenSaver
//     (Wayland: غير مدعوم بلا معيار موحد — يُعاد None بصدق وتتعطل ميزتا الخمول بأمان).
// · مراقب 15s: تجاوز عتبة «تحسين الخمول» (idle.optMinutes من الإعدادات المشتركة)
//   → وضع الخمول: مراقب الحافظة يتوقف عن الاستطلاع + الواجهة تخفف استطلاعاتها
//   (حدث desktop://idle) — أقل دوران وحدة معالجة = استهلاك طاقة أدنى.
// · قفل الخمول: تجاوز idleLockMin (إن كان appLock.enabled) → قفل التطبيق.
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

static IDLE_MODE: AtomicBool = AtomicBool::new(false);
static LAST_IDLE_EMITTED: AtomicBool = AtomicBool::new(false);

pub fn is_idle_mode() -> bool {
    IDLE_MODE.load(Ordering::Relaxed)
}

// ---------------------------------------------------------------------------
// idle_secs — لكل منصة
// ---------------------------------------------------------------------------

#[cfg(windows)]
pub fn idle_secs() -> Option<f64> {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    let ok = unsafe { GetLastInputInfo(&mut info) };
    if !ok.as_bool() {
        return None;
    }
    let now = unsafe { GetTickCount() };
    // dwTime يتلف عند التفاف العداد (49 يومًا) — الفرق المغلف صحيح حسابيًا
    let delta = now.wrapping_sub(info.dwTime);
    Some(delta as f64 / 1000.0)
}

#[cfg(target_os = "macos")]
pub fn idle_secs() -> Option<f64> {
    // CGEventTypes.h — API عام:
    // CFTimeInterval CGEventSourceSecondsSinceLastEventType(CGEventSourceStateID, CGEventType)
    // kCGEventSourceStateCombinedSessionState = 0 · kCGAnyInputEventType = (CGEventType)(~0) → -1 كـ int
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state_id: i32, mask: i32) -> f64;
    }
    Some(unsafe { CGEventSourceSecondsSinceLastEventType(0, -1) })
}

#[cfg(target_os = "linux")]
pub fn idle_secs() -> Option<f64> {
    use x11rb::connection::Connection;
    use x11rb::protocol::screensaver::ConnectionExt as _;
    let (conn, screen) = x11rb::connect(None).ok()?;
    let root = conn.setup().roots.get(screen)?.root;
    let reply = conn.screensaver_query_info(root).ok()?.reply().ok()?;
    Some(reply.ms as f64 / 1000.0)
}

// ---------------------------------------------------------------------------
// المراقب — 15s (رخيص جدًا: استدعاء نظام واحد كل دورة)
// ---------------------------------------------------------------------------

pub fn spawn_idle_watcher(app: AppHandle) {
    std::thread::Builder::new()
        .name("idle-watcher".into())
        .spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(15));
            tick(&app);
        })
        .expect("idle watcher thread");
}

fn tick(app: &AppHandle) {
    let Some(secs) = idle_secs() else {
        // منصة بلا كشف خمول (Wayland) — لا وضع خمول ولا قفل خمول (موثق بصدق)
        set_idle(app, false);
        return;
    };
    let cfg = crate::settings::get();

    // (أ) وضع تحسين الخمول (بند 4)
    let opt_min = cfg.idle_opt_minutes as f64;
    set_idle(app, opt_min > 0.0 && secs >= opt_min * 60.0);

    // (ب) قفل الخمول (بند 1) — appLock.enabled + idleLockMin > 0
    let lock_min = cfg.idle_lock_minutes;
    if cfg.app_lock_enabled && lock_min > 0 && secs >= (lock_min as f64) * 60.0 {
        crate::lock::lock_now(app, "idle");
    }
}

fn set_idle(app: &AppHandle, on: bool) {
    if on == LAST_IDLE_EMITTED.swap(on, Ordering::Relaxed) {
        return;
    }
    IDLE_MODE.store(on, Ordering::Relaxed);
    let _ = app.emit(
        "desktop://idle",
        json!({ "idle": on, "ts": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0) }),
    );
    println!("[idle] mode={on} — المراقبات والاستطلاعات {}", if on { "مخففة" } else { "مستأنفة" });
}

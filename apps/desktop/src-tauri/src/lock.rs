// NexusLink Desktop — قفل التطبيق: PIN + Windows Hello / Touch ID (FA-harden — بند 1)
// ============================================================
// · PIN: PBKDF2-HMAC-SHA256 (10k جولة) — الهاش والملح في config.json المحلي فقط
//   (لا يغادران الجهاز أبدًا؛ المخزن المشترك يحمل مرآة hasPin للعرض فقط).
// · بصمة: Windows Hello (UserConsentVerifier — Windows.Security.Credentials.UI)
//   / Touch ID (LocalAuthentication LAContext) — لينكس: غير مدعوم بصدق (PIN فقط).
// · نافذة القفل: lock.html (ضمن splash — نفس CSP) — إطار علوي دائم + مقفول أبعاده.
// · قفل الخمول: idle.rs يستدعي lock_now عند تجاوز idleLockMin.
use hmac::{Hmac, Mac};
use serde_json::json;
use sha2::Sha256;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

static LOCKED: AtomicBool = AtomicBool::new(false);
const PBKDF2_ROUNDS: u32 = 10_000;

pub fn is_locked() -> bool {
    LOCKED.load(Ordering::Relaxed)
}

// ---------------------------------------------------------------------------
// PBKDF2-HMAC-SHA256 — تنفيذ يدوي متحقق منه بمتجهات RFC (scripts/hardening-verify)
// ---------------------------------------------------------------------------

fn pbkdf2_hmac_sha256(password: &[u8], salt: &[u8], rounds: u32, out: &mut [u8; 32]) {
    let mut mac = Hmac::<Sha256>::new_from_slice(password).expect("hmac accepts any key length");
    mac.update(salt);
    mac.update(&[0, 0, 0, 1]); // INT(1) — كتلة أولى فقط (dkLen=32 = hLen)
    let mut u = mac.finalize().into_bytes();
    let mut acc = [0u8; 32];
    acc.copy_from_slice(&u);
    for _ in 1..rounds {
        let mut mac2 = mac.clone();
        mac2.update(&u);
        u = mac2.finalize().into_bytes();
        for (a, b) in acc.iter_mut().zip(u.iter()) {
            *a ^= *b;
        }
    }
    *out = acc;
}

pub fn hash_pin(pin: &str, salt: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    pbkdf2_hmac_sha256(pin.as_bytes(), salt, PBKDF2_ROUNDS, &mut out);
    out
}

fn random_salt() -> [u8; 16] {
    // مصدر عشوائية النظام — /dev/urandom على يونكس، BCryptGenRandom عبر windows crate
    #[cfg(unix)]
    {
        let mut s = [0u8; 16];
        use std::io::Read;
        std::fs::File::open("/dev/urandom")
            .and_then(|mut f| f.read_exact(&mut s))
            .expect("urandom");
        s
    }
    #[cfg(windows)]
    {
        use windows::Win32::Security::Authentication::Identity::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG};
        let mut s = [0u8; 16];
        unsafe {
            BCryptGenRandom(None, &mut s, BCRYPT_USE_SYSTEM_PREFERRED_RNG)
                .expect("BCryptGenRandom");
        }
        s
    }
}

// ---------------------------------------------------------------------------
// البصمة — لكل منصة
// ---------------------------------------------------------------------------

/// هل البصمة متاحة فعلًا (مُسجّلة ومدعومة)؟
pub fn biometric_available() -> bool {
    #[cfg(windows)]
    {
        return hello_available();
    }
    #[cfg(target_os = "macos")]
    {
        return touch_id_available();
    }
    #[cfg(target_os = "linux")]
    {
        false // غير مدعوم بصدق — PIN فقط
    }
}

/// محاولة فتح بالبصمة — Some(true)=نجحت، Some(false)=رفضت، None=غير متاحة/خطأ
pub fn biometric_verify(reason: &str) -> Option<bool> {
    #[cfg(windows)]
    {
        return hello_verify(reason);
    }
    #[cfg(target_os = "macos")]
    {
        return touch_id_verify(reason);
    }
    #[cfg(target_os = "linux")]
    {
        let _ = reason;
        None
    }
}

#[cfg(windows)]
fn hello_available() -> bool {
    use windows::Security::Credentials::UI::{UserConsentVerifier, UserConsentVerifierAvailability};
    com_init();
    match UserConsentVerifier::CheckAvailabilityAsync() {
        Ok(op) => match op.get() {
            Ok(v) => v == UserConsentVerifierAvailability::Available,
            Err(_) => false,
        },
        Err(_) => false,
    }
}

#[cfg(windows)]
fn hello_verify(reason: &str) -> Option<bool> {
    use windows::Security::Credentials::UI::{ConsentVerificationResult, UserConsentVerifier};
    use windows::core::HSTRING;
    com_init();
    let hint = HSTRING::from(reason);
    let op = UserConsentVerifier::RequestConsentVerificationAsync(&hint).ok()?;
    match op.get() {
        Ok(r) => Some(r == ConsentVerificationResult::Verified),
        Err(_) => None,
    }
}

#[cfg(windows)]
fn com_init() {
    use windows::Win32::System::Com::{CoInitializeEx, COINIT, HRESULT};
    unsafe {
        // RPC_E_CHANGED_MODE (0x80010106) مقبول — لقد هيأ الخيط شقته مسبقًا
        let hr: HRESULT = CoInitializeEx(None, COINIT::MULTITHREADED);
        let _ = hr;
    }
}

#[cfg(target_os = "macos")]
fn touch_id_available() -> bool {
    use objc2_local_authentication::{LAContext, LAPolicy};
    let ctx = unsafe { LAContext::new() };
    unsafe {
        ctx.canEvaluatePolicy_error(LAPolicy::DeviceOwnerAuthenticationWithBiometrics).is_ok()
    }
}

#[cfg(target_os = "macos")]
fn touch_id_verify(reason: &str) -> Option<bool> {
    use block2::RcBlock;
    use objc2_local_authentication::{LAContext, LAPolicy};
    let ctx = unsafe { LAContext::new() };
    let (tx, rx) = std::sync::mpsc::channel::<bool>();
    let blk = RcBlock::new(move |ok: objc2::runtime::Bool, _err: *mut NSObject| {
        let _ = tx.send(ok.as_bool());
    });
    let reason_ns = objc2_foundation::NSString::from_str(reason);
    unsafe {
        ctx.evaluatePolicy_localizedReason_reply(
            LAPolicy::DeviceOwnerAuthenticationWithBiometrics,
            &reason_ns,
            &blk,
        );
    }
    rx.recv_timeout(std::time::Duration::from_secs(30)).ok()
}

// ---------------------------------------------------------------------------
// دورة القفل
// ---------------------------------------------------------------------------

/// قفل التطبيق — من الشريط/الأمر/قفل الخمول. لا وسيلة فتح ⇒ تجاهل بصدق.
pub fn lock_now(app: &AppHandle, reason: &str) {
    let cfg = crate::settings::get();
    if !cfg.app_lock_enabled {
        return;
    }
    if LOCKED.swap(true, Ordering::Relaxed) {
        return; // مقفول بالفعل
    }
    let has_pin = cfg.pin_hash.is_some() && cfg.pin_salt.is_some();
    if !has_pin && !biometric_available() {
        LOCKED.store(false, Ordering::Relaxed);
        println!("[lock] لا وسيلة فتح (بلا PIN وبلا بصمة) — تجاهل القفل");
        return;
    }
    let app2 = app.clone();
    // إنشاء النوافذ على macOS يجب أن يكون في الخيط الرئيسي
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = app2.get_webview_window("lock") {
            let _ = w.show();
            let _ = w.set_focus();
        } else {
            let _ = WebviewWindowBuilder::new(&app2, "lock", WebviewUrl::App("lock.html".into()))
                .title("NexusLink — مقفول")
                .inner_size(420.0, 560.0)
                .resizable(false)
                .maximizable(false)
                .minimizable(false)
                .decorations(false)
                .always_on_top(true)
                .center()
                .focused(true)
                .build();
        }
    });
    crate::audit::audit("lock", "info", format!("قفل التطبيق ({reason})"));
}

fn unlock(app: &AppHandle) {
    LOCKED.store(false, Ordering::Relaxed);
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(w) = app2.get_webview_window("lock") {
            let _ = w.close();
        }
    });
    crate::audit::audit("lock", "info", "فتح التطبيق".to_string());
}

// ---------------------------------------------------------------------------
// أوامر الواجهة (lock.html + بطاقة الإعدادات)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn lock_state() -> serde_json::Value {
    let cfg = crate::settings::get();
    json!({
        "locked": is_locked(),
        "hasPin": cfg.pin_hash.is_some() && cfg.pin_salt.is_some(),
        "biometric": biometric_available(),
        "appLockEnabled": cfg.app_lock_enabled,
        "idleLockMin": cfg.idle_lock_minutes,
        "platform": std::env::consts::OS,
    })
}

#[tauri::command]
pub fn lock_set_pin(app: AppHandle, pin: String) -> serde_json::Value {
    let p = pin.trim();
    if p.len() < 4 || p.len() > 32 {
        return json!({ "ok": false, "error": "الرمز يجب أن يكون بين 4 و32 محرفًا" });
    }
    let salt = random_salt();
    let h = hash_pin(p, &salt);
    let hex = h.iter().map(|b| format!("{b:02x}")).collect::<String>();
    let salt_hex = salt.iter().map(|b| format!("{b:02x}")).collect::<String>();
    crate::settings::set_pin(Some(salt_hex), Some(hex));
    // مرآة hasPin للمخزن المشترك (الهاش نفسه لا يغادر الجهاز — عقد §16)
    crate::settings::push_shared(&app);
    crate::audit::audit("lock", "info", "ضبط رمز قفل التطبيق".to_string());
    json!({ "ok": true, "hasPin": true })
}

#[tauri::command]
pub fn lock_clear_pin(app: AppHandle) -> serde_json::Value {
    if is_locked() {
        return json!({ "ok": false, "error": "افتح القفل أولًا" });
    }
    crate::settings::set_pin(None, None);
    crate::settings::push_shared(&app);
    crate::audit::audit("lock", "warn", "مسح رمز قفل التطبيق".to_string());
    json!({ "ok": true, "hasPin": false })
}

#[tauri::command]
pub fn lock_verify_pin(app: AppHandle, pin: String) -> serde_json::Value {
    let cfg = crate::settings::get();
    let (Some(salt_hex), Some(hash_hex)) = (&cfg.pin_salt, &cfg.pin_hash) else {
        return json!({ "ok": false, "error": "لا رمز مضبوط" });
    };
    let mut salt = [0u8; 16];
    for i in 0..16 {
        salt[i] = u8::from_str_radix(salt_hex.get(i * 2..i * 2 + 2).unwrap_or("00"), 16).unwrap_or(0);
    }
    let h = hash_pin(pin.trim(), &salt);
    let hex = h.iter().map(|b| format!("{b:02x}")).collect::<String>();
    if hex == *hash_hex {
        if is_locked() {
            unlock(&app);
        }
        json!({ "ok": true })
    } else {
        crate::audit::audit("lock", "warn", "محاولة فتح برمز خاطئ".to_string());
        json!({ "ok": false, "error": "رمز خاطئ" })
    }
}

#[tauri::command]
pub fn lock_biometric(app: AppHandle) -> serde_json::Value {
    match biometric_verify("افتح NexusLink") {
        Some(true) => {
            if is_locked() {
                unlock(&app);
            }
            json!({ "ok": true })
        }
        Some(false) => {
            crate::audit::audit("lock", "warn", "فشل فتح بالبصمة (رفض)".to_string());
            json!({ "ok": false, "error": "لم تُقبل البصمة" })
        }
        None => json!({ "ok": false, "error": "البصمة غير متاحة — استخدم الرمز" }),
    }
}

#[tauri::command]
pub fn lock_now_cmd(app: AppHandle) -> serde_json::Value {
    lock_now(&app, "manual");
    json!({ "ok": true, "locked": is_locked() })
}

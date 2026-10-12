// NexusLink Desktop — أوامر النظام والطاقة الحقيقية (FA-power — عقد §12)
// ============================================================================
// «أوامر النظام والطاقة الحقيقية» — تستقبل أوامر الهاتف عبر WebSocket (3004):
//
//   rc:power {action}  →  الويبفيو (desktop-bridge) يستدعي power_request
//   pc:lock (جسر الحماية 3006 — القرب/الابتعاد)  →  power_request {lock, auto-lock}
//
//  · الأوامر الفورية: lock / sleep (غير مدمرة)
//  · الأوامر المدمرة: shutdown / restart / hibernate / logout — تأكيد أمان
//    10 ثوانٍ ظاهر في الـ Tray (عنصر العدّاد + زر إلغاء) وقابل للإلغاء.
//  · لكل منصة طريقها الصحيح (أوامر النظام الرسمية مع بدائل احتياطية).
//  · unlock يُرفض أمنيًا على الطبقة الحقيقية (فتح الجلسة من الكمبيوتر نفسه فقط)
//    — المحاكاة الويبية تبقى مسموحة (عقد §12).
//  · إعلان MAC الحقيقي للشبكة (Wake-on-LAN) عبر system_mac → desktop:register.
use serde_json::json;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// مدة تأكيد الأمان للأوامر المدمرة (ثوانٍ)
pub const COUNTDOWN_SECS: u64 = 10;
/// أوامر تنفَّذ فورًا (غير مدمرة)
const IMMEDIATE: [&str; 2] = ["lock", "sleep"];

static AUTO_LOCK: AtomicBool = AtomicBool::new(true);
static PENDING_SEQ: AtomicU64 = AtomicU64::new(0);
static PENDING: Mutex<Option<Pending>> = Mutex::new(None);
static MAC: OnceLock<Option<String>> = OnceLock::new();

struct Pending {
    #[allow(dead_code)]
    action: String,
    label: String,
    seq: u64,
}

// ---------------------------------------------------------------------------
// إعدادات الأمان (من status.desktop.security ← المخزن المشترك desktop-ui.json)
// ---------------------------------------------------------------------------

pub fn update_cfg(security: &serde_json::Value) {
    let Some(v) = security.get("autoLock").and_then(|x| x.as_bool()) else {
        return;
    };
    let prev = AUTO_LOCK.swap(v, Ordering::Relaxed);
    if prev != v {
        println!("[power] autoLock={v}");
    }
}

pub fn is_pending() -> bool {
    PENDING.lock().unwrap().is_some()
}

/// نص عربي لحالة الطاقة القادمة من جسر التحكم (لعرض الـ Tray)
pub fn power_ar(state: &str) -> &'static str {
    match state {
        "on" => "الطاقة: تعمل",
        "locked" => "الطاقة: مقفل",
        "sleeping" => "الطاقة: سكون",
        "off" => "الطاقة: مطفأ",
        "booting" => "الطاقة: إقلاع",
        "hibernating" => "الطاقة: إسبات",
        "shutting-down" => "الطاقة: جارٍ الإيقاف",
        _ => "الطاقة: تعمل",
    }
}

fn ar_label(action: &str) -> &'static str {
    match action {
        "shutdown" => "إيقاف التشغيل",
        "restart" => "إعادة التشغيل",
        "sleep" => "السكون",
        "hibernate" => "الإسبات",
        "lock" => "قفل الجلسة",
        "logout" => "تسجيل الخروج",
        _ => "أمر نظام",
    }
}

// ---------------------------------------------------------------------------
// كشف عنوان MAC الفعلي (لإعلان Wake-on-LAN) — بلا crates جديدة
// ---------------------------------------------------------------------------

fn norm_mac(s: &str) -> Option<String> {
    let up = s.trim().to_uppercase().replace('-', ":");
    let parts: Vec<&str> = up.split(':').collect();
    if parts.len() != 6 {
        return None;
    }
    for p in &parts {
        if p.len() != 2 || !p.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
    }
    if up == "00:00:00:00:00:00" {
        return None;
    }
    Some(up)
}

#[cfg(target_os = "linux")]
fn detect_platform_mac() -> Option<String> {
    // المفضّل: واجهة المسار الافتراضي (NIC الشبكة الفعلية) ثم أول واجهة غير lo
    if let Ok(route) = std::fs::read_to_string("/proc/net/route") {
        for line in route.lines().skip(1) {
            let cols: Vec<&str> = line.split('\t').collect();
            if cols.len() > 1 && cols[1] == "00000000" {
                if let Ok(addr) = std::fs::read_to_string(format!("/sys/class/net/{}/address", cols[0])) {
                    if let Some(m) = norm_mac(addr.trim()) {
                        return Some(m);
                    }
                }
            }
        }
    }
    if let Ok(entries) = std::fs::read_dir("/sys/class/net") {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name == "lo" {
                continue;
            }
            if let Ok(addr) = std::fs::read_to_string(e.path().join("address")) {
                if let Some(m) = norm_mac(addr.trim()) {
                    return Some(m);
                }
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
fn detect_platform_mac() -> Option<String> {
    let out = std::process::Command::new("ifconfig").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut iface = String::new();
    for line in text.lines() {
        if !line.starts_with(' ') && !line.starts_with('\t') && line.contains(':') {
            iface = line.split(':').next().unwrap_or("").trim().to_string();
        }
        if iface == "lo0" || iface.is_empty() {
            continue;
        }
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("ether ") {
            if let Some(m) = norm_mac(rest.split_whitespace().next().unwrap_or("")) {
                return Some(m);
            }
        }
    }
    None
}

#[cfg(windows)]
fn detect_platform_mac() -> Option<String> {
    // الأدق: أول محوّل نشط (Status = Up) عبر PowerShell
    if let Ok(out) = std::process::Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            "(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' } | Select-Object -First 1).MacAddress",
        ])
        .output()
    {
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if let Some(m) = norm_mac(&s) {
            return Some(m);
        }
    }
    // احتياط: getmac CSV (أول MAC صالح)
    if let Ok(out) = std::process::Command::new("getmac").args(["/fo", "csv", "/nh"]).output() {
        let s = String::from_utf8_lossy(&out.stdout);
        for line in s.lines() {
            for cell in line.split(',') {
                let c = cell.trim().trim_matches('"');
                if c.len() == 17 && c.contains('-') {
                    if let Some(m) = norm_mac(c) {
                        return Some(m);
                    }
                }
            }
        }
    }
    None
}

/// عنوان MAC الفعلي (مخزَّن مؤقتًا) — فارغ عند تعذر الكشف
pub fn detect_mac() -> Option<String> {
    if let Some(v) = MAC.get() {
        return v.clone();
    }
    let v = detect_platform_mac();
    println!("[power] detected MAC: {:?}", v);
    let _ = MAC.set(v.clone());
    v
}

// ---------------------------------------------------------------------------
// التنفيذ الفعلي — لكل منصة الطريقة الرسمية (+ بديل احتياطي موثق)
// ---------------------------------------------------------------------------

fn run(cmd: &str, args: &[&str]) -> Result<(), String> {
    std::process::Command::new(cmd)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("{cmd}: {e}"))
}

#[cfg(target_os = "macos")]
fn osa(script: &str) -> Result<(), String> {
    run("osascript", &["-e", script])
}

fn execute(action: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        match action {
            "shutdown" => return run("shutdown", &["/s", "/t", "0"]),
            "restart" => return run("shutdown", &["/r", "/t", "0"]),
            "hibernate" => {
                return run("shutdown", &["/h"])
                    .or_else(|_| run("rundll32", &["powrprof.dll,SetSuspendState", "0,1,0"]))
            }
            "sleep" => return run("rundll32", &["powrprof.dll,SetSuspendState", "0,1,0"]),
            "lock" => return run("rundll32", &["user32.dll,LockWorkStation"]),
            "logout" => return run("shutdown", &["/l"]),
            _ => {}
        }
    }
    #[cfg(target_os = "macos")]
    {
        match action {
            "shutdown" => return osa("tell application \"System Events\" to shut down"),
            "restart" => return osa("tell application \"System Events\" to restart"),
            // ماك: «الإسبات» = Safe Sleep عبر pmset sleepnow
            "sleep" | "hibernate" => {
                return run("pmset", &["sleepnow"])
                    .or_else(|_| osa("tell application \"System Events\" to sleep"))
            }
            "lock" => {
                return run(
                    "/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession",
                    &["-suspend"],
                )
                .or_else(|_| run("pmset", &["displaysleepnow"]))
            }
            "logout" => return osa("tell application \"System Events\" to log out"),
            _ => {}
        }
    }
    #[cfg(target_os = "linux")]
    {
        match action {
            "shutdown" => return run("systemctl", &["poweroff"]),
            "restart" => return run("systemctl", &["reboot"]),
            "hibernate" => {
                return run("systemctl", &["hibernate"])
                    .or_else(|_| run("systemctl", &["suspend"]))
            }
            "sleep" => return run("systemctl", &["suspend"]),
            "lock" => {
                return run("loginctl", &["lock-session"])
                    .or_else(|_| run("gnome-screensaver-command", &["-l"]))
            }
            "logout" => {
                return run("loginctl", &["terminate-session", "self"])
                    .or_else(|_| run("gnome-session-quit", &["--logout", "--no-prompt"]))
            }
            _ => {}
        }
    }
    Err(format!("أمر غير مدعوم على هذه المنصة: {action}"))
}

// ---------------------------------------------------------------------------
// بوابة الطلب: فوري أو عدّاد 10 ثوانٍ قابل للإلغاء
// ---------------------------------------------------------------------------

pub fn request(app: &AppHandle, action: &str, source: &str) -> Result<String, String> {
    let action = action.trim().to_lowercase();
    match action.as_str() {
        "shutdown" | "restart" | "hibernate" | "sleep" | "lock" | "logout" => {}
        "unlock" => {
            return Err(
                "فتح القفل عن بُعد غير مسموح أمنيًا — تُفتح الجلسة من الكمبيوتر نفسه فقط".into(),
            )
        }
        other => return Err(format!("أمر غير معروف: {other}")),
    }
    // بوابة القفل التلقائي: مصدر auto-lock (منارة القرب) يخضع لإعداد الأمان
    if source == "auto-lock" && !AUTO_LOCK.load(Ordering::Relaxed) {
        return Err("القفل التلقائي معطّل من إعدادات الأمان".into());
    }

    let label = ar_label(&action);
    if IMMEDIATE.contains(&action.as_str()) {
        cancel(app, false);
        execute(&action).map_err(|e| {
            println!("[power] execute {action} failed: {e}");
            e
        })?;
        let power = if action == "sleep" { "sleeping" } else { "locked" };
        crate::tray::update_power(app, (crate::power::power_ar(&power), None));
        let _ = app.emit(
            "desktop://power",
            json!({"phase": "executed", "action": action, "power": power, "source": source}),
        );
        if source == "auto-lock" {
            crate::notify::plain(
                app,
                "قفل تلقائي",
                "ابتعد هاتفك عن النطاق — قُفلت الجلسة تلقائيًا",
            );
        }
        println!("[power] {action} executed (source={source})");
        return Ok(format!("{label}: نُفِّذ فورًا"));
    }

    // أمر مدمّر → تأكيد أمان 10 ثوانٍ قابل للإلغاء من الشريط
    cancel(app, false);
    let seq = PENDING_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    *PENDING.lock().unwrap() = Some(Pending { action: action.clone(), label: label.to_string(), seq });
    crate::tray::update_power(app, (label, Some(COUNTDOWN_SECS as u8)));
    let _ = app.emit(
        "desktop://power",
        json!({"phase": "pending", "action": action, "power": "shutting-down", "secondsLeft": COUNTDOWN_SECS}),
    );
    crate::notify::plain(
        app,
        &format!("تأكيد أمان: {label}"),
        &format!("سيتم التنفيذ خلال {COUNTDOWN_SECS} ثوانٍ — الإلغاء من أيقونة الشريط"),
    );
    let app2 = app.clone();
    let act2 = action.clone();
    let lab2 = label.to_string();
    std::thread::Builder::new()
        .name("power-countdown".into())
        .spawn(move || countdown(&app2, act2, lab2, seq))
        .map_err(|e| format!("thread: {e}"))?;
    println!("[power] {action} countdown {COUNTDOWN_SECS}s (source={source})");
    Ok(format!("{label}: عد تنازلي {COUNTDOWN_SECS}ث — قابل للإلغاء من الشريط"))
}

/// خيط العدّاد — يحدّث الـ Tray كل ثانية وينفّذ عند الصفر (إن لم يُلغَ)
fn countdown(app: &AppHandle, action: String, label: String, seq: u64) {
    for left in (1..=COUNTDOWN_SECS).rev() {
        crate::tray::update_power(app, (&label, Some(left as u8)));
        let _ = app.emit(
            "desktop://power",
            json!({"phase": "pending", "action": action, "power": "shutting-down", "secondsLeft": left}),
        );
        std::thread::sleep(Duration::from_secs(1));
        let cur = PENDING.lock().unwrap().as_ref().map(|p| p.seq);
        if cur != Some(seq) {
            return; // أُلغي أو استُبدل
        }
    }
    *PENDING.lock().unwrap() = None;
    crate::tray::update_power(app, ("الطاقة: جارٍ التنفيذ…", None));
    match execute(&action) {
        Ok(()) => {
            let power = match action.as_str() {
                "sleep" => "sleeping",
                "lock" | "logout" => "locked",
                _ => "shutting-down",
            };
            crate::tray::update_power(app, (power_ar(&power), None));
            let _ = app.emit(
                "desktop://power",
                json!({"phase": "executed", "action": action, "power": power}),
            );
            println!("[power] executed {action}");
        }
        Err(e) => {
            crate::tray::update_power(app, (power_ar("on"), None));
            let _ = app.emit(
                "desktop://power",
                json!({"phase": "error", "action": action, "power": "on", "error": e}),
            );
            println!("[power] execute {action} failed: {e}");
        }
    }
}

/// إلغاء أي عدّاد جارٍ — emit يحدد بث الحدث للواجهة (نكته عند الاستبدال)
pub fn cancel(app: &AppHandle, emit: bool) -> bool {
    let had = PENDING.lock().unwrap().take().is_some();
    if had {
        // رفع التسلسل يُبطل خيط العدّاد القديم فورًا
        PENDING_SEQ.fetch_add(1, Ordering::SeqCst);
        crate::tray::update_power(app, (power_ar("on"), None));
        if emit {
            let _ = app.emit("desktop://power", json!({"phase": "cancelled", "power": "on"}));
        }
        println!("[power] countdown cancelled");
    }
    had
}

// ---------------------------------------------------------------------------
// أوامر Tauri (يستدعيها الويبفيو — عقد §12)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn power_request(app: AppHandle, action: String, source: Option<String>) -> Result<String, String> {
    request(&app, &action, source.as_deref().unwrap_or("phone"))
}

#[tauri::command]
pub fn power_cancel(app: AppHandle) -> bool {
    cancel(&app, true)
}

/// عنوان MAC الفعلي لهذا الكمبيوتر — يُبث عبر desktop:register (إعلان للأجهزة الموثوقة)
#[tauri::command]
pub fn system_mac() -> String {
    detect_mac().unwrap_or_default()
}

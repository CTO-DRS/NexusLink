// NexusLink Desktop — إعدادات محلية (config.json في مجلد إعدادات التطبيق)
// الإغلاق إلى الـ Tray مفعّل افتراضيًا (المطلوب التعاقدي) وقابل للتغيير من قائمة الـ Tray.
// الطبقة الأصلية تضيف: autostart (التشغيل مع النظام) + start_hidden (بدء مخفي في الـ Tray)
// + downloads_dir (مجلد تنزيلات افتراضي لحفظ الملفات الواردة)
// + context_menu (قائمة الزر الأيمن «إرسال عبر NexusLink» — عقد §14).
// FA-harden (عقد §16): pin_hash/pin_salt أسرار محلية لا تغادر الجهاز أبدًا،
// وسياسات appLock/idle/updater مخزّن مشترك (نفس SQLite — بند 6) يُسحب كل 10ث
// إلى cache محلي هنا (يعمل أوفلاين أيضًا) — آخر كاتب يفوز كما في كل المخازن المشتركة.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Settings {
    pub close_to_tray: bool,
    #[serde(default)]
    pub autostart: bool,
    #[serde(default)]
    pub start_hidden: bool,
    #[serde(default)]
    pub downloads_dir: Option<String>,
    #[serde(default = "dft_context_menu")]
    pub context_menu: bool,
    // FA-media (عقد §15) — افتراضيات بث الشاشة (يتجاوزها الهاتف لكل طلب)
    #[serde(default = "dft_media_fps")]
    pub media_fps: u32,
    #[serde(default = "dft_media_quality")]
    pub media_quality: String,
    // FA-harden (عقد §16) — بند 1: قفل التطبيق. الهاش والملح محليان حصريًا،
    // وبقية السياسات (appLock.enabled/idleLockMin + idle.optMinutes + updater.autoCheck)
    // تُدار من المخزن المشترك وتُسحب دوريًا إلى هذه القيم المحلية (كاش أوفلاين).
    #[serde(default)]
    pub pin_hash: Option<String>,
    #[serde(default)]
    pub pin_salt: Option<String>,
    #[serde(default)]
    pub app_lock_enabled: bool,
    #[serde(default)]
    pub idle_lock_minutes: u32, // 0 = تعطيل قفل الخمول (1..120 من المشترك)
    #[serde(default = "dft_idle_opt")]
    pub idle_opt_minutes: u32, // عتبة وضع الخمول (تحسين البند 4)
    #[serde(default = "dft_true")]
    pub updater_auto_check: bool, // بند 2 — فحص التحديث عند الإقلاع (كاش من المشترك)
}

fn dft_idle_opt() -> u32 {
    5
}

fn dft_true() -> bool {
    true
}

fn dft_context_menu() -> bool {
    true
}
fn dft_media_fps() -> u32 {
    30
}
fn dft_media_quality() -> String {
    "high".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            autostart: false,
            start_hidden: false,
            downloads_dir: None,
            context_menu: true,
            media_fps: 30,
            media_quality: "high".into(),
            pin_hash: None,
            pin_salt: None,
            app_lock_enabled: false,
            idle_lock_minutes: 0,
            idle_opt_minutes: 5,
            updater_auto_check: true,
        }
    }
}

static SETTINGS: OnceLock<Mutex<Settings>> = OnceLock::new();
static CONFIG_PATH: OnceLock<PathBuf> = OnceLock::new();

fn cell() -> &'static Mutex<Settings> {
    SETTINGS.get_or_init(|| Mutex::new(Settings::default()))
}

pub fn init(app: &tauri::AppHandle) {
    use tauri::Manager;
    let dir = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("nexuslink"));
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("config.json");
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(s) = serde_json::from_str::<Settings>(&text) {
            *cell().lock().unwrap() = s;
        }
    }
    let _ = CONFIG_PATH.set(path);
}

pub fn get() -> Settings {
    cell().lock().unwrap().clone()
}

fn persist(s: &Settings) {
    if let Some(path) = CONFIG_PATH.get() {
        if let Ok(json) = serde_json::to_string_pretty(s) {
            let _ = std::fs::write(path, json);
        }
    }
}

pub fn set_close_to_tray(v: bool) {
    let mut s = cell().lock().unwrap();
    s.close_to_tray = v;
    persist(&s);
}

pub fn set_autostart(v: bool) {
    let mut s = cell().lock().unwrap();
    s.autostart = v;
    persist(&s);
}

pub fn set_downloads_dir(v: Option<String>) {
    let mut s = cell().lock().unwrap();
    s.downloads_dir = v;
    persist(&s);
}

/// FA-files (عقد §14) — تفعيل/تعطيل قائمة الزر الأيمن (تسجيل HKCU فوري)
pub fn set_context_menu(v: bool) {
    {
        let mut s = cell().lock().unwrap();
        if s.context_menu == v {
            return;
        }
        s.context_menu = v;
        persist(&s);
    }
    if v {
        crate::files_menu::apply_startup();
    } else {
        #[cfg(windows)]
        {
            let _ = crate::files_menu::files_context_menu("unregister".into());
        }
    }
}

/// «بدء مخفي» فعلي = إعداد المستخدم أو إقلاع تلقائي بوسيطة --hidden
pub fn effective_start_hidden() -> bool {
    if std::env::args().any(|a| a == "--hidden") {
        return true;
    }
    get().start_hidden
}

/// FA-media (عقد §15) — ضبط افتراضيات البث من بطاقة الوسائط
pub fn set_media_defaults(fps: Option<u32>, quality: Option<String>) {
    let mut s = cell().lock().unwrap();
    if let Some(f) = fps {
        s.media_fps = f;
    }
    if let Some(q) = quality {
        if ["low", "medium", "high", "ultra"].contains(&q.as_str()) {
            s.media_quality = q;
        }
    }
    persist(&s);
}

// ---------------------------------------------------------------------------
// FA-harden (عقد §16) — قفل التطبيق + مزامنة الإعدادات المشتركة (بند 6)
// ---------------------------------------------------------------------------

/// ضبط/مسح PIN — الهاش والملح في config.json المحلي فقط (لا يغادران الجهاز)
pub fn set_pin(salt: Option<String>, hash: Option<String>) {
    let mut s = cell().lock().unwrap();
    s.pin_salt = salt;
    s.pin_hash = hash;
    persist(&s);
}

/// مرآة hasPin/biometric للمخزن المشترك (للعرض في واجهة الويب فقط — عقد §16)
/// قراءة-تعديل-كتابة: لا يمس enabled/idleLockMin المُدارة من الواجهات.
pub fn push_shared(app: &tauri::AppHandle) {
    let cfg = get();
    let has_pin = cfg.pin_hash.is_some() && cfg.pin_salt.is_some();
    let biometric = crate::lock::biometric_available();
    let patch = serde_json::json!({
        "appLock": {
            "enabled": cfg.app_lock_enabled,
            "idleLockMin": cfg.idle_lock_minutes,
            "biometric": biometric,
            "hasPin": has_pin,
        }
    });
    if let Err(e) = crate::procman::put_json("/api/desktop/settings", &patch) {
        println!("[settings] push_shared failed (سيرفر غير جاهز؟): {e}");
    }
    let _ = app;
}

/// تطبيق سياسة وصلت من المخزن المشترك — كاش محلي (يعمل أوفلاين).
/// التنقية في النواة النقية harden_core::policy_from_shared (مرآة السيرفر
/// desktop-hardening.ts حرفيًا — مُختبرة في hardening-verify).
fn apply_shared(cfg: &serde_json::Value) -> bool {
    let (enabled, lock_min, opt_min, auto) = crate::harden_core::policy_from_shared(cfg);
    let mut changed = false;
    {
        let mut s = cell().lock().unwrap();
        if s.app_lock_enabled != enabled || s.idle_lock_minutes != lock_min {
            s.app_lock_enabled = enabled;
            s.idle_lock_minutes = lock_min;
            changed = true;
        }
        if s.idle_opt_minutes != opt_min {
            s.idle_opt_minutes = opt_min;
            changed = true;
        }
        if s.updater_auto_check != auto {
            s.updater_auto_check = auto;
            changed = true;
        }
        if changed {
            persist(&s);
        }
    }
    changed
}

/// سحب دوري خفيف (كل 10ث — HTTP محلي رخيص) لسياسات المخزن المشترك.
/// فشله بلا أثر (سيرفر غير جاهز/قاعدة قديمة) — الكاش المحلي يبقى صالحًا.
pub fn spawn_hardening_sync(app: tauri::AppHandle) {
    std::thread::Builder::new()
        .name("hardening-sync".into())
        .spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(10));
            match crate::procman::get_json("/api/desktop/settings") {
                Ok(cfg) => {
                    if apply_shared(&cfg) {
                        println!("[settings] hardening policy updated من المخزن المشترك");
                        let _ = &app;
                    }
                }
                Err(_) => {} // بلا ضجيج — السيرفر قد يكون يقلع
            }
        })
        .expect("hardening sync thread");
}

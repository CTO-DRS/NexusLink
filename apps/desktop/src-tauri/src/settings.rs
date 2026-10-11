// NexusLink Desktop — إعدادات محلية (config.json في مجلد إعدادات التطبيق)
// الإغلاق إلى الـ Tray مفعّل افتراضيًا (المطلوب التعاقدي) وقابل للتغيير من قائمة الـ Tray.
// الطبقة الأصلية تضيف: autostart (التشغيل مع النظام) + start_hidden (بدء مخفي في الـ Tray)
// + downloads_dir (مجلد تنزيلات افتراضي لحفظ الملفات الواردة).
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
}

impl Default for Settings {
    fn default() -> Self {
        Self { close_to_tray: true, autostart: false, start_hidden: false, downloads_dir: None }
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

/// «بدء مخفي» فعلي = إعداد المستخدم أو إقلاع تلقائي بوسيطة --hidden
pub fn effective_start_hidden() -> bool {
    if std::env::args().any(|a| a == "--hidden") {
        return true;
    }
    get().start_hidden
}

// NexusLink Desktop — إعدادات محلية (config.json في مجلد إعدادات التطبيق)
// الإغلاق إلى الـ Tray مفعّل افتراضيًا (المطلوب التعاقدي) وقابل للتغيير من قائمة الـ Tray.
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

#[derive(Serialize, Deserialize, Clone, Copy, Debug)]
pub struct Settings {
    pub close_to_tray: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self { close_to_tray: true }
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
    *cell().lock().unwrap()
}

pub fn set_close_to_tray(v: bool) {
    *cell().lock().unwrap().close_to_tray = v;
    if let Some(path) = CONFIG_PATH.get() {
        if let Ok(json) = serde_json::to_string_pretty(&get()) {
            let _ = std::fs::write(path, json);
        }
    }
}

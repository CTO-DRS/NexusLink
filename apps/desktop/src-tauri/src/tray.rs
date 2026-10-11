// NexusLink Desktop — أيقونة النظام (System Tray)
// ============================================================
// أيقونة تعكس حالة الاتصال: متصل (أخضر) / منتظر (أزرق) / موقوف (كهرماني) / خطأ (أحمر)
// قائمة سريعة: فتح، إيقاف مؤقت/استئناف، الإغلاق إلى الـ Tray (خيار)، إنهاء.
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

pub struct TrayUi {
    pub tray: Mutex<TrayIcon>,
    pub pause_item: Mutex<MenuItem<tauri::Wry>>,
    pub closetray_item: Mutex<CheckMenuItem<tauri::Wry>>,
}

fn icon(name: &str) -> tauri::Result<tauri::image::Image<'static>> {
    let bytes: &[u8] = match name {
        "connected" => include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/icons/tray-connected.png")),
        "paused" => include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/icons/tray-paused.png")),
        "error" => include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/icons/tray-error.png")),
        _ => include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/icons/tray-waiting.png")),
    };
    tauri::image::Image::from_bytes(bytes)
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "فتح NexusLink", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "إيقاف مؤقت للسيرفر", true, None::<&str>)?;
    let closetray = CheckMenuItem::with_id(
        app,
        "closetray",
        "الإغلاق إلى الـ Tray",
        true,
        crate::settings::get().close_to_tray,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "إنهاء NexusLink", true, None::<&str>)?;
    let sep = |app: &AppHandle| PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(app, &[&open, &sep(app)?, &pause, &closetray, &sep(app)?, &quit])?;

    let tray = TrayIconBuilder::with_id("nexuslink-tray")
        .icon(icon("waiting")?)
        .tooltip("NexusLink — جارٍ التشغيل…")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => crate::procman::open_main(app),
            "pause" => crate::procman::toggle_pause(app),
            "closetray" => {
                let ui = app.state::<TrayUi>();
                // الحارس مؤقت ينتهي عند هذه الجملة — بلا امتداد داخل if-let
                let checked = ui.closetray_item.lock().unwrap().is_checked().unwrap_or(false);
                crate::settings::set_close_to_tray(checked);
            }
            "quit" => {
                crate::procman::kill_all();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                crate::procman::open_main(tray.app_handle());
            }
        })
        .build(app)?;

    app.manage(TrayUi {
        tray: Mutex::new(tray),
        pause_item: Mutex::new(pause),
        closetray_item: Mutex::new(closetray),
    });
    Ok(())
}

const TIPS: [(&str, &str); 5] = [
    ("waiting", "NexusLink — في انتظار هاتف…"),
    ("connected", "NexusLink — هاتف متصل"),
    ("paused", "NexusLink — موقوف مؤقتًا"),
    ("error", "NexusLink — مشكلة في الخدمات"),
    ("booting", "NexusLink — جارٍ التشغيل…"),
];

pub fn set_state(app: &AppHandle, state: &str) {
    let ui = app.state::<TrayUi>();
    let tray = ui.tray.lock().unwrap();
    match icon(state) {
        Ok(img) => {
            let _ = tray.set_icon(Some(img));
        }
        Err(e) => println!("[tray] icon {state}: {e}"),
    }
    if let Some((_, tip)) = TIPS.iter().find(|(k, _)| *k == state) {
        let _ = tray.set_tooltip(Some((*tip).to_string()));
    }
}

/// تحديث الأيقونة عند كل مرحلة إقلاع (يُستدعى من procman::emit_status)
pub fn on_stage(app: &AppHandle, stage: &str) {
    let state = match stage {
        "ready" => "waiting", // جاهز بلا هاتف بعد
        "error" => "error",
        "paused" => "paused",
        _ => "booting",
    };
    set_state(app, state);
    let _ = app.emit("desktop://tray-state", state);
}

pub fn on_pause_toggled(app: &AppHandle, paused: bool) {
    let ui = app.state::<TrayUi>();
    let item = ui.pause_item.lock().unwrap();
    let _ = item.set_text(if paused { "استئناف السيرفر" } else { "إيقاف مؤقت للسيرفر" });
    if !paused {
        // الاستئناف: أيقونة انتقالية حتى تكمل دورة الإقلاع
        set_state(app, "booting");
    }
}

// NexusLink Desktop — أيقونة النظام (System Tray)
// ============================================================
// أيقونة تعكس حالة الاتصال: متصل (أخضر) / منتظر (أزرق) / موقوف (كهرماني) / خطأ (أحمر)
// قائمة سريعة: فتح، حالة الطاقة + عدد الاتصالات النشطة (FA-power — §12)،
// إلغاء الإيقاف المجدول، إيقاف مؤقت/استئناف، الإغلاق إلى الـ Tray (خيار)،
// التشغيل التلقائي مع النظام (خيار)، مجلد التنزيلات…، إنهاء.
use std::sync::Mutex;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

pub struct TrayUi {
    pub tray: Mutex<TrayIcon>,
    pub pause_item: Mutex<MenuItem<tauri::Wry>>,
    pub closetray_item: Mutex<CheckMenuItem<tauri::Wry>>,
    pub autostart_item: Mutex<CheckMenuItem<tauri::Wry>>,
    // FA-power (عقد §12) — مؤشر الطاقة + الاتصالات + زر إلغاء الإيقاف المجدول
    pub power_item: Mutex<MenuItem<tauri::Wry>>,
    pub connections_item: Mutex<MenuItem<tauri::Wry>>,
    pub cancel_item: Mutex<MenuItem<tauri::Wry>>,
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
    // FA-power — عناصر عرض حالة الطاقة/الاتصالات (غير قابلة للنقر) + إلغاء الإيقاف
    let power_item = MenuItem::with_id(app, "power", "الطاقة: تعمل", false, None::<&str>)?;
    let connections_item = MenuItem::with_id(app, "connections", "الاتصالات النشطة: 0", false, None::<&str>)?;
    let cancel_item = MenuItem::with_id(app, "cancel_power", "لا إيقاف مجدول", false, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "إيقاف مؤقت للسيرفر", true, None::<&str>)?;
    let closetray = CheckMenuItem::with_id(
        app,
        "closetray",
        "الإغلاق إلى الـ Tray",
        true,
        crate::settings::get().close_to_tray,
        None::<&str>,
    )?;
    // حالة التشغيل التلقائي الحقيقية من مدير الإقلاع (لا من الإعداد فقط)
    use tauri_plugin_autostart::ManagerExt;
    let enabled = app.autolaunch().is_enabled().unwrap_or(crate::settings::get().autostart);
    let autostart = CheckMenuItem::with_id(
        app,
        "autostart",
        "التشغيل التلقائي مع النظام",
        true,
        enabled,
        None::<&str>,
    )?;
    let downloads = MenuItem::with_id(app, "downloads", "مجلد التنزيلات…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "إنهاء NexusLink", true, None::<&str>)?;
    let sep = |app: &AppHandle| PredefinedMenuItem::separator(app);
    let menu = Menu::with_items(
        app,
        &[&open, &sep(app)?, &power_item, &connections_item, &cancel_item, &sep(app)?, &pause, &closetray, &autostart, &downloads, &sep(app)?, &quit],
    )?;

    let tray = TrayIconBuilder::with_id("nexuslink-tray")
        .icon(icon("waiting")?)
        .tooltip("NexusLink — جارٍ التشغيل…")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => crate::procman::open_main(app),
            "cancel_power" => {
                crate::power::cancel(app, true);
            }
            "pause" => crate::procman::toggle_pause(app),
            "closetray" => {
                let ui = app.state::<TrayUi>();
                // الحارس مؤقت ينتهي عند هذه الجملة — بلا امتداد داخل if-let
                let checked = ui.closetray_item.lock().unwrap().is_checked().unwrap_or(false);
                crate::settings::set_close_to_tray(checked);
            }
            "autostart" => {
                let ui = app.state::<TrayUi>();
                let checked = ui.autostart_item.lock().unwrap().is_checked().unwrap_or(false);
                crate::settings::set_autostart(checked);
                use tauri_plugin_autostart::ManagerExt;
                let r = if checked { app.autolaunch().enable() } else { app.autolaunch().disable() };
                println!("[tray] autostart={} → {:?}", checked, r.is_ok());
            }
            "downloads" => {
                pick_downloads_dir(app);
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
        autostart_item: Mutex::new(autostart),
        power_item: Mutex::new(power_item),
        connections_item: Mutex::new(connections_item),
        cancel_item: Mutex::new(cancel_item),
    });
    Ok(())
}

/// اختيار مجلد التنزيلات الافتراضي (حوار مجلد أصلي) — يُخزن في config.json
fn pick_downloads_dir(app: &AppHandle) {
    use tauri_plugin_dialog::DialogExt;
    let app2 = app.clone();
    app.dialog().file().pick_folder(move |chosen| {
        if let Some(fp) = chosen {
            if let Ok(path) = fp.into_path() {
                crate::settings::set_downloads_dir(Some(path.display().to_string()));
                let dir = path.display().to_string();
                crate::notify::plain(&app2, "مجلد التنزيلات الافتراضي", &dir);
            }
        }
    });
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

// ---------------------------------------------------------------------------
// FA-power (عقد §12) — مؤشر الطاقة + الاتصالات + إلغاء الإيقاف المجدول
// ---------------------------------------------------------------------------

/// تحديث سطر الطاقة: (نص، Some(ثوانٍ متبقية) أثناء العدّاد / None للعرض الثابت)
/// أثناء العدّاد يصبح زر الإلغاء مفعلًا بنص الأمر المعلق.
pub fn update_power(app: &AppHandle, line: (&str, Option<u8>)) {
    let ui = app.state::<TrayUi>();
    let (text, pending) = line;
    if let Ok(mut it) = ui.power_item.lock() {
        let _ = if let Some(secs) = pending {
            it.set_text(format!("سيتم {text} خلال {secs}ث…"))
        } else {
            it.set_text(text.to_string())
        };
    }
    if let Ok(mut it) = ui.cancel_item.lock() {
        match pending {
            Some(_) => {
                let _ = it.set_enabled(true);
                let _ = it.set_text(format!("إلغاء {text}"));
            }
            None => {
                let _ = it.set_enabled(false);
                let _ = it.set_text("لا إيقاف مجدول");
            }
        }
    }
    if let Ok(tray) = ui.tray.lock() {
        let tip = if let Some(secs) = pending {
            format!("NexusLink — سيتم {text} خلال {secs}ث")
        } else {
            format!("NexusLink — {text}")
        };
        let _ = tray.set_tooltip(Some(tip));
    }
}

/// تحديث عدّاد الاتصالات النشطة (من استطلاع الحالة كل ~10ث)
pub fn update_connections(app: &AppHandle, n: usize) {
    let ui = app.state::<TrayUi>();
    if let Ok(mut it) = ui.connections_item.lock() {
        let _ = it.set_text(format!("الاتصالات النشطة: {n}"));
    }
}

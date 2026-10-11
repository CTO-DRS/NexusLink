// NexusLink Desktop — تطبيق سطح المكتب (Tauri 2)
// ============================================================
// نافذة تُحمّل واجهة NexusLink كما هي + سيرفر Node مضمّن (procman) + Tray
// + إغلاق إلى الـ Tray + مثيل وحيد + انتظار جاهزية السيرفر قبل عرض الواجهة.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod procman;
mod settings;
mod tray;

use tauri::{RunEvent, WindowEvent};

fn main() {
    tauri::Builder::default()
        // المثيل الوحيد — يجب أن يكون أول إضافة (توثيق tauri)
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // إقلاع ثانٍ → أبرز النافذة القائمة
            procman::open_main(app);
        }))
        .setup(|app| {
            let handle = app.handle().clone();
            settings::init(&handle);
            tray::init(&handle)?;
            procman::start(handle.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // إغلاق → إخفاء إلى الـ Tray (قابل للتعطيل من قائمة الـ Tray)
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && settings::get().close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("فشل بناء تطبيق NexusLink")
        .run(|_app, event| {
            // أي خروج (قائمة/إغلاق فعلي/Ctrl-C عبر النظام) يقتل العمليات المضمّنة
            match event {
                RunEvent::ExitRequested { .. } => procman::kill_all(),
                RunEvent::Exit => procman::kill_all(),
                _ => {}
            }
        });
}

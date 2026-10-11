// NexusLink Desktop — تطبيق سطح المكتب (Tauri 2) — الطبقة الأصلية
// ============================================================
// نافذة تُحمّل واجهة NexusLink كما هي + سيرفر Node مضمّن (procman) + Tray
// + إغلاق إلى الـ Tray + مثيل وحيد + انتظار جاهزية السيرفر قبل عرض الواجهة.
// الطبقة الأصلية: اختصارات عالمية مقيّدة بالتركيز + إشعارات نظام بأزرار +
// حوارات حفظ أصلية + سحب وإفلات إرسال فوري + deep-link nexus:// + تشغيل تلقائي.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod notify;
mod procman;
mod settings;
mod shortcuts;
mod tray;

use tauri::{RunEvent, WindowEvent};

fn main() {
    tauri::Builder::default()
        // المثيل الوحيد — يجب أن يكون أول إضافة (توثيق tauri)
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            // إقلاع ثانٍ → أبرز النافذة القائمة
            procman::open_main(app);
        }))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]), // الإقلاع التلقائي يبدأ مخفيًا في الـ Tray
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle().clone();
            settings::init(&handle);

            // مزامنة التشغيل التلقائي مع النظام (enable فقط عند الطلب — لا نعطّل ما فعله المستخدم خارجيًا)
            if settings::get().autostart {
                use tauri_plugin_autostart::ManagerExt;
                if let Err(e) = handle.autolaunch().enable() {
                    println!("[setup] autostart enable failed: {e}");
                }
            }

            tray::init(&handle)?;

            // شاشة التحميل تُبنى هنا (لا في conf) للتحكم بالبدء المخفي في الـ Tray
            create_splash(&handle, !settings::effective_start_hidden())?;

            // deep-link: nexus:// — تسجيل النمط + معالجة الروابط الواردة
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(e) = handle.deep_link().register_all() {
                    println!("[setup] deep-link register: {e}");
                }
                let h2 = handle.clone();
                handle.deep_link().on_open_url(move |event| {
                    procman::handle_deep_link(&h2, event.urls());
                });
            }

            procman::start(handle.clone());
            // تسجيل أولي للاختصارات العالمية (النافذة تبدأ غير مركّزة/مخفية —
            // يغطي وضع «البدء المخفي» حيث لا تحدث أحداث Focused إطلاقًا)
            shortcuts::apply_focus(&handle, false);
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // إغلاق → إخفاء إلى الـ Tray (قابل للتعطيل من قائمة الـ Tray)
            WindowEvent::CloseRequested { api, .. } => {
                if window.label() == "main" && settings::get().close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                    procman::set_main_focused(window.app_handle(), false);
                }
            }
            // تركيز النافذة الرئيسية → حسم الاختصارات (عالمية عند عدم التركيز)
            WindowEvent::Focused(focused) => {
                if window.label() == "main" {
                    procman::set_main_focused(window.app_handle(), *focused);
                }
            }
            // سحب وإفلات الملفات من سطح المكتب → إرسال فوري للهاتف
            WindowEvent::DragDrop(dde) => {
                if window.label() == "main" {
                    if let tauri::DragDropEvent::Drop { paths, .. } = dde {
                        procman::handle_dropped_files(window.app_handle(), paths.clone());
                    }
                }
            }
            _ => {}
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

/// شاشة التحميل — نفس تصميم splash/index.html، ظاهرة أو مخفية حسب «بدء مخفي»
fn create_splash(app: &tauri::AppHandle, visible: bool) -> tauri::Result<()> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("index.html".into()))
        .title("NexusLink")
        .inner_size(480.0, 340.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .center(true)
        .visible(visible)
        .build()?;
    Ok(())
}

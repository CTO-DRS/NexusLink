// NexusLink Desktop — تطبيق سطح المكتب (Tauri 2) — الطبقة الأصلية
// ============================================================
// نافذة تُحمّل واجهة NexusLink كما هي + سيرفر Node مضمّن (procman) + Tray
// + إغلاق إلى الـ Tray + مثيل وحيد + انتظار جاهزية السيرفر قبل عرض الواجهة.
// الطبقة الأصلية: اختصارات عالمية مقيّدة بالتركيز + إشعارات نظام بأزرار +
// حوارات حفظ أصلية + سحب وإفلات إرسال فوري + deep-link nexus:// + تشغيل تلقائي.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audit;
mod clipboard;
// FA-harden (عقد §16) — التشخيص الأصلي (بند 5)
mod diag;
mod files_menu;
mod files_menu_core;
// FA-harden (عقد §16) — النواة النقية للتقوية (PBKDF2 + القرار الخالص +
// طابور التدقيق + تنقية السياسة) — تُضمَّن حرفيًا في hardening-verify
mod harden_core;
mod input;
// الجولة 4 مرحلة ② (عقد §20) — منفّذ الإدخال النقي وحدة عليا (يستهلكه
// input.rs بالاسم التاريخي exec + tablet.rs مباشرة — بلا تضمين مزدوج)
#[path = "input_exec.rs"]
pub mod input_exec;
// FA-harden (عقد §16) — كشف الخمول (بندا 1 و4 من مصدر واحد)
mod idle;
// الجولة 4 مرحلة ③ (عقد §21) — التحكم المتقدم: جيمباد الحساسات/الماوس
// الهوائي المعاير/عارض العروض — النواة النقية + المستهلك على القناة الحية
mod gyro;
mod gyro_core;
// الجولة 4 (عقد §18) — NexusLive: مستقبل UDP للإدخال الحي (loopback حصرًا)
mod live;
// FA-harden (عقد §16) — قفل التطبيق: PIN + Windows Hello / Touch ID (بند 1)
mod lock;
mod media;
mod notify;
mod power;
mod procman;
mod settings;
mod shortcuts;
mod sync;
mod sync_core;
// الجولة 4 مرحلة ② (عقد §20) — لوحة الرسم: أوضاع القلم + اللوحة الافتراضية
mod tablet;
#[cfg(target_os = "linux")]
mod tablet_uinput;
mod tray;
// FA-harden (عقد §16) — المحدّث الموقّع + سجل الإصدارات (بند 2)
mod updater;
// الجولة 4 مرحلة ① (عقد §19) — الشاشة الثانية: النواة النقية + طبقة المنصات
mod vdisplay;
mod vdisplay_core;

use tauri::{Manager, RunEvent, WindowEvent};

fn main() {
    // FA-files (عقد §14) — مسارات --send من قائمة الزر الأيمن (إقلاع أول)
    let argv: Vec<String> = std::env::args().collect();
    files_menu::queue_send_args(&argv);

    tauri::Builder::default()
        // المثيل الوحيد — يجب أن يكون أول إضافة (توثيق tauri)
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // إقلاع ثانٍ → أبرز النافذة القائمة
            // FA-files — أرجف المثيل الثاني قد تحمل --send (قائمة الزر الأيمن)
            let args: Vec<String> = argv.iter().cloned().collect();
            files_menu::queue_send_args(&args);
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
        // FA-files — سحب الملفات من التطبيق إلى سطح المكتب/المجلدات (drag-out)
        .plugin(tauri_plugin_drag::init())
        // FA-harden (عقد §16 بند 2) — المحدّث الموقّع (endpoints + pubkey في tauri.conf.json)
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            // FA-clipboard-sync — مراقب الحافظة الحي على مستوى النظام (نص/صور/ملفات)
            clipboard::spawn_monitor(handle.clone());
            // FA-input (عقد §13) — ضبط مفوّض الصوت لكل منصة (osascript/نقرات ويندوز)
            input::init();
            // FA-files (عقد §14) — قائمة الزر الأيمن + مقبض المزامنة الأصلي
            files_menu::apply_startup();
            sync::set_app(handle.clone());
            // FA-media (عقد §15) — الطبقة الأصلية للوسائط (بث الشاشة + الويب كام)
            media::set_app(handle.clone());
            // الجولة 4 (عقد §18) — NexusLive: مستقبل UDP الحي على loopback
            live::spawn(handle.clone());
            // -----------------------------------------------------------------
            // FA-harden (عقد §16):
            //  بند 6 — سحب سياسات المخزن المشترك كل 10ث (نفس SQLite)
            //  بندا 1+4 — مراقب الخمول 15ث (قفل الخمول + وضع التوفير)
            //  بند 2 — فحص التحديث الموقّع عند الإقلاع (بعد جاهزية السيرفر)
            // -----------------------------------------------------------------
            settings::spawn_hardening_sync(handle.clone());
            idle::spawn_idle_watcher(handle.clone());
            updater::startup_check(handle.clone());
            Ok(())
        })
        // FA-clipboard-sync — أوامر الطبقة الأصلية للحافظة الموحدة (عقد §11)
        // FA-power — أوامر النظام/الطاقة الحقيقية + MAC + إلغاء الإيقاف (عقد §12)
        // FA-input — جلسة التحكم وتنفيذ أحداث اللمس/الكيبورد عبر enigo (عقد §13)
        // FA-files — إظهار في المستكشف/بث الفيديو/قائمة السياق (عقد §14)
        // FA-media — بث الشاشة + الويب كام الافتراضية (عقد §15)
        // FA-harden — قفل التطبيق + المحدّث + التشخيص الأصلي (عقد §16)
        .invoke_handler(tauri::generate_handler![
            clipboard::clip_apply,
            clipboard::clip_send_now,
            power::power_request,
            power::power_cancel,
            power::system_mac,
            input::input_exec,
            input::input_session,
            input::input_permission,
            input::input_open_permissions,
            files_menu::files_reveal,
            files_menu::files_stream_open,
            files_menu::files_stream_cancel,
            files_menu::files_context_menu,
            lock::lock_state,
            lock::lock_set_pin,
            lock::lock_clear_pin,
            lock::lock_verify_pin,
            lock::lock_biometric,
            lock::lock_now_cmd,
            updater::updater_state,
            updater::updater_check_now,
            updater::updater_install,
            diag::diag_sidecar_ports,
            diag::diag_speed_test,
            diag::diag_export,
            diag::diag_idle_state,
            media::media_screen_start,
            media::media_screen_answer,
            media::media_screen_ice,
            media::media_screen_stop,
            media::media_screen_set,
            media::media_targets,
            media::media_vcam_start,
            media::media_vcam_stop,
            media::media_vcam_status,
            media::media_vcam_install,
            media::media_open_player,
            media::media_open_sound_settings,
            media::media_answer,
            media::media_ice,
            media::media_kind_stop,
            media::media_status,
            live::live_state,
            vdisplay::vdisplay_status,
            vdisplay::vdisplay_enable,
            vdisplay::vdisplay_disable,
            tablet::tablet_config,
            tablet::tablet_config_set,
            gyro::gyro_config,
            gyro::gyro_config_set,
        ])
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
                RunEvent::ExitRequested { .. } => {
                    procman::kill_all();
                    files_menu::cleanup_all();
                    sync::stop_all();
                    media::stop_all();
                }
                RunEvent::Exit => {
                    procman::kill_all();
                    files_menu::cleanup_all();
                    sync::stop_all();
                    media::stop_all();
                }
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
        .center()
        .visible(visible)
        .build()?;
    Ok(())
}

// NexusLink Desktop — إشعارات النظام الأصلية (OS-level) بأزرار تفاعلية
// ============================================================
// ويندوز: WinRT Toast عبر tauri-winrt-notification — يدعم أزرارًا فعلية
//         (حفظ في… / فتح المجلد / رد) وcallback تفعيل يستقبل action الزر.
// ماك/لينكس: إضافة الإشعارات الرسمية (بلا أزرار — حد المنصة، موثق بصدق).
// السياسة: لا إشعار نظام بينما نافذة الواجهة مركّزة (نسخة داخل التطبيق تكفي حينها).
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// سياق كل إشعار — يحدد ماذا تفعل أزراره عند التفعيل
#[derive(Clone, Debug)]
pub enum NotifyCtx {
    /// وصل ملف من الهاتف (مهمة نقل اتجاه in اكتملت)
    FileArrived { rel_path: String, file_name: String },
    /// إشعار جديد من الهاتف (تطبيق/رسالة)
    NewMessage { notif_id: String, app_name: String },
    /// إشعار معلوماتي بلا سياق (النقر يفتح النافذة)
    Plain,
}

fn server_file_abs(app: &AppHandle, rel_path: &str) -> PathBuf {
    let rel = rel_path.replace('\\', "/").trim_start_matches('/').to_string();
    // G-30: destPath التعاقدي يبدأ «data/nexus-storage/...» — بعد إعادة توجيه
    // الجذر القابل للكتابة: «data/» ⇒ data_root (nexus-data)؛ وإلا المسارات
    // القديمة تحت جذر الحزمة كما هي.
    if let Some(rest) = rel.strip_prefix("data/") {
        crate::procman::data_root(app).join(rest)
    } else {
        crate::procman::server_root(app).join(rel)
    }
}

/// إظهار إشعار نظام. buttons = [(نص الزر, action)]
pub fn notify(app: &AppHandle, title: &str, body: &str, ctx: NotifyCtx, buttons: &[(&str, &str)]) {
    // لا إزعاج أثناء تركيز النافذة — النسخة الداخلية تعرضها أصلاً
    if crate::procman::is_main_focused() {
        return;
    }
    #[cfg(windows)]
    {
        let app2 = app.clone();
        let ctx2 = ctx.clone();
        let mut toast = tauri_winrt_notification::Toast::new("sa.drs.nexuslink")
            .title(title)
            .text1(body)
            .sound(Option::Some(tauri_winrt_notification::Sound::Default));
        for (label, action) in buttons {
            toast = toast.add_button(label, action);
        }
        let _ = toast
            .on_activated(move |action| {
                handle_activation(&app2, &ctx2, action.as_deref());
                Ok(())
            })
            .show();
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_notification::NotificationExt;
        let _ = app.notification().builder().title(title).body(body).show();
        // حد المنصة: لا أزرار على ماك/لينكس عبر الإضافة الرسمية — النقر لا يُدار هنا.
        let _ = ctx;
    }
}

/// تنفيذ الـ action القادم من زر الإشعار (يُستدعى من خيط WinRT — كل شيء هنا آمن خيطيًا)
fn handle_activation(app: &AppHandle, ctx: &NotifyCtx, action: Option<&str>) {
    match (ctx, action) {
        // ---- وصل ملف: حفظ في… / فتح المجلد ----
        (NotifyCtx::FileArrived { rel_path, file_name }, Some("save")) => {
            let app2 = app.clone();
            let rel = rel_path.clone();
            let name = file_name.clone();
            std::thread::spawn(move || save_as_dialog(&app2, &rel, &name));
        }
        (NotifyCtx::FileArrived { rel_path, .. }, Some("open")) => {
            let src = server_file_abs(app, rel_path);
            open_in_file_manager(src);
            crate::procman::open_main(app);
        }
        (NotifyCtx::FileArrived { .. }, None) => {
            // نقر جسم الإشعار → فتح النافذة على شاشة النقل
            crate::procman::navigate_main(app, "transfers");
        }
        // ---- رسالة جديدة: رد / فتح ----
        (NotifyCtx::NewMessage { .. }, Some("reply")) | (NotifyCtx::NewMessage { .. }, Some("open")) => {
            crate::procman::navigate_main(app, "comms");
        }
        (NotifyCtx::NewMessage { .. }, None) => {
            crate::procman::navigate_main(app, "comms");
        }
        (NotifyCtx::Plain, _) => {
            crate::procman::open_main(app);
        }
        _ => {
            // أي تركيبة أخرى — فتح النافذة سلوك آمن
            crate::procman::open_main(app);
        }
    }
}

/// حوار «حفظ في» أصلي: ينسخ الملف الوارد إلى المسار الذي يختاره المستخدم
fn save_as_dialog(app: &AppHandle, rel_path: &str, file_name: &str) {
    use tauri_plugin_dialog::DialogExt;
    let src = server_file_abs(app, rel_path);
    if !src.is_file() {
        println!("[notify] save-as: المصدر غائب {src:?}");
        return;
    }
    let default_dir: PathBuf = crate::settings::get()
        .downloads_dir
        .map(PathBuf::from)
        .or_else(|| app.path().download_dir().ok())
        .unwrap_or_else(|| std::env::temp_dir());

    let app2 = app.clone();
    let name2 = file_name.to_string();
    app.dialog()
        .file()
        .set_file_name(file_name)
        .set_directory(&default_dir)
        .add_filter("كل الملفات", &["*"])
        .save_file(move |chosen| {
            let Some(dest) = chosen else { return };
            let Ok(dest_path) = dest.into_path() else { return };
            match std::fs::copy(&src, &dest_path) {
                Ok(bytes) => {
                    println!("[notify] saved {} bytes → {dest_path:?}", bytes);
                    let name3 = name2.clone();
                    crate::notify::notify(
                        &app2,
                        "تم الحفظ",
                        &name3,
                        crate::notify::NotifyCtx::Plain,
                        &[],
                    );
                }
                Err(e) => println!("[notify] save failed: {e}"),
            }
        });
}

/// فتح المجلد الحاوي مع تحديد الملف (نمط كل منصة)
fn open_in_file_manager(path: PathBuf) {
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer").arg(format!("/select,{}", path.display())).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").args(["-R", &path.display().to_string()]).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let dir = path.parent().map(|p| p.to_path_buf()).unwrap_or(path.clone());
        let _ = std::process::Command::new("xdg-open").arg(dir).spawn();
    }
}

/// إشعار مجرّد بلا أزرار (استُخدم لتأكيدات مثل «بدأ الإرسال»)
pub fn plain(app: &AppHandle, title: &str, body: &str) {
    notify(app, title, body, NotifyCtx::Plain, &[]);
}

/// يبني إشعار «وصل ملف» بأزراره التعاقدية
pub fn file_arrived(app: &AppHandle, rel_path: &str, file_name: &str, size: u64) {
    notify(
        app,
        "وصل ملف من الهاتف",
        &format!("{file_name} ({})", human_size(size)),
        NotifyCtx::FileArrived { rel_path: rel_path.to_string(), file_name: file_name.to_string() },
        &[("حفظ في…", "save"), ("فتح المجلد", "open")],
    );
}

/// يبني إشعار «رسالة/إشعار من الهاتف» بأزراره التعاقدية
pub fn new_message(app: &AppHandle, notif_id: &str, app_name: &str, title: &str, body: &str) {
    let text = if body.is_empty() { title.to_string() } else { format!("{title}\n{body}") };
    notify(
        app,
        app_name,
        &text,
        NotifyCtx::NewMessage { notif_id: notif_id.to_string(), app_name: app_name.to_string() },
        &[("رد", "reply"), ("فتح", "open")],
    );
}

fn human_size(n: u64) -> String {
    if n >= 1_048_576 { format!("{:.1} MB", n as f64 / 1_048_576.0) }
    else if n >= 1024 { format!("{:.0} KB", n as f64 / 1024.0) }
    else { format!("{n} B") }
}

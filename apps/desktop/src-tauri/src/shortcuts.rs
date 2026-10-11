// NexusLink Desktop — الاختصارات العالمية (تعمل والتطبيق غير مركّز)
// ============================================================
// تعاقد التركيز: تُسجّل الاختصارات عالميًا فقط عندما تكون نافذة الواجهة غير
// مركّزة، وتُلغى تسجيلتها فور تركيزها — فيحفظ سلوك الواجهة الداخلي combos نفسها
// (نفس المخزن: zustand/localStorage عبر /api/desktop/shortcuts).
// هذا يحسم التعارض التعاقدي: Ctrl+Shift+D خارج التركيز = إظهار/إخفاء النافذة،
// وداخلها = سلوك الواجهة الحالي (تبديل المظهر) بلا أي انحدار.
// الإجراءات:
//   sendClipboard → حافظة النظام → POST /api/prod/clipboard → الهاتف فوريًا
//   toggleWindow  → إظهار/إخفاء نافذة الواجهة
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

static DESIRED: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());
static REGISTERED: AtomicBool = AtomicBool::new(false);

/// بناء قائمة الإجراءات المطلوبة من خريطة المخزن المشترك (بالترتيب الثابت)
pub fn desired_from_map(map: &HashMap<String, String>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for action in ["sendClipboard", "toggleWindow"] {
        if let Some(combo) = map.get(action) {
            let c = combo.trim();
            if !c.is_empty() && c.len() <= 40 {
                out.push((action.to_string(), c.to_string()));
            }
        }
    }
    out
}

/// تحديث المطلوب من استطلاع الحالة — يعيد التسجيل فقط إذا لم تكن النافذة مركّزة
pub fn update_desired(app: &tauri::AppHandle, list: Vec<(String, String)>) {
    let changed = {
        let mut d = DESIRED.lock().unwrap();
        if *d != list {
            *d = list;
            true
        } else {
            false
        }
    };
    // الحسم بالتركيز لا بحالة التسجيل — وإلا ظلّت «البدء المخفي» بلا اختصارات أبدًا
    if changed && !crate::procman::is_main_focused() {
        register_all(app);
    }
}

/// استدعاء عند تغيّر تركيز النافذة الرئيسية (Focused/إظهار/إخفاء/الإقلاع)
pub fn apply_focus(app: &tauri::AppHandle, focused: bool) {
    if focused {
        if REGISTERED.swap(false, Ordering::Relaxed) {
            if let Err(e) = app.global_shortcut().unregister_all() {
                println!("[shortcuts] unregister_all: {e}");
            }
        }
    } else {
        register_all(app);
    }
}

fn register_all(app: &tauri::AppHandle) {
    use tauri_plugin_global_shortcut::ShortcutState;
    let gs = app.global_shortcut();
    // تنظيف دائم قبل إعادة البناء (تغيير combos من الإعدادات)
    if let Err(e) = gs.unregister_all() {
        println!("[shortcuts] unregister_all: {e}");
    }
    let desired = DESIRED.lock().unwrap().clone();
    let mut any = false;
    for (action, combo) in &desired {
        let key = combo.to_lowercase(); // global-hotkey يقبل ctrl+shift+n (to_uppercase داخليًا)
        let action2 = action.clone();
        let res = gs.on_shortcut(key.as_str(), move |app, _sc, event| {
            if event.state == ShortcutState::Pressed {
                dispatch(app, &action2);
            }
        });
        match res {
            Ok(_) => {
                any = true;
                println!("[shortcuts] registered {action} = {combo}");
            }
            Err(e) => println!("[shortcuts] register {action}={combo} failed: {e}"),
        }
    }
    REGISTERED.store(any, Ordering::Relaxed);
}

fn dispatch(app: &tauri::AppHandle, action: &str) {
    match action {
        "sendClipboard" => {
            let app2 = app.clone();
            std::thread::spawn(move || match crate::procman::read_clipboard_text() {
                Ok(text) if !text.trim().is_empty() => {
                    if let Err(e) = crate::procman::push_clipboard_text(&text) {
                        println!("[shortcuts] clipboard send failed: {e}");
                    }
                }
                Ok(_) => println!("[shortcuts] clipboard فارغة"),
                Err(e) => println!("[shortcuts] clipboard read failed: {e}"),
            });
        }
        "toggleWindow" => crate::procman::toggle_main_window(app),
        other => println!("[shortcuts] unknown action {other}"),
    }
}

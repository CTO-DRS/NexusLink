// build.rs — يجرد #[tauri::command] من tablet.rs كي يُضمَّن في محرك التحقق
// (نفس نمط «تجريد #[tauri::command]» المعتمد في حشية R4-s1) — الملف الأصلي
// لم يمس؛ التجريد عند البناء حصرًا.
use std::env;
use std::fs;
use std::path::Path;

fn main() {
    let src = "../../apps/desktop/src-tauri/src/tablet.rs";
    println!("cargo:rerun-if-changed={src}");
    let text = fs::read_to_string(src).expect("read tablet.rs");
    let stripped: Vec<&str> = text.lines().filter(|l| !l.trim().starts_with("#[tauri::command")).collect();
    let out = Path::new(&env::var("OUT_DIR").unwrap()).join("tablet_stripped.rs");
    fs::write(&out, stripped.join("\n")).expect("write stripped");

    // live.rs — نفس التجريد (R4-t9: live.rs لا يترجم إلا في CI — إدراجه هنا
    // يفحص الربط والأنواع محليًا ضد فئة أخطاء crate-root/bind)
    let src2 = "../../apps/desktop/src-tauri/src/live.rs";
    println!("cargo:rerun-if-changed={src2}");
    let text2 = fs::read_to_string(src2).expect("read live.rs");
    // #[path = "live_core.rs"] يُعاد كتابته إلى مطلق — الإدراج من OUT_DIR
    let core_abs = Path::new("../../apps/desktop/src-tauri/src/live_core.rs").canonicalize().expect("canonicalize live_core");
    let stripped2: Vec<String> = text2
        .lines()
        .filter(|l| !l.trim().starts_with("#[tauri::command"))
        .map(|l| {
            if l.contains("#[path") && l.contains("live_core.rs") {
                format!("#[path = {:?}]", core_abs)
            } else if l.contains("tauri::") && !l.contains("crate::tauri") {
                // الإدراج داخل mod live — مسارات tauri العارية تُقيَّد بالجذر
                l.replace("tauri::", "crate::tauri::")
            } else {
                l.to_string()
            }
        })
        .collect();
    let out2 = Path::new(&env::var("OUT_DIR").unwrap()).join("live_stripped.rs");
    fs::write(&out2, stripped2.join("\n")).expect("write stripped live");
}

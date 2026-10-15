// build.rs — يجرد #[tauri::command] من gyro.rs كي يُضمَّن في محرك التحقق
// (نفس نمط tablet-verify المعتمد) — الملف الأصلي لم يمس؛ التجريد عند البناء
// حصرًا. #[path = "gyro_core.rs"] يُعاد كتابته إلى مطلق، ومسارات tauri::
// العارية تُقيَّد بالجذر (crates حقيقية داخل الحشية).
use std::env;
use std::fs;
use std::path::Path;

fn main() {
    let src = "../../apps/desktop/src-tauri/src/gyro.rs";
    println!("cargo:rerun-if-changed={src}");
    let text = fs::read_to_string(src).expect("read gyro.rs");
    let core_abs = Path::new("../../apps/desktop/src-tauri/src/gyro_core.rs")
        .canonicalize()
        .expect("canonicalize gyro_core");
    let stripped: Vec<String> = text
        .lines()
        .filter(|l| !l.trim().starts_with("#[tauri::command"))
        .map(|l| {
            if l.contains("#[path") && l.contains("gyro_core.rs") {
                format!("#[path = {:?}]", core_abs)
            } else if l.contains("tauri::") && !l.contains("crate::tauri") {
                l.replace("tauri::", "crate::tauri::")
            } else {
                l.to_string()
            }
        })
        .collect();
    let out = Path::new(&env::var("OUT_DIR").unwrap()).join("gyro_stripped.rs");
    fs::write(&out, stripped.join("\n")).expect("write stripped gyro");
}

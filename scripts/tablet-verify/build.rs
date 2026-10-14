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
}

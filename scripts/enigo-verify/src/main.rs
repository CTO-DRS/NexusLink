// محرك التحقق الفعلي لمنفّذ الإدخال (FA-input) — يشغّل input_exec.rs الحقيقي
// على شاشة Xvfb افتراضية: حركة المؤشر تُثبت بـ XQueryPointer (استعلام مستقل
// عن enigo)، والحقن العربي والنقرات والتمرير ومفاتيح الوسائط تمر عبر XTEST.
#![allow(dead_code)]

mod exec {
    // الملف الحقيقي المشغّل في تطبيق سطح المكتب — بلا نسخ ولا تزييف
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/src/input_exec.rs"));
}

use enigo::{Coordinate, Enigo, Mouse, Settings};
use exec::apply_event;
use std::time::Duration;
use x11rb::connection::Connection;
use x11rb::protocol::xproto::ConnectionExt;

fn ev(json: &str) -> serde_json::Value {
    serde_json::from_str(json).expect("json")
}

fn pointer_pos(conn: &x11rb::rust_connection::RustConnection) -> (i32, i32) {
    let setup = conn.setup();
    let root = setup.roots[0].root;
    let reply = conn
        .query_pointer(root)
        .expect("query_pointer")
        .reply()
        .expect("reply");
    (reply.root_x as i32, reply.root_y as i32)
}

fn settle(conn: &x11rb::rust_connection::RustConnection) {
    // جولة ذهاب-إياب تضمن معالجة كل الطلبات السابقة ثم مهلة قصيرة
    if let Ok(cookie) = conn.get_input_focus() {
        let _ = cookie.reply();
    }
    std::thread::sleep(Duration::from_millis(60));
}

fn main() {
    let mut failed = 0usize;
    let mut total = 0usize;
    let mut check = |name: &str, ok: bool, detail: String| {
        total += 1;
        println!("{} {name}{}", if ok { "✅" } else { "❌" }, if detail.is_empty() { String::new() } else { format!(" — {detail}") });
        if !ok {
            failed += 1;
        }
    };

    let conn = x11rb::connect(None).expect("اتصال X11 (Xvfb)").0;
    let mut enigo = Enigo::new(&Settings::default()).expect("Enigo::new");

    // 1) حركة مطلقة → XQueryPointer يؤكد الموضع
    enigo.move_mouse(200, 150, Coordinate::Abs).expect("abs move");
    settle(&conn);
    let (x, y) = pointer_pos(&conn);
    check("حركة مطلقة → (200,150)", (x - 200).abs() <= 1 && (y - 150).abs() <= 1, format!("({x},{y})"));

    // 2) حركة نسبية عبر apply_event → دلتا مطابقة
    apply_event(&mut enigo, &ev(r#"{"kind":"move","dx":50,"dy":25}"#)).expect("rel move");
    settle(&conn);
    let (x2, y2) = pointer_pos(&conn);
    check("حركة نسبية +50,+25", (x2 - 250).abs() <= 1 && (y2 - 175).abs() <= 1, format!("({x2},{y2})"));

    // 3) سحب: ضغط → تحريك → رفع (آلية drag من لوحة اللمس)
    let r1 = apply_event(&mut enigo, &ev(r#"{"kind":"move","dx":10,"dy":0,"drag":true}"#));
    let r2 = apply_event(&mut enigo, &ev(r#"{"kind":"move","dx":20,"dy":30}"#));
    settle(&conn);
    let (x3, y3) = pointer_pos(&conn);
    apply_event(&mut enigo, &ev(r#"{"kind":"move","dx":0,"dy":0}"#)).ok(); // رفع الزر (drag=false افتراضي)
    check(
        "سحب كامل (ضغط/تحريك/رفع)",
        r1.is_ok() && r2.is_ok() && (x3 - 280).abs() <= 2 && (y3 - 205).abs() <= 2,
        format!("({x3},{y3})"),
    );

    // 4) النقرات — أيسر/أيمن/مزدوج (XTEST يقبلها بلا خطأ)
    check("نقر أيسر", apply_event(&mut enigo, &ev(r#"{"kind":"click","button":"left"}"#)).is_ok(), String::new());
    check("نقر أيمن", apply_event(&mut enigo, &ev(r#"{"kind":"click","button":"right"}"#)).is_ok(), String::new());
    check("نقر مزدوج", apply_event(&mut enigo, &ev(r#"{"kind":"click","button":"left","type":"double"}"#)).is_ok(), String::new());

    // 5) التمرير والقرص
    check("تمرير عجلة", apply_event(&mut enigo, &ev(r#"{"kind":"scroll","dy":120}"#)).is_ok(), String::new());
    check("قرص تكبير", apply_event(&mut enigo, &ev(r#"{"kind":"pinch","scale":1.8}"#)).is_ok(), String::new());
    check("قرص تصغير", apply_event(&mut enigo, &ev(r#"{"kind":"pinch","scale":0.6}"#)).is_ok(), String::new());

    // 6) كتابة عربية كاملة من كيبورد الهاتف (حقن يونيكودي مستقل عن التخطيط)
    let arabic = apply_event(&mut enigo, &ev(r#"{"kind":"key","ch":"م"}"#));
    let arabic2 = apply_event(&mut enigo, &ev(r#"{"kind":"key","ch":"ر"}"#));
    let arabic3 = apply_event(&mut enigo, &ev(r#"{"kind":"key","ch":"ح"}"#));
    let arabic4 = apply_event(&mut enigo, &ev(r#"{"kind":"key","ch":"ب"}"#));
    let arabic5 = apply_event(&mut enigo, &ev(r#"{"kind":"key","ch":"ا"}"#));
    check(
        "كتابة عربية (مرحبا حرفًا حرفًا)",
        [arabic, arabic2, arabic3, arabic4, arabic5].iter().all(|r| r.is_ok()),
        String::new(),
    );
    // سلسلة نصية كاملة (لصق متعدد الأحرف)
    check("نص متعدد الأحرف عربي+لاتيني", apply_event(&mut enigo, &ev(r#"{"kind":"key","ch":"NexusLink مرحبا!"}"#)).is_ok(), String::new());

    // 7) مفاتيح خاصة ومسماة
    check("enter", apply_event(&mut enigo, &ev(r#"{"kind":"key","special":"enter"}"#)).is_ok(), String::new());
    check("backspace", apply_event(&mut enigo, &ev(r#"{"kind":"key","special":"backspace"}"#)).is_ok(), String::new());
    check("أسهم", ["up", "down", "left", "right"].iter().all(|s| apply_event(&mut enigo, &ev(&format!(r#"{{"kind":"key","special":"{s}"}}"#))).is_ok()), String::new());
    check("مفتاح مسماة F5", apply_event(&mut enigo, &ev(r#"{"kind":"key","key":"f5"}"#)).is_ok(), String::new());

    // 8) العرض التقديمي (PowerPoint/Keynote/Google Slides)
    check("عرض: next (PageDown)", apply_event(&mut enigo, &ev(r#"{"kind":"presenter","action":"next"}"#)).is_ok(), String::new());
    check("عرض: prev (PageUp)", apply_event(&mut enigo, &ev(r#"{"kind":"presenter","action":"prev"}"#)).is_ok(), String::new());
    check("عرض: start (F5)", apply_event(&mut enigo, &ev(r#"{"kind":"presenter","action":"start"}"#)).is_ok(), String::new());
    check("عرض: stop (Esc)", apply_event(&mut enigo, &ev(r#"{"kind":"presenter","action":"stop"}"#)).is_ok(), String::new());
    check("عرض: black (b)", apply_event(&mut enigo, &ev(r#"{"kind":"presenter","action":"black"}"#)).is_ok(), String::new());

    // 9) مفاتيح الوسائط النظامية
    check("وسائط: play/pause", apply_event(&mut enigo, &ev(r#"{"kind":"media","action":"toggle"}"#)).is_ok(), String::new());
    check("وسائط: next", apply_event(&mut enigo, &ev(r#"{"kind":"media","action":"next"}"#)).is_ok(), String::new());
    check("وسائط: prev", apply_event(&mut enigo, &ev(r#"{"kind":"media","action":"prev"}"#)).is_ok(), String::new());
    check("وسائط: mute", apply_event(&mut enigo, &ev(r#"{"kind":"media","action":"mute"}"#)).is_ok(), String::new());
    let vol = apply_event(&mut enigo, &ev(r#"{"kind":"media","action":"volume","value":70}"#));
    check("وسائط: volume 70 (pactl→amixer→نقرات)", vol.is_ok(), vol.err().unwrap_or_default());

    // 10) رفض صادق للقيم الفاسدة
    check("رفض صوت خارج المدى", apply_event(&mut enigo, &ev(r#"{"kind":"media","action":"volume","value":150}"#)).is_err(), String::new());
    check("رفض إجراء وسائط مجهول", apply_event(&mut enigo, &ev(r#"{"kind":"media","action":"x"}"#)).is_err(), String::new());
    check("رفض نوع حدث مجهول", apply_event(&mut enigo, &ev(r#"{"kind":"alien"}"#)).is_err(), String::new());

    println!("\n===== ENIGO VERIFY: {}/{total} passed =====", total - failed);
    std::process::exit(if failed == 0 { 0 } else { 1 });
}

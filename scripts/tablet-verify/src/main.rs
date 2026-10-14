// NexusLink — محرك تحقق لوحة الرسم (الجولة 4 مرحلة ② — عقد §20)
// ============================================================================
// يُضمِّن حرفيًا (مصدر واحد للمنطق مع التطبيق):
//   · input_exec.rs — محرك الضغط→الفرشاة (نقية: brush_level/brush_steps)
//   · tablet_uinput.rs — تخطيط uinput النقي (map_sample/build_setup)
//   · tablet.rs بعد تجريد #[tauri::command] (build.rs) — تنقية الإعدادات والحالة
// يتحقق من: تخطيط uinput_user_setup حرفيًا · دفعة أحداث كل طور (transitions
// حصرًا + SYN واحد) · تحجيم المحاور/الضغط/الميل · تبديل الأداة (قلم/ممحاة/
// إصبع) · تنقية الإعدادات (رفض الفاسد) · بوابة الجلسة/التوفر في consume_pen.
// الحقن الفيزيائي على جهاز فعلي يحتاج /dev/uinput — غيابه هنا موثق بصدق.
#![allow(dead_code)]

mod input_exec {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/src/input_exec.rs"));
}

mod input {
    // بوابة الجلسة §13 — قابلة للضبط من الاختبارات
    use std::sync::atomic::{AtomicBool, Ordering};
    pub static ACTIVE: AtomicBool = AtomicBool::new(false);
    pub fn is_active() -> bool {
        ACTIVE.load(Ordering::SeqCst)
    }
}

#[cfg(target_os = "linux")]
mod tablet_uinput {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/src/tablet_uinput.rs"));
}

mod tablet {
    include!(concat!(env!("OUT_DIR"), "/tablet_stripped.rs"));
}

use std::sync::atomic::{AtomicUsize, Ordering};

static PASS: AtomicUsize = AtomicUsize::new(0);
static FAIL: AtomicUsize = AtomicUsize::new(0);

fn check(name: &str, cond: bool, detail: impl Into<String>) {
    let d = detail.into();
    if cond {
        PASS.fetch_add(1, Ordering::SeqCst);
        println!("  ✅ {name}");
    } else {
        FAIL.fetch_add(1, Ordering::SeqCst);
        println!("  ❌ {name} — {d}");
    }
}

fn section(title: &str) {
    println!("\n== {title} ==");
}

fn main() {
    println!("NexusLink tablet-verify — لوحة الرسم الاحترافية (عقد §20)");
    section("1) تخطيط uinput_user_setup (linux/uinput.h حرفيًا)");
    setup_vectors();
    section("2) تعيين عينة القلم → دفعة أحداث evdev");
    map_vectors();
    section("3) تنقية إعدادات الفرشاة + الحالة (§20.ج)");
    config_vectors();
    section("4) بوابة consume_pen (الجلسة §13 + التوفر + التدهور الرشيق)");
    gate_vectors();
    let p = PASS.load(Ordering::SeqCst);
    let f = FAIL.load(Ordering::SeqCst);
    println!("\n=========================");
    println!("tablet-verify: {p} ناجح / {f} فاشل");
    if f > 0 {
        std::process::exit(1);
    }
}

// ---------------------------------------------------------------------------
// 1) بنية الإعداد — الإزاحات والنطاقات حرفيًا
// ---------------------------------------------------------------------------
fn setup_vectors() {
    #[cfg(target_os = "linux")]
    {
        let s = tablet_uinput::build_setup(tablet_uinput::DEV_NAME);
        let total = 80 + 8 + 4 + 64 * 4 * 4;
        check("الطول = name80+id8+ff4+4×abs64 = 1116", s.len() == total, format!("{}", s.len()));
        check("الاسم في [0..)", &s[..5] == b"Nexus", format!("{:?}", &s[..8]));
        check("الاسم صفري الختام (النواة يشترط)", s[30] == 0, "");
        let rd16 = |o: usize| u16::from_ne_bytes([s[o], s[o + 1]]);
        check("bustype=BUS_VIRTUAL(0x06)", rd16(80) == 0x06, format!("{:x}", rd16(80)));
        check("vendor=0x4E4C \"NL\"", rd16(82) == 0x4E4C, "");
        let rd32 = |o: usize| i32::from_ne_bytes([s[o], s[o + 1], s[o + 2], s[o + 3]]);
        let absmax = 92; // 80+8+4
        let absmin = absmax + 64 * 4;
        check("absmax[ABS_X]=32767", rd32(absmax) == 32767, format!("{}", rd32(absmax)));
        check("absmax[ABS_Y]=32767", rd32(absmax + 4) == 32767, "");
        check("absmax[ABS_PRESSURE]=2047", rd32(absmax + 0x18 * 4) == 2047, format!("{}", rd32(absmax + 0x18 * 4)));
        check("absmax[ABS_TILT_X]=127", rd32(absmax + 0x1a * 4) == 127, "");
        check("absmin[ABS_TILT_Y]=-127", rd32(absmin + 0x1b * 4) == -127, format!("{}", rd32(absmin + 0x1b * 4)));
        check("absfuzz/absflat صفران", &s[absmin + 64 * 4..total] == &vec![0u8; 64 * 4 * 2][..], "");
        // ثوابت ioctls — ضد linux/uinput.h
        check("UI_SET_EVBIT=0x40045564", tablet_uinput::UI_SET_EVBIT == 0x40045564, "");
        check("UI_SET_ABSBIT=0x40045566", tablet_uinput::UI_SET_ABSBIT == 0x40045566, "");
        check("UI_DEV_CREATE=0x5501", tablet_uinput::UI_DEV_CREATE == 0x5501, "");
        // التوفر بصدق في الحاوية (غالبًا بلا /dev/uinput — لا ادعاء)
        let ok = tablet_uinput::writable();
        println!("  ℹ️  /dev/uinput قابل للكتابة هنا: {ok} (الحقن الفيزيائي يحتاج جهازًا فعليًا)");
    }
    #[cfg(not(target_os = "linux"))]
    {
        check("uinput لينكس حصرًا (compile-gated)", true, "");
    }
}

// ---------------------------------------------------------------------------
// 2) تعيين العينة — انتقالات حصرًا + SYN واحد
// ---------------------------------------------------------------------------
fn map_vectors() {
    #[cfg(target_os = "linux")]
    {
        use tablet_uinput::*;
        let syn = |ev: &[(u16, u16, i32)]| ev.last() == Some(&(EV_SYN, 0, 0));

        // hover: أداة في المدى بلا تلامس — ضغط صفر
        let mut st = PenState::default();
        let ev = map_sample(0.5, 0.25, 0.0, 0, 0, 0, 0, 0, &mut st);
        check("hover: دفعة تنتهي SYN_REPORT", syn(&ev), format!("{ev:?}"));
        check("hover: دخول BTN_TOOL_PEN=1", ev.contains(&(EV_KEY, BTN_TOOL_PEN, 1)), "");
        check("hover: بلا BTN_TOUCH (لم يلمس)", !ev.iter().any(|e| e.1 == BTN_TOUCH), "");
        check("hover: الضغط صفر", ev.iter().any(|e| e == &(EV_ABS, ABS_PRESSURE, 0)), "");
        check("hover: الموضع 0.5→16384 و0.25→8192", ev.contains(&(EV_ABS, ABS_X, 16384)) && ev.contains(&(EV_ABS, ABS_Y, 8192)), format!("{ev:?}"));

        // down: تلامس + ضغط + بلا إعادة دخول الأداة (انتقالات حصرًا)
        let ev = map_sample(0.5, 0.25, 0.5, 0, 0, 1, 0, 0, &mut st);
        check("down: BTN_TOUCH=1", ev.contains(&(EV_KEY, BTN_TOUCH, 1)), "");
        check("down: بلا إعادة BTN_TOOL_PEN (في المدى)", !ev.iter().any(|e| e.1 == BTN_TOOL_PEN), "");
        check("down: ضغط 0.5→1024", ev.contains(&(EV_ABS, ABS_PRESSURE, 1024)), format!("{ev:?}"));
        let n_no_syn = ev.iter().filter(|e| e.0 == EV_SYN).count();
        check("down: SYN واحد فقط", n_no_syn == 1, format!("{n_no_syn}"));

        // move بنفس الحالة: موضع/ضغط/ميل + SYN حصرًا
        let ev = map_sample(0.75, 0.5, 0.9, 60, -60, 2, 0, 0, &mut st);
        check("move: بلا أحداث مفاتيح (حالة ثابتة)", !ev.iter().any(|e| e.0 == EV_KEY), format!("{ev:?}"));
        check("move: الميل ±60°→±127", ev.contains(&(EV_ABS, ABS_TILT_X, 127)) && ev.contains(&(EV_ABS, ABS_TILT_Y, -127)), "");
        check("move: ضغط 0.9→1842", ev.contains(&(EV_ABS, ABS_PRESSURE, 1842)), format!("{:?}", ev.iter().find(|e| e.1 == ABS_PRESSURE)));

        // ميل خارج التعاقد (i8 حتى ±127 يرد من شبكة غير موثوقة) — مقصوص
        let ev = map_sample(0.5, 0.5, 0.5, 127, -127, 2, 0, 0, &mut st);
        check("move: ميل متطرف مقصوص إلى ±127", ev.contains(&(EV_ABS, ABS_TILT_X, 127)) && ev.contains(&(EV_ABS, ABS_TILT_Y, -127)), format!("{ev:?}"));

        // الزر الخلفي — حافة واحدة
        let ev = map_sample(0.5, 0.5, 0.5, 0, 0, 2, 1, 0, &mut st);
        check("barrel: BTN_STYLUS=1 حافة", ev.contains(&(EV_KEY, BTN_STYLUS, 1)), "");
        let ev = map_sample(0.5, 0.5, 0.5, 0, 0, 2, 1, 0, &mut st);
        check("barrel: بلا تكرار وهو مضغوط", !ev.iter().any(|e| e.1 == BTN_STYLUS), "");

        // تبديل الأداة قلم→ممحاة أثناء قرب: خروج القلم ثم دخول الممحاة بالترتيب
        let mut st2 = PenState::default();
        let _ = map_sample(0.3, 0.3, 0.0, 0, 0, 0, 0, 0, &mut st2); // قلم في المدى
        let ev = map_sample(0.3, 0.3, 0.4, 0, 0, 1, 0, 1, &mut st2); // ممحاة تلامس
        let pen_out = ev.iter().position(|e| e == &(EV_KEY, BTN_TOOL_PEN, 0));
        let rub_in = ev.iter().position(|e| e == &(EV_KEY, BTN_TOOL_RUBBER, 1));
        check("ممحاة: خروج القلم ودخولها بالترتيب", pen_out.is_some() && rub_in.is_some() && pen_out.unwrap() < rub_in.unwrap(), format!("{ev:?}"));

        // إصبع: لمس عام بلا أدوات قلم
        let mut st3 = PenState::default();
        let ev = map_sample(0.5, 0.5, 1.0, 0, 0, 1, 0, 2, &mut st3);
        check("إصبع: BTN_TOUCH=1 بلا BTN_TOOL_PEN", ev.contains(&(EV_KEY, BTN_TOUCH, 1)) && !ev.iter().any(|e| e.1 == BTN_TOOL_PEN), format!("{ev:?}"));

        // up: خروج من المدى (الأداة صفر) + رفع التلامس + ضغط صفر
        let ev = map_sample(0.5, 0.5, 0.0, 0, 0, 3, 0, 0, &mut st);
        check("up: خروج الأداة ورفع التلامس", ev.contains(&(EV_KEY, BTN_TOOL_PEN, 0)) && ev.contains(&(EV_KEY, BTN_TOUCH, 0)), "");
        check("up: الضغط صفر", ev.contains(&(EV_ABS, ABS_PRESSURE, 0)), "");
        check("up: الحالة عادت فارغة", st == PenState::default(), format!("{st:?}"));

        // إحداثيات غير منتهية → 0 (دفاعي)
        let ev = map_sample(f64::NAN, f64::INFINITY, 0.5, 0, 0, 2, 0, 0, &mut st);
        check("NaN/∞ → الموضع 0", ev.contains(&(EV_ABS, ABS_X, 0)) && ev.contains(&(EV_ABS, ABS_Y, 0)), format!("{ev:?}"));

        // الأدوات غير المعروفة (3) → قلم
        let mut st4 = PenState::default();
        let ev = map_sample(0.5, 0.5, 0.3, 0, 0, 1, 0, 3, &mut st4);
        check("أداة محجوزة (3) → قلم", ev.contains(&(EV_KEY, BTN_TOOL_PEN, 1)), "");
    }
    #[cfg(not(target_os = "linux"))]
    {
        check("uinput لينكس حصرًا", true, "");
    }
}

// ---------------------------------------------------------------------------
// 3) تنقية الإعدادات + الحالة
// ---------------------------------------------------------------------------
fn config_vectors() {
    let ok = tablet::brush_from_json(&serde_json::json!({"pressure":"keys","decKey":"[","incKey":"]","levels":24,"modifier":"none"}));
    check("إعداد سليم → Some", ok.is_some(), "");
    let ok = tablet::brush_from_json(&serde_json::json!({"pressure":"scroll","modifier":"ctrl"}));
    check("عجلة+Ctrl سليمة", ok.is_some(), "");
    check("وضع فرشاة مجهول → None", tablet::brush_from_json(&serde_json::json!({"pressure":"wheels"})).is_none(), "");
    check("مفتاح متعدد الأحرف → None", tablet::brush_from_json(&serde_json::json!({"pressure":"keys","decKey":"ab"})).is_none(), "");
    check("مفتاح خارج ASCII المرئي → None", tablet::brush_from_json(&serde_json::json!({"pressure":"keys","decKey":"\u{7}"})).is_none(), "");
    check("levels=1 → None", tablet::brush_from_json(&serde_json::json!({"pressure":"keys","levels":1})).is_none(), "");
    check("levels=65 → None", tablet::brush_from_json(&serde_json::json!({"pressure":"keys","levels":65})).is_none(), "");
    check("معدّل مجهول → None", tablet::brush_from_json(&serde_json::json!({"pressure":"scroll","modifier":"win"})).is_none(), "");

    let st = tablet::state_json();
    check("الوضع الافتراضي = mouse", st["mode"] == "mouse", format!("{}", st));
    check("الفرشاة الافتراضية keys [/] 24", st["brush"]["pressure"] == "keys" && st["brush"]["decKey"] == "[" && st["brush"]["incKey"] == "]" && st["brush"]["levels"] == 24, format!("{}", st["brush"]));
    check("الحالة تحمل note صادقًا عند غياب المحرك", st["available"].as_bool().unwrap() || !st["note"].as_str().unwrap_or("").is_empty(), format!("{}", st["note"]));

    // ضبط فرشاة عبر التنقية نفسها (مسار tablet_config_set المنطقي)
    let st = tablet::tablet_config_set(None, Some("scroll".into()), None, None, Some(16), Some("alt".into()));
    check("set سليم: scroll/16/alt", st["brush"]["pressure"] == "scroll" && st["brush"]["levels"] == 16 && st["brush"]["modifier"] == "alt", format!("{}", st["brush"]));
    let st = tablet::tablet_config_set(None, Some("bad".into()), None, None, None, None);
    check("set فاسد: رفض مع إبقاء الحالة", st.get("error").is_some() && st["brush"]["pressure"] == "scroll", format!("{}", st));
    let st = tablet::tablet_config_set(Some("tablet".into()), None, None, None, None, None);
    // الحاوية بلا /dev/uinput غالبًا — الوضع يُطلب والقيد يظهر صادقًا، أو available=true إن وُجد
    check("set tablet: يُقبل بوضوح توفر صادق", st["mode"] == "tablet", format!("{}", st));
    let st = tablet::tablet_config_set(Some("mouse".into()), None, None, None, None, None);
    check("العودة للماوس", st["mode"] == "mouse", "");

    // وصول الفرشاة للمنفّذ (set_brush_cfg عبر المسار نفسه)
    let cfg = input_exec::brush_cfg();
    check("المحرك يرى آخر إعداد (scroll/16/alt)", cfg.mode == input_exec::BRUSH_SCROLL && cfg.levels == 16 && cfg.modifier == input_exec::MOD_ALT, format!("{cfg:?}"));
    input_exec::set_brush_cfg(input_exec::BrushCfg::default());
}

// ---------------------------------------------------------------------------
// 4) بوابة consume_pen — الجلسة + التوفر + التدهور الرشيق
// ---------------------------------------------------------------------------
fn gate_vectors() {
    // وضع الماوس (الافتراضي) — يمر لمسار الماوس دائمًا
    check("mouse: consume=false (مسار الماوس)", !tablet::consume_pen(0.5, 0.5, 0.5, 0, 0, 2, 0, 0), "");
    // طلب وضع لوحة غير متاح — التدهور الرشيق للماوس المطلق (الحاوية بلا /dev/uinput غالبًا)
    tablet::set_mode(tablet::MODE_TABLET);
    input::ACTIVE.store(true, Ordering::SeqCst);
    let consumed = tablet::consume_pen(0.5, 0.5, 0.5, 0, 0, 2, 0, 0);
    let available = tablet::engine_available();
    if available {
        check("tablet متاح: عينة مستهلكة", consumed, "");
    } else {
        check("tablet غير متاح: تدهور رشيق للماوس (لا إسقاط رسم)", !consumed, "");
    }
    // بلا جلسة → مسار الماوس حتى في وضع اللوحة
    input::ACTIVE.store(false, Ordering::SeqCst);
    if available {
        check("بلا جلسة §13 → لا استهلاك", !tablet::consume_pen(0.5, 0.5, 0.5, 0, 0, 2, 0, 0), "");
    }
    input::ACTIVE.store(true, Ordering::SeqCst);
    tablet::set_mode(tablet::MODE_MOUSE);
    let st = tablet::state_json();
    check("إحصاء العينات رصده (samples>0)", st["stats"]["samples"].as_u64().unwrap_or(0) > 0, format!("{}", st["stats"]));
    input::ACTIVE.store(false, Ordering::SeqCst);
}

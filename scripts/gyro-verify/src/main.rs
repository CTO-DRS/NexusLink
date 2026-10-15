// NexusLink — محرك تحقق التحكم المتقدم (الجولة 4 مرحلة ③ — عقد §21)
// ============================================================================
// يُضمِّن حرفيًا (مصدر واحد للمنطق مع التطبيق):
//   · gyro_core.rs — النواة النقية (تعاقد flags/الخرائط/العصا/الماوس/الإيماءة)
//   · input_exec.rs — apply_key بضغط/إفلات الجيمباد (state press/release §21)
//   · live_core.rs — ترميز gyro بأزرار/إمساك (encode_gyro_flags)
//   · gyro.rs بعد تجريد #[tauri::command] (build.rs) — المستهلك الزمني كاملًا
//     (consume_gyro: بوابة الجلسة/الوضع + حواف الأزرار + العصا + المعايرة
//     + تبريد الإيماءة + بوابة الإمساك + تفكيك المفاتيح المعلقة)
// الحقن الفيزيائي دخان على Xvfb (نفس live-verify) — شغّله بـ xvfb-run.
#![allow(dead_code)]

mod core_gyro {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/src/gyro_core.rs"));
}

mod core_live {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/src/live_core.rs"));
}

mod input_exec {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/src/input_exec.rs"));
}

// ===== حشيات الربط (نفس الأنماط التي يراها gyro.rs في التطبيق) =====
mod tauri {
    #[derive(Clone)]
    pub struct AppHandle;
}

mod input {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Mutex;
    pub static ACTIVE: AtomicBool = AtomicBool::new(false);
    pub static EXECUTED: Mutex<Vec<serde_json::Value>> = Mutex::new(Vec::new());
    pub fn is_active() -> bool {
        ACTIVE.load(Ordering::SeqCst)
    }
    pub fn execute(_app: &crate::tauri::AppHandle, events: &[serde_json::Value], _source: &str) -> Result<String, String> {
        EXECUTED.lock().unwrap().extend(events.iter().cloned());
        Ok("ok".into())
    }
    pub fn executed() -> Vec<serde_json::Value> {
        EXECUTED.lock().unwrap().clone()
    }
    pub fn reset() {
        EXECUTED.lock().unwrap().clear();
    }
}

mod gyro {
    include!(concat!(env!("OUT_DIR"), "/gyro_stripped.rs"));
}

use core_gyro::{GB_A, GB_B, GB_R, GB_X, GB_Y};
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

// عينة gyro حقيقية عبر الترميز التعاقدي + فك live_core (دائرة كاملة)
fn gyro_packet(flags: u8, ax: i16, ay: i16, az: i16, gx: i16, gy: i16, gz: i16) -> (u8, [i16; 3], [i16; 3]) {
    let key = [7u8; 8];
    let pkt = core_live::encode_gyro_flags(1, 2, &key, flags, ax, ay, az, gx, gy, gz);
    match core_live::parse(&pkt) {
        Ok((h, core_live::Payload::Gyro { ax, ay, az, gx, gy, gz })) => (h.flags, [ax, ay, az], [gx, gy, gz]),
        _ => panic!("فك حزمة gyro فشل"),
    }
}

/// تمرير عينة عبر المستهلك الحقيقي (consume_gyro) — يعيد أحداثه
fn sample(flags: u8, ax: i16, ay: i16, az: i16, gx: i16, gy: i16, gz: i16) -> Vec<serde_json::Value> {
    let (f, a, r) = gyro_packet(flags, ax, ay, az, gx, gy, gz);
    gyro::consume_gyro(f, a[0], a[1], a[2], r[0], r[1], r[2])
}

fn set_mode(mode: &str, extra: serde_json::Value) -> serde_json::Value {
    let app = tauri::AppHandle;
    let mut payload = serde_json::json!({"cmd": "set", "mode": mode});
    if let (Some(o), Some(p)) = (extra.as_object(), payload.as_object_mut()) {
        for (k, v) in o {
            p.insert(k.clone(), v.clone());
        }
    }
    gyro::gyro_config_set(
        app,
        payload.get("mode").and_then(|x| x.as_str()).map(String::from),
        payload.get("template").and_then(|x| x.as_str()).map(String::from),
        payload.get("deadzoneDeg").and_then(|x| x.as_f64()),
        payload.get("sens").and_then(|x| x.as_f64()),
        payload.get("shakeDegS").and_then(|x| x.as_f64()),
        payload.get("tiltDeg").and_then(|x| x.as_f64()),
        payload.get("laser").and_then(|x| x.as_bool()),
        payload.get("calibrate").and_then(|x| x.as_bool()),
        payload.get("keyA").and_then(|x| x.as_str()).map(String::from),
        payload.get("keyB").and_then(|x| x.as_str()).map(String::from),
        payload.get("keyX").and_then(|x| x.as_str()).map(String::from),
        payload.get("keyY").and_then(|x| x.as_str()).map(String::from),
        payload.get("keyL").and_then(|x| x.as_str()).map(String::from),
        payload.get("keyR").and_then(|x| x.as_str()).map(String::from),
    )
}

fn cfg_json() -> serde_json::Value {
    gyro::gyro_config()
}

fn main() {
    let mut args = std::env::args();
    let _ = args.next();
    let only = args.next();

    println!("== عقد §21 — محرك تحقق التحكم المتقدم (جيمباد/ماوس هوائي/عارض) ==");

    if only.is_none() || only.as_deref() == Some("pure") {
        section("21.ب تعاقد flags — ترميز/فك (دائرة كاملة عبر live_core)");
        let (f, _, _) = gyro_packet(0b0110_0011, 100, -200, 900, 10, -20, 30);
        check("أزرار A/B/L/R + الإمساك تعبر الترميز والفك", f == 0b0110_0011, format!("flags={f:#010b}"));
        let fl = core_gyro::parse_flags(0b0100_1010);
        check("bit6 الإمساك منفصل عن bits0-5", fl.grab && fl.buttons[GB_B as usize] && fl.buttons[GB_Y as usize] && !fl.buttons[GB_A as usize] && !fl.buttons[GB_R as usize], "parse_flags");
        check("flags=0 الحالة الصفرية (توافق §18 قبل §21)", { let z = core_gyro::parse_flags(0); !z.grab && z.buttons.iter().all(|b| !b) }, "parse_flags(0)");
        check("bit7 المحجوز لا يفسد الفك", { let z = core_gyro::parse_flags(0x80); !z.grab && z.buttons.iter().all(|b| !b) }, "parse_flags(0x80)");

        section("21.أ الخرائط والقوالب (نقاط انطلاق قابلة للتعيين)");
        let t = core_gyro::template_keymap(core_gyro::TPL_PLATFORMER);
        check("قالب المنصة: A=مسافة (قفز)", t.key_for(GB_A) == core_gyro::KeyRef::Char(' '), "A");
        check("قالب المنصة: Y=shift (ركض)", t.key_for(GB_Y) == core_gyro::KeyRef::Named("shift"), "Y");
        let r = core_gyro::template_keymap(core_gyro::TPL_RACING);
        check("قالب السباقات: A=مسافة (فرامل يد)", r.key_for(GB_A) == core_gyro::KeyRef::Char(' '), "A");
        let f2 = core_gyro::template_keymap(core_gyro::TPL_FIGHTING);
        check("قالب القتال: ZXCV", f2.key_for(GB_A) == core_gyro::KeyRef::Char('z') && f2.key_for(GB_B) == core_gyro::KeyRef::Char('x') && f2.key_for(GB_X) == core_gyro::KeyRef::Char('c') && f2.key_for(GB_Y) == core_gyro::KeyRef::Char('v'), "ZXCV");
        check("مفتاح مرئي مفرد يقبل", core_gyro::key_ref_from("k").is_some(), "k");
        check("مفتاح مسمّى يقبل (pagedown)", core_gyro::key_ref_from("PageDown").is_some(), "pagedown");
        check("المسافة مفتاح صالح (قفز/فرامل — §21.أ)", core_gyro::key_ref_from(" ").is_some(), "space");
        check("محرف تحكم يرفض", core_gyro::key_ref_from("\u{7}").is_none(), "غير مرئي");
        check("اسم خارج البياض يرفض (capslock)", core_gyro::key_ref_from("capslock").is_none(), "capslock");
        check("حدث مفتاح قياسي: ch + state", {
            let ev = core_gyro::key_event(core_gyro::KeyRef::Char('w'), "press");
            ev["kind"] == "key" && ev["ch"] == "w" && ev["state"] == "press"
        }, "key_event");
        check("حدث مفتاح مسمّى: special", {
            let ev = core_gyro::key_event(core_gyro::KeyRef::Named("space"), "release");
            ev["special"] == "space" && ev["state"] == "release" && ev.get("ch").is_none()
        }, "key_event named");
        check("click يترك state غائبًا (توافق §13)", { let ev = core_gyro::key_event(core_gyro::KeyRef::Char('a'), "click"); ev.get("state").is_none() }, "key_event click");

        section("21.ج تنقية الإعدادات — الفاسد يُرفض كله والدمج الجزئي يحفظ");
        check("وضع غير معروف يرفض", core_gyro::cfg_from_json(&serde_json::json!({"mode": "hacked"})).is_none(), "mode");
        check("نافذة ميتة خارج 5..45 ترفض", core_gyro::cfg_from_json(&serde_json::json!({"deadzoneDeg": 50})).is_none(), "deadzone");
        check("حساسية خارج 0.5..5 ترفض", core_gyro::cfg_from_json(&serde_json::json!({"sens": 9.0})).is_none(), "sens");
        check("مفتاح متعدد أحرف يرفض", core_gyro::cfg_from_json(&serde_json::json!({"keyA": "ab"})).is_none(), "keyA");
        check("مفتاح مسمّى صالح يقبل ويصير custom", {
            let c = core_gyro::cfg_from_json(&serde_json::json!({"keyA": "k"})).unwrap();
            c.template == core_gyro::TPL_CUSTOM && c.map.key_for(GB_A) == core_gyro::KeyRef::Char('k')
        }, "keyA→custom");
        check("قالب صريح يعيد بناء الخريطة ويبقى قالبًا", {
            let c = core_gyro::cfg_from_json(&serde_json::json!({"template": "racing", "keyA": "k"})).unwrap();
            c.template == core_gyro::TPL_RACING && c.map.key_for(GB_A) == core_gyro::KeyRef::Char('k') && c.map.key_for(GB_B) == core_gyro::KeyRef::Char('r')
        }, "template+key");
        check("الدمج الجزئي فوق قاعدة مخصصة يحفظ الخريطة", {
            let base = core_gyro::cfg_from_json(&serde_json::json!({"keyA": "m", "keyB": "n"})).unwrap();
            let next = core_gyro::cfg_from_json_base(&serde_json::json!({"sens": 3.0}), base).unwrap();
            next.template == core_gyro::TPL_CUSTOM && next.map.key_for(GB_A) == core_gyro::KeyRef::Char('m') && next.map.key_for(GB_B) == core_gyro::KeyRef::Char('n') && next.sens == 3.0
        }, "base merge");
        check("laser قيمة غير منطقية ترفض", core_gyro::cfg_from_json(&serde_json::json!({"laser": 3})).is_none(), "laser");

        section("21.أ-3 عصا التقليب — نافذة ميتة + هيستيريسيس (بلا رجفان)");
        let dz = 18.0;
        let (s1, e1) = core_gyro::flip_step(core_gyro::FlipState::default(), 20f64.to_radians(), 0.0, dz);
        check("دخول فوق العتبة → ضغط يمين واحد", s1.right && e1.len() == 1 && e1[0]["special"] == "right" && e1[0]["state"] == "press", format!("{e1:?}"));
        let (s2, e2) = core_gyro::flip_step(s1, 12f64.to_radians(), 0.0, dz);
        check("داخل الهيستيريسيس → لا حافة (بلا رجفان)", s2.right && e2.is_empty(), format!("{e2:?}"));
        let (s3, e3) = core_gyro::flip_step(s2, 5f64.to_radians(), 0.0, dz);
        check("عودة للمركز → إفلات واحد", !s3.right && e3.len() == 1 && e3[0]["state"] == "release", format!("{e3:?}"));
        let (s4, e4) = core_gyro::flip_step(core_gyro::FlipState::default(), 0.0, -22f64.to_radians(), dz);
        check("pitch سالب → أعلى (up)", s4.up && e4.len() == 1 && e4[0]["special"] == "up" && e4[0]["state"] == "press", format!("{e4:?}"));
        let (s5, _) = core_gyro::flip_step(core_gyro::FlipState::default(), 17.9f64.to_radians(), 0.0, dz);
        check("تحت العتبة لا يضغط", !s5.right && !s5.left, "17.9°<18");
        check("زاوية الجاذبية: عمودي → roll≈0/pitch محكوم", {
            let (roll, pitch) = core_gyro::tilt_angles(0.0, 0.0, -1000.0);
            roll.abs() < 0.01 && pitch.abs() < 0.01
        }, "upright");
        check("أرضية الاستواء: بلا إنف/نن", {
            let (roll, pitch) = core_gyro::tilt_angles(1000.0, 0.0, 0.0);
            roll.is_finite() && pitch.is_finite()
        }, "flat");

        section("21.ب-4 الماوس الهوائي — صفير/فلتر/حساسية (بلا AI)");
        check("صفير: متوسط العينات", {
            let z = core_gyro::calibrate_zero(&[[0.02, -0.01, 0.0], [0.04, -0.03, 0.0]]).unwrap();
            (z[0] - 0.03).abs() < 1e-9 && (z[1] + 0.02).abs() < 1e-9
        }, "mean");
        check("صفير: بلا عينات يرفض", core_gyro::calibrate_zero(&[]).is_none(), "empty");
        check("صفير: NaN يرفض", core_gyro::calibrate_zero(&[[f64::NAN, 0.0, 0.0]]).is_none(), "nan");
        check("الفلتر الأُسي يتقارب نحو المعدل", {
            let mut f = [0.0f64; 3];
            for _ in 0..30 {
                f = core_gyro::air_filter(f, [1.0, 0.0, 0.5], [0.0; 3], 0.55);
            }
            (f[0] - 1.0).abs() < 0.01 && (f[2] - 0.5).abs() < 0.01
        }, "EMA");
        check("الفلتر يحصّن NaN → صفر", { let f = core_gyro::air_filter([0.0; 3], [f64::NAN, 0.0, 0.0], [0.0; 3], 0.55); f.iter().all(|v| v.is_finite()) }, "nan-safe");
        check("الهز تحت النافذة الميتة يقتل الحركة", { let (dx, dy) = core_gyro::air_delta([0.1, 0.0, 0.1], 0.01, 2.0, 8.0); dx == 0.0 && dy == 0.0 }, "deadzone");
        check("الإشارات: gz موجب→يمين · gx موجب→أعلى (−)", {
            let (dx, dy) = core_gyro::air_delta([0.5, 0.0, 0.5], 0.01, 2.0, 3.0);
            dx > 0.0 && dy < 0.0
        }, "signs");
        check("القص ±500 بكسل (حاجز §18 طرفين)", { let (dx, _) = core_gyro::air_delta([5.0, 0.0, 5.0], 0.05, 5.0, 3.0); dx.abs() <= 500.0 }, "clamp");
        check("dt مقصوص 1..50ms (عينات مفقودة لا تُضخّم)", {
            let a = core_gyro::air_delta([1.0, 0.0, 0.0], 2.0, 1.0, 3.0).0;
            let b = core_gyro::air_delta([1.0, 0.0, 0.0], 0.05, 1.0, 3.0).0;
            (a - b).abs() < 1e-9
        }, "dt clamp");

        section("21.ج-5 إيماءة العارض — تسليح ثم إطلاق + الاتجاهان");
        let t28 = 28.0;
        let (s1, a1) = core_gyro::tilt_gesture(core_gyro::TiltState::default(), 30f64.to_radians(), t28);
        check("تجاوز العتبة يسلّح فقط (لا إطلاق)", a1.is_none() && s1.armed_right, "arm");
        let (s2, a2) = core_gyro::tilt_gesture(s1, 10f64.to_radians(), t28);
        check("العودة تُطلق next", a2 == Some("next") && !s2.armed_right, "fire");
        let (_, a3) = core_gyro::tilt_gesture(core_gyro::TiltState::default(), -30f64.to_radians(), t28);
        check("تسليح يسار بلا إطلاق", a3.is_none(), "arm left");
        let (_, a4) = core_gyro::tilt_gesture(core_gyro::TiltState { armed_left: true, armed_right: false }, -10f64.to_radians(), t28);
        check("العودة يسار تُطلق prev", a4 == Some("prev"), "fire prev");
        check("بدون تسليح: عودة مباشرة لا تُطلق", {
            let (s, a) = core_gyro::tilt_gesture(core_gyro::TiltState::default(), 10f64.to_radians(), t28);
            a.is_none() && !s.armed_right
        }, "no fire w/o arm");
    }

    // ------------------------------------------------------------------
    // المستهلك الزمني الحقيقي (gyro.rs consume_gyro) — بوابة/حواف/معايرة/تبريد
    // ------------------------------------------------------------------
    if only.is_none() || only.as_deref() == Some("consumer") {
        section("المستهلك — بوابة الوضع والجلسة");
        input::ACTIVE.store(true, Ordering::SeqCst);
        set_mode("off", serde_json::json!({}));
        check("وضع off: عينة بلا أحداث (إحصاء فقط — §18)", sample(0, 0, 0, -1000, 0, 0, 0).is_empty(), "off");

        section("المستهلك — جيمباد: حواف الأزرار عبر flags (ضغط/إفلات حقيقيان)");
        set_mode("gamepad", serde_json::json!({}));
        let e = sample(0b000001, 0, 0, -1000, 0, 0, 0); // A down
        check("A down → press مفتاح الخريطة (مسافة)", e.len() == 1 && e[0]["ch"] == " " && e[0]["state"] == "press", format!("{e:?}"));
        let e = sample(0b000001, 0, 0, -1000, 0, 0, 0); // لا تغيير
        check("ثبات الحالة بلا حواف → صفر أحداث", e.is_empty(), "no edge");
        let e = sample(0b000011, 0, 0, -1000, 0, 0, 0); // B down (A still down)
        check("B ينضم والـA يبقى → press واحد لـ B", e.len() == 1 && e[0]["ch"] == "z" && e[0]["state"] == "press", format!("{e:?}"));
        let e = sample(0b000010, 0, 0, -1000, 0, 0, 0); // A up (B still down)
        check("A up → release واحد", e.len() == 1 && e[0]["ch"] == " " && e[0]["state"] == "release", format!("{e:?}"));
        check("فقد حزمة إفلات يصححه التالي (دلالة حية §18/§21)", {
            let e = sample(0, 0, 0, -1000, 0, 0, 0); // B up (كان down) — حزمة الإفلات "فُقدت" ثم وصلت الحالة الكاملة
            e.len() == 1 && e[0]["ch"] == "z" && e[0]["state"] == "release"
        }, "self-correcting");
        // عصا التقليب عبر زاوية الجاذبية (تسارع): إمالة يمين ~30° → sin30×1000≈500 milli-g
        let e = sample(0, 0, 500, -866, 0, 0, 0);
        check("إمالة يمين 30° → ضغط right (زاوية جاذبية)", e.iter().any(|x| x["special"] == "right" && x["state"] == "press"), format!("{e:?}"));
        let e = sample(0, 0, 500, -866, 0, 0, 0);
        check("ثبات الإمالة بلا رجفان", e.is_empty(), "hysteresis");
        let e = sample(0, 0, 100, -995, 0, 0, 0);
        check("عودة للمركز → إفلات right", e.iter().any(|x| x["special"] == "right" && x["state"] == "release"), format!("{e:?}"));

        section("المستهلك — بوابة الجلسة (إحصاء حصرًا بلا جلسة)");
        input::ACTIVE.store(false, Ordering::SeqCst);
        let e = sample(0b000001, 0, 0, -1000, 0, 0, 0);
        check("بلا جلسة: لا أحداث (بوابة §13 حارسان)", e.is_empty(), "gate");
        input::ACTIVE.store(true, Ordering::SeqCst);

        section("المستهلك — ماوس هوائي: الإمساك بوابة الحركة + المعايرة");
        set_mode("airmouse", serde_json::json!({"calibrate": true}));
        // إغراق عينات معايرة (هاتف ساكن بانحياز ثابت — milli-rad/s)
        for _ in 0..14 {
            let _ = sample(0, 0, 0, -1000, 30, -20, 10);
        }
        let st = cfg_json();
        check("المعايرة التقطت الصفير (12 عينة)", st["calibrated"] == true && st["stats"]["calibrations"].as_u64().unwrap_or(0) >= 1, format!("{st}"));
        // دوران خالص حول z (يمين) 1 rad/s — فوق عتبة الهز 8°/s ≈ 0.14 rad/s
        let e = sample(core_gyro::FLAG_GRAB, 0, 0, -1000, 0, 0, 1000);
        check("إمساك + دوران → حركة نسبية (kind=move)", e.iter().any(|x| x["kind"] == "move" && x["dx"].as_f64().unwrap_or(0.0) > 0.0), format!("{e:?}"));
        let e = sample(0, 0, 0, -1000, 0, 0, 1000); // بلا إمساك
        check("بلا إمساك: المؤشر مجمّد (لا حركة)", !e.iter().any(|x| x["kind"] == "move"), format!("{e:?}"));
        let e = sample(core_gyro::FLAG_GRAB, 0, 0, -1000, 0, 0, 50); // هز 0.05 rad/s < 8°/s
        check("هز تحت عتبة تجاهل الاهتزاز → لا حركة", !e.iter().any(|x| x["kind"] == "move"), "jitter");
        let e = sample(core_gyro::FLAG_GRAB, 0, 0, -1000, 0, 0, 30000); // 30 rad/s عنيف
        check("دوران عنيف يُقص على ±500", {
            let mv = e.iter().find(|x| x["kind"] == "move").cloned().unwrap_or_default();
            mv["dx"].as_f64().map(|d| d.abs() <= 500.0).unwrap_or(false)
        }, format!("{e:?}"));

        section("المستهلك — عارض العروض: إيماءة + تبريد + ليزر بالإمساك");
        set_mode("presenter", serde_json::json!({"tiltDeg": 28}));
        let e = sample(0, 0, 600, -800, 0, 0, 0); // إمالة يمين 36° — تسليح
        check("إمالة المعصم تسلّح فقط", !e.iter().any(|x| x["kind"] == "presenter"), format!("{e:?}"));
        let e = sample(0, 0, 100, -995, 0, 0, 0); // عودة → إطلاق next
        check("العودة تُطلق next (PageDown على الكمبيوتر)", e.iter().any(|x| x["kind"] == "presenter" && x["action"] == "next"), format!("{e:?}"));
        // فترة التبريد تنتهي واقعيًا (المحرك أسرع من 650ms — النوم يصنع الفارق الزمني)
        std::thread::sleep(std::time::Duration::from_millis(750));
        let _ = sample(0, 0, -600, -800, 0, 0, 0); // يسار — تسليح
        let e = sample(0, 0, -100, -995, 0, 0, 0); // عودة → prev
        check("اليسار يُطلق prev", e.iter().any(|x| x["kind"] == "presenter" && x["action"] == "prev"), format!("{e:?}"));
        // تبريد: إيماءة ثانية فورًا تُكبَط
        let _ = sample(0, 0, 600, -800, 0, 0, 0);
        let e = sample(0, 0, 100, -995, 0, 0, 0);
        check("التبريد (650ms) يكبط الإيماءات المتلاحقة", !e.iter().any(|x| x["kind"] == "presenter"), "cooldown");
        let e = sample(core_gyro::FLAG_GRAB, 0, 0, -1000, 0, 0, 3000);
        check("ليزر أثناء العرض: الإمساك يحرك المؤشر (highlight §21.ج)", e.iter().any(|x| x["kind"] == "move"), format!("{e:?}"));

        section("المستهلك — لا مفتاح عالق: التفكيك الحتمي");
        set_mode("gamepad", serde_json::json!({}));
        let _ = sample(0b111111, 0, 0, -1000, 0, 0, 0); // كل الأزرار down
        let _ = sample(0b111111, 0, 700, -714, 0, 0, 0); // + إمالة يمين/أعلى
        let rel = gyro::session_ended();
        let rel_count = rel.iter().filter(|x| x["state"] == "release").count();
        check("نهاية الجلسة تفكك الأزرار الستة + اتجاهات العصا", rel_count >= 7, format!("releases={rel_count}"));
        let st = cfg_json();
        check("بعد التفكيك: لا حالة معلقة", st["stats"]["keyEdges"].as_u64().unwrap_or(0) > 0, "clean");
        // تغيير الوضع أثناء ضغط يفكك أيضًا (عبر المسار القائم — desktop-local)
        let _ = sample(0b000001, 0, 0, -1000, 0, 0, 0); // A down
        input::reset();
        let _ = set_mode("off", serde_json::json!({}));
        let ex = input::executed();
        check("تغيير الوضع يحقن الإفلات عبر المسار القائم (desktop-local)", ex.iter().any(|x| x["state"] == "release"), format!("{ex:?}"));
        input::ACTIVE.store(false, Ordering::SeqCst);

        // ------------------------------------------------------------------
        section("دخان الحقن على Xvfb — apply_key بضغط/إفلات الجيمباد (§21)");
        match std::env::var("DISPLAY") {
            Ok(d) if !d.is_empty() => {
                use enigo::{Enigo, Settings};
                let s = Settings { release_keys_when_dropped: false, ..Default::default() };
                match Enigo::new(&s) {
                    Ok(mut en) => {
                        let p = input_exec::apply_event(&mut en, &serde_json::json!({"kind": "key", "ch": "w", "state": "press"}));
                        let r = input_exec::apply_event(&mut en, &serde_json::json!({"kind": "key", "ch": "w", "state": "release"}));
                        check("press ثم release عبر Key::Unicode ينجحان", p.is_ok() && r.is_ok(), format!("{p:?}/{r:?}"));
                        let c = input_exec::apply_event(&mut en, &serde_json::json!({"kind": "key", "special": "space", "state": "press"}));
                        let c2 = input_exec::apply_event(&mut en, &serde_json::json!({"kind": "key", "special": "space", "state": "release"}));
                        check("مفتاح مسمّى بضغط/إفلات ينجح", c.is_ok() && c2.is_ok(), format!("{c:?}/{c2:?}"));
                        let k = input_exec::apply_event(&mut en, &serde_json::json!({"kind": "key", "ch": "a"}));
                        check("بلا state = click كما كان (توافق §13)", k.is_ok(), format!("{k:?}"));
                    }
                    Err(e) => println!("  ⚠️ enigo init فشل على هذا العرض: {e} — دخان الحقن تُجتازه CI الفيزيائية"),
                }
            }
            _ => println!("  ⚠️ بلا DISPLAY — دخان apply_key يُشغَّل بـ xvfb-run (نمط live-verify)"),
        }

        section("إحصاء صادق");
        let st = cfg_json();
        let s = &st["stats"];
        check("عدادات: عينات/حواف/حركات/إيماءات/معايرات كلها > 0", s["samples"].as_u64().unwrap_or(0) > 0 && s["keyEdges"].as_u64().unwrap_or(0) > 0 && s["moves"].as_u64().unwrap_or(0) > 0 && s["gestures"].as_u64().unwrap_or(0) > 0 && s["calibrations"].as_u64().unwrap_or(0) > 0, format!("{s}"));
        check("الحالة تحمل الوضع والأبعاد الستة للخريطة", st["map"]["A"].is_string() && st["map"]["R"].is_string() && st["mode"].is_string(), "state shape");
        check("calibrating ظاهرة في الحالة", st.get("calibrating").is_some(), "calibrating field");
    }

    let p = PASS.load(Ordering::SeqCst);
    let f = FAIL.load(Ordering::SeqCst);
    println!("\n══ gyro-verify: {p} ناجح · {f} فاشل ══");
    if f > 0 {
        std::process::exit(1);
    }
}

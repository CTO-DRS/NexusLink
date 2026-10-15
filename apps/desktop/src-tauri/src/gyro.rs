// NexusLink — الجولة 4 مرحلة ③ (عقد §21) — مستهلك الجيروسكوب المتقدم
// ============================================================================
// «ثلاثية التحكم المتقدم فوق NexusLive»: وجهة التحكم بالأوضاع + محرك ترجمة
// حزم TYPE_GYRO إلى أحداث الإدخال القياسية (kind=key/move/presenter) عبر
// المسار القائم حصرًا — بلا مسار حقن موازٍ (القاعدة الذهبية §18):
//
//   live.rs absorb → consume_gyro (هنا: بوابة الوضع/الجلسة + الحالة الزمنية)
//     → أحداث قياسية → دفعة live.rs → coalesce → input::execute_sync (§13)
//
// الأوضاع الثلاثة (نواة النقية في gyro_core):
//  · gamepad — عصا التقليب (زاوية جاذبية → أسهم بنافذة ميتة) + أزرار
//    A/B/X/Y/L/R (flags bits0-5 → مفاتيح الخريطة: ضغط/إفلات عند الحواف —
//    «ضغط مستمر» حقيقي تنفذه الألعاب، لا نقرات تُفقد بين الإطارات)
//  · airmouse — معدل الدوران المدمج (rad/s × dt) بعد صفير معاير وفلتر
//    EMA (تجاهل الاهتزاز) وحساسية قابلة للضبط — حركة نسبية عبر kind=move
//    القائم (§13) — البوابة: زر الإمساك (flags bit6) مضغوط حصرًا
//  · presenter — إيماءة إمالة معصم (عتبة + هيستيريسيس + تبريد) →
//    presenter next/prev (PageDown/PageUp عبر apply_presenter القائم §13)
//    + حركة الليزر أثناء العرض بنفس رياضيات الماوس (زر الإمساك = أشر)
//
// لا مفاتيح معلقة على المستخدم: نهاية الجلسة (ResetDrag في input.rs) أو
// تغيير الوضع يفكك كل ضغطات الجيمباد المعلقة (release حتمية).
use serde_json::{json, Value};
use std::time::Instant;

#[path = "gyro_core.rs"]
pub mod core;

use core::{FlipState, GyroCfg, TiltState};

static CFG: std::sync::Mutex<Option<GyroCfg>> = std::sync::Mutex::new(None);

// إحصاء صادق (أمر gyro_config — التشخيص + مصدر الحقيقة للهاتف)
static PACKETS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn cfg() -> GyroCfg {
    CFG.lock().ok().and_then(|g| g.clone()).unwrap_or_default()
}

/// الحالة الزمنية للمستهلك — خيط واحد فقط يمسها (خيط live-sink) والقفل
/// حماية دفاعية حصرًا (نفس نمط BrushState في input_exec §20)
struct Runtime {
    flip: FlipState,
    tilt: TiltState,
    /// مفاتيح الأزرار الستة مضغوطة الآن (للتفكيك الحتمي)
    held_btn: [bool; core::BTN_COUNT],
    /// المعدل المنعّم (rad/s) — EMA بين العينات
    air: [f64; 3],
    last_instant: Option<Instant>,
    /// صفير المعايرة (rad/s) — Some بعد زر المعايرة في الهاتف
    zero: Option<[f64; 3]>,
    /// عازل عينات المعايرة الجارية (12 عينة ≈ 120ms عند 100Hz)
    calib_buf: Vec<[f64; 3]>,
    /// علم المعايرة الجارية (العازل فارغ في بدايتها — العلم هو المصدر)
    calibrating: bool,
    /// تبريد إيماءة العارض
    last_gesture: Option<Instant>,
    stats: core::GyroStats,
}

fn rt() -> &'static std::sync::Mutex<Runtime> {
    static R: std::sync::OnceLock<std::sync::Mutex<Runtime>> = std::sync::OnceLock::new();
    R.get_or_init(|| {
        std::sync::Mutex::new(Runtime {
            flip: FlipState::default(),
            tilt: TiltState::default(),
            held_btn: [false; core::BTN_COUNT],
            air: [0.0; 3],
            last_instant: None,
            zero: None,
            calib_buf: Vec::new(),
            calibrating: false,
            last_gesture: None,
            stats: core::GyroStats::default(),
        })
    })
}

const CALIB_SAMPLES: usize = 12;
const GESTURE_COOLDOWN_MS: u128 = 650;
/// بكسل لكل درجة دوران عند حساسية 1.0 (مضاعَف بالحساسية — §21.ب)
const PX_PER_DEG: f64 = 18.0;

/// أحداث إفلات كل المفاتيح المعلقة + تصفير الحالة — تُنفَّذ في خيط enigo
/// عبر apply_event القياسي (لا مسار موازٍ).
pub fn release_all_events() -> Vec<Value> {
    let mut r = rt().lock().unwrap();
    let cfg_now = cfg();
    let mut evs = Vec::new();
    for (i, held) in r.held_btn.iter().enumerate() {
        if *held {
            evs.push(core::key_event(cfg_now.map.keys[i], "release"));
        }
    }
    // الاتجاهات الأربعة — حالة العصا نفسها مصدر الحقيقة
    for name in ["up", "down", "left", "right"] {
        let on_now = match name {
            "up" => r.flip.up,
            "down" => r.flip.down,
            "left" => r.flip.left,
            _ => r.flip.right,
        };
        if on_now {
            evs.push(core::key_event(core::KeyRef::Named(name), "release"));
        }
    }
    r.held_btn = [false; core::BTN_COUNT];
    r.flip = FlipState::default();
    r.tilt = TiltState::default();
    r.air = [0.0; 3];
    r.last_instant = None;
    r.calib_buf.clear();
    r.calibrating = false;
    evs
}

/// طلب معايرة من الهاتف (زر نقطة الصفير): جمع 12 عينة معدل قادمة
/// أثناء سكون اليد ثم متوسطها — تنفَّذ مع أول حزم gyro تالية.
pub fn begin_calibration() {
    let mut r = rt().lock().unwrap();
    r.calib_buf.clear();
    r.calibrating = true;
}

/// استهلاك عينة gyro في وضع نشط — يعيد أحداث الإدخال القياسية (قد تكون
/// فارغة: عينة بلا حواف). بوابة الجلسة §13 فُحصت في المستدعي (live.rs
/// قبل الدفعة) وفُحصت هنا دفاعيًا — والحقن يعيدها حتمًا.
pub fn consume_gyro(flags: u8, ax: i16, ay: i16, az: i16, gx: i16, gy: i16, gz: i16) -> Vec<Value> {
    PACKETS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let cfg_now = cfg();
    if cfg_now.mode == core::MODE_OFF || !crate::input::is_active() {
        return Vec::new();
    }
    let f = core::parse_flags(flags);
    let mut r = rt().lock().unwrap();
    r.stats.packets += 1;
    let mut evs: Vec<Value> = Vec::with_capacity(6);
    // الوحدة الفعلية (تعاقد §18 كما يرسلها sensors_plus): milli-rad/s
    // (rad/s × 1000 — مدى ±32.7 rad/s يغطي أسرع دوران معصم بلا قص)
    let rate = [gx as f64 / 1000.0, gy as f64 / 1000.0, gz as f64 / 1000.0];

    match cfg_now.mode {
        core::MODE_GAMEPAD => {
            // (1) أزرار A..R — حواف الحالة الكاملة (دلالة حية ذاتية التصحيح)
            for i in 0..core::BTN_COUNT {
                let now = f.buttons[i];
                if now != r.held_btn[i] {
                    evs.push(core::key_event(cfg_now.map.keys[i], if now { "press" } else { "release" }));
                    r.held_btn[i] = now;
                    r.stats.key_edges += 1;
                }
            }
            // (2) عصا التقليب — زاوية الجاذبية (المرجع المستقر — §21.أ)
            let (roll, pitch) = core::tilt_angles(ax as f64, ay as f64, az as f64);
            let (st2, flip_evs) = core::flip_step(r.flip, roll, pitch, cfg_now.deadzone_deg);
            r.flip = st2;
            r.stats.key_edges += flip_evs.len() as u64;
            evs.extend(flip_evs);
            // (3) تغيّر الوضع عن الماوس/العارض قد ترك معدلات — تصفير
            r.air = [0.0; 3];
        }
        core::MODE_AIRMOUSE | core::MODE_PRESENTER => {
            // المعايرة الجارية: تجميع العينات ثم متوسطها (زر الصفير في الهاتف) —
            // العلم هو المصدر (العازل فارغ في بدايتها)
            if r.calibrating {
                r.calib_buf.push(rate);
                if r.calib_buf.len() >= CALIB_SAMPLES {
                    if let Some(z) = core::calibrate_zero(&r.calib_buf) {
                        r.zero = Some(z);
                        r.stats.calibrations += 1;
                    }
                    r.calib_buf.clear();
                    r.calibrating = false;
                }
            }
            let zero = r.zero.unwrap_or([0.0; 3]);
            // dt من ساعة الاستقبال (مقصوص 1..50ms — عينات مفقودة لا تُضخّم)
            let now = Instant::now();
            let dt = r.last_instant.map(|t| now.duration_since(t).as_secs_f64()).unwrap_or(0.01);
            r.last_instant = Some(now);
            // الفلتر الأُسي (تجاهل الاهتزاز — بسيط بلا AI — §21.ب)
            r.air = core::air_filter(r.air, rate, zero, 0.55);
            // العارض: إيماءة إمالة المعصم (بلا بوابة إمساك — رفّة معصم منفصلة)
            if cfg_now.mode == core::MODE_PRESENTER {
                let (roll, _pitch) = core::tilt_angles(ax as f64, ay as f64, az as f64);
                let cooled = r.last_gesture.map(|t| now.duration_since(t).as_millis() >= GESTURE_COOLDOWN_MS).unwrap_or(true);
                if cooled {
                    let (st2, act) = core::tilt_gesture(r.tilt, roll, cfg_now.tilt_deg);
                    r.tilt = st2;
                    if let Some(a) = act {
                        evs.push(json!({"kind": "presenter", "action": a}));
                        r.last_gesture = Some(now);
                        r.stats.gestures += 1;
                    }
                }
            }
            // حركة الليزر/الماوس — بوابة الإمساك حصرًا (زر الإمساك = أشر/حرّك)
            if f.grab {
                let (dx, dy) = core::air_delta(r.air, dt, cfg_now.sens, cfg_now.shake_deg_s);
                if dx.abs() > 0.3 || dy.abs() > 0.3 {
                    evs.push(json!({"kind": "move", "dx": dx, "dy": dy, "source": "gyro-air"}));
                    r.stats.moves += 1;
                }
            } else {
                // بلا إمساك: المؤشر مجمّد — المعدل يُنسى (لا قفزة عند إعادة الإمساك)
                r.air = [0.0; 3];
                r.last_instant = None;
            }
        }
        _ => {}
    }
    r.stats.samples += 1;
    evs
}

/// نهاية جلسة تحكم — تفكيك المفاتيح المعلقة (يستدعيها input.rs ResetDrag
/// داخل خيط enigo — الحقن مباشر عبر apply_event هناك)
pub fn session_ended() -> Vec<Value> {
    release_all_events()
}

// ---------------------------------------------------------------------------
// أوامر Tauri — التحكم من الهاتف عبر rc:gyro:cmd (عقد §21.ج)
// ---------------------------------------------------------------------------

/// بناء مرشّح الدمج من الإعداد الحالي (الحقول كلها — المرسل يرقّع فوقها).
/// مفاتيح الخريطة تُحمل فقط للقالب المخصص (حفظه عبر الدمج الجزئي) — قالب
/// معياري بلا مفاتيح يُعاد بناؤه من قالبِه عند ذكره صراحةً حصرًا.
fn probe_json(cur: &GyroCfg) -> Value {
    let km = &cur.map;
    let mut j = json!({
        "mode": core::mode_name(cur.mode),
        "template": core::template_name(cur.template),
        "deadzoneDeg": cur.deadzone_deg,
        "sens": cur.sens,
        "shakeDegS": cur.shake_deg_s,
        "tiltDeg": cur.tilt_deg,
        "laser": cur.laser,
    });
    if cur.template == core::TPL_CUSTOM {
        j["keyA"] = json!(core::key_ref_to_json(km.keys[0]));
        j["keyB"] = json!(core::key_ref_to_json(km.keys[1]));
        j["keyX"] = json!(core::key_ref_to_json(km.keys[2]));
        j["keyY"] = json!(core::key_ref_to_json(km.keys[3]));
        j["keyL"] = json!(core::key_ref_to_json(km.keys[4]));
        j["keyR"] = json!(core::key_ref_to_json(km.keys[5]));
    }
    j
}

fn stats_json() -> core::GyroStats {
    rt().lock().map(|r| r.stats).unwrap_or_default()
}

/// حالة التحكم المتقدم (تُبث للهاتف بعد كل set وتعاد مع get — مصدر الحقيقة)
pub fn state_json() -> Value {
    let cur = cfg();
    let calibrated = rt().lock().map(|r| r.zero.is_some()).unwrap_or(false);
    let mut j = core::cfg_to_json(&cur, &stats_json(), calibrated);
    j["calibrating"] = json!(rt().lock().map(|r| r.calibrating).unwrap_or(false));
    j
}

#[tauri::command]
pub fn gyro_config() -> Value {
    state_json()
}

/// ضبط الوضع/الإعدادات — التنقية الأولى عند الجسر (§21.ج) وهنا ثقة التعاقد
/// نفسها (نمط tablet_config_set §20.ج). تغيير الوضع يفكك مفاتيح الجيمباد
/// المعلقة (حقن إفلات فوري عبر المسار القائم — desktop-local صاحب الجهاز).
#[tauri::command]
pub fn gyro_config_set(
    app: tauri::AppHandle,
    mode: Option<String>,
    template: Option<String>,
    deadzoneDeg: Option<f64>,
    sens: Option<f64>,
    shakeDegS: Option<f64>,
    tiltDeg: Option<f64>,
    laser: Option<bool>,
    calibrate: Option<bool>,
    keyA: Option<String>,
    keyB: Option<String>,
    keyX: Option<String>,
    keyY: Option<String>,
    keyL: Option<String>,
    keyR: Option<String>,
) -> Value {
    let want_calib = calibrate == Some(true);
    let cur = cfg();
    let mut probe = probe_json(&cur);
    // ترقيع الحقول المرسلة حصرًا (الحافظ على الباقي — نمط tablet_config_set)
    let sent: [(&str, Option<serde_json::Value>); 13] = [
        ("mode", mode.map(|v| json!(v))),
        ("template", template.map(|v| json!(v))),
        ("deadzoneDeg", deadzoneDeg.map(|v| json!(v))),
        ("sens", sens.map(|v| json!(v))),
        ("shakeDegS", shakeDegS.map(|v| json!(v))),
        ("tiltDeg", tiltDeg.map(|v| json!(v))),
        ("laser", laser.map(|v| json!(v))),
        ("keyA", keyA.map(|v| json!(v))),
        ("keyB", keyB.map(|v| json!(v))),
        ("keyX", keyX.map(|v| json!(v))),
        ("keyY", keyY.map(|v| json!(v))),
        ("keyL", keyL.map(|v| json!(v))),
        ("keyR", keyR.map(|v| json!(v))),
    ];
    for (k, v) in sent {
        if let Some(v) = v {
            probe[k] = v;
        }
    }
    match core::cfg_from_json_base(&probe, cur) {
        Some(next) => {
            let mode_changed = next.mode != cur.mode;
            if let Ok(mut g) = CFG.lock() {
                *g = Some(next);
            }
            if mode_changed {
                let evs = release_all_events();
                if !evs.is_empty() {
                    let _ = crate::input::execute(&app, &evs, "desktop-local");
                }
            }
            // المعايرة بعد التصفير (release_all يطفئ العلم — الطلب أولاً يبقى)
            if want_calib {
                begin_calibration();
            }
            state_json()
        }
        None => state_json().tap_reject("إعداد خارج التعاقد (§21.ج) — رُفض كله"),
    }
}

trait GyroReject {
    fn tap_reject(self, note: &str) -> Value;
}
impl GyroReject for Value {
    fn tap_reject(mut self, note: &str) -> Value {
        self["error"] = json!(note);
        self
    }
}

// NexusLink — الجولة 4 مرحلة ③ (عقد §21) — نواة التحكم المتقدم النقية
// ============================================================================
// «ثلاثية التحكم المتقدم فوق NexusLive»: جيمباد بالحساسات · ماوس هوائي
// معاير · عارض عروض بإيماءات. هذا الملف نقي بلا I/O ولا Tauri ولا enigo —
// يُضمَّن حرفيًا في gyro.rs (تطبيق سطح المكتب) وفي محرك التحقق scripts/
// gyro-verify — مصدر واحد للمنطق (نمط live_core/tablet المعتمد).
//
// تعاقد أزرار حزمة gyro (§21.ب — امتداد flags لحزمة TYPE_GYRO):
//   flags bit0..5 = A·B·X·Y·L·R (زر مضغوط=1 — الحالة الكاملة كل عينة،
//                   دلالة حية ذاتية التصحيح ضد فقد حزمة، نفس عقد §18)
//   flags bit6    = الإمساك (الماوس الهوائي/الليزر يتحركان وهو مضغوط حصرًا)
//   flags bit7    = محجوز (صفر)
//   الحمولة 12B كما هي عقد §18: ax·ay·az (milli-g) · gx·gy·gz (milli-dps)
// الجسر لا يفكك flags للجيروسكوب — يمرر خامًا (لا تغيير عند 3004/3010).
//
// ملاحظة ميدانية موثقة (§21.أ): «عصا التقليب» تقرأ **زاوية الجاذبية** من
// التسارع (atan2) لا معدل الدوران — معدل الجيروسكوب يعود صفرًا مع ثبات
// الإمالة فتنطلق المفاتيح؛ الزاوية المطلقة هي المرجع الكلاسيكي المستقر.
// الماوس الهوائي بالعكس يدمج **معدل** الدوران (جيروسكوب) مع صفير معاير.
use serde_json::{json, Value};

// ---------------------------------------------------------------------------
// تعاقد flags (§21.ب)
// ---------------------------------------------------------------------------
pub const GB_A: u8 = 0;
pub const GB_B: u8 = 1;
pub const GB_X: u8 = 2;
pub const GB_Y: u8 = 3;
pub const GB_L: u8 = 4;
pub const GB_R: u8 = 5;
/// عدد أزرار الجيمباد الافتراضية (bits0..5)
pub const BTN_COUNT: usize = 6;
/// bit6 — زر الإمساك (بوابة حركة الماوس الهوائي/الليزر)
pub const FLAG_GRAB: u8 = 0b0100_0000;
/// قناع الأزرار الستة
pub const BTN_MASK: u8 = 0b0011_1111;

/// أوضاع التحكم المتقدم
pub const MODE_OFF: u8 = 0;
pub const MODE_GAMEPAD: u8 = 1;
pub const MODE_AIRMOUSE: u8 = 2;
pub const MODE_PRESENTER: u8 = 3;

pub fn mode_name(m: u8) -> &'static str {
    match m {
        MODE_GAMEPAD => "gamepad",
        MODE_AIRMOUSE => "airmouse",
        MODE_PRESENTER => "presenter",
        _ => "off",
    }
}

/// القوالب الجاهزة (نقطة انطلاق قابلة لإعادة التعيين لكل زر — §21.أ)
pub const TPL_PLATFORMER: u8 = 0;
pub const TPL_RACING: u8 = 1;
pub const TPL_FIGHTING: u8 = 2;
pub const TPL_CUSTOM: u8 = 3;

pub fn template_name(t: u8) -> &'static str {
    match t {
        TPL_PLATFORMER => "platformer",
        TPL_RACING => "racing",
        TPL_FIGHTING => "fighting",
        _ => "custom",
    }
}

/// مرجع مفتاح — حرف ASCII مرئي أو مفتاح مسمى من البياض (يترجمه apply_key
/// عبر مسار ch / special القائم — بلا مسار حقن موازٍ، القاعدة الذهبية)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyRef {
    Char(char),
    Named(&'static str),
}

/// الأسماء المسموحة للمفاتيح المسمّاة (ترجمها special_key في input_exec —
/// موسعة بمفاتيح الألعاب الشائعة: أسهم/مسافة/تبديل/أحرف تحكم/صفحات)
pub const NAMED_KEYS: [&str; 16] = [
    "up", "down", "left", "right", "space", "enter", "esc", "tab", "shift",
    "ctrl", "pageup", "pagedown", "home", "end", "f5", "f11",
];

/// خريطة الأزرار الستة
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Keymap {
    pub keys: [KeyRef; BTN_COUNT],
}

impl Keymap {
    pub fn key_for(&self, bit: u8) -> KeyRef {
        self.keys[(bit as usize).min(BTN_COUNT - 1)]
    }
}

/// مفتاح من نص JSON: محرف ASCII مرئي واحد (33..126) أو مسافة (مفتاح
/// الألعاب الأهم — قفز/فرامل يد) أو اسم من البياض (يترجمه special_key
/// في input_exec عبر مسار ch / special القائم — بلا مسار حقن موازٍ)
pub fn key_ref_from(s: &str) -> Option<KeyRef> {
    let mut it = s.chars();
    let c = it.next()?;
    if it.next().is_none() {
        // محرف مفرد — مرئي أو مسافة حصرًا (بلا trim هنا — المسافة مفتاح صالح
        // يبتلعها trim — قفز/فرامل §21.أ)
        if c == ' ' || ((c as u32) >= 33 && (c as u32) <= 126) {
            return Some(KeyRef::Char(c));
        }
        return None;
    }
    // اسم مسمّى — من البياض حصرًا (حروف صغيرة، مع تسامح الفراغات المحيطة)
    let lower = s.trim().to_lowercase();
    NAMED_KEYS.iter().find(|k| **k == lower).map(|k| KeyRef::Named(k))
}

pub fn key_ref_to_json(k: KeyRef) -> String {
    match k {
        KeyRef::Char(c) => c.to_string(),
        KeyRef::Named(s) => s.to_string(),
    }
}

/// بناء حدث مفتاح قياسي (kind=key القائم) — state: press حصرًا عند الإرسال
/// من الجيمباد (الإفلات يصدره المستهلك عند حافة الزر الصاعدة)
pub fn key_event(k: KeyRef, state: &str) -> Value {
    let mut ev = match k {
        KeyRef::Char(c) => json!({"kind": "key", "ch": c.to_string()}),
        KeyRef::Named(s) => json!({"kind": "key", "special": s}),
    };
    if state != "click" {
        ev["state"] = json!(state);
    }
    ev
}

// ---------------------------------------------------------------------------
// القوالب الجاهزة (§21.أ) — A·B·X·Y·L·R
// ---------------------------------------------------------------------------
pub fn template_keymap(t: u8) -> Keymap {
    let k = |a: KeyRef, b: KeyRef, x: KeyRef, y: KeyRef, l: KeyRef, r: KeyRef| Keymap { keys: [a, b, x, y, l, r] };
    let c = |ch: char| KeyRef::Char(ch);
    match t {
        // منصة: قفز/ركض/أفعال — الأسهم من عصا التقليب
        TPL_PLATFORMER => k(c(' '), c('z'), c('x'), KeyRef::Named("shift"), c('c'), c('v')),
        // سباقات: فرامل يد/إعادة/نظرة خلفية — التوجيه والدعسات من العصا
        TPL_RACING => k(c(' '), c('r'), c('c'), c('v'), c('q'), c('e')),
        // قتال: لكمة/ركل/خفة/قوية — الأسهم من العصا
        TPL_FIGHTING => k(c('z'), c('x'), c('c'), c('v'), c('a'), c('s')),
        _ => k(c(' '), c('z'), c('x'), c('c'), c('v'), c('b')),
    }
}

// ---------------------------------------------------------------------------
// تنقية الإعدادات (§21.ج — مرآة الجسر حرفيًا: الفاسد يُرفض كله لا جزئيات)
// ---------------------------------------------------------------------------
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GyroCfg {
    pub mode: u8,
    pub template: u8,
    /// النافذة الميتة لعصا التقليب (درجات) — 5..45
    pub deadzone_deg: f64,
    /// حساسية الماوس الهوائي (مضاعف) — 0.5..5.0
    pub sens: f64,
    /// النافذة الميتة للمعدل (درجة/ث) — تجاهل الاهتزاز — 3..30
    pub shake_deg_s: f64,
    /// عتبة إيماءة تقليب العرض (درجات) — 10..60
    pub tilt_deg: f64,
    /// مؤشر الليزر مفعل أثناء العرض (Ctrl+L عند البدء)
    pub laser: bool,
    pub map: Keymap,
}

impl Default for GyroCfg {
    fn default() -> Self {
        GyroCfg {
            mode: MODE_OFF,
            template: TPL_PLATFORMER,
            deadzone_deg: 18.0,
            sens: 2.0,
            shake_deg_s: 8.0,
            tilt_deg: 28.0,
            laser: false,
            map: template_keymap(TPL_PLATFORMER),
        }
    }
}

/// تنقية كاملة من JSON فوق **قاعدة حالية** (دمج جزئي حرفيًا: المرسل فقط
/// يُرقّع — الباقي يُحفظ، بما فيه خريطة القالب المخصص). None يعني رفض
/// كلي (نفس دلالة brush_from_json §20.ج). cfg_from_json = قاعدة افتراضية.
pub fn cfg_from_json_base(d: &Value, base: GyroCfg) -> Option<GyroCfg> {
    let mut cfg = base;
    if let Some(m) = d.get("mode").and_then(|x| x.as_str()) {
        cfg.mode = match m {
            "off" => MODE_OFF,
            "gamepad" => MODE_GAMEPAD,
            "airmouse" => MODE_AIRMOUSE,
            "presenter" => MODE_PRESENTER,
            _ => return None,
        };
    }
    let template_explicit = d.get("template").is_some();
    if let Some(t) = d.get("template").and_then(|x| x.as_str()) {
        cfg.template = match t {
            "platformer" => TPL_PLATFORMER,
            "racing" => TPL_RACING,
            "fighting" => TPL_FIGHTING,
            "custom" => TPL_CUSTOM,
            _ => return None,
        };
    }
    // قالب صريح يعيد بناء الخريطة من قالبِه؛ وإلا تُحفظ خريطة القاعدة
    // (حفظ القالب المخصص عبر الدمج الجزئي — حساسية مطلوبة §21)
    if template_explicit {
        cfg.map = template_keymap(cfg.template);
    }
    let mut map_explicit = false;
    for (i, k) in ["keyA", "keyB", "keyX", "keyY", "keyL", "keyR"].iter().enumerate() {
        if let Some(s) = d.get(*k).and_then(|x| x.as_str()) {
            let kr = key_ref_from(s)?;
            cfg.map.keys[i] = kr;
            map_explicit = true;
        }
    }
    // مفاتيح صريحة بلا قالب صريح = قالب مخصص (الحالة تعكس ذلك)
    if map_explicit && !template_explicit {
        cfg.template = TPL_CUSTOM;
    }
    if let Some(v) = d.get("deadzoneDeg").and_then(|x| x.as_f64()) {
        if !(5.0..=45.0).contains(&v) {
            return None;
        }
        cfg.deadzone_deg = v;
    }
    if let Some(v) = d.get("sens").and_then(|x| x.as_f64()) {
        if !(0.5..=5.0).contains(&v) {
            return None;
        }
        cfg.sens = v;
    }
    if let Some(v) = d.get("shakeDegS").and_then(|x| x.as_f64()) {
        if !(3.0..=30.0).contains(&v) {
            return None;
        }
        cfg.shake_deg_s = v;
    }
    if let Some(v) = d.get("tiltDeg").and_then(|x| x.as_f64()) {
        if !(10.0..=60.0).contains(&v) {
            return None;
        }
        cfg.tilt_deg = v;
    }
    if let Some(v) = d.get("laser") {
        cfg.laser = v.as_bool()?;
    }
    Some(cfg)
}

/// تنقية فوق الافتراضي (الاختبارات والاستدعاء الأول)
pub fn cfg_from_json(d: &Value) -> Option<GyroCfg> {
    cfg_from_json_base(d, GyroCfg::default())
}

/// الحالة إلى JSON (مصدر الحقيقة للهاتف — نفس نمط tablet::state_json).
/// calibrated من حالة المستهلك (صفير ملتقط) — وليست من الإعداد.
pub fn cfg_to_json(cfg: &GyroCfg, stats: &GyroStats, calibrated: bool) -> Value {
    let km = &cfg.map;
    json!({
        "mode": mode_name(cfg.mode),
        "template": template_name(cfg.template),
        "deadzoneDeg": cfg.deadzone_deg,
        "sens": cfg.sens,
        "shakeDegS": cfg.shake_deg_s,
        "tiltDeg": cfg.tilt_deg,
        "laser": cfg.laser,
        "map": {
            "A": key_ref_to_json(km.keys[0]), "B": key_ref_to_json(km.keys[1]),
            "X": key_ref_to_json(km.keys[2]), "Y": key_ref_to_json(km.keys[3]),
            "L": key_ref_to_json(km.keys[4]), "R": key_ref_to_json(km.keys[5]),
        },
        "stats": {
            "samples": stats.samples, "packets": stats.packets,
            "keyEdges": stats.key_edges, "moves": stats.moves,
            "gestures": stats.gestures, "calibrations": stats.calibrations,
        },
        "calibrated": calibrated,
        "at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
    })
}

#[derive(Debug, Default, Clone, Copy)]
pub struct GyroStats {
    pub samples: u64,     // عينات استُهلكت في وضع نشط
    pub packets: u64,     // كل حزم gyro الواصلة (إحصاء المستقبل يرى أيضًا)
    pub key_edges: u64,   // حواف مفاتيح (ضغط/إفلات) مولدة
    pub moves: u64,       // أحداث حركة ماوس هوائي مولدة
    pub gestures: u64,    // إيماءات تقليب عرض
    pub calibrations: u64,
}

// ---------------------------------------------------------------------------
// عصا التقليب (§21.أ-3): زاوية جاذبية → مفاتيح اتجاه بنافذة ميتة قابلة
// للضبط + هيستيريسيس (دخول > عتبة · خروج < 0.6×عتبة) — بلا رجفان مفاتيح
// عند الحافة. الحالة الزمنية صريحة وقابلة للاختبار النقي.
// ---------------------------------------------------------------------------

/// زوايا الجاذبية من عينة تسارع (milli-g): roll (إمالة يمين/يسار — عموديًا)
/// وpitch (إمالة أمام/خلف). المرجع: الهاتف عموديًا شاشة نحو المستخدم.
/// أرضية 81 milli-g (0.081g) تمنع انفجار atan2 عند الاستواء الكامل —
/// الزاوية تشبع قرب ±85° (قيد ميداني موثق: الاستواء لا يحدد الاتجاه).
pub fn tilt_angles(ax: f64, ay: f64, az: f64) -> (f64, f64) {
    let floor = 81.0_f64;
    let roll = ay.atan2(az.abs().max(floor));
    let pitch = ax.atan2(az.abs().max(floor));
    (roll, pitch)
}

/// حالة العصا — أي مفاتيح اتجاه مضغوطة الآن
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct FlipState {
    pub up: bool,
    pub down: bool,
    pub left: bool,
    pub right: bool,
}

/// مفاتيح الاتجاه الأربعة (Named — تترجمها special_key: up/down/left/right)
pub const FLIP_KEYS: [(&str, &str); 4] = [("up", "up"), ("down", "down"), ("left", "left"), ("right", "right")];

/// خطوة محور موقّع نقي: الحالة -1/0/+1 مع هيستيريسيس (دخول > عتبة،
/// خروج < 0.6×عتبة) — محور واحد اتجاه واحد حصرًا (لا ضغط مزدوج).
/// يعيد (الحالة الجديدة، الحافة: +1 دخول موجب، -1 دخول سالب، 0 إفلات).
pub fn axis_step(prev: i8, v: f64, dz: f64) -> (i8, Option<i8>) {
    let out = dz * 0.6;
    let next: i8 = match prev {
        1 => {
            if v > out {
                1
            } else {
                0
            }
        }
        -1 => {
            if v < -out {
                -1
            } else {
                0
            }
        }
        _ => {
            if v > dz {
                1
            } else if v < -dz {
                -1
            } else {
                0
            }
        }
    };
    (next, if next != prev { Some(next) } else { None })
}

/// خطوة العصا النقية: (زاوية roll, زاوية pitch بالراديان) → حواف مفاتيح.
/// يعيد (الحالة الجديدة، أحداث قياسية kind=key state=press/release).
/// roll موجب = يمين · سالب = يسار · pitch موجب = أسفل · سالب = أعلى —
/// محور واحد اتجاه واحد (axis_step) — بلا رجفان ولا مزدوج.
pub fn flip_step(prev: FlipState, roll: f64, pitch: f64, deadzone_deg: f64) -> (FlipState, Vec<Value>) {
    let dz = deadzone_deg.to_radians().max(0.001);
    let r_prev: i8 = if prev.right { 1 } else if prev.left { -1 } else { 0 };
    let p_prev: i8 = if prev.down { 1 } else if prev.up { -1 } else { 0 };
    let (rs, re) = axis_step(r_prev, roll, dz);
    let (ps, pe) = axis_step(p_prev, pitch, dz);
    let st = FlipState { right: rs == 1, left: rs == -1, down: ps == 1, up: ps == -1 };
    let mut evs: Vec<Value> = Vec::with_capacity(2);
    match re {
        Some(1) => evs.push(key_event(KeyRef::Named("right"), "press")),
        Some(-1) => evs.push(key_event(KeyRef::Named("left"), "press")),
        Some(_) => {
            // إفلات — الجهة المضغوطة سابقًا (المحور يحمل اتجاهًا واحدًا)
            if prev.right {
                evs.push(key_event(KeyRef::Named("right"), "release"));
            } else if prev.left {
                evs.push(key_event(KeyRef::Named("left"), "release"));
            }
        }
        None => {}
    }
    match pe {
        Some(1) => evs.push(key_event(KeyRef::Named("down"), "press")),
        Some(-1) => evs.push(key_event(KeyRef::Named("up"), "press")),
        Some(_) => {
            if prev.down {
                evs.push(key_event(KeyRef::Named("down"), "release"));
            } else if prev.up {
                evs.push(key_event(KeyRef::Named("up"), "release"));
            }
        }
        None => {}
    }
    (st, evs)
}

// ---------------------------------------------------------------------------
// الماوس الهوائي (§21.ب-4): صفير معاير + فلتر بسيط بلا AI + مضاعفة حساسية
// + بوابة الإمساك. الدمج: معدل الدوران (rad/s) × dt — عينة 100Hz dt≈10ms.
// ---------------------------------------------------------------------------

/// معايرة نقطة الصفير: متوسط K عينة معدل (الهاتف ساكن في وضع الإمساك) —
/// يزيل انحياز الجيروسكوب الذاتي ووضع اليد (النقطة الصفرية). يعيد None
/// إن لم تُوفر عينات كافية.
pub fn calibrate_zero(samples: &[[f64; 3]]) -> Option<[f64; 3]> {
    if samples.is_empty() {
        return None;
    }
    let n = samples.len() as f64;
    let mut z = [0.0f64; 3];
    for s in samples {
        for i in 0..3 {
            z[i] += s[i];
        }
    }
    for i in 0..3 {
        z[i] /= n;
        if !z[i].is_finite() {
            return None;
        }
    }
    Some(z)
}

/// فلتر التنعيم الأُسي (تجاهل الاهتزاز — بسيط بلا AI): EMA على المعدل
/// المنقى من الصفير. alpha 0..1 (الأعلى أسرع استجابة).
pub fn air_filter(prev: [f64; 3], sample: [f64; 3], zero: [f64; 3], alpha: f64) -> [f64; 3] {
    let a = alpha.clamp(0.05, 1.0);
    let mut out = [0.0f64; 3];
    for i in 0..3 {
        let raw = sample[i] - zero[i];
        out[i] = prev[i] * (1.0 - a) + raw * a;
        if !out[i].is_finite() {
            out[i] = 0.0;
        }
    }
    out
}

/// دلتا الماوس الهوائي (بكسل) من معدل منعّم (rad/s) وdt (ث):
/// · النافذة الميتة للهز (shake_deg_s) تقتل الاهتزاز الصغير
/// · الحساسية sens مضاعف خطي · القص ±500 بكسل (حاجز §18 المرسل والمستقبل)
/// المحاور (نفس اصطلاح الماوس الهوائي القائم — الهاتف رأسيًا):
/// أفقي = gz · عمودي = −gx (عينات gyro بترتيب gx,gy,gz — §18)
pub fn air_delta(rate: [f64; 3], dt_s: f64, sens: f64, shake_deg_s: f64) -> (f64, f64) {
    let dt = dt_s.clamp(0.001, 0.05);
    let shake = shake_deg_s.to_radians();
    let gz = if rate[2].abs() < shake { 0.0 } else { rate[2] };
    let gx = if rate[0].abs() < shake { 0.0 } else { rate[0] };
    let dx = (gz * dt * sens * 57.2958 * 18.0).clamp(-500.0, 500.0);
    let dy = (-gx * dt * sens * 57.2958 * 18.0).clamp(-500.0, 500.0);
    (dx, dy)
}

// ---------------------------------------------------------------------------
// إيماءة العارض (§21.ج-5): إمالة معصم (roll زاوية) عتبة + هيستيريسيس +
// تبريد زمني (ms) — يمين→next · يسار→prev (نفس مفاتيح apply_presenter —
/// PageDown/PageUp عبر المسار القائم حصرًا).
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct TiltState {
    /// داخل نطاق الإيماءة يمينًا (بانتظار العودة للمركز)
    pub armed_right: bool,
    pub armed_left: bool,
}

/// خطوة الإيماءة: يعيد (الحالة، Some("next"|"prev")) — التبريد خارجها
/// (يديره المستهلك بساعته — النقية تبقى بلا ساعة).
pub fn tilt_gesture(prev: TiltState, roll: f64, tilt_deg: f64) -> (TiltState, Option<&'static str>) {
    let t = tilt_deg.to_radians().max(0.01);
    let back = t * 0.5; // العودة لنصف العتبة تُسلّح الإيماءة مجددًا
    let mut st = prev;
    let mut act: Option<&'static str> = None;
    // يمين: دخول فوق العتبة (بلا تسليح مسبق = لا إطلاق) — خروج تحت النصف يطلق
    if !prev.armed_right && roll > t {
        st.armed_right = true;
    } else if prev.armed_right && roll < back {
        st.armed_right = false;
        act = Some("next");
    }
    // يسار (يُقاس بعد اليمين كي لا يتنافسا في العينة نفسها)
    if act.is_none() {
        if !prev.armed_left && roll < -t {
            st.armed_left = true;
        } else if prev.armed_left && roll > -back {
            st.armed_left = false;
            act = Some("prev");
        }
    }
    (st, act)
}

// ---------------------------------------------------------------------------
// فك flags الحزمة (مرآة gyro.rs — نقية للاختبار)
// ---------------------------------------------------------------------------
pub struct GyroFlags {
    pub buttons: [bool; BTN_COUNT],
    pub grab: bool,
}

pub fn parse_flags(flags: u8) -> GyroFlags {
    let mut buttons = [false; BTN_COUNT];
    for i in 0..BTN_COUNT {
        buttons[i] = flags & (1 << i) != 0;
    }
    GyroFlags { buttons, grab: flags & FLAG_GRAB != 0 }
}

// ---------------------------------------------------------------------------
// اختبارات الوحدة الداخلية (تُشغَّل أيضًا من محرك التحقق عبر الحشية)
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flags_roundtrip() {
        let f = parse_flags(0b0101_0011);
        assert_eq!(f.buttons, [true, true, false, false, true, false]);
        assert!(f.grab);
        let f0 = parse_flags(0);
        assert!(!f0.grab && f0.buttons.iter().all(|b| !b));
    }

    #[test]
    fn keymap_templates_and_patch() {
        let mut cfg = GyroCfg::default();
        assert_eq!(cfg.map.key_for(GB_A), KeyRef::Char(' '));
        // رقعة مفتاح واحد بلا قالب → custom
        let v = json!({"keyA": "k"});
        let c2 = cfg_from_json(&v).unwrap();
        assert_eq!(c2.template, TPL_CUSTOM);
        assert_eq!(c2.map.key_for(GB_A), KeyRef::Char('k'));
        let _ = &mut cfg;
    }

    #[test]
    fn flip_hysteresis_no_chatter() {
        let dz = 18.0_f64;
        let (st1, evs1) = flip_step(FlipState::default(), 20_f64.to_radians(), 0.0, dz);
        assert!(st1.right && evs1.len() == 1 && evs1[0]["state"] == "press");
        // داخل الهيستيريسيس (12° < 0.6×18) — لا حافة جديدة
        let (st2, evs2) = flip_step(st1, 12_f64.to_radians(), 0.0, dz);
        assert!(st2.right && evs2.is_empty());
        // عودة للمركز — إفلات واحد
        let (st3, evs3) = flip_step(st2, 5_f64.to_radians(), 0.0, dz);
        assert!(!st3.right && evs3.len() == 1 && evs3[0]["state"] == "release");
    }

    #[test]
    fn air_math_pipeline() {
        let zero = calibrate_zero(&[[0.01, -0.02, 0.005], [0.011, -0.019, 0.004]]).unwrap();
        // gx=0.25 rad/s ≈ 14.3°/s فوق عتبة الهز 8°/s · gz=0.35 ≈ 20°/s كذلك
        let f0 = air_filter([0.0; 3], [0.25, 0.0, 0.35], zero, 0.6);
        let (dx, dy) = air_delta(f0, 0.01, 2.0, 8.0);
        assert!(dx > 0.0 && dy < 0.0); // gz موجب → يمين · gx موجب → أعلى (−)
        // قص ±500
        let (dx2, _) = air_delta([5.0, 0.0, 5.0], 0.05, 5.0, 3.0);
        assert!(dx2.abs() <= 500.0);
        // هز تحت النافذة الميتة = صفر
        let (dx3, dy3) = air_delta([0.1, 0.0, 0.1], 0.01, 2.0, 8.0);
        assert_eq!(dx3, 0.0);
        assert_eq!(dy3, 0.0);
    }

    #[test]
    fn tilt_gesture_armed_fire() {
        let (st, a) = tilt_gesture(TiltState::default(), 30_f64.to_radians(), 28.0);
        assert!(a.is_none() && st.armed_right); // دخول لا يطلق
        let (st2, a2) = tilt_gesture(st, 10_f64.to_radians(), 28.0);
        assert_eq!(a2, Some("next"));
        assert!(!st2.armed_right);
    }

    #[test]
    fn cfg_sanitize_rejects_all() {
        assert!(cfg_from_json(&json!({"mode": "hacked"})).is_none());
        assert!(cfg_from_json(&json!({"deadzoneDeg": 60})).is_none());
        assert!(cfg_from_json(&json!({"sens": 9})).is_none());
        assert!(cfg_from_json(&json!({"keyA": "ab"})).is_none());
        assert!(cfg_from_json(&json!({"keyA": "\u{7}"})).is_none());
        assert!(cfg_from_json(&json!({"keyB": "capslock"})).is_none());
        assert!(cfg_from_json(&json!({"laser": 3})).is_none());
        let ok = cfg_from_json(&json!({"mode":"presenter","tiltDeg":30,"laser":true})).unwrap();
        assert_eq!(ok.mode, MODE_PRESENTER);
        assert!(ok.laser);
    }
}

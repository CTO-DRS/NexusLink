// NexusLink — NexusLive نواة البروتوكول الثنائي النقية (الجولة 4 — عقد §18)
// ============================================================================
// «قناة UDP عالية التردد للإدخال الحي»: قلم/ماوس/جيروسكوب/لمس من الهاتف
// عبر داتاجرام واحد لكل حدث (بلا تجزئة، بلا إعادة إرسال — دلالة حية).
// هذا الملف نقي بلا I/O ولا Tauri: يُضمَّن حرفيًا في live.rs (تطبيق سطح
// المكتب) وفي محرّك التحقق scripts/live-verify — مصدر واحد للمنطق.
//
// تخطيط الحزمة (big-endian حصراً — عقد §18):
//   رأس 20B: [0..2) magic 0x4E58 ("NX") · [2] version=1 · [3] type ·
//            [4] flags (bit0=نسبي لحزمة mouse · bits1-2=الأداة لحزمة pen — §20) ·
//            [5] محجوز ·
//            [6..10) seq u32be · [10..14) ts u32be (ms epoch مقتطعة) ·
//            [14..22) key 8B (مفتاح الجلسة)
//   pen   12B: nx·ny u16be (0..65535) · pressure u16be · tiltX·tiltY i8 ·
//              phase u8 (0=hover 1=down 2=move 3=up) · buttons u8
//   mouse 10B: nx|dx · ny|dy u16be (نسبي: i16be ±500 بكسل — flags bit0=1) ·
//              phase u8 (0=move 1=down 2=up 3=click 4=dblclick 5=rclick) ·
//              buttons u8 · wheel i16be
//   gyro  12B: ax·ay·az i16be (milli-g) · gx·gy·gz i16be (milli-dps)
//   touch  8B: nx·ny u16be · action u8 (إجراءات pointer الستة) · id u8 · pad u16
//   ping   0B  (يرد الجسر pong: type=0x7E بنفس seq وts=زمن الجسر)
//
// التحويل للتنفيذ (بلا مسار حقن موازٍ — القاعدة الذهبية):
//   pen → kind=pointer (المطبع القائم §15) + pressure محمولة للمهام القادمة
//   touch/mouse-مطلق → kind=pointer · mouse-نسبي → kind=move (§13 drag حافة)
//   wheel≠0 → kind=scroll · gyro → بلا حدث (إحصاء فقط — مستهلكه مهمة الجيمباد)
use serde_json::{json, Value};

/// إيقاع الحزمة — magic «NX»
pub const MAGIC: u16 = 0x4E58;
pub const VERSION: u8 = 1;
/// أقصى داتاجرام مقبول (رأس 22 + أوسع حمولة 12 = 34؛ سقف دفاعي 128)
pub const MAX_DATAGRAM: usize = 128;
/// طول الرأس الثابت: magic2+ver1+type1+flags1+rsv1+seq4+ts4+key8 = 22 بايت
pub const HEADER_LEN: usize = 22;

pub const TYPE_PEN: u8 = 1;
pub const TYPE_MOUSE: u8 = 2;
pub const TYPE_GYRO: u8 = 3;
pub const TYPE_TOUCH: u8 = 4;
pub const TYPE_PONG: u8 = 0x7E;
pub const TYPE_PING: u8 = 0x7F;

/// أطوال الحمولات بعد الرأس — [pen, mouse, gyro, touch]
/// (pen: 2+2+2+1+1+1+1=10 · mouse: 2+2+1+1+2=8 · gyro: 6×2=12 · touch: 2+2+1+1+2=8)
const PAYLOAD_LEN: [usize; 4] = [10, 8, 12, 8]; // تعاقد §18 — تستعمله الاختبارات

/// طور القلم (pen.phase)
pub const PEN_HOVER: u8 = 0;
pub const PEN_DOWN: u8 = 1;
pub const PEN_MOVE: u8 = 2;
pub const PEN_UP: u8 = 3;

/// أداة القلم (flags bits1-2 لحزمة pen — الجولة 4 مرحلة ② عقد §20)
/// 0=قلم · 1=ممحاة (طرف مقلوب) · 2=إصبع (راحة اليد عند إيقاف الرفض) · 3 محجوز → يفك قلمًا
pub const TOOL_PEN: u8 = 0;
pub const TOOL_ERASER: u8 = 1;
pub const TOOL_FINGER: u8 = 2;

/// اسم الأداة التعاقدي (JSON الحدث — مستهلكه محرك الفرشاة في input_exec)
pub fn tool_name(tool: u8) -> &'static str {
    match tool {
        TOOL_ERASER => "eraser",
        TOOL_FINGER => "finger",
        _ => "pen", // 0 و3 (محجوز) — قلم
    }
}

/// إجراءات mouse/touch — بنفس ترتيب POINTER_ACTIONS في input_exec (§15)
pub const ACT_MOVE: u8 = 0;
pub const ACT_DOWN: u8 = 1;
pub const ACT_UP: u8 = 2;
pub const ACT_CLICK: u8 = 3;
pub const ACT_DBLCLICK: u8 = 4;
pub const ACT_RCLICK: u8 = 5;

/// إجراءات المؤشر التعاقدية (تطابق input_exec::POINTER_ACTIONS)
pub const POINTER_ACTIONS: [&str; 6] = ["move", "down", "up", "click", "dblclick", "rclick"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParseError {
    TooShort,
    TooLong,
    BadMagic,
    BadVersion,
    BadType,
    BadSize,
}

impl ParseError {
    /// سبب عربي صادق (للسجل/الإحصاء — لا تفاصيل حساسة)
    pub fn reason(self) -> &'static str {
        match self {
            ParseError::TooShort => "حزمة أقصر من الرأس",
            ParseError::TooLong => "حزمة أطول من السقف",
            ParseError::BadMagic => "توقيع خاطئ",
            ParseError::BadVersion => "إصدار بروتوكول غير مدعوم",
            ParseError::BadType => "نوع حزمة غير معروف",
            ParseError::BadSize => "طول الحمولة لا يطابق النوع",
        }
    }
}

/// رأس حزمة مفكوك
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Header {
    pub ptype: u8,
    pub flags: u8,
    pub seq: u32,
    pub ts: u32,
    pub key: [u8; 8],
}

impl Header {
    /// flags bit0 — وضع النسبية لحزمة mouse
    pub fn relative(&self) -> bool {
        self.flags & 0x01 != 0
    }
}

/// حمولة حدث مفكوكة (قيم مُطبّعة جاهزة للاستهلاك)
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Payload {
    /// قلم: إحداثيات 0..1 + ضغط 0..1 + ميل ±60° مقصوص + طور + أزرار + أداة (§20)
    Pen { nx: f64, ny: f64, pressure: f64, tilt_x: i8, tilt_y: i8, phase: u8, buttons: u8, tool: u8 },
    /// ماوس: مطلق (0..1) أو نسبي (±500 بكسل) + إجراء + عجلة (نقرات)
    Mouse { a: f64, b: f64, phase: u8, buttons: u8, wheel: i16 },
    /// جيروسكوب/تسارع خام — بلا حدث حقن في هذه المرحلة (إحصاء فقط)
    Gyro { ax: i16, ay: i16, az: i16, gx: i16, gy: i16, gz: i16 },
    /// لمس: إحداثيات 0..1 + إجراء من الستة + معرف مؤشر (تعدد لمس لاحقًا)
    Touch { nx: f64, ny: f64, action: u8, pointer_id: u8 },
    Ping,
    /// رد الجسر على النبض (يفكه الهاتف — يعرفه Rust للتكامل الدفاعي)
    Pong,
}

// ---------------------------------------------------------------------------
// قراءة big-endian آمنة (بلا panics — كل الحدود مفحوصة)
// ---------------------------------------------------------------------------
fn be_u16(b: &[u8], o: usize) -> Option<u16> {
    if o + 2 > b.len() { return None; }
    Some(u16::from_be_bytes([b[o], b[o + 1]]))
}
fn be_u32(b: &[u8], o: usize) -> Option<u32> {
    if o + 4 > b.len() { return None; }
    Some(u32::from_be_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]))
}
fn be_i16(b: &[u8], o: usize) -> Option<i16> {
    be_u16(b, o).map(|v| v as i16)
}

/// تحليل داتاجرام كاملة → (رأس، حمولة). صارم: طول مطابق تمامًا للنوع.
pub fn parse(buf: &[u8]) -> Result<(Header, Payload), ParseError> {
    if buf.len() < HEADER_LEN {
        return Err(ParseError::TooShort);
    }
    if buf.len() > MAX_DATAGRAM {
        return Err(ParseError::TooLong);
    }
    if be_u16(buf, 0) != Some(MAGIC) {
        return Err(ParseError::BadMagic);
    }
    if buf[2] != VERSION {
        return Err(ParseError::BadVersion);
    }
    let ptype = buf[3];
    let flags = buf[4];
    let seq = be_u32(buf, 6).unwrap_or(0);
    let ts = be_u32(buf, 10).unwrap_or(0);
    let mut key = [0u8; 8];
    key.copy_from_slice(&buf[14..22]);

    let payload = match ptype {
        TYPE_PING => {
            if buf.len() != HEADER_LEN {
                return Err(ParseError::BadSize);
            }
            Payload::Ping
        }
        TYPE_PONG => {
            if buf.len() != HEADER_LEN {
                return Err(ParseError::BadSize);
            }
            Payload::Pong
        }
        TYPE_PEN => {
            if buf.len() != HEADER_LEN + 10 {
                return Err(ParseError::BadSize);
            }
            Payload::Pen {
                nx: be_u16(buf, 22).unwrap_or(0) as f64 / 65535.0,
                ny: be_u16(buf, 24).unwrap_or(0) as f64 / 65535.0,
                pressure: be_u16(buf, 26).unwrap_or(0) as f64 / 65535.0,
                tilt_x: buf[28] as i8,
                tilt_y: buf[29] as i8,
                phase: buf[30].min(PEN_UP),
                buttons: buf[31],
                tool: (flags >> 1) & 0b11, // §20 — أداة القلم من flags bits1-2
            }
        }
        TYPE_MOUSE => {
            if buf.len() != HEADER_LEN + 8 {
                return Err(ParseError::BadSize);
            }
            let (a, b) = if flags & 0x01 != 0 {
                // نسبي: i16be مقصوص على ±500 (حاجز input_exec MAX_DELTA=500 نفسه)
                let dx = be_i16(buf, 22).unwrap_or(0).clamp(-500, 500) as f64;
                let dy = be_i16(buf, 24).unwrap_or(0).clamp(-500, 500) as f64;
                (dx, dy)
            } else {
                (be_u16(buf, 22).unwrap_or(0) as f64 / 65535.0, be_u16(buf, 24).unwrap_or(0) as f64 / 65535.0)
            };
            Payload::Mouse { a, b, phase: buf[26].min(ACT_RCLICK), buttons: buf[27], wheel: be_i16(buf, 28).unwrap_or(0) }
        }
        TYPE_GYRO => {
            if buf.len() != HEADER_LEN + 12 {
                return Err(ParseError::BadSize);
            }
            Payload::Gyro {
                ax: be_i16(buf, 22).unwrap_or(0),
                ay: be_i16(buf, 24).unwrap_or(0),
                az: be_i16(buf, 26).unwrap_or(0),
                gx: be_i16(buf, 28).unwrap_or(0),
                gy: be_i16(buf, 30).unwrap_or(0),
                gz: be_i16(buf, 32).unwrap_or(0),
            }
        }
        TYPE_TOUCH => {
            if buf.len() != HEADER_LEN + 8 {
                return Err(ParseError::BadSize);
            }
            Payload::Touch {
                nx: be_u16(buf, 22).unwrap_or(0) as f64 / 65535.0,
                ny: be_u16(buf, 24).unwrap_or(0) as f64 / 65535.0,
                action: buf[26].min(ACT_RCLICK),
                pointer_id: buf[27],
            }
        }
        _ => return Err(ParseError::BadType),
    };
    Ok((Header { ptype, flags, seq, ts, key }, payload))
}

// ---------------------------------------------------------------------------
// الترميز (محرّك التحقق يصنع حزمًا حقيقية عبر UDP loopback)
// ---------------------------------------------------------------------------
/// ترميز رأس + حمولة خام إلى داتاجرام
pub fn encode(ptype: u8, flags: u8, seq: u32, ts: u32, key: &[u8; 8], payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER_LEN + payload.len());
    out.extend_from_slice(&MAGIC.to_be_bytes());
    out.push(VERSION);
    out.push(ptype);
    out.push(flags);
    out.push(0); // محجوز
    out.extend_from_slice(&seq.to_be_bytes());
    out.extend_from_slice(&ts.to_be_bytes());
    out.extend_from_slice(key);
    out.extend_from_slice(payload);
    out
}

/// ترميز حزمة pen كاملة (12B حمولة) — tool: أداة القلم (§20 — flags bits1-2).
/// أداة خارج التعاقد (>2) تُطبع إلى قلم عند الترميز (والفك يتسامح كذلك).
#[allow(clippy::too_many_arguments)]
pub fn encode_pen(seq: u32, ts: u32, key: &[u8; 8], nx: f64, ny: f64, pressure: f64, tilt_x: i8, tilt_y: i8, phase: u8, buttons: u8, tool: u8) -> Vec<u8> {
    let nx = (nx.clamp(0.0, 1.0) * 65535.0).round() as u16;
    let ny = (ny.clamp(0.0, 1.0) * 65535.0).round() as u16;
    let pr = (pressure.clamp(0.0, 1.0) * 65535.0).round() as u16;
    let p = [&nx.to_be_bytes()[..], &ny.to_be_bytes()[..], &pr.to_be_bytes()[..], &[tilt_x as u8, tilt_y as u8, phase.min(PEN_UP), buttons][..]].concat();
    let flags = if tool > TOOL_FINGER { TOOL_PEN } else { tool } << 1;
    encode(TYPE_PEN, flags, seq, ts, key, &p)
}

/// ترميز حزمة mouse — relative=true يعني a/b إزاحات i16
pub fn encode_mouse(seq: u32, ts: u32, key: &[u8; 8], relative: bool, a: f64, b: f64, phase: u8, buttons: u8, wheel: i16) -> Vec<u8> {
    let (ab1, ab2, flags) = if relative {
        let dx = (a.clamp(-500.0, 500.0).round() as i16).to_be_bytes();
        let dy = (b.clamp(-500.0, 500.0).round() as i16).to_be_bytes();
        ([dx[0], dx[1]], [dy[0], dy[1]], 0x01u8)
    } else {
        let nx = ((a.clamp(0.0, 1.0)) * 65535.0).round() as u16;
        let ny = ((b.clamp(0.0, 1.0)) * 65535.0).round() as u16;
        ([nx.to_be_bytes()[0], nx.to_be_bytes()[1]], [ny.to_be_bytes()[0], ny.to_be_bytes()[1]], 0u8)
    };
    let p = [ab1, ab2, [phase.min(ACT_RCLICK), buttons], wheel.to_be_bytes()].concat();
    encode(TYPE_MOUSE, flags, seq, ts, key, &p)
}

/// ترميز حزمة touch (8B حمولة)
pub fn encode_touch(seq: u32, ts: u32, key: &[u8; 8], nx: f64, ny: f64, action: u8, pointer_id: u8) -> Vec<u8> {
    let nx = (nx.clamp(0.0, 1.0) * 65535.0).round() as u16;
    let ny = (ny.clamp(0.0, 1.0) * 65535.0).round() as u16;
    let p = [&nx.to_be_bytes()[..], &ny.to_be_bytes()[..], &[action.min(ACT_RCLICK), pointer_id, 0, 0][..]].concat();
    encode(TYPE_TOUCH, 0, seq, ts, key, &p)
}

/// ترميز حزمة gyro (12B حمولة)
#[allow(clippy::too_many_arguments)]
pub fn encode_gyro(seq: u32, ts: u32, key: &[u8; 8], ax: i16, ay: i16, az: i16, gx: i16, gy: i16, gz: i16) -> Vec<u8> {
    let p = [ax.to_be_bytes(), ay.to_be_bytes(), az.to_be_bytes(), gx.to_be_bytes(), gy.to_be_bytes(), gz.to_be_bytes()].concat();
    encode(TYPE_GYRO, 0, seq, ts, key, &p)
}

/// ترميز ping (بلا حمولة)
pub fn encode_ping(seq: u32, ts: u32, key: &[u8; 8]) -> Vec<u8> {
    encode(TYPE_PING, 0, seq, ts, key, &[])
}

/// ترميز pong (يرده الجسر Node — متاح هنا للتحقق من الوجهة المعاكسة)
pub fn encode_pong(seq: u32, ts: u32, key: &[u8; 8]) -> Vec<u8> {
    encode(TYPE_PONG, 0, seq, ts, key, &[])
}

// ---------------------------------------------------------------------------
// إحصاء التسلسل — الفقد/الترتيب/التكرار (wrap-aware على u32)
// ---------------------------------------------------------------------------
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeqUpdate {
    Ok,
    /// فقد d-1 حزمة قبل هذه
    Lost(u32),
    /// حزمة قديمة وصلت متأخرة (تُمرّر أيضًا — دلالة حية)
    Reorder,
    /// مكررة (تُهمل)
    Dup,
}

pub fn seq_update(last: u32, seq: u32) -> SeqUpdate {
    let d = seq.wrapping_sub(last);
    if d == 0 {
        return SeqUpdate::Dup;
    }
    if d < 0x8000_0000 {
        if d == 1 {
            SeqUpdate::Ok
        } else {
            SeqUpdate::Lost(d - 1)
        }
    } else {
        SeqUpdate::Reorder
    }
}

// ---------------------------------------------------------------------------
// التحويل إلى أحداث محلّل الإدخال القائم (input_exec::apply_event — §13/§15)
// يعيد None للأنواع بلا هدف حقن (gyro/ping) — تعدّ إحصاءً فقط.
// ---------------------------------------------------------------------------
pub fn payload_to_event(p: &Payload) -> Option<Value> {
    match *p {
        Payload::Ping | Payload::Pong | Payload::Gyro { .. } => None,
        Payload::Pen { nx, ny, pressure, phase, tool, .. } => {
            // القلم يمر عبر المؤشر المطلق القائم — pressure وtool محمولان في الحدث
            // (مستهلكهما: مهمة لوحة الرسم §20 — الضغط→الفرشاة عبر المسار الأصلي
            // لكل منصة، والأداة تحدد مستهلك الضغط: قلم حصرًا)
            let action = match phase {
                PEN_DOWN => "down",
                PEN_UP => "up",
                _ => "move", // hover وmove كلاهما حركة
            };
            Some(json!({"kind": "pointer", "nx": nx, "ny": ny, "action": action, "pressure": pressure, "tool": tool_name(tool), "source": "pen-live"}))
        }
        Payload::Touch { nx, ny, action, .. } => {
            let a = POINTER_ACTIONS.get(action as usize).copied().unwrap_or("move");
            Some(json!({"kind": "pointer", "nx": nx, "ny": ny, "action": a, "source": "touch-live"}))
        }
        Payload::Mouse { a, b, phase, wheel, .. } => {
            // العجلة أولوية إن وُجدت (المرسل لا يجمعها مع حركة — موثق §18)
            if wheel != 0 {
                // تدرّج §13: كل نقرة عجلة = 40px — dy موجب = لأسفل
                return Some(json!({"kind": "scroll", "dy": (wheel as f64) * 40.0}));
            }
            // ملاحظة: الوضع النسبي (flags bit0) يعالجه packet_to_events قبل هنا —
            // ما يصل لهذه الدالة من mouse مطلق حصرًا (a/b 0..1).
            let act = POINTER_ACTIONS.get(phase as usize).copied().unwrap_or("move");
            Some(json!({"kind": "pointer", "nx": a, "ny": b, "action": act, "source": "mouse-live"}))
        }
    }
}

/// نسخة كاملة تعرف الرأس: mouse نسبي → kind=move (§13 — آلية السحب القائمة)
/// دلالة حية ذاتية التصحيح: حالة الزر الأيسر (buttons bit0) في كل حزمة —
/// حافة السحب تُحسب في apply_move/set_drag، وفقد حزمة up يصححه التالي
/// (بلا تعليق زر على المستخدم — عقد §18).
pub fn packet_to_events(h: &Header, p: &Payload) -> Vec<Value> {
    match (h.ptype, *p) {
        (TYPE_MOUSE, Payload::Mouse { a, b, phase, buttons, .. }) if h.relative() => {
            let mut evs: Vec<Value> = Vec::with_capacity(2);
            // حركة نسبية دائمًا (حتى صفرية) — set_drag يعمل قبل الإرجاع المبكر
            // فيتطبق حافة ضغط/رفع الزر حتى بلا إزاحة (ضغط في المكان)
            evs.push(json!({
                "kind": "move", "dx": a, "dy": b, "drag": (buttons & 0x01) == 1,
                "source": "airmouse-live",
            }));
            // نقرات في الوضع النسبي: حدث click إضافي بعد الحركة
            match phase {
                ACT_CLICK => evs.push(json!({"kind": "click", "button": "left"})),
                ACT_DBLCLICK => evs.push(json!({"kind": "click", "button": "left", "type": "double"})),
                ACT_RCLICK => evs.push(json!({"kind": "click", "button": "right"})),
                _ => {}
            }
            evs
        }
        _ => match payload_to_event(p) {
            Some(ev) => vec![ev],
            None => vec![],
        },
    }
}

// ---------------------------------------------------------------------------
// الدمج الحي (latest-wins) — قلب دلالة «حية»: تحت التحميل، حركات المؤشر
// (pointer-move / move النسبية) تُستبدل بأحدثها بدل تراكم الطابور (كمون
// محدود بلا نمو خطي)، والأحداث المنفصلة (نقر/ضغط/رفع/عجلة) تُحفظ كلها
// بالترتيب، والحركة المعلقة تُفرغ قبل أول حدث منفصل بعده (الموضع قبل النقرة).
// ---------------------------------------------------------------------------
pub fn coalesce(events: Vec<Value>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::with_capacity(events.len() + 2);
    let mut motion_ptr: Option<Value> = None; // kind=pointer action=move (مطلق)
    let mut motion_rel: Option<Value> = None; // kind=move (نسبي — ماوس هوائي/لمس)
    for ev in events {
        let kind = ev.get("kind").and_then(|x| x.as_str()).unwrap_or("");
        let is_motion = match kind {
            "pointer" => ev.get("action").and_then(|x| x.as_str()) == Some("move"),
            "move" => true,
            _ => false,
        };
        if is_motion {
            match kind {
                "pointer" => motion_ptr = Some(ev),
                _ => motion_rel = Some(ev),
            }
            continue;
        }
        // حدث منفصل — أفرغ الحركتين المعلقتين قبلها إن وُجدتا
        if let Some(m) = motion_ptr.take() {
            out.push(m);
        }
        if let Some(m) = motion_rel.take() {
            out.push(m);
        }
        out.push(ev);
    }
    if let Some(m) = motion_ptr.take() {
        out.push(m);
    }
    if let Some(m) = motion_rel.take() {
        out.push(m);
    }
    out
}

/// تحويل إحداثيات u16be خام (للاختبارات)
pub fn norm_u16(v: u16) -> f64 {
    v as f64 / 65535.0
}

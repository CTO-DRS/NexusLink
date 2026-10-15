// NexusLink Desktop — منفّذ أحداث الإدخال النقي (FA-input — عقد §13)
// ============================================================================
// نواة نقية بلا اعتماد على Tauri: تستقبل أحداث rc:* بعد فك JSON وتنفذها
// عبر enigo. هذا الملف يُضمَّن حرفيًا في input.rs (تطبيق سطح المكتب) وفي
// محرّك التحقق scripts/enigo-verify (Xvfb) — مصدر واحد للمنطق.
//
// تعاقد الأحداث (§4.2 + §13):
//   move    {dx, dy, drag?}        حركة نسبية — drag=true يضغط الزر الأيسر
//                                  حتى أول حدث بلا drag (آلية سحب لوحة اللمس)
//   click   {button, type?}        tap | double (نقرتان متتاليتان)
//   scroll  {dy}                   عجلة عمودية — dy موجب = لأسفل (تدرّج 40px/نقرة)
//   pinch   {scale}                تكبير/تصغير = Ctrl + عجلة (PowerPoint/المتصفح)
//   key     {ch? | special? | key?, modifiers?}  حقن نص يونيكودي (عربي كامل
//                                  مستقل عن تخطيط الكيبورد — انظر أدناه) أو
//                                  مفتاح خاص/مسماة (f5/pageup/pagedown…)
//   presenter {action}             next→PageDown · prev→PageUp · start→F5 ·
//                                  stop→Esc · black→b (شاشة PowerPoint السوداء)
//                                  laser-*: عرض ويبي فقط — لا مقابل نظامي (موثق)
//   media   {action, value?}       toggle/play/pause→MediaPlayPause ·
//                                  next/prev→MediaNext/PrevTrack ·
//                                  mute/unmute→VolumeMute · volume→مستوى مطلق
//                                  0..100 (لكل منصة طريقها — انظر volume_set)
//
// حقن النص العربي (البند 1 — معالجة تخطيط الكيبورد):
//   enigo.text() يحقن يونيكوديًا مستقلًا عن التخطيط النشط:
//   · Windows: SendInput مع KEYEVENTF_UNICODE — الحرف يمر كما هو بغضّ النظر
//     عن تخطيط النظام (عربي/إنجليزي/أي لوحة) — لا حاجة لتبديل اللغة إطلاقًا.
//   · macOS: CGEventKeyboardSetUnicodeString — نفس الضمان.
//   · Linux/X11: Key::Unicode(c) → keysym يونيكودي (0x1000000+codepoint) عبر
//     XTEST مع إعادة ربط keycodes غير مستخدمة مؤقتًا (نمط xdotool) — يعمل
//     مع أي تطبيق يستقبل إدخال X11 (XWayland يشمله). Wayland الأصلي غير مسند
//     في هذه النسخة (موثق بصدق في العقد).
//   يعني: الكتابة بالعربية من كيبورد الهاتف تصل حرفًا حرفًا حتى لو كانت
//   لوحة الكمبيوتر الإنجليزية هي النشطة — لا تبديل تخطيط ولا توقع أحرف.
use enigo::{Axis, Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse};

/// أقصى إزاحة واحدة مقبولة (الهاتف يقصّ ±200 — حاجز ثانٍ دفاعي)
const MAX_DELTA: f64 = 500.0;
/// تدرّج التمرير: كل 40 بكسل سحب = نقرة عجلة واحدة
const SCROLL_PX_PER_NOTCH: f64 = 40.0;
/// أقصى نقرات عجلة في حدث واحد
const MAX_SCROLL_NOTCHES: i32 = 10;

// ---------------------------------------------------------------------------
// FA-media (عقد §15) — المؤشر المطلق على الشاشة المعروضة في الهاتف:
// فضاء الإحداثيات = سطح المكتب المركّب (أصل كل الشاشات) — يضبطه media.rs عند
// بدء/إيقاف البث (أبعاد الهدف + أصله) ويفض افتراضيًا على البعد الشائع.
// ---------------------------------------------------------------------------
static POINTER_SPACE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// ضبط فضاء المؤشر المطلق — (w, h, origin_x, origin_y) مرمزة في u64 واحد
/// (w 12bit · h 12bit · x 20bit إزاحة ±512K · y 20bit) — بلا قفل للمسار الحرج
pub fn set_pointer_space(w: u32, h: u32, ox: i32, oy: i32) {
    let pack = ((w.min(0xFFF) as u64) << 52)
        | ((h.min(0xFFF) as u64) << 40)
        | (((ox + 512_000).clamp(0, 0xFFFFF) as u64) << 20)
        | ((oy + 512_000).clamp(0, 0xFFFFF) as u64);
    POINTER_SPACE.store(pack, std::sync::atomic::Ordering::Relaxed);
}

fn pointer_space() -> (u32, u32, i32, i32) {
    let p = POINTER_SPACE.load(std::sync::atomic::Ordering::Relaxed);
    if p == 0 {
        return (1920, 1080, 0, 0); // افتراضي حتى يضبطه media.rs
    }
    (
        ((p >> 52) & 0xFFF) as u32,
        ((p >> 40) & 0xFFF) as u32,
        ((p >> 20) & 0xFFFFF) as i32 - 512_000,
        (p & 0xFFFFF) as i32 - 512_000,
    )
}

/// إجراءات المؤشر المطلق (rc:pointer — تنقية الجسر تغطيها أيضًا)
pub const POINTER_ACTIONS: [&str; 6] = ["move", "down", "up", "click", "dblclick", "rclick"];

pub fn pointer_action_ok(a: &str) -> bool {
    POINTER_ACTIONS.contains(&a)
}

/// تحويل إحداثيات مُطبّعة (0..1 من الشاشة المعروضة في الهاتف) إلى بكسل
/// مطلق في فضاء سطح المكتب المركّب (أصل كل الشاشات المركبة).
pub fn pointer_map(nx: f64, ny: f64, w: u32, h: u32, ox: i32, oy: i32) -> (i32, i32) {
    let nx = if nx.is_finite() { nx.clamp(0.0, 1.0) } else { 0.0 };
    let ny = if ny.is_finite() { ny.clamp(0.0, 1.0) } else { 0.0 };
    let x = ox + (nx * w as f64).round() as i32;
    let y = oy + (ny * h as f64).round() as i32;
    // حاجز دفاعي: داخل فضاء سطح المكتب المركب بعيدًا عن الأطراف القاتلة
    (x.clamp(-32_000, 32_000), y.clamp(-32_000, 32_000))
}

fn clamp_i(v: f64, hi: f64) -> i32 {
    if !v.is_finite() {
        return 0;
    }
    let c = v.clamp(-hi, hi);
    c.round() as i32
}

/// تطبيق حدث إدخال واحد (دوال enigo مباشرة)
/// يعيد نصًا وصفيًا عند النجاح (للسجل) أو خطأ عربيًا.
pub fn apply_event(enigo: &mut Enigo, ev: &serde_json::Value) -> Result<String, String> {
    let kind = ev
        .get("kind")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    match kind.as_str() {
        "move" => apply_move(enigo, ev),
        "click" => apply_click(enigo, ev),
        "scroll" => apply_scroll(enigo, ev),
        "pinch" => apply_pinch(enigo, ev),
        "key" => apply_key(enigo, ev),
        "presenter" => apply_presenter(enigo, ev),
        "media" => apply_media(enigo, ev),
        "pointer" => apply_pointer(enigo, ev), // FA-media (عقد §15)
        other => Err(format!("نوع حدث إدخال غير معروف: {other}")),
    }
}

/// FA-media (عقد §15) — لمس على الشاشة المعروضة في الهاتف: مؤشر مطلق + إجراء.
/// nx/ny 0..1 على إطار البث → بكسل مطلق في فضاء سطح المكتب المركّب.
fn apply_pointer(enigo: &mut Enigo, ev: &serde_json::Value) -> Result<String, String> {
    let nx = ev.get("nx").and_then(|x| x.as_f64()).unwrap_or(0.0);
    let ny = ev.get("ny").and_then(|x| x.as_f64()).unwrap_or(0.0);
    let action = ev.get("action").and_then(|x| x.as_str()).unwrap_or("move");
    if !pointer_action_ok(action) {
        return Err(format!("إجراء مؤشر غير معروف: {action}"));
    }
    // الجولة 4 مرحلة ② (عقد §20) — لوحة الرسم: الضغط والأداة محمولان في حدث
    // pen-live (من live_core)؛ بقية المسارات (rc:pointer/touch-live) بلا ضغط.
    let pressure = ev.get("pressure").and_then(|x| x.as_f64());
    let tool = ev.get("tool").and_then(|x| x.as_str()).unwrap_or("");
    let (w, h, ox, oy) = pointer_space();
    let (x, y) = pointer_map(nx, ny, w, h, ox, oy);
    enigo
        .move_mouse(x, y, Coordinate::Abs)
        .map_err(|e| format!("تحريك المؤشر المطلق فشل: {e}"))?;
    match action {
        "move" => {
            brush_tick(enigo, pressure, tool)?;
            Ok("مؤشر مطلق".into())
        }
        "down" => {
            brush_begin();
            enigo
                .button(Button::Left, Direction::Press)
                .map(|_| "ضغط".to_string())
                .map_err(|e| format!("ضغط فشل: {e}"))
        }
        "up" => {
            brush_end();
            enigo
                .button(Button::Left, Direction::Release)
                .map(|_| "رفع".to_string())
                .map_err(|e| format!("رفع فشل: {e}"))
        }
        "click" => {
            enigo.button(Button::Left, Direction::Click).map_err(|e| format!("نقر فشل: {e}"))?;
            Ok("نقر على الموضع".into())
        }
        "dblclick" => {
            enigo.button(Button::Left, Direction::Click).map_err(|e| format!("نقر فشل: {e}"))?;
            std::thread::sleep(std::time::Duration::from_millis(40));
            enigo.button(Button::Left, Direction::Click).map_err(|e| format!("نقر مزدوج فشل: {e}"))?;
            Ok("نقر مزدوج على الموضع".into())
        }
        "rclick" => {
            enigo.button(Button::Right, Direction::Click).map_err(|e| format!("نقر أيمن فشل: {e}"))?;
            Ok("نقر أيمن على الموضع".into())
        }
        _ => Ok("مؤشر مطلق".into()),
    }
}

// ---------------------------------------------------------------------------
// الجولة 4 مرحلة ② (عقد §20) — لوحة الرسم الاحترافية: الضغط → سماكة الفرشاة.
// «وضع الماوس المطلق» يعمل مع أي برنامج رسم (Krita/Photoshop/IbisPaint):
// القلم يحرك مؤشر النظام بموضع مطلق، والضغط يضبط السماكة عبر تقنية متوافقة
// قابلة للتعيين — مفاتيح الفرشاة (Krita/Photoshop: [ و]) أو عجلة التمرير
// مع معدّل اختياري. الحساب الرياضي مفصول عن الحقن (نقي — يُختبَر في محركي
// enigo-verify/live-verify)، والضغط مستهلك للقلم/الممحاة حصرًا (ضغط الإصبع
// بلا معنى فيض على أكثر الأجهزة — موثق §20).
// ---------------------------------------------------------------------------

/// وضع تقنية الضغط→الفرشاة
pub const BRUSH_OFF: u8 = 0;
pub const BRUSH_KEYS: u8 = 1;
pub const BRUSH_SCROLL: u8 = 2;

/// المعدّل الاختياري لوضع العجلة
pub const MOD_NONE: u8 = 0;
pub const MOD_CTRL: u8 = 1;
pub const MOD_ALT: u8 = 2;
pub const MOD_SHIFT: u8 = 3;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BrushCfg {
    pub mode: u8,
    pub dec_ch: char, // مفتاح تصغير الفرشاة
    pub inc_ch: char, // مفتاح تكبير الفرشاة
    pub levels: u32,  // مستويات التكميم 2..=64
    pub modifier: u8, // وضع العجلة فقط
}

impl Default for BrushCfg {
    fn default() -> Self {
        // Krita/Photoshop: [ يصغّر و] يكبّر — 24 مستوى بخطوة ملموسة بلا إغراق
        BrushCfg { mode: BRUSH_KEYS, dec_ch: '[', inc_ch: ']', levels: 24, modifier: MOD_NONE }
    }
}

static BRUSH_CFG: std::sync::Mutex<Option<BrushCfg>> = std::sync::Mutex::new(None);

/// ضبط إعداد الفرشاة (من أمر Tauri tablet_config_set — المدقق هناك؛ هنا ثقة)
pub fn set_brush_cfg(cfg: BrushCfg) {
    if let Ok(mut g) = BRUSH_CFG.lock() {
        *g = Some(cfg);
    }
}

pub fn brush_cfg() -> BrushCfg {
    BRUSH_CFG.lock().ok().and_then(|g| *g).unwrap_or_default()
}

/// حساب جزيئي نقي: ضغط 0..1 → مستوى مكمم 0..levels-1
pub fn brush_level(pressure: f64, levels: u32) -> u32 {
    let lv = levels.max(2);
    let p = if pressure.is_finite() { pressure.clamp(0.0, 1.0) } else { 0.0 };
    ((p * lv as f64).floor() as u32).min(lv - 1)
}

/// حساب جزيئي نقي: فرق المستويين → (عدد الخطوات، اتجاهها) — سقف 4 لكل عينة
pub fn brush_steps(last: u32, cur: u32) -> (i32, bool) {
    let d = cur as i64 - last as i64;
    (d.unsigned_abs().min(4) as i32, d >= 0)
}

struct BrushState {
    active: bool,
    last_level: Option<u32>,
    last_inject: Option<std::time::Instant>,
}

fn brush_state() -> &'static std::sync::Mutex<BrushState> {
    static S: std::sync::OnceLock<std::sync::Mutex<BrushState>> = std::sync::OnceLock::new();
    S.get_or_init(|| std::sync::Mutex::new(BrushState { active: false, last_level: None, last_inject: None }))
}

/// بداية ضربة القلم (down) — أول عينة تُرسي المستوى المرجعي بلا حقن
pub fn brush_begin() {
    if let Ok(mut s) = brush_state().lock() {
        s.active = true;
        s.last_level = None;
    }
}

/// نهاية ضربة القلم (up)
pub fn brush_end() {
    if let Ok(mut s) = brush_state().lock() {
        s.active = false;
    }
}

/// تصفير الحالة عند نهاية الجلسة (بلا أثر معلق للمستخدم التالي)
pub fn brush_reset() {
    brush_end();
}

/// سقف إيقاع الحقن: ≤33 مفتاح/ث — إغراق التطبيق الرسمي بمفاتيح السماكة ممنوع
const BRUSH_MIN_INJECT_MS: u128 = 30;

/// نبضة الفرشاة على كل عينة حركة أثناء الضربة — حقن تغيّر المستوى المكمم فقط
fn brush_tick(enigo: &mut Enigo, pressure: Option<f64>, tool: &str) -> Result<(), String> {
    let cfg = brush_cfg();
    if cfg.mode == BRUSH_OFF || tool == "finger" {
        return Ok(());
    }
    let p = match pressure {
        Some(v) => v,
        None => return Ok(()),
    };
    let mut s = brush_state().lock().map_err(|_| "قفل حالة الفرشاة".to_string())?;
    if !s.active {
        return Ok(()); // hover لا يغيّر السماكة
    }
    let level = brush_level(p, cfg.levels);
    let Some(last) = s.last_level else {
        s.last_level = Some(level);
        return Ok(());
    };
    if last == level {
        return Ok(());
    }
    let now = std::time::Instant::now();
    if let Some(t) = s.last_inject {
        if now.duration_since(t).as_millis() < BRUSH_MIN_INJECT_MS {
            // الإيقاع ممتلئ: لا نحدّث last_level — العينة التالية تعيد المحاولة
            // بأحدث مستوى (دلالة latest-wins نفسها — لا خطوة مفقودة نهائيًا)
            return Ok(());
        }
    }
    let (steps, up) = brush_steps(last, level);
    let r = brush_inject(enigo, &cfg, steps, up);
    if r.is_ok() {
        s.last_level = Some(level);
        s.last_inject = Some(now);
    }
    r
}

fn brush_inject(enigo: &mut Enigo, cfg: &BrushCfg, steps: i32, up: bool) -> Result<(), String> {
    match cfg.mode {
        BRUSH_KEYS => {
            let ch = if up { cfg.inc_ch } else { cfg.dec_ch };
            for _ in 0..steps {
                enigo.key(Key::Unicode(ch), Direction::Click).map_err(|e| format!("مفتاح الفرشاة فشل: {e}"))?;
            }
            Ok(())
        }
        BRUSH_SCROLL => {
            let m = match cfg.modifier {
                MOD_CTRL => Some(Key::Control),
                MOD_ALT => Some(Key::Alt),
                MOD_SHIFT => Some(Key::Shift),
                _ => None,
            };
            if let Some(k) = m {
                enigo.key(k, Direction::Press).map_err(|e| format!("معدّل الفرشاة فشل: {e}"))?;
            }
            let r = enigo
                .scroll(if up { steps } else { -steps }, Axis::Vertical)
                .map_err(|e| format!("عجلة الفرشاة فشلت: {e}"));
            if let Some(k) = m {
                let r2 = enigo.key(k, Direction::Release).map_err(|e| format!("تحرير معدّل الفرشاة فشل: {e}"));
                r?;
                return r2;
            }
            r
        }
        _ => Ok(()),
    }
}

fn apply_move(enigo: &mut Enigo, ev: &serde_json::Value) -> Result<String, String> {
    let dx = ev.get("dx").and_then(|x| x.as_f64()).unwrap_or(0.0);
    let dy = ev.get("dy").and_then(|x| x.as_f64()).unwrap_or(0.0);
    // آلية السحب (FA-9): أول حدث drag=true يضغط الزر الأيسر، وأول حدث
    // بلا drag يرفعه — تحوّل «نقر مطول + تحريك» في الهاتف إلى سحب حقيقي.
    let drag = ev.get("drag").and_then(|x| x.as_bool()).unwrap_or(false);
    set_drag(enigo, drag)?;
    if dx.abs() < 0.01 && dy.abs() < 0.01 {
        return Ok("سحب".into());
    }
    enigo
        .move_mouse(clamp_i(dx, MAX_DELTA), clamp_i(dy, MAX_DELTA), Coordinate::Rel)
        .map_err(|e| format!("تحريك المؤشر فشل: {e}"))?;
    Ok("حركة مؤشر".into())
}

/// حالة زر السحب (حافة فقط: ضغط عند الانتقال true، رفع عند الانتقال false —
/// بلا تكرار ضغط/رفع على كل حدث حركة)
static DRAG_DOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub fn set_drag(enigo: &mut Enigo, down: bool) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if DRAG_DOWN.swap(down, Ordering::SeqCst) == down {
        return Ok(()); // لا تغيّر حافة — بلا فعل
    }
    if down {
        enigo.button(Button::Left, Direction::Press).map_err(|e| format!("ضغط زر السحب فشل: {e}"))
    } else {
        enigo.button(Button::Left, Direction::Release).map_err(|e| format!("رفع زر السحب فشل: {e}"))
    }
}

/// تحرير زر السحب إن كان معلقًا (يستدعى عند نهاية الجلسة — لا زر معلق على المستخدم)
pub fn reset_drag(enigo: &mut Enigo) {
    use std::sync::atomic::Ordering;
    if DRAG_DOWN.swap(false, Ordering::SeqCst) {
        let _ = enigo.button(Button::Left, Direction::Release);
    }
}

fn apply_click(enigo: &mut Enigo, ev: &serde_json::Value) -> Result<String, String> {
    let button = match ev.get("button").and_then(|x| x.as_str()) {
        Some("right") => Button::Right,
        Some("middle") => Button::Middle,
        _ => Button::Left,
    };
    let dbl = ev.get("type").and_then(|x| x.as_str()) == Some("double");
    enigo.button(button, Direction::Click).map_err(|e| format!("النقر فشل: {e}"))?;
    if dbl {
        // نقرتان متتاليتان — نظام التشغيل يفسّرهما نقرًا مزدوجًا (ضمن عتبته الزمنية)
        std::thread::sleep(std::time::Duration::from_millis(40));
        enigo.button(button, Direction::Click).map_err(|e| format!("النقر المزدوج فشل: {e}"))?;
        return Ok("نقر مزدوج".into());
    }
    Ok(if matches!(button, Button::Right) { "نقر أيمن".into() } else { "نقر أيسر".into() })
}

fn apply_scroll(enigo: &mut Enigo, ev: &serde_json::Value) -> Result<String, String> {
    let dy = ev.get("dy").and_then(|x| x.as_f64()).unwrap_or(0.0);
    if !dy.is_finite() || dy.abs() < 0.5 {
        return Ok("تمرير صفري".into());
    }
    // موجب = تمرير لأسفل (اتجاه العجلة الطبيعي عند سحب إصبعين لأسفل)
    let notches = clamp_i(dy / SCROLL_PX_PER_NOTCH, MAX_SCROLL_NOTCHES as f64).max(-MAX_SCROLL_NOTCHES);
    if notches == 0 {
        return Ok("تمرير دون نقرة".into());
    }
    enigo.scroll(notches, Axis::Vertical).map_err(|e| format!("التمرير فشل: {e}"))?;
    Ok(format!("تمرير عمودي {notches} نقرة"))
}

fn apply_pinch(enigo: &mut Enigo, ev: &serde_json::Value) -> Result<String, String> {
    let scale = ev.get("scale").and_then(|x| x.as_f64()).unwrap_or(1.0);
    if !scale.is_finite() || (scale - 1.0).abs() < 0.05 {
        return Ok("قرص مهمل".into());
    }
    let notches = clamp_i((scale - 1.0).abs() * 3.0, 6.0).max(1);
    // التكبير/التصغير الشائع = Ctrl مع تمرير (متصفح/PowerPoint/محررات الصور)
    enigo.key(Key::Control, Direction::Press).map_err(|e| format!("Ctrl فشل: {e}"))?;
    let r = enigo
        .scroll(if scale > 1.0 { notches } else { -notches }, Axis::Vertical)
        .map_err(|e| format!("تمرير القرص فشل: {e}"));
    let r2 = enigo.key(Key::Control, Direction::Release).map_err(|e| format!("تحرير Ctrl فشل: {e}"));
    r?;
    r2?;
    Ok(if scale > 1.0 { "تكبير".into() } else { "تصغير".into() })
}

/// تحويل المفاتيح الخاصة المسماة من الهاتف إلى enigo Key
fn special_key(s: &str) -> Option<Key> {
    Some(match s {
        "enter" | "return" => Key::Return,
        "backspace" => Key::Backspace,
        "space" => Key::Space,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "esc" | "escape" => Key::Escape,
        "tab" => Key::Tab,
        "delete" | "del" => Key::Delete,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        // مفاتيح مسماة (مسار rc:key {key}) — العرض التقديمي والأنظمة
        "f5" => Key::F5,
        "f11" => Key::F11,
        _ => return None,
    })
}

/// ضغط/تحرير قائمة معدّلات (تُستخدم بالترتيب ثم تُحل بالعكس)
fn press_mods(enigo: &mut Enigo, mods: &[Key], dir: Direction) -> Result<(), String> {
    for m in mods {
        enigo.key(*m, dir).map_err(|e| format!("معدّل فشل: {e}"))?;
    }
    Ok(())
}

fn apply_key(enigo: &mut Enigo, ev: &serde_json::Value) -> Result<String, String> {
    // معدّلات اختيارية: ["ctrl","alt","shift","meta"] — مدعومة للتوسع المستقبلي
    let mods: Vec<Key> = ev
        .get("modifiers")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.as_str())
                .filter_map(|m| match m.to_lowercase().as_str() {
                    "ctrl" | "control" | "cmd" | "meta" | "win" | "super" => Some(Key::Control),
                    "alt" | "option" => Some(Key::Alt),
                    "shift" => Some(Key::Shift),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default();

    // الجولة 4 مرحلة ③ (عقد §21) — state اختياري للجيمباد: "press"/"release"
    // (ضغط مستمر حقيقي تنفذه الألعاب — النقر السريع قد يُفقد بين إطارات
    // الاستطلاع) — الغياب = click كما كان (توافق أمامي كامل مع §13).
    let hold = match ev.get("state").and_then(|x| x.as_str()) {
        Some("press") => Some(Direction::Press),
        Some("release") => Some(Direction::Release),
        _ => None,
    };

    let special = ev.get("special").and_then(|x| x.as_str()).map(|s| s.to_string());
    let named = ev.get("key").and_then(|x| x.as_str()).map(|s| s.to_string());
    let ch = ev.get("ch").and_then(|x| x.as_str()).map(|s| s.to_string());

    press_mods(enigo, &mods, Direction::Press)?;
    let special_target = special.clone().or_else(|| named.clone());
    let res: Result<String, String> = (|| {
        if let Some(s) = special_target {
            // المسمّى له الأولوية إن كان معروفًا وإلا يُجرّب كنص (حرف واحد)
            match special_key(&s) {
                Some(k) => {
                    let r = match hold {
                        Some(dir) => enigo.key(k, dir).map_err(|e| format!("المفتاح {s} فشل: {e}")),
                        None => enigo.key(k, Direction::Click).map_err(|e| format!("المفتاح {s} فشل: {e}")),
                    };
                    r?;
                    return Ok(format!("مفتاح: {s}"));
                }
                None if s.chars().count() == 1 => { /* حرف مفرد — يمر لمسار النص */ }
                None => return Err(format!("مفتاح غير مدعوم: {s}")),
            }
        }
        if let Some(text) = ch.or(special).or(named) {
            if text.is_empty() {
                return Ok("نص فارغ".into());
            }
            if text.contains('\0') {
                return Err("النص يحوي بايت صفري".into());
            }
            // ضغط/إفلات الجيمباد (§21): محرف واحد عبر Key::Unicode (ضغط حقيقي
            // قابل للاستمرار — النص اليونيكودي للحقن الكامل يبقى مسار click)
            if let (Some(dir), Some(c)) = (hold, text.chars().next()) {
                if text.chars().count() == 1 {
                    enigo
                        .key(Key::Unicode(c), dir)
                        .map_err(|e| format!("مفتاح الجيمباد فشل: {e}"))?;
                    return Ok(format!("مفتاح جيمباد: {c}"));
                }
            }
            // حقن يونيكودي كامل — عربي/إيموجي/أي حرف مستقلًا عن تخطيط الكيبورد
            enigo.text(&text).map_err(|e| format!("حقن النص فشل: {e}"))?;
            return Ok(format!("نص: {} حرف", text.chars().count()));
        }
        Err("حدث مفتاح بلا محتوى".into())
    })();
    // تحرير المعدّلات دائمًا حتى عند فشل المفتاح (لا تعليق Ctrl على المستخدم)
    // — أحداث الجيمباد (§21) بلا معدّلات أصلًا فالتحرير لا عملية فيه (no-op)
    press_mods(enigo, &mods, Direction::Release)?;
    res
}

fn apply_presenter(enigo: &mut Enigo, ev: &serde_json::Value) -> Result<String, String> {
    let action = ev.get("action").and_then(|x| x.as_str()).unwrap_or("");
    match action {
        "next" => {
            enigo.key(Key::PageDown, Direction::Click).map_err(|e| format!("PageDown فشل: {e}"))?;
            Ok("عرض: الشريحة التالية (PageDown)".into())
        }
        "prev" => {
            enigo.key(Key::PageUp, Direction::Click).map_err(|e| format!("PageUp فشل: {e}"))?;
            Ok("عرض: الشريحة السابقة (PageUp)".into())
        }
        "start" => {
            enigo.key(Key::F5, Direction::Click).map_err(|e| format!("F5 فشل: {e}"))?;
            Ok("عرض: بدء العرض (F5)".into())
        }
        "stop" => {
            enigo.key(Key::Escape, Direction::Click).map_err(|e| format!("Esc فشل: {e}"))?;
            Ok("عرض: إنهاء العرض (Esc)".into())
        }
        "black" => {
            // مفتاح b يبدّل الشاشة السوداء في PowerPoint (تشغيل/إلغاء بنفس المفتاح)
            enigo.key(Key::Unicode('b'), Direction::Click).map_err(|e| format!("b فشل: {e}"))?;
            Ok("عرض: شاشة سوداء/إلغاء (b)".into())
        }
        "laser-on" | "laser-off" | "laser-move" => {
            // لا مقابل نظامي للمؤشر الليزري — العرض الويبي فقط (موثق بصدق §13)
            Ok("ليزر: عرض ويبي فقط".into())
        }
        other => Err(format!("إجراء عرض غير معروف: {other}")),
    }
}

fn apply_media(enigo: &mut Enigo, ev: &serde_json::Value) -> Result<String, String> {
    let action = ev.get("action").and_then(|x| x.as_str()).unwrap_or("");
    match action {
        "toggle" | "play" | "pause" => {
            // مفتاح الوسائط النظامي — يصل لكل مشغل يستمع لمفاتيح الوسائط
            enigo.key(Key::MediaPlayPause, Direction::Click).map_err(|e| format!("Play/Pause فشل: {e}"))?;
            Ok("وسائط: تشغيل/إيقاف".into())
        }
        "next" => {
            enigo.key(Key::MediaNextTrack, Direction::Click).map_err(|e| format!("Next فشل: {e}"))?;
            Ok("وسائط: التالي".into())
        }
        "prev" => {
            enigo.key(Key::MediaPrevTrack, Direction::Click).map_err(|e| format!("Prev فشل: {e}"))?;
            Ok("وسائط: السابق".into())
        }
        "mute" | "unmute" => {
            enigo.key(Key::VolumeMute, Direction::Click).map_err(|e| format!("Mute فشل: {e}"))?;
            Ok("وسائط: كتم".into())
        }
        "volume" => {
            let v = ev.get("value").and_then(|x| x.as_f64()).unwrap_or(-1.0);
            if !(0.0..=100.0).contains(&v) {
                return Err("مستوى الصوت خارج 0..100".into());
            }
            volume_set(enigo, v)
        }
        other => Err(format!("إجراء وسائط غير معروف: {other}")),
    }
}

/// مفوّض ضبط الصوت لكل منصة (يضبطه input.rs عند الإقلاع: osascript/Core Audio)
pub type VolumeOverride = fn(&mut Enigo, f64) -> Result<(), String>;
static VOLUME_OVERRIDE: std::sync::OnceLock<VolumeOverride> = std::sync::OnceLock::new();

/// ضبط المفوّض (يستدعى مرة واحدة عند الإقلاع — OnceLock آمن خيطيًا)
pub fn set_volume_override(f: VolumeOverride) {
    let _ = VOLUME_OVERRIDE.set(f);
}

/// ضبط مستوى الصوت المطلق — لكل منصة طريقها الصحيح (موثق §13):
/// · override منصة (macOS osascript / Windows Core Audio) إن وُجد
/// · Linux: pactl (PulseAudio/PipeWire) ← amixer (ALSA) ← نقرات مفاتيح الصوت
pub fn volume_set(enigo: &mut Enigo, v: f64) -> Result<String, String> {
    if let Some(over) = VOLUME_OVERRIDE.get() {
        over(enigo, v).map_err(|e| format!("ضبط الصوت فشل: {e}"))?;
        return Ok(format!("وسائط: مستوى الصوت {}", v.round()));
    }
    #[cfg(target_os = "linux")]
    {
        let pct = format!("{:.0}%", v.round());
        // PulseAudio/PipeWire (الافتراضي في كل توزيعات المكتب الحديثة)
        if std::process::Command::new("pactl")
            .args(["set-sink-volume", "@DEFAULT_SINK@", &pct])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return Ok(format!("وسائط: مستوى الصوت {}", pct));
        }
        // ALSA احتياطًا
        if std::process::Command::new("amixer")
            .args(["-q", "set", "Master", &pct])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
        {
            return Ok(format!("وسائط: مستوى الصوت {}", pct));
        }
        // احتياط أخير: نقرات مفاتيح الصوت (تقريبي — كل نقرة ~2%)
        tap_volume(enigo, v)?;
        return Ok(format!("وسائط: مستوى الصوت {} (نقرات تقريبية)", v.round()));
    }
    #[cfg(not(target_os = "linux"))]
    {
        // enigo: مفتاحا الصوت نسبيان — بلا قراءة المستوى الحالي لا ضبط مطلق صادق.
        // macOS (osascript) وWindows (IAudioEndpointVolume) يوفّرهما input.rs
        // عبر set_volume_override؛ وصولنا هنا يعني غيابه — نرفض بصدق بدل التخريب.
        let _ = enigo;
        Err("ضبط الصوت المطلق غير متاح على هذه المنصة بدون override".into())
    }
}

/// نقرات مفاتيح الصوت التقريبية (احتياط لينكس فقط)
#[cfg(target_os = "linux")]
fn tap_volume(enigo: &mut Enigo, v: f64) -> Result<(), String> {
    // بلا قراءة الحالة الحالية: نضغط بالنسبة للافتراض 50% كمرجع عملي موثق
    let steps = ((v - 50.0) / 2.0).round() as i32;
    let key = if steps >= 0 { Key::VolumeUp } else { Key::VolumeDown };
    for _ in 0..steps.abs().min(50) {
        enigo.key(key, Direction::Click).map_err(|e| format!("مفتاح صوت فشل: {e}"))?;
    }
    Ok(())
}

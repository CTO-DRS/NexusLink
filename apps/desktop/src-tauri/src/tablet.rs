// NexusLink — الجولة 4 مرحلة ② (عقد §20) — وضع اللوحة الافتراضية
// ============================================================================
// «حوّل الهاتف+القلم إلى لوحة رسم احترافية»: وجهة التحكم بالأوضاع والإعدادات
// ومحرك اللوحة الافتراضية لكل منصة.
//
// وضعان تعاقديان:
//  · mouse (الافتراضي — «وضع الماوس المطلق»): القلم يحرك مؤشر النظام بموضع
//    مطلق عبر المسار القائم (live_core → apply_pointer) — يعمل مع أي برنامج
//    رسم، والضغط يضبط السماكة عبر محرك الفرشاة في input_exec (مفاتيح/عجلة).
//  · tablet («وضع اللوحة الافتراضية»): جهاز HID رقمي حقيقي يرى التطبيق فيه
//    الضغط والميل كأدوات أصيلة:
//    · Linux: /dev/uinput — أساس النواة الرسمي بلا أي سائق خارجي (إثبات:
//      توثيق النواة Documentation/input/uinput.rst) — تنفيذ كامل أدناه.
//    · Windows/macOS: **غير متاح — قيد موثق بصدق (§20.أ)**: التحقق من المصدر
//      (2026-10): vigem-client 0.1.4 (crates.io حرفيًا) = «ViGEm client API»
//      محاكاة يد ألعاب حصرًا (Xbox/DS4) بلا ديجيتايزر/قلم؛ vmulti
//      (djpnewton/vmulti — «Virtual Multiple HID Driver») آخر دفع 2016 —
//      سائق KMDF مهجور يتطلب توقيعًا اختباريًا ⇒ بلا أساس موثوق مفتوح
//      المصدر — الوضع مرفوض هنا بصدق والماوس المطلق هو بديل الإنتاج.
//
// المسار الحي: live.rs absorb → consume_pen (هنا) — بُوابة الجلسة §13 فُحصت
// في المستدعي ويفحصها الحقن حتمًا؛ والفشل لا يُسقط القناة أبدًا (إحصاء صادق).
use serde_json::{json, Value};

/// وضع التشغيل — mouse (ماوس مطلق + فرشاة) أو tablet (لوحة افتراضية حيث تُتاح)
pub const MODE_MOUSE: u8 = 0;
pub const MODE_TABLET: u8 = 1;

static MODE: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(MODE_MOUSE);

// إحصاء صادق (أمر tablet_config — التشخيص)
static SAMPLES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static CONSUMED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static ERRORS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn mode() -> u8 {
    MODE.load(std::sync::atomic::Ordering::Relaxed)
}

/// توفر المحرك الأصلي على هذه المنصة (بصدق — لا وعود وهمية)
#[cfg(target_os = "linux")]
pub fn engine_available() -> bool {
    // /dev/uinput وجود + كتابة — الأساس النووي الموثق (بلا سائق خارجي)
    crate::tablet_uinput::writable()
}

#[cfg(not(target_os = "linux"))]
pub fn engine_available() -> bool {
    false // §20.أ — قيد ويندوز/ماك موثق بتحقق المصدر أعلاه
}

pub fn set_mode(m: u8) {
    MODE.store(m, std::sync::atomic::Ordering::Relaxed);
    #[cfg(target_os = "linux")]
    if m != MODE_TABLET {
        // الخروج من الوضع يفكك الجهاز — بلا جهاز افتراضي معلق على المستخدم
        crate::tablet_uinput::destroy();
    }
    #[cfg(not(target_os = "linux"))]
    if m == MODE_TABLET {
        // طلب وضع غير متاح يُصحّح فورًا إلى الماوس المطلق (الواجهة تعرض القيد)
        MODE.store(MODE_MOUSE, std::sync::atomic::Ordering::Relaxed);
    }
}

/// استهلاك عينة قلم في وضع اللوحة الافتراضية — true ⇒ لا تمرر لمسار الماوس.
/// بوابة الجلسة §13 فحصها المستدعي (live.rs) قبل هنا والحقن يعيدها حتمًا.
/// غياب المحرك (صلاحيات /dev/uinput) ⇒ تدهور رشيق: العينة تمر لمسار الماوس
/// المطلق (لا إسقاط خطوط الرسم) — والحالة تعرض القيد صادقًا (state_json).
pub fn consume_pen(nx: f64, ny: f64, pressure: f64, tilt_x: i8, tilt_y: i8, phase: u8, buttons: u8, tool: u8) -> bool {
    SAMPLES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    if mode() != MODE_TABLET {
        return false;
    }
    #[cfg(target_os = "linux")]
    {
        // بوابة الجلسة هنا أيضًا (حاجز ثانٍ دفاعي — نفس نمط الحقن §13)
        // + بوابة التوفر: بلا /dev/uinput لا لوحة — العينة للماوس المطلق
        if !crate::input::is_active() || !engine_available() {
            return false;
        }
        match crate::tablet_uinput::inject(nx, ny, pressure, tilt_x, tilt_y, phase, buttons, tool) {
            Ok(()) => {
                CONSUMED.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                true
            }
            Err(e) => {
                ERRORS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let n = ERRORS.load(std::sync::atomic::Ordering::Relaxed);
                if n % 100 == 1 {
                    println!("[tablet] فشل حقن اللوحة الافتراضية: {e}");
                }
                true // فشل محرك مكسور بعد بدء الضربة لا يعيد العينة (تفادي مؤشر مزدوج)
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (nx, ny, pressure, tilt_x, tilt_y, phase, buttons, tool);
        false // §20.أ — القيد: يمر لمسار الماوس المطلق
    }
}

/// نهاية جلسة تحكم — رفع القلم/الأداة من جهاز اللوحة (بلا تعليق على المستخدم)
pub fn session_ended() {
    #[cfg(target_os = "linux")]
    crate::tablet_uinput::release_all();
}

// ---------------------------------------------------------------------------
// أوامر Tauri — التحكم من الهاتف عبر rc:tablet:cmd (عقد §20.ج)
// ---------------------------------------------------------------------------

/// تنقية إعداد الفرشاة (تعاقد §20.ج — نفس القيم عند الجسر) — pub لمحرك التحقق
pub fn brush_from_json(d: &Value) -> Option<crate::input_exec::BrushCfg> {
    let mode = match d.get("pressure").and_then(|x| x.as_str())? {
        "off" => crate::input_exec::BRUSH_OFF,
        "keys" => crate::input_exec::BRUSH_KEYS,
        "scroll" => crate::input_exec::BRUSH_SCROLL,
        _ => return None,
    };
    let mut cfg = crate::input_exec::BrushCfg { mode, ..Default::default() };
    if let Some(k) = d.get("decKey").and_then(|x| x.as_str()) {
        let mut it = k.chars();
        let c = it.next()?;
        if it.next().is_some() || !(c as u32 >= 33 && c as u32 <= 126) {
            return None;
        }
        cfg.dec_ch = c;
    }
    if let Some(k) = d.get("incKey").and_then(|x| x.as_str()) {
        let mut it = k.chars();
        let c = it.next()?;
        if it.next().is_some() || !(c as u32 >= 33 && c as u32 <= 126) {
            return None;
        }
        cfg.inc_ch = c;
    }
    if let Some(l) = d.get("levels") {
        let l = l.as_u64()?;
        if !(2..=64).contains(&l) {
            return None;
        }
        cfg.levels = l as u32;
    }
    if let Some(m) = d.get("modifier").and_then(|x| x.as_str()) {
        cfg.modifier = match m {
            "none" => crate::input_exec::MOD_NONE,
            "ctrl" => crate::input_exec::MOD_CTRL,
            "alt" => crate::input_exec::MOD_ALT,
            "shift" => crate::input_exec::MOD_SHIFT,
            _ => return None,
        };
    }
    Some(cfg)
}

/// حالة اللوحة (تُبث للهاتف بعد كل set وتعاد مع get — مصدر الحقيقة)
pub fn state_json() -> Value {
    let cfg = crate::input_exec::brush_cfg();
    let pressure = match cfg.mode {
        crate::input_exec::BRUSH_KEYS => "keys",
        crate::input_exec::BRUSH_SCROLL => "scroll",
        _ => "off",
    };
    let modifier = match cfg.modifier {
        crate::input_exec::MOD_CTRL => "ctrl",
        crate::input_exec::MOD_ALT => "alt",
        crate::input_exec::MOD_SHIFT => "shift",
        _ => "none",
    };
    let (available, note): (bool, &str) = if engine_available() {
        (true, "")
    } else if cfg!(target_os = "linux") {
        (false, "غير متاح: /dev/uinput غير قابل للكتابة (أضف المستخدم لمجموعة input أو ثبّت حزمة uinput)")
    } else {
        (false, "غير متاح على هذه المنصة — قيد موثق عقد §20.أ (بلا أساس HID موثوق مفتوح المصدر)؛ الماوس المطلق هو بديل الإنتاج")
    };
    json!({
        "mode": if mode() == MODE_TABLET { "tablet" } else { "mouse" },
        "available": available,
        "note": note,
        "brush": {
            "pressure": pressure,
            "decKey": cfg.dec_ch.to_string(),
            "incKey": cfg.inc_ch.to_string(),
            "levels": cfg.levels,
            "modifier": modifier,
        },
        "stats": {
            "samples": SAMPLES.load(std::sync::atomic::Ordering::Relaxed),
            "consumed": CONSUMED.load(std::sync::atomic::Ordering::Relaxed),
            "errors": ERRORS.load(std::sync::atomic::Ordering::Relaxed),
        },
        "at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
    })
}

#[tauri::command]
pub fn tablet_config() -> Value {
    state_json()
}

/// ضبط الوضع/الفرشاة — التنقية الأولى عند الجسر (§20.ج) وهنا ثقة التعاقد
/// نفسه (نفس نمط secondscreen:cmd)؛ الفاسد يُرفض بصدق ويُرجع الوضع الحالي.
#[tauri::command]
pub fn tablet_config_set(
    mode: Option<String>,
    pressure: Option<String>,
    decKey: Option<String>,
    incKey: Option<String>,
    levels: Option<u32>,
    modifier: Option<String>,
) -> Value {
    if let Some(m) = &mode {
        match m.as_str() {
            "mouse" => set_mode(MODE_MOUSE),
            "tablet" => set_mode(MODE_TABLET),
            _ => return state_json().tap_reject("وضع غير معروف"),
        }
    }
    if pressure.is_some() || decKey.is_some() || incKey.is_some() || levels.is_some() || modifier.is_some() {
        // بناء كائن مرشّح من الحقول المرسلة حصرًا (الحافظ على الباقي)
        let mut probe = json!({});
        let cur = crate::input_exec::brush_cfg();
        probe["pressure"] = json!(match cur.mode {
            crate::input_exec::BRUSH_KEYS => "keys",
            crate::input_exec::BRUSH_SCROLL => "scroll",
            _ => "off",
        });
        probe["decKey"] = json!(cur.dec_ch.to_string());
        probe["incKey"] = json!(cur.inc_ch.to_string());
        probe["levels"] = json!(cur.levels);
        probe["modifier"] = json!(match cur.modifier {
            crate::input_exec::MOD_CTRL => "ctrl",
            crate::input_exec::MOD_ALT => "alt",
            crate::input_exec::MOD_SHIFT => "shift",
            _ => "none",
        });
        if let Some(p) = &pressure { probe["pressure"] = json!(p); }
        if let Some(k) = &decKey { probe["decKey"] = json!(k); }
        if let Some(k) = &incKey { probe["incKey"] = json!(k); }
        if let Some(l) = levels { probe["levels"] = json!(l); }
        if let Some(m) = &modifier { probe["modifier"] = json!(m); }
        match brush_from_json(&probe) {
            Some(cfg) => crate::input_exec::set_brush_cfg(cfg),
            None => return state_json().tap_reject("إعداد فرشاة خارج التعاقد (§20.ج)"),
        }
    }
    state_json()
}

trait TapReject {
    fn tap_reject(self, note: &str) -> Value;
}
impl TapReject for Value {
    fn tap_reject(mut self, note: &str) -> Value {
        self["error"] = json!(note);
        self
    }
}

// NexusLink — الجولة 4 مرحلة ② (عقد §20) — محرك اللوحة الافتراضية (Linux)
// ============================================================================
// جهاز HID رقمي (ديجيتايزر) حقيقي عبر /dev/uinput — **أساس النواة الرسمي**
// (Documentation/input/uinput.rst): بلا أي سائق خارجي ولا توقيع — توزيعات
// المكتب تلتقطه تلقائيًا عبر libinput (X11: XInput بضغط كامل — Krita/MyPaint
// تقرأه؛ Wayland: أصيلًا).
//
// البروتوكول الداخلي (تعاقد §20.ب):
//   X/Y      0..32767  (nx·ny 0..1 → مطلق على الشاشة — INPUT_PROP_DIRECT)
//   PRESSURE 0..2047   (0..1 — عند التلامس حصرًا، صفر في hover)
//   TILT_X/Y −127..127 (i8 ±60° من الهاتف → تحجيم 127/60)
//   BTN_TOOL_PEN/RUBBER — القلم/الممحاة · BTN_TOUCH — التلامس ·
//   BTN_STYLUS — الزر الخلفي (buttons bit0)
//
// الطور: hover = الأداة في المدى بلا تلامس · down/move = تلامس + ضغط ·
// up = خارج المدى (الأداة صفر) — دلالة أقلام Wacom الفعلية.
//
// **التعيين نقية** (map_sample/build_setup): تُضمَّن حرفيًا في محرك التحقق
// scripts/tablet-verify — والحقن الفعلي (ioctls/كتابة) طبقة رفيعة فوقها.
// بنية uinput_user_setup حرفية من linux/uinput.h (name80+id8+ff4+4×abs64).
use libc::ioctl;
use std::io::Write;
use std::os::unix::io::AsRawFd;
use std::sync::{Mutex, OnceLock};

// ioctls — linux/uinput.h حرفيًا (_IOW('U', n, int) = 0x40045500|n)
pub const UI_SET_EVBIT: libc::c_ulong = 0x40045564; // _IOW('U', 100, int)
pub const UI_SET_KEYBIT: libc::c_ulong = 0x40045565; // _IOW('U', 101, int)
pub const UI_SET_ABSBIT: libc::c_ulong = 0x40045566; // _IOW('U', 102, int)
pub const UI_SET_PROPBIT: libc::c_ulong = 0x4004556e; // _IOW('U', 110, int)
pub const UI_DEV_CREATE: libc::c_ulong = 0x5501; // _IO('U', 101)
pub const UI_DEV_DESTROY: libc::c_ulong = 0x5502; // _IO('U', 102)

// أنواع/رموز أحداث evdev — linux/input-event-codes.h
pub const EV_SYN: u16 = 0x00;
pub const EV_KEY: u16 = 0x01;
pub const EV_ABS: u16 = 0x03;
pub const ABS_X: u16 = 0x00;
pub const ABS_Y: u16 = 0x01;
pub const ABS_PRESSURE: u16 = 0x18;
pub const ABS_TILT_X: u16 = 0x1a;
pub const ABS_TILT_Y: u16 = 0x1b;
pub const BTN_TOOL_PEN: u16 = 0x140;
pub const BTN_TOOL_RUBBER: u16 = 0x141;
pub const BTN_TOUCH: u16 = 0x14a;
pub const BTN_STYLUS: u16 = 0x14b;
pub const INPUT_PROP_DIRECT: libc::c_int = 0x01;
pub const BUS_VIRTUAL: u16 = 0x06;

pub const ABS_COUNT: usize = 64; // ABS_MAX + 1 (0x3f + 1)
pub const RANGE_XY: i32 = 32767;
pub const RANGE_PRESSURE: i32 = 2047;
pub const RANGE_TILT: i32 = 127; // i8 ±60° من الهاتف → ±127 (127/60)
pub const DEV_NAME: &str = "NexusLink Virtual Tablet";

/// حالة الأداة داخل الجهاز (تراكمية بين العينات — انتقالات حصرًا)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PenState {
    /// 0=خارج المدى، 1=قلم، 2=ممحاة، 3=لمس إصبع
    pub tool: u8,
    pub contact: bool,
    pub stylus: bool,
}

/// تحجيم محور مطلق من 0..1 إلى 0..hi (نقي)
pub fn clamp_axis(v: f64, hi: i32) -> i32 {
    if !v.is_finite() {
        return 0;
    }
    (v * hi as f64).round().clamp(0.0, hi as f64) as i32
}

/// تخطيط عينة قلم واحدة إلى دفعة أحداث evdev (نقية — قلب المحرك).
/// تحدّث state (انتقالات الأداة/التلامس/الزر) وتعيد (type, code, value).
/// طور التعاقد: 0=hover 1=down 2=move 3=up — contact = down/move.
/// أداة التعاقد: 0=قلم 1=ممحاة 2=إصبع (§20).
pub fn map_sample(nx: f64, ny: f64, pressure: f64, tilt_x: i8, tilt_y: i8, phase: u8, buttons: u8, tool: u8, state: &mut PenState) -> Vec<(u16, u16, i32)> {
    let mut ev: Vec<(u16, u16, i32)> = Vec::with_capacity(10);
    let contact = phase == 1 || phase == 2;
    let near = contact || phase == 0; // hover: في المدى بلا تلامس
    // الموضع دائمًا (مطلق — DIRECT)
    ev.push((EV_ABS, ABS_X, clamp_axis(nx, RANGE_XY)));
    ev.push((EV_ABS, ABS_Y, clamp_axis(ny, RANGE_XY)));
    // الضغط: تلامس حصرًا (صفر في hover — دلالة أقلام فعلية)
    let p = if contact { clamp_axis(pressure.clamp(0.0, 1.0), RANGE_PRESSURE) } else { 0 };
    ev.push((EV_ABS, ABS_PRESSURE, p));
    // الميل: i8 ±60° → ±127
    let tx = (tilt_x as i32).clamp(-60, 60) * RANGE_TILT / 60;
    let ty = (tilt_y as i32).clamp(-60, 60) * RANGE_TILT / 60;
    ev.push((EV_ABS, ABS_TILT_X, tx));
    ev.push((EV_ABS, ABS_TILT_Y, ty));
    // الأداة — انتقالات حصرًا (خروج القديمة قبل دخول الجديدة — دلالة Wacom)
    let want: u8 = if !near {
        0
    } else {
        match tool {
            1 => 2, // ممحاة
            2 => 3, // إصبع (لمس عام — مع رفض راحة اليد نادر الوصول)
            _ => 1, // قلم
        }
    };
    if state.tool != want {
        match state.tool {
            1 => ev.push((EV_KEY, BTN_TOOL_PEN, 0)),
            2 => ev.push((EV_KEY, BTN_TOOL_RUBBER, 0)),
            _ => {}
        }
        match want {
            1 => ev.push((EV_KEY, BTN_TOOL_PEN, 1)),
            2 => ev.push((EV_KEY, BTN_TOOL_RUBBER, 1)),
            _ => {}
        }
        state.tool = want;
    }
    // التلامس + الزر الخلفي — حواف حصرًا
    if state.contact != contact {
        ev.push((EV_KEY, BTN_TOUCH, if contact { 1 } else { 0 }));
        state.contact = contact;
    }
    let s = buttons & 0x01 != 0;
    if state.stylus != s {
        ev.push((EV_KEY, BTN_STYLUS, if s { 1 } else { 0 }));
        state.stylus = s;
    }
    // SYN_REPORT واحد يغلق الدفعة
    ev.push((EV_SYN, 0, 0));
    ev
}

/// بناء uinput_user_setup كاملة (نقية — تخطيط linux/uinput.h حرفيًا):
/// name[80] + input_id (bustype/vendor/product/version u16ne) + ff_effects_max
/// + absmax/absmin/absfuzz/absflat لكل ABS_MAX+1 محور (i32 native endian)
pub fn build_setup(name: &str) -> Vec<u8> {
    let mut setup = vec![0u8; 80 + 8 + 4 + ABS_COUNT * 4 * 4];
    let nb = name.as_bytes();
    let n = nb.len().min(79); // النواة يشترط بايت صفري ختامي
    setup[..n].copy_from_slice(&nb[..n]);
    let id_at = 80;
    setup[id_at..id_at + 2].copy_from_slice(&BUS_VIRTUAL.to_ne_bytes()); // bustype
    setup[id_at + 2..id_at + 4].copy_from_slice(&0x4E4C_u16.to_ne_bytes()); // vendor "NL"
    setup[id_at + 4..id_at + 6].copy_from_slice(&0x0002_u16.to_ne_bytes()); // product: pen
    setup[id_at + 6..id_at + 8].copy_from_slice(&1_u16.to_ne_bytes()); // version
    // ff_effects_max = 0 (أصفار) — absfuzz/absflat = 0
    let absmax = 80 + 8 + 4;
    let absmin = absmax + ABS_COUNT * 4;
    let put = |setup: &mut [u8], axis: u16, min: i32, max: i32| {
        let i = axis as usize * 4;
        setup[absmax + i..absmax + i + 4].copy_from_slice(&max.to_ne_bytes());
        setup[absmin + i..absmin + i + 4].copy_from_slice(&min.to_ne_bytes());
    };
    put(&mut setup, ABS_X, 0, RANGE_XY);
    put(&mut setup, ABS_Y, 0, RANGE_XY);
    put(&mut setup, ABS_PRESSURE, 0, RANGE_PRESSURE);
    put(&mut setup, ABS_TILT_X, -RANGE_TILT, RANGE_TILT);
    put(&mut setup, ABS_TILT_Y, -RANGE_TILT, RANGE_TILT);
    setup
}

/// كتابة /dev/uinput ممكنة؟ (فحص توفر المحرك — tablet.rs)
pub fn writable() -> bool {
    std::fs::OpenOptions::new().write(true).open("/dev/uinput").is_ok()
}

struct PenDev {
    file: std::fs::File,
    state: PenState,
}

impl PenDev {
    fn open() -> Result<Self, String> {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .open("/dev/uinput")
            .map_err(|e| format!("فتح /dev/uinput فشل: {e} (مجموعة input؟)"))?;
        // 1) أنواع الأحداث
        for t in [EV_SYN, EV_KEY, EV_ABS] {
            set_bits(&f, UI_SET_EVBIT, t as libc::c_int)?;
        }
        // 2) المفاتيح (أدوات القلم)
        for c in [BTN_TOOL_PEN, BTN_TOOL_RUBBER, BTN_TOUCH, BTN_STYLUS] {
            set_bits(&f, UI_SET_KEYBIT, c as libc::c_int)?;
        }
        // 3) المحاور المطلقة
        for a in [ABS_X, ABS_Y, ABS_PRESSURE, ABS_TILT_X, ABS_TILT_Y] {
            set_bits(&f, UI_SET_ABSBIT, a as libc::c_int)?;
        }
        // 4) DIRECT — جهاز مطلق معيّن على مساحة الشاشة (نمط أقلام الرسم)
        set_bits(&f, UI_SET_PROPBIT, INPUT_PROP_DIRECT)?;
        // 5) الإعداد النقي ثم إنشاء الجهاز
        f.write_all(&build_setup(DEV_NAME)).map_err(|e| format!("كتابة إعداد uinput فشلت: {e}"))?;
        unsafe {
            if ioctl(f.as_raw_fd(), UI_DEV_CREATE) < 0 {
                return Err("UI_DEV_CREATE فشل".into());
            }
        }
        println!("[tablet] جهاز اللوحة الافتراضية جاهز: {DEV_NAME}");
        Ok(PenDev { file: f, state: PenState::default() })
    }

    fn emit_all(&mut self, ev: &[(u16, u16, i32)]) -> Result<(), String> {
        for (t, c, v) in ev {
            // input_event: timeval 16B (أصفار — النواة يوصل الطابع) + type/code/value
            let mut one = [0u8; 24];
            one[16..18].copy_from_slice(&t.to_ne_bytes());
            one[18..20].copy_from_slice(&c.to_ne_bytes());
            one[20..24].copy_from_slice(&v.to_ne_bytes());
            self.file.write_all(&one).map_err(|e| format!("كتابة حدث evdev فشلت: {e}"))?;
        }
        Ok(())
    }
}

fn set_bits(f: &std::fs::File, req: libc::c_ulong, bit: libc::c_int) -> Result<(), String> {
    unsafe {
        if ioctl(f.as_raw_fd(), req, bit) < 0 {
            return Err(format!("ioctl uinput (0x{req:x}, bit {bit}) فشل"));
        }
    }
    Ok(())
}

fn engine() -> &'static Mutex<Option<PenDev>> {
    static E: OnceLock<Mutex<Option<PenDev>>> = OnceLock::new();
    E.get_or_init(|| Mutex::new(None))
}

/// قتل الجهاز عند عطب المقبس — يعاد بناؤه كسنًا عند أول عينة تالية
fn drop_broken(g: &mut Option<PenDev>) {
    if let Some(d) = g.take() {
        unsafe {
            let _ = ioctl(d.file.as_raw_fd(), UI_DEV_DESTROY);
        }
        println!("[tablet] جهاز اللوحة أُسقط بعد عطب — سيعاد بناؤه تلقائيًا");
    }
}

/// حقن عينة قلم واحدة (تعاقد §20.ب) — عينة = دفعة أحداث + SYN_REPORT واحد
pub fn inject(nx: f64, ny: f64, pressure: f64, tilt_x: i8, tilt_y: i8, phase: u8, buttons: u8, tool: u8) -> Result<(), String> {
    let mut g = engine().lock().map_err(|_| "قفل محرك اللوحة".to_string())?;
    if g.is_none() {
        *g = Some(PenDev::open()?);
    }
    let ev = {
        let dev = g.as_mut().unwrap();
        map_sample(nx, ny, pressure, tilt_x, tilt_y, phase, buttons, tool, &mut dev.state)
    };
    let r = g.as_mut().unwrap().emit_all(&ev);
    if r.is_err() {
        drop_broken(&mut g);
    }
    r
}

/// نهاية الجلسة — رفع القلم/التلامس/الزر (بلا تعليق على المستخدم)
pub fn release_all() {
    if let Ok(mut g) = engine().lock() {
        if let Some(d) = g.as_mut() {
            let st = d.state;
            let mut ev: Vec<(u16, u16, i32)> = Vec::with_capacity(4);
            if st.stylus {
                ev.push((EV_KEY, BTN_STYLUS, 0));
            }
            if st.contact {
                ev.push((EV_KEY, BTN_TOUCH, 0));
            }
            match st.tool {
                1 => ev.push((EV_KEY, BTN_TOOL_PEN, 0)),
                2 => ev.push((EV_KEY, BTN_TOOL_RUBBER, 0)),
                _ => {}
            }
            if !ev.is_empty() {
                ev.push((EV_SYN, 0, 0));
            }
            let r = d.emit_all(&ev);
            if r.is_ok() {
                d.state = PenState::default();
            } else {
                drop_broken(&mut g);
            }
        }
    }
}

/// تفكيك الجهاز (الخروج من وضع اللوحة)
pub fn destroy() {
    if let Ok(mut g) = engine().lock() {
        drop_broken(&mut g);
    }
}

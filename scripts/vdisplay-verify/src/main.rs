// NexusLink — محرك تحقق الشاشة الثانية (R4 مرحلة ① — عقد §19)
// ============================================================================
// يُضمِّن حرفيًا vdisplay_core.rs (النواة النقية: التحقق من الأوضاع، بناء/
// ترقيع vdd_settings.xml، محلل xrandr وباني الأوامر) — مصدر واحد للمنطق مع
// التطبيق (نمط live-verify المعتمد)، ثم يجري:
//   1) تحقق الأوضاع (حدود + تعاقد)  2) XML: بناء/ترقيع محافظ/رفض غريب/فحص
//   3) حزمة السائق المرفقة فعليًا (apps/desktop/src-tauri/vdd) توافق النواة
//   4) xrandr: محلل --query على ثابتين واقعيين + اختيار المخرج + بناء الأوامر
//   5) cvt: تحليل Modeline  6) أسماء الأوضاع حتمية (بناء/تفكيك متطابقان)
// طبقة المنصات (vdisplay.rs — CCD/xrandr الحية) تُترجم فيزيائيًا على المنصات
// الثلاث عبر CI desktop.yml (الحاوية بلا GTK/سائقين — موثق بصدق).
use std::sync::atomic::{AtomicUsize, Ordering};

mod core {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/src/vdisplay_core.rs"));
}

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

const MODES: [(u32, u32); 2] = [(1080, 2400), (2400, 1080)];

fn main() {
    println!("NexusLink vdisplay-verify — الشاشة الثانية (عقد §19)");

    // ---- 1) تحقق الأوضاع ----
    section("1) تحقق الأوضاع");
    check("عمودي هاتفي 1080×2400 مقبول", core::validate_mode(1080, 2400).is_ok(), "يجب أن يمر");
    check("أفقي هاتفي 2400×1080 مقبول", core::validate_mode(2400, 1080).is_ok(), "يجب أن يمر");
    check("صفر مرفوض", core::validate_mode(0, 0).is_err(), "حدود 320..8192");
    check("صغير جدًا مرفوض", core::validate_mode(100, 100).is_err(), "أصغر من 320");
    check("كبير جدًا مرفوض", core::validate_mode(9000, 500).is_err(), "أكبر من 8192");
    check("اسم وضع xrandر حتمي", core::xrandr_mode_name(1080, 2400) == "nx1080x2400_60", core::xrandr_mode_name(1080, 2400));

    // ---- 2) بناء XML من الصفر ----
    section("2) بناء vdd_settings.xml");
    let xml = core::build_settings_xml(&MODES);
    check("البناء يحوي <vdd_settings>", xml.contains("<vdd_settings>") && xml.contains("</vdd_settings>"), "الجذر");
    check("count = 1 (شاشة واحدة)", core::read_monitor_count(&xml) == Some(1), "عدد الشاشات");
    check("الوضعان التعاقديان حاضران", core::modes_present(&xml, &MODES), "بعد البناء مباشرة");
    check("كل وضع بحقل refresh 60", xml.matches("<refresh_rate>60</refresh_rate>").count() >= 2, "تردد واحد موحد");

    // ---- 3) الترقيع المحافظ (XML طرف آخر) ----
    section("3) ترقيع XML قائم (بلا إتلاف إعدادات الطرف الآخر)");
    let foreign = "<vdd_settings>\n <monitors>\n <count>2</count>\n </monitors>\n <gpu><friendlyname>RTX-4090</friendlyname></gpu>\n <resolutions>\n        <resolution>\n            <width>800</width>\n            <height>600</height>\n            <refresh_rate>30</refresh_rate>\n        </resolution>\n        <resolution>\n            <width>2560</width>\n            <height>1440</height>\n            <refresh_rate>120</refresh_rate>\n        </resolution>\n </resolutions>\n <logging><logging>false</logging></logging>\n</vdd_settings>\n";
    let patched = core::patch_settings_xml(foreign, &MODES);
    check("الترقيع ينجح على XML غريب", patched.is_some(), "بنية مفهومة");
    let p = patched.unwrap_or_default();
    check("اسم GPU للطرف الآخر باقٍ", p.contains("<friendlyname>RTX-4090</friendlyname>"), "بلا مساس");
    check("وضع 800×600 للطرف الآخر باقٍ", p.contains("<width>800</width>"), "لا نمسح أوضاعه");
    check("وضع 2560×1440 باقٍ", p.contains("<width>2560</width>"), "لا نمسح أوضاعه");
    check("وضعانا أُضيفا", core::modes_present(&p, &MODES), "إضافة لا استبدال");
    check("عدد قائم ≥1 لا يُمس (2 يبقى 2)", core::read_monitor_count(&p) == Some(2), "سياسة العدّ");
    check("وسوم logging باقية", p.contains("<logging>false</logging>"), "كل الوسوم الخارجية");
    check("جذر غريب يُرفض (None)", core::patch_settings_xml("<other/>", &MODES).is_none(), "لا استنتاج صامت");
    // إعادة الترقيع لا تكرر الأوضاع (idempotent)
    let p2 = core::patch_settings_xml(&p, &MODES).unwrap_or_default();
    check("الترقيع idempotent (بلا تكرار)", p2.matches("<width>1080</width>").count() == 1, "مرة واحدة");

    // ---- 4) حزمة السائق المرفقة فعليًا ----
    section("4) حزمة apps/desktop/src-tauri/vdd توافق النواة");
    let bundled = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/vdd/vdd_settings.xml"));
    match bundled {
        Ok(t) => {
            check("الملف المرفوع: count = 1", core::read_monitor_count(&t) == Some(1), "سياسة §19");
            check("الملف المرفوع: الوضعان التعاقديان", core::modes_present(&t, &MODES), "1080×2400 + 2400×1080");
            check("الملف المرفوع: 60Hz حصرًا", t.contains("<g_refresh_rate>60</g_refresh_rate>"), "تردد التعاقد");
            // الترقيع على الملف الحقيقي idempotent (لا تغيير)
            let re = core::patch_settings_xml(&t, &MODES);
            check("ترقيع الملف الحقيقي = نفسه (مكتمل)", re.as_deref() == Some(t.as_str()), "لا فرق بعد الترقيع");
        }
        Err(e) => check("قراءة حزمة السائق", false, format!("{e}")),
    }
    for f in ["MttVDD.inf", "MttVDD.dll", "mttvdd.cat", "nefconc.exe", "LICENSE-VirtualDisplayDriver", "LICENSE-nefcon"] {
        let p = format!("{}/../../apps/desktop/src-tauri/vdd/{}", env!("CARGO_MANIFEST_DIR"), f);
        let ok = std::path::Path::new(&p).exists();
        check(&format!("أصل مطلوب موجود: {f}"), ok, "حزمة §19 كاملة");
    }
    let inf_raw = std::fs::read(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/vdd/MttVDD.inf")).unwrap_or_default();
    // بعض حزم السائق تُشفر INF بـ UTF-16LE (BOM 0xFF 0xFE) — نفك بذكاء
    let inf = if inf_raw.starts_with(&[0xFF, 0xFE]) {
        let u16s: Vec<u16> = inf_raw[2..].chunks(2).map(|c| u16::from_le_bytes([c[0], *c.get(1).unwrap_or(&0)])).collect();
        String::from_utf16_lossy(&u16s).to_lowercase()
    } else {
        String::from_utf8_lossy(&inf_raw).to_lowercase()
    };
    check("INF يحمل HWID التعاقدي Root\\MttVDD", inf.contains("root\\mttvdd"), "HWID السائق");
    check("INF صنف Display", inf.contains("display"), "Class = Display");

    // ---- 5) محلل xrandr --query ----
    section("5) محلل xrandr");
    let q1 = "Screen 0: minimum 8 x 8, current 1920 x 1080, maximum 32767 x 32767\n\
              eDP-1 connected primary 1920x1080+0+0 (normal left inverted right) 344mm x 194mm\n\
                1920x1080     60.00*+  59.94    40.00\n\
              HDMI-A-1 disconnected (normal left inverted right)\n\
              DP-1 connected 2560x1440+1920+0 (normal left inverted right)\n\
                2560x1440    144.00*+\n\
              VIRTUAL1 disconnected (normal left inverted right)\n";
    let outs = core::parse_xrandr_query(q1, "nx1080x2400_60");
    check("أربعة مخرجات مقروءة", outs.len() == 4, format!("{}", outs.len()));
    check("eDP-1 أساسية متصلة", outs.first().map(|o| o.name == "eDP-1" && o.primary && o.connected) == Some(true), "سطر أول");
    check("DP-1 ثانية متصلة بلا أساسية", outs.iter().find(|o| o.name == "DP-1").map(|o| o.connected && !o.primary) == Some(true), "متعدد الشاشات");
    let pick = core::pick_disconnected_output(&outs);
    check("أول مخرج غير متصل بلا وضعنا = HDMI-A-1", pick.map(|o| o.name == "HDMI-A-1") == Some(true), "اختيار حتمي");
    // مخرج يحمل وضعنا لا يُختار أولًا
    let q2 = "Screen 0: minimum 8 x 8, current 1920 x 1080\n\
              eDP-1 connected primary 1920x1080+0+0\n\
              VIRTUAL1 disconnected\n\
                nx1080x2400_60  60.00\n";
    let outs2 = core::parse_xrandr_query(q2, "nx1080x2400_60");
    check("VIRTUAL1 يحمل وضعنا (has_our_mode)", outs2.iter().find(|o| o.name == "VIRTUAL1").map(|o| o.has_our_mode) == Some(true), "وضعنا مقروء من سطر الأوضاع");
    check("لا مخرجًا ثانيًا غير حامل وضعنا → يُختار VIRTUAL1 (احتياط)", core::pick_disconnected_output(&outs2).map(|o| o.name == "VIRTUAL1") == Some(true), "fallback مقبول");

    // ---- 6) بناء أوامر الإعداد/التفكيك ----
    section("6) بناء أوامر xrandr");
    let cmds = core::build_xrandr_setup("nx1080x2400_60", "288.00  1080 1208 1328 1576  2400 2403 2413 2560 -hsync +vsync", "HDMI-A-1", "eDP-1");
    check("ثلاث خطوات: newmode → addmode → attach", cmds.len() == 3, "الترتيب التعاقدي");
    check("newmode يبدأ بالاسم ثم وسائط modeline", cmds[0][0] == "--newmode" && cmds[0][1] == "nx1080x2400_60" && cmds[0].len() >= 10, "وسائط cvt كاملة");
    check("addmode على المخرج المختار", cmds[1] == vec!["--addmode", "HDMI-A-1", "nx1080x2400_60"], "addmode");
    check("إلحاق يمين الأساسية", cmds[2].contains(&"--right-of".to_string()) && cmds[2].contains(&"eDP-1".to_string()), "موضع يمين");
    let nopri = core::build_xrandr_setup("m", "1 2", "X", "");
    check("بلا أساسية → --auto", nopri[2].contains(&"--auto".to_string()), "احتياط");
    let down = core::build_xrandr_teardown("nx1080x2400_60", "HDMI-A-1");
    check("تفكيك: off ثم rmmode", down == vec![vec!["--output", "HDMI-A-1", "--off"], vec!["--rmmode", "nx1080x2400_60"]], "ترتيب الإزالة");

    // ---- 7) تحليل cvt Modeline ----
    section("7) تحليل cvt");
    let cvt_out = "# 1080x2400 59.97 Hz (CVT) hsync: 148.99 kHz; pclk: 286.50\nModeline \"1080x2400_60.00\"  286.50  1080 1208 1328 1576  2400 2403 2413 2560 -hsync +vsync\n";
    let ml = core::parse_cvt_modeline(cvt_out);
    check("Modeline محلولة", ml.is_some(), "سطر واحد صالح");
    let (n, rest) = ml.unwrap();
    check("الاسم بين علامتي تنصيص", n == "1080x2400_60.00", n);
    check("بقية الوسائط تبدأ بالتردد وتنتهي +vsync", rest.starts_with("286.50") && rest.ends_with("+vsync"), rest);
    check("مدخل فاسد → None", core::parse_cvt_modeline("no modeline here").is_none(), "رفض صامت");

    // ---- 8) تطابق بناء/تفكيك اسم الوضع ----
    section("8) حتمية أسماء الأوضاع");
    for (w, h) in MODES {
        let name = core::xrandr_mode_name(w, h);
        check(&format!("اسم {w}×{h} يطابق النمط"), name.contains(&format!("{w}x{h}")) && name.ends_with("_60"), name);
    }

    let p = PASS.load(Ordering::SeqCst);
    let f = FAIL.load(Ordering::SeqCst);
    println!("\n────────────────────────────");
    println!("النتيجة: {p} ناجح · {f} فاشل");
    if f > 0 {
        std::process::exit(1);
    }
}

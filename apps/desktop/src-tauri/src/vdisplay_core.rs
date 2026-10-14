// NexusLink Desktop — الشاشة الثانية: النواة النقية (R4 مرحلة ①)
// ============================================================================
// كل المنطق القابل للاختبار بلا منصة: التحقق من الأوضاع، بناء/ترقيع
// vdd_settings.xml، محلل مخرجات xrandr وباني أوامره. يُضمَّن حرفيًا في
// محرك التحقق scripts/vdisplay-verify — مصدر واحد للمنطق (نمط live_core).
//
// السائق (ويندوز): VirtualDrivers/Virtual-Display-Driver — MIT — توقيع SignPath
//   HWID = Root\MttVDD · إعداداته الثابتة: C:\VirtualDisplayDriver\vdd_settings.xml
//   (مسار مثبّت في مصدر السائق: confpath — تحقق حرفي Driver.cpp:94)
//   الأوضاع تُوفَّر عند التثبيت (installer-hooks.nsh) — لا إعادة تشغيل جهاز وقت
//   التشغيل (لا صلاحيات مدير): التبديل ChangeDisplaySettingsEx (مستخدم-level).
//
// لينكس: xrandr (cvt → newmode → addmode → attach) — بلا صلاحيات، جلسة X11.
// ماك: لا شاشات افتراضية بدون سائق موقّع (قيد موثق) — البديل: بث نافذة محددة.

/// الأوضاع المعتمدة التعاقدية (التنصيب يكتبها في XML — إحداها عمودي وأخرى أفقي)
pub const PRESET_MODES: [(&str, u32, u32); 4] = [
    ("portrait-phone", 1080, 2400),  // عمودي — أبعاد الهاتف
    ("landscape-phone", 2400, 1080), // أفقي — أبعاد الهاتف
    ("hd", 1920, 1080),              // احتياط شائع
    ("portrait-hd", 1080, 1920),     // عمودي شائع
];

/// تحقق من وضع مطلوب (w,h) — يعيد الوضع المضبوط أو خطأ عربيًا
pub fn validate_mode(w: u32, h: u32) -> Result<(u32, u32), String> {
    if w < 320 || h < 320 || w > 8192 || h > 8192 {
        return Err(format!("أبعاد خارج الحدود المسموحة 320..8192: {w}×{h}"));
    }
    // الأوضاع المضبوطة تمر مباشرة؛ غيرها مسموح ضمن الحدود (السائق يقرر إن كان
    // الوضع متاحًا — الخطأ يظهر صادقًا عند التطبيق إن غاب من XML)
    Ok((w, h))
}

/// اسم وضع xrandr لمتطلباتنا — ثابت كي نعرف ما نحذفه لاحقًا
pub fn xrandr_mode_name(w: u32, h: u32) -> String {
    format!("nx{w}x{h}_60")
}

// ---------------------------------------------------------------------------
// vdd_settings.xml — البناء الكامل والترقيع المحافظ (نحفظ وسوم الطرف الآخر)
// ---------------------------------------------------------------------------

/// بناء ملف إعدادات كامل (يُستخدم عند غياب الملف) — الوضعان التعاقديان @60Hz
pub fn build_settings_xml(modes: &[(u32, u32)]) -> String {
    let mut res = String::new();
    for (w, h) in modes {
        res.push_str(&format!(
            "        <resolution>\n            <width>{w}</width>\n            <height>{h}</height>\n            <refresh_rate>60</refresh_rate>\n        </resolution>\n"
        ));
    }
    format!(
        "<vdd_settings>\n\
         \x20   <!-- NexusLink preset (الشاشة الثانية — R4) · السائق: VirtualDrivers VDD (MIT) -->\n\
         \x20   <monitors>\n        <count>1</count>\n    </monitors>\n\
         \x20   <gpu>\n        <friendlyname>default</friendlyname>\n    </gpu>\n\
         \x20   <global>\n        <g_refresh_rate>60</g_refresh_rate>\n    </global>\n\
         \x20   <resolutions>\n{res}    </resolutions>\n\
         </vdd_settings>\n"
    )
}

/// استخراج قيمة وسم بسيط `<tag>val</tag>` من نص
fn tag_value(src: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let s = src.find(&open)? + open.len();
    let e = src[s..].find(&close)? + s;
    Some(src[s..e].trim().to_string())
}

/// قراءة عدد الشاشات المضبوط في XML الحالي (للتشخيص)
pub fn read_monitor_count(xml: &str) -> Option<u32> {
    let block_start = xml.find("<monitors>")?;
    let block_end = xml[block_start..].find("</monitors>")? + block_start;
    tag_value(&xml[block_start..block_end], "count")
    .and_then(|v| v.parse().ok())
}

/// ترقيع XML الحالي محافظًا: يضمن count=1 + وجود أوضاعنا في <resolutions>
/// بلا مسس لبقية الوسوم (الطرف الآخر قد يملك إعداداته). يعيد النص الجديد أو
/// خطأ عند بنية غير مفهومة (نكتب ملفًا كاملًا حينها — قرار المستدعي).
pub fn patch_settings_xml(existing: &str, modes: &[(u32, u32)]) -> Option<String> {
    if !existing.contains("<vdd_settings>") || !existing.contains("</vdd_settings>") {
        return None;
    }
    let mut out = existing.to_string();

    // 1) كتلة monitors — count = 1 (شاشة افتراضية واحدة تكفي الاستخدام)
    let count = read_monitor_count(&out);
    match count {
        Some(n) if n >= 1 => { /* عدد قائم يكفي — لا مساس */ }
        _ => {
            let new_block = "<monitors>\n        <count>1</count>\n    </monitors>";
            out = match (out.find("<monitors>"), out.find("</monitors>")) {
                (Some(s), Some(e)) => format!("{}{}{}", &out[..s], new_block, &out[e + "</monitors>".len()..]),
                _ => return None,
            };
        }
    }

    // 2) أوضاعنا داخل <resolutions> — نضيف ما ينقص فقط (لا نمسح أوضاع الطرف الآخر)
    let res_start = out.find("<resolutions>")? + "<resolutions>".len();
    let res_end = out[res_start..].find("</resolutions>")? + res_start;
    let res_block = &out[res_start..res_end];
    let mut missing = String::new();
    for (w, h) in modes {
        let wtag = format!("<width>{w}</width>");
        let htag = format!("<height>{h}</height>");
        // وضع موجود إن تلاقى width وheight داخل أي resolution واحدة
        let mut found = false;
        for chunk in res_block.split("<resolution>") {
            if chunk.contains(&wtag) && chunk.contains(&htag) {
                found = true;
            }
        }
        if !found {
            missing.push_str(&format!(
                "        <resolution>\n            <width>{w}</width>\n            <height>{h}</height>\n            <refresh_rate>60</refresh_rate>\n        </resolution>\n"
            ));
        }
    }
    if !missing.is_empty() {
        out.insert_str(res_end, &missing);
    }
    Some(out)
}

/// فحص: هل الوضعان التعاقديان موجودان في XML؟ (للتشخيص الصادق)
pub fn modes_present(xml: &str, modes: &[(u32, u32)]) -> bool {
    let res_start = match xml.find("<resolutions>") {
        Some(s) => s + "<resolutions>".len(),
        None => return false,
    };
    let res_end = match xml[res_start..].find("</resolutions>") {
        Some(e) => e + res_start,
        None => return false,
    };
    let block = &xml[res_start..res_end];
    modes.iter().all(|(w, h)| {
        block
            .split("<resolution>")
            .any(|c| c.contains(&format!("<width>{w}</width>")) && c.contains(&format!("<height>{h}</height>")))
    })
}

// ---------------------------------------------------------------------------
// xrandr (لينكس) — محلل مخرجات --query + بناء الأوامر
// ---------------------------------------------------------------------------

/// مخرج شاشة من xrandr --query
#[derive(Debug, Clone, PartialEq)]
pub struct XOutput {
    pub name: String,
    pub connected: bool,
    pub primary: bool,
    /// هل يحمل وضعنا (nxWxH) ضمن أوضاعه؟
    pub has_our_mode: bool,
}

/// محلل سطر سطر لمخرج xrandr --query — يعيد المخرجات فقط (الأوضاع العامة لا تلزم)
pub fn parse_xrandr_query(text: &str, our_mode: &str) -> Vec<XOutput> {
    let mut outs = Vec::new();
    for line in text.lines() {
        // سطر مخرج: "HDMI-1 connected primary 1920x1080+0+0 ..." أو "eDP-1 disconnected ..."
        let is_out_line = (line.contains(" connected") || line.contains(" disconnected"))
            && !line.starts_with('\t')
            && !line.starts_with(' ');
        if !is_out_line || line.starts_with('\t') || line.starts_with(' ') {
            continue;
        }
        let mut it = line.split_whitespace();
        let name = match it.next() {
            Some(n) => n.to_string(),
            None => continue,
        };
        let connected = line.contains(" connected");
        let primary = line.contains("primary");
        outs.push(XOutput { name, connected, primary, has_our_mode: false });
    }
    // أوضاع كل مخرج تلي سطره بإزاحة — نطابق اسم وضعنا (الوسم الأول للسطر —
    // سطر الوضع الحقيقي يحمل التردد بعده: "  nx1080x2400_60  60.00*+")
    let mut cur: Option<usize> = None;
    for line in text.lines() {
        if let Some(i) = current_output_line(line, &outs) {
            cur = Some(i);
            continue;
        }
        if let (Some(i), Some(o)) = (cur, outs.get_mut(cur.unwrap_or(usize::MAX))) {
            let t = line.trim_start();
            if t.split_whitespace().next() == Some(our_mode) {
                o.has_our_mode = true;
            }
            let _ = i;
        }
    }
    outs
}

/// هل هذا السطر سطر مخرج؟ (يعيد فهرسه إن كذا) — أسطر المخرجات تبدأ من عمود 0
/// وأسطر الأوضاع مزاحة بإزاحة (الحارس على السطر الخام لا المقصوص)
fn current_output_line(line: &str, outs: &[XOutput]) -> Option<usize> {
    if line.starts_with(' ') || line.starts_with('\t') {
        return None;
    }
    let name = line.split_whitespace().next()?;
    outs.iter()
        .position(|o| o.name == name && (line.contains(" connected") || line.contains(" disconnected")))
}

/// اختيار مخرج غير متصل لتثبيت الوضع عليه — أول disconnected بلا وضعنا،
/// ثم أي disconnected آخر (السطر الأنظف أولوية).
pub fn pick_disconnected_output(outs: &[XOutput]) -> Option<&XOutput> {
    outs.iter()
        .find(|o| !o.connected && !o.has_our_mode)
        .or_else(|| outs.iter().find(|o| !o.connected))
}

/// تحليل سطر Modeline الناتج من cvt — يعيد (اسم الوضع، بقية الوسائط نصًا)
/// مثال: `Modeline "1920x1080_60.00"  148.50  1920 2008 2052 2200  1080 1084 1089 1125 +hsync +vsync`
pub fn parse_cvt_modeline(text: &str) -> Option<(String, String)> {
    for line in text.lines() {
        let t = line.trim();
        if !t.starts_with("Modeline") {
            continue;
        }
        let q1 = t.find('"')? + 1;
        let q2 = t[q1..].find('"')? + q1;
        let name = t[q1..q2].to_string();
        let rest = t[q2 + 1..].trim().to_string();
        if name.is_empty() || rest.is_empty() {
            return None;
        }
        return Some((name, rest));
    }
    None
}

/// سلسلة أوامر xrandr لتثبيت الوضع على مخرج غير متصل (بترتيب حتمي)
/// `primary` = اسم المخرج الأساسي للإلحاق بجانبه (يمينه).
pub fn build_xrandr_setup(
    mode_name: &str,
    modeline_args: &str,
    output: &str,
    primary: &str,
) -> Vec<Vec<String>> {
    vec![
        {
            let mut c = vec!["--newmode".to_string(), mode_name.to_string()];
            c.extend(modeline_args.split_whitespace().map(|s| s.to_string()));
            c
        },
        vec!["--addmode".into(), output.into(), mode_name.into()],
        {
            if primary.is_empty() {
                vec!["--output".into(), output.into(), "--mode".into(), mode_name.into(), "--auto".into()]
            } else {
                vec![
                    "--output".into(),
                    output.into(),
                    "--mode".into(),
                    mode_name.into(),
                    "--right-of".into(),
                    primary.into(),
                ]
            }
        },
    ]
}

/// أمر إطفاء المخرج وحذف وضعنا (ترتيب الإزالة: off ثم rmmode)
pub fn build_xrandr_teardown(mode_name: &str, output: &str) -> Vec<Vec<String>> {
    vec![
        vec!["--output".into(), output.into(), "--off".into()],
        vec!["--rmmode".into(), mode_name.into()],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_roundtrip() {
        let xml = build_settings_xml(&[(1080, 2400), (2400, 1080)]);
        assert_eq!(read_monitor_count(&xml), Some(1));
        assert!(modes_present(&xml, &[(1080, 2400), (2400, 1080)]));
    }

    #[test]
    fn patch_preserves_other_tags() {
        let base = "<vdd_settings>\n <monitors>\n <count>2</count>\n </monitors>\n <gpu><friendlyname>RTX</friendlyname></gpu>\n <resolutions>\n        <resolution>\n            <width>800</width>\n            <height>600</height>\n            <refresh_rate>60</refresh_rate>\n        </resolution>\n </resolutions>\n <logging><logging>false</logging></logging>\n</vdd_settings>\n";
        let patched = patch_settings_xml(base, &[(1080, 2400)]).unwrap();
        assert!(patched.contains("<friendlyname>RTX</friendlyname>"), "وسم الطرف الآخر يبقى");
        assert!(patched.contains("<width>800</width>"), "وضع الطرف الآخر يبقى");
        assert!(patched.contains("<width>1080</width>"), "وضعنا أُضيف");
        assert!(patched.contains("<count>2</count>"), "عدد قائم ≥1 لا يُمس");
        assert!(patched.contains("<logging>false</logging>"));
    }

    #[test]
    fn patch_rejects_foreign_root() {
        assert!(patch_settings_xml("<other/>", &[(1, 1)]).is_none());
    }

    #[test]
    fn cvt_parse() {
        let (n, rest) = parse_cvt_modeline(
            "# 1920x1080 59.96 Hz (CVT) hsync: 67.16 kHz; pclk: 173.00\nModeline \"1920x1080_60.00\"  173.00  1920 2048 2248 2576  1080 1083 1088 1120 -hsync +vsync\n",
        )
        .unwrap();
        assert_eq!(n, "1920x1080_60.00");
        assert!(rest.starts_with("173.00"));
        assert!(rest.ends_with("+vsync"));
    }

    #[test]
    fn xrandr_parse_and_pick() {
        let q = "Screen 0: minimum 8 x 8, current 1920 x 1080, maximum 32767 x 32767\n\
                 eDP-1 connected primary 1920x1080+0+0 (normal left inverted right) 344mm x 194mm\n\
                   1920x1080     60.00*+  59.94\n\
                 HDMI-A-1 disconnected (normal left inverted right)\n\
                 VIRTUAL1 disconnected (normal left inverted right)\n";
        let outs = parse_xrandr_query(q, "nx1080x2400_60");
        assert_eq!(outs.len(), 3);
        assert_eq!(outs[0].name, "eDP-1");
        assert!(outs[0].primary && outs[0].connected);
        let pick = pick_disconnected_output(&outs).unwrap();
        assert_eq!(pick.name, "HDMI-A-1");
        let cmds = build_xrandr_setup("nx1080x2400_60", "288.00  1080 1208 1328 1576  2400 2403 2413 2560 -hsync +vsync", pick.name.as_str(), "eDP-1");
        assert_eq!(cmds[0][0], "--newmode");
        assert_eq!(cmds[1], vec!["--addmode", "HDMI-A-1", "nx1080x2400_60"]);
        assert_eq!(cmds[2].last().unwrap(), "eDP-1");
        let down = build_xrandr_teardown("nx1080x2400_60", "HDMI-A-1");
        assert_eq!(down[0], vec!["--output", "HDMI-A-1", "--off"]);
    }

    #[test]
    fn mode_validation_bounds() {
        assert!(validate_mode(1080, 2400).is_ok());
        assert!(validate_mode(1, 1).is_err());
        assert!(validate_mode(99999, 10).is_err());
    }
}

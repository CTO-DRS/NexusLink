// NexusLink Desktop — نواة طبقة الوسائط النقية (FA-media — عقد §15)
// ============================================================================
// بلا Tauri/webrtc/tokio: دوال التحويل والتنقية وحالات الإشارات فقط — يُضمَّن
// هذا الملف حرفيًا في media.rs (التطبيق) وفي محرك التحقق scripts/media-verify
// (مصدر واحد للمنطق — نفس نمط input_exec.rs/files_menu_core.rs).
//
// التعاقد (§15):
//   · عرض شاشة الكمبيوتر → الهاتف: rtc:offer kind="screen" من الكمبيوتر (هذا
//     الطرف) استجابة لـ screen:req من الهاتف على جسر 3005؛ الهاتف يجيب
//     rtc:answer {kind:"screen"} ويتبادلان rtc:ice (trickle من الهاتف —
//     إجاباتنا غير ترشيحية: كل مرشحات host مضمّنة في SDP نفسها).
//   · كاميرا الهاتف → ويب كام حقيقية: الهاتف ينشئ rtc:offer kind="cam"
//     (فيديو H264 + صوت Opus — getUserMedia audio:true في خدمة الوسائط)
//     عند cam:cmd cam-start، ونحن نجيب — «أول إجابة من دور pc تُقبل لكل
//     kind وتُتجاهل ما بعدها» (عقد §4.3 حرفيًا).
//   · ميكروفون الهاتف → إدخال صوتي افتراضي: نفس المسار بـ kind="mic".
//
// مسارات الحقن (لكل منصة طريقها — موثق بصدق):
//   · ويب كام فيديو:  لينكس v4l2loopback (YUYV خام + S_FMT ioctl) ·
//     ويندوز/ماك akvirtualcamera (AkVCamManager stream YUY2 من stdin —
//     بروتوكوله متحقق من مصدره: DEVICE FORMAT WIDTH HEIGHT).
//   · صوت افتراضي:    لينكس pactl module-pipe-source (FIFO s16le) ·
//     ويندوز VB-CABLE (cpal إخراج إلى CABLE Input) · ماك BlackHole (cpal).
//     غياب الدرايفور لا يعطّل التطبيق: status.driver يشرح ويوجه للتثبيت.

use serde_json::{json, Value};


// ---------------------------------------------------------------------------
// الجودة — مستويات مضبوطة (fps 15..60 كما تعاقدنا + مقياس دقة + bitrate)
// ---------------------------------------------------------------------------

/// مستوى جودة البث — كل مستوى: مقياس الدقة وbitrate افتراضي.
/// fps يُضبط مستقلًا (قائمة بيضاء مستقلة) — ultra يسمح حتى 60fps.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct QualityPreset {
    pub name: &'static str,
    /// مقياس أبعاد الالتقاط (1.0 = الدقة الأصلية)
    pub scale: f64,
    /// bitrate هادف للمشفر (OpenH264 rate control)
    pub bitrate_bps: u32,
    /// افتراضي fps عند عدم التحديد
    pub fps: u32,
}

pub const QUALITY_PRESETS: [QualityPreset; 4] = [
    QualityPreset { name: "low", scale: 0.4, bitrate_bps: 800_000, fps: 24 },
    QualityPreset { name: "medium", scale: 0.6, bitrate_bps: 1_500_000, fps: 30 },
    QualityPreset { name: "high", scale: 0.8, bitrate_bps: 3_000_000, fps: 30 },
    QualityPreset { name: "ultra", scale: 1.0, bitrate_bps: 6_000_000, fps: 30 },
];

pub fn quality_preset(name: &str) -> QualityPreset {
    QUALITY_PRESETS
        .iter()
        .copied()
        .find(|p| p.name == name)
        .unwrap_or(QUALITY_PRESETS[2]) // high افتراضي
}

/// قائمة بيضاء لمعدلات الإطارات (المطلوب التعاقدي: 30–60 قابل للضبط، مع
/// مستويات أدنى للأجهزة الضعيفة). يعيد القيمة الصالحة أو الافتراضي 30.
pub fn sanitize_fps(fps: f64) -> u32 {
    const ALLOWED: [u32; 5] = [15, 24, 30, 45, 60];
    let r = fps.round() as u32;
    ALLOWED.into_iter().find(|a| *a == r).unwrap_or(30)
}

/// أبعاد مضغوطة لقيمة المقياس — أبعاد زوجية دائمًا (متطلب YUV420/YUYV)
pub fn scaled_dims(w: u32, h: u32, scale: f64) -> (u32, u32) {
    let scale = if scale.is_finite() && scale > 0.05 && scale <= 1.0 { scale } else { 1.0 };
    let w2 = ((w as f64 * scale).round() as u32).max(2) & !1;
    let h2 = ((h as f64 * scale).round() as u32).max(2) & !1;
    (w2.max(2), h2.max(2))
}

// ---------------------------------------------------------------------------
// تحويلات الألوان (نقية — تُختبر بالبكسل)
// ---------------------------------------------------------------------------

/// حجم إطار YUYV (4:2:2 معبأ — 4 بايت لكل بكسلين)
pub fn yuyv_frame_size(w: u32, h: u32) -> usize {
    (w as usize) * (h as usize) * 2
}

/// تحويل BGRA (كما يأتي من الالتقاط) إلى YUYV مباشرًا — نفس معادلة
/// BT.601 المحدودة المستخدمة في YUV420→YUYV (قناة واحدة للجودة).
pub fn bgra_to_yuyv(bgra: &[u8], w: u32, h: u32) -> Vec<u8> {
    let w = w as usize;
    let h = h as usize;
    let mut out = vec![0u8; yuyv_frame_size(w as u32, h as u32)];
    for row in 0..h {
        for pair in 0..(w / 2) {
            let x0 = pair * 2;
            let x1 = x0 + 1;
            let p0 = (row * w + x0) * 4;
            let p1 = (row * w + x1) * 4;
            let (b0, g0, r0) = (bgra[p0] as i32, bgra[p0 + 1] as i32, bgra[p0 + 2] as i32);
            let (b1, g1, r1) = (bgra[p1] as i32, bgra[p1 + 1] as i32, bgra[p1 + 2] as i32);
            let y0 = ((66 * r0 + 129 * g0 + 25 * b0 + 128) >> 8) + 16;
            let y1 = ((66 * r1 + 129 * g1 + 25 * b1 + 128) >> 8) + 16;
            let u = ((-38 * r0 - 74 * g0 + 112 * b0 + 256) >> 8) / 2 + 128;
            let v = ((112 * r0 - 94 * g0 - 18 * b0 + 256) >> 8) / 2 + 128;
            let o = (row * w + x0) * 2;
            out[o] = y0.clamp(0, 255) as u8;
            out[o + 1] = u.clamp(0, 255) as u8;
            out[o + 2] = y1.clamp(0, 255) as u8;
            out[o + 3] = v.clamp(0, 255) as u8;
        }
        // عمود فردي (عرض فردي) — يُكرر البكسل الأخير (YUYV يتطلب عرضًا زوجيًا؛
        // w نصفه مطروح فوق يترك الأخير صفرًا — نملؤه بنسخ الزوج الأخير)
        if w % 2 == 1 && w >= 3 {
            // عمود فردي: يُكرر الزوج الأخير — split_at_mut يجعل الاقتراض سليمًا
            let o = (row * w + w - 2) * 2;
            let last = (row * w + w - 1) * 2;
            let (head, tail) = out.split_at_mut(last);
            tail[0..4].copy_from_slice(&head[o..o + 4]);
        }
    }
    out
}

/// تحويل YUV420 (مستويات مفصولة كما يعيدها OpenH264) إلى YUYV.
/// الكروما 4:2:0 تُرفع لـ 4:2:2 بتكرار صفوف الكروما (متطلب الأجهزة).
pub fn yuv420_to_yuyv(
    y: &[u8],
    u: &[u8],
    v: &[u8],
    w: u32,
    h: u32,
    y_stride: usize,
    uv_stride: usize,
) -> Vec<u8> {
    let w = w as usize;
    let h = h as usize;
    let mut out = vec![0u8; yuyv_frame_size(w as u32, h as u32)];
    for row in 0..h {
        let u_row = (row / 2) * uv_stride;
        for pair in 0..(w / 2) {
            let x0 = pair * 2;
            let x1 = x0 + 1;
            let y0 = y[row * y_stride + x0] as i32;
            let y1 = y[row * y_stride + x1] as i32;
            // الصيغة نفسها تُبنى من YUV مباشرًا: U/V كروما مشتركة للزوج
            let u_raw = u[u_row + pair] as i32; // 0..255 (مركز 128)
            let v_raw = v[u_row + pair] as i32;
            // نعيد تعبئة كما هي: YUYV يخزن Y ثم U ثم Y ثم V بقيمه المركزية
            let o = (row * w + x0) * 2;
            out[o] = y0.clamp(0, 255) as u8;
            out[o + 1] = u_raw.clamp(0, 255) as u8;
            out[o + 2] = y1.clamp(0, 255) as u8;
            out[o + 3] = v_raw.clamp(0, 255) as u8;
        }
        if w % 2 == 1 && w >= 3 {
            // عمود فردي: يُكرر الزوج الأخير — split_at_mut يجعل الاقتراض سليمًا
            let o = (row * w + w - 2) * 2;
            let last = (row * w + w - 1) * 2;
            let (head, tail) = out.split_at_mut(last);
            tail[0..4].copy_from_slice(&head[o..o + 4]);
        }
    }
    out
}

/// تصغير BGRA بأقرب جار (بلا crate image — تكلفة صفرية إضافية) — يُستخدم
/// لضبط الجودة قبل الترميز. يعيد مخزنًا جديدًا بأبعاد (w2, h2).
pub fn downscale_bgra(bgra: &[u8], w: u32, h: u32, w2: u32, h2: u32) -> Vec<u8> {
    let (w, h) = (w as usize, h as usize);
    let (w2, h2) = (w2 as usize, h2 as usize);
    if w2 == w && h2 == h {
        return bgra.to_vec();
    }
    let mut out = vec![0u8; w2 * h2 * 4];
    if w == 0 || h == 0 || w2 == 0 || h2 == 0 {
        return out;
    }
    for r2 in 0..h2 {
        let r = r2 * h / h2;
        for c2 in 0..w2 {
            let c = c2 * w / w2;
            let src = (r * w + c) * 4;
            let dst = (r2 * w2 + c2) * 4;
            out[dst..dst + 4].copy_from_slice(&bgra[src..src + 4]);
        }
    }
    out
}

// ---------------------------------------------------------------------------
// خريطة اللمس → مؤشر مطلق — عاشت في input_exec.rs (مصدر واحد للحقيقة —
// تُختبر عبر محرك التحقق الذي يضمّن الملفين معًا).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// بوابة الإجابات — «أول إجابة من دور pc تُقبل لكل kind وتُتجاهل ما بعدها»
// (عقد §4.3 حرفيًا) — آلة حالة نقية تُختبر حرفيًا.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KindPhase {
    /// لا جلسة — ننتظر عرضًا من الهاتف (cam/mic) أو طلبًا (screen)
    Idle,
    /// أنشأنا إجابة/عرضًا ونتظر الإكمال من الطرف الآخر
    Pending,
    /// الوسائط تجري فعليًا
    Live,
}

/// بوابة واحدة لكل kind: تمنع الإجابة الثانية المتجاهلة والطلبات المتضاربة.
#[derive(Debug)]
pub struct KindGate {
    pub kind: String,
    pub phase: KindPhase,
    /// دورنا في هذا kind: "answer" (الهاتف يعرض — كام/ميك) أو "offer" (شاشة)
    pub role: &'static str,
}

impl KindGate {
    pub fn new(kind: &str, role: &'static str) -> Self {
        Self { kind: kind.to_string(), phase: KindPhase::Idle, role }
    }

    /// هل نقبل معالجة عرضًا واردًا من الهاتف؟ (kind=cam/mic فقط)
    pub fn accept_remote_offer(&self) -> bool {
        self.role == "answer" && self.phase == KindPhase::Idle
    }

    /// قبول إجابتنا المحلية (سجّلناها) — للشاشة بعد إنشاء العرض
    pub fn mark_offered(&mut self) {
        if self.role == "offer" {
            self.phase = KindPhase::Pending;
        }
    }

    /// قبول إجابة الهاتف لعرضنا — أول إجابة فقط
    pub fn accept_remote_answer(&mut self) -> bool {
        if self.role == "offer" && self.phase == KindPhase::Pending {
            self.phase = KindPhase::Live;
            true
        } else {
            false
        }
    }

    /// وسائط تجري (بعد اتصال PeerConnection) — من أي طور غير Live
    pub fn mark_live(&mut self) {
        if self.phase != KindPhase::Live {
            self.phase = KindPhase::Live;
        }
    }

    pub fn reset(&mut self) {
        self.phase = KindPhase::Idle;
    }

    pub fn is_busy(&self) -> bool {
        self.phase != KindPhase::Idle
    }
}

// ---------------------------------------------------------------------------
// أكوام حقن الويب كام — أوامر ومسارات مكتشفة (نقية — تُختبر بالسلاسل)
// ---------------------------------------------------------------------------

/// بناء أرجف أمر AkVCamManager stream — البروتوكول متحقق من مصدر akvirtualcamera:
/// `stream [-f FPS] DEVICE FORMAT WIDTH HEIGHT` يقرأ إطارات خام من stdin
/// بحجم VideoFrame الكامل لكل قراءة (صيغة YUY2 = 4 بايت لكل بكسلين).
pub fn akvcam_stream_args(device: &str, w: u32, h: u32, fps: u32) -> Vec<String> {
    vec![
        "stream".into(),
        "-f".into(),
        fps.to_string(),
        device.to_string(),
        "YUY2".into(),
        w.to_string(),
        h.to_string(),
    ]
}

/// استخراج معرفات الأجهزة من خرج `AkVCamManager devices` (سطر لكل جهاز)
pub fn parse_akvcam_devices(output: &str) -> Vec<String> {
    output
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| {
            // قد يسبق الاسم فهرسة "0: <id>" — نأخذ الحقل الأخير الشبه-UUID/الاسم
            l.split_whitespace().last().unwrap_or(l).to_string()
        })
        .collect()
}

/// كشف أجهزة v4l2loopback من /sys/class/video4linux — يعيد (مسار الجهاز، الاسم).
/// وحدة v4l2loopback تظهر باسم درايفر "v4l2 loopback" في /sys/.../name.
pub fn parse_v4l2_entries(names: &[(String, String)]) -> Vec<(String, String)> {
    names
        .iter()
        .filter(|(_, name)| name.to_lowercase().contains("loopback") || name.to_lowercase().contains("nexuslink"))
        .cloned()
        .collect()
}

/// مطابقة جهاز إخراج الصوت الافتراضي من قائمة أسماء (cpal):
/// ويندوز VB-CABLE ("CABLE Input") · ماك BlackHole · لينكس (لا cpal — FIFO).
pub fn match_audio_output(devices: &[String]) -> Option<String> {
    for d in devices {
        let l = d.to_lowercase();
        if l.contains("cable input") || l.contains("nexuslink virtual") || l.contains("blackhole") {
            return Some(d.clone());
        }
    }
    None
}

/// مطابقة جهة الالتقاط المقابلة (تأكيد وجود الدرايفور):
/// VB-CABLE تظهر للتطبيقات كـ "CABLE Output" · BlackHole نفسه طرفي.
pub fn match_audio_capture(devices: &[String]) -> Option<String> {
    for d in devices {
        let l = d.to_lowercase();
        if l.contains("cable output") || l.contains("blackhole") || l.contains("nexuslink virtual") {
            return Some(d.clone());
        }
    }
    None
}

// ---------------------------------------------------------------------------
// المرحلة 0-وسائط (عقد §22) — توفير الكاميرا الافتراضية وكشفها
// كل الحقائق هنا متحقق منها من مصدر akvirtualcamera 9.3.1 الحرفي:
//   · installscript.nsi: يكتب HKLM\SOFTWARE\Webcamoid\VirtualCamera\installPath
//   · cmdparser.cpp: devices -p (معرف لكل سطر) · add-device DESCRIPTION ·
//     add-format DEVICE FORMAT WIDTH HEIGHT FPS · description DEVICE ·
//     -v (نسخة) · system-api · stream (المستخدم قائمًا)
//   · preferences.cpp: أجهزة الكاميرات في Cameras\N\description
// ---------------------------------------------------------------------------

/// اسم كاميرا NexusLink — الاسم نفسه في Zoom/Meet (الهدف التعاقدي §22)
pub const NEXUS_CAMERA_NAME: &str = "NexusLink Camera";

/// صيغ الكاميرا المعلنة (YUY2 — الأوسع دعمًا للويب كام؛ الأول افتراضي).
/// متحقق: `add-format DEVICE FORMAT WIDTH HEIGHT FPS` — YUY2 ضمن الصيغ
/// المدعومة للإخراج (supported-formats) وتطابق مسار stream القائم في media.rs.
pub const NEXUS_CAMERA_FORMATS: [(&str, u32, u32, u32); 3] = [
    ("YUY2", 1280, 720, 30),
    ("YUY2", 1920, 1080, 30),
    ("YUY2", 640, 480, 30),
];

/// فك خرج `reg query HKLM\SOFTWARE\Webcamoid\VirtualCamera /v installPath`
/// (ويندوز) — يرد مسار التثبيت. المصدر: installscript.nsi يكتب installPath.
pub fn parse_reg_install_path(output: &str) -> Option<String> {
    for line in output.lines() {
        let l = line.trim();
        // RegEdit سطر: "installPath    REG_SZ    C:\Program Files\AkVirtualCamera"
        if let Some(pos) = l.find("REG_SZ") {
            let key = l[..pos].trim();
            if key.eq_ignore_ascii_case("installpath") {
                let v = l[pos + 6..].trim();
                if !v.is_empty() {
                    return Some(v.to_string());
                }
            }
        }
    }
    None
}

/// مسارات AkVCamManager المعروفة (ويندوز + ماك) — أول موجود يفوز.
/// نضيف تخطيط المثبّت الرسمي الموثق: $INSTDIR\<arch>\AkVCamManager.exe
/// (installscript.nsi: StrCpy $managerPath "$INSTDIR\$arch\AkVCamManager.exe").
pub fn akvcam_manager_paths() -> Vec<&'static str> {
    vec![
        r"C:\Program Files\AkVirtualCamera\x64\AkVCamManager.exe",
        r"C:\Program Files\AkVCam\AkVCamManager.exe",
        r"C:\Program Files\akvirtualcamera\AkVCamManager.exe",
        r"C:\Program Files (x86)\AkVCam\AkVCamManager.exe",
        "/usr/local/bin/AkVCamManager",
        "/Applications/AkVCamManager.app/Contents/MacOS/AkVCamManager",
        "/usr/bin/AkVCamManager",
    ]
}

/// نسخة akvirtualcamera من خرج `AkVCamManager -v` — يطبع COMMONS_VERSION
/// (cmdparser.cpp: containsFlag "-v" → AkPrintOut(COMMONS_VERSION)).
pub fn parse_akvcam_version(output: &str) -> Option<String> {
    let l = output.trim().trim_start_matches('v');
    if l.is_empty() || l.len() > 24 || !l.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
        return None;
    }
    Some(l.to_string())
}

/// خطة توفير كاميرا NexusLink — أوامر argv مهيكلة (لا انقسام مسافات).
/// قرار Idempotent من المصدر: add-device لا يكرر الوصف تلقائيًا — لذا نفحص
/// الأوصاف القائمة؛ إن وُجد وصفنا نعيد None (لا شيء يُنفَّذ).
/// المدخل: (المعرفات من `devices -p`، الوصف لكل معرف من `description ID`).
/// ملاحظة مصدرية: addDevice يقرأ args[1] حصرًا — الوصف وسيط argv واحد
/// «NexusLink Camera» (بالمسافة داخل وسيط واحد) — لهذا الأوامر مهيكلة.
pub fn ensure_camera_plan(
    ids: &[String],
    descriptions: &[(String, String)],
) -> Option<Vec<Vec<String>>> {
    let ours = descriptions
        .iter()
        .any(|(_, d)| d.trim().eq_ignore_ascii_case(NEXUS_CAMERA_NAME));
    if ours {
        return None;
    }
    // جهاز قائم بلا وصفنا؟ نتركه للمستخدم ولا نمس شيئًا (لا load المدمر) —
    // ننشئ جهازنا الخاص بجانبه.
    let mut cmds = vec![vec!["add-device".into(), NEXUS_CAMERA_NAME.into()]];
    for (f, w, h, fps) in NEXUS_CAMERA_FORMATS {
        // المعرف يعاد من `add-device -p` وقت التنفيذ — @NEW@ يُستبدل به
        cmds.push(vec![
            "add-format".into(), "@NEW@".into(), f.into(),
            w.to_string(), h.to_string(), fps.to_string(),
        ]);
    }
    cmds.push(vec!["update".into()]);
    let _ = ids;
    Some(cmds)
}

/// ملاحظة OBS كبديل — وجود مجلدات OBS (obs64.exe) يكفي للكشف.
/// CLSID «OBS Virtual Camera» يُحقن وقت بناء OBS (virtualcam-guid.h.in
/// VIRTUALCAM_GUID من cmake) — لا يصلح علامة كشف ثابتة؛ نكتشف التثبيت
/// ونوجه للمسار اليدوي الرسمي (قائمة OBS → Start Virtual Camera).
pub fn obs_fallback_status(obs_installed: bool) -> Value {
    json!({
        "installed": obs_installed,
        "note": if obs_installed {
            "OBS مكتشف — بديل مدعوم: في OBS أضف Media Source إلى واجهة NexusLink ثم قائمة أدوات ← Start Virtual Camera (تظهر OBS Virtual Camera في Zoom/Meet)"
        } else {
            ""
        },
    })
}

/// محتوى ملف m3u مؤقت لمشغل سطح المكتب الافتراضي (عقد §22 — مشغل النظام).
/// m3u ملف نصي معياري؛ مشغلات سطح المكتب (VLC/WMP/mpv) تتعامل معه كتيار
/// HTTP — هذا هو «الstream المؤقت» بلا نسخ أي بايت.
pub fn nexuslink_cast_m3u(name: &str, url: &str) -> String {
    // تعقيم الاسم: أسطر m3u لا تقبل سطرًا جديدًا
    let safe_name = name.replace(['\r', '\n'], " ");
    format!("#EXTM3U\n#EXTINF:-1,{safe_name}\n{url}\n")
}

/// اسم ملف m3u المؤقت الثابت (يُعاد كتابته في كل بث — «مؤقت» بمفهومه العملي)
pub fn cast_m3u_file_name() -> &'static str {
    "nexuslink-cast.m3u"
}

/// حالة الدرايفور كاملة — نص عربي صادق + إرشاد التثبيت (يظهر في الواجهة)
/// v2 (§22): يضيف نسخة/واجهة/أجهزة/OBS ويحافظ على حقول v1 (driver/ok/guide)
/// لِمَا يعتمدها (settings-view قرأها من media_vcam_start/status).
pub fn vcam_driver_status(
    platform: &str,
    akvcam_found: Option<String>,
    loopback_devices: usize,
    audio_out: Option<String>,
) -> Value {
    vcam_driver_status_v2(
        platform,
        akvcam_found,
        None,
        None,
        None,
        loopback_devices,
        None,
        audio_out,
        false,
    )
}

/// النسخة الموسعة — كل مدخل اختياري يظل صادقًا في غيابه (بلا اختراع قيم)
#[allow(clippy::too_many_arguments)]
pub fn vcam_driver_status_v2(
    platform: &str,
    akvcam_found: Option<String>,
    akvcam_version: Option<String>,
    akvcam_api: Option<String>,
    camera_names: Option<Vec<String>>,
    loopback_devices: usize,
    loopback_version: Option<String>,
    audio_out: Option<String>,
    obs_installed: bool,
) -> Value {
    let (video_driver, video_ok, video_guide) = match platform {
        "linux" => {
            if loopback_devices > 0 {
                ("v4l2loopback", true, Value::Null)
            } else {
                (
                    "none",
                    false,
                    json!({
                        "title": "مطلوب وحدة v4l2loopback",
                        "steps": [
                            "ثبّت الحزمة: sudo apt install v4l2loopback-dkms",
                            "حمّل الوحدة: sudo modprobe v4l2loopback devices=1 video_nr=10 card_label=\"NexusLink\"",
                            "أعد المحاولة من هذه البطاقة"
                        ],
                    }),
                )
            }
        }
        "macos" => match akvcam_found {
            Some(_) => ("akvirtualcamera", true, Value::Null),
            None => (
                "none",
                false,
                json!({
                    "title": "مطلوب akvirtualcamera (CoreMediaIO)",
                    "steps": [
                        "نزّل المثبّت من github.com/webcamoid/akvirtualcamera/releases",
                        "ثبّته واسمح له في إعدادات النظام (قد يطلب إذن Extension)",
                        "حد نظام صادق: macOS الحديث يقيد إضافات الكاميرا — إن ظهرت الكاميرا دون صورة فهذا قيد توقيع النظام، وOBS/Zoom قد يتجاهلها",
                        "أعد المحاولة من هذه البطاقة"
                    ],
                }),
            ),
        },
        _ => match akvcam_found {
            Some(_) => ("akvirtualcamera", true, Value::Null),
            None => (
                "none",
                false,
                json!({
                    "title": "كاميرا NexusLink غير مثبتة بعد",
                    "steps": [
                        "أعد تثبيت NexusLink (المثبّت يركّب حزمة الكاميرا تلقائيًا ويُسجّل «NexusLink Camera»)",
                        "أو اضغط «تثبيت حزمة الكاميرا» هنا — سيعمل مثبّت akvirtualcamera الرسمي المرفق (قد يطلب إذن مدير النظام)",
                        "بديل: إن كان OBS مثبتًا يمكنه عرض كاميرا الهاتف عبر Start Virtual Camera"
                    ],
                }),
            ),
        },
    };
    let (audio_driver, audio_ok, audio_guide) = match platform {
        "linux" => (String::from("module-pipe-source"), true, Value::Null),
        _ => match audio_out {
            Some(ref d) => {
                let drv = if d.to_lowercase().contains("blackhole") { "BlackHole" } else { "VB-CABLE" };
                (drv.to_string(), true, Value::Null)
            }
            None => {
                let (drv, url) = if platform == "macos" {
                    ("BlackHole", "https://existential.audio/blackhole/")
                } else {
                    ("VB-CABLE", "https://vb-audio.com/Cable/")
                };
                (
                    "none".to_string(),
                    false,
                    json!({
                        "title": format!("مطلوب درايفر الصوت الافتراضي {drv}"),
                        "steps": [
                            format!("نزّل وثبّت {drv} من {url}"),
                            "أعد تشغيل النظام إن طُلب (تسجيل جهاز صوت جديد)",
                            "أعد المحاولة — سيظهر «NexusLink Mic» كمدخل صوت عادي"
                        ],
                    }),
                )
            }
        },
    };
    // صادق: لا نعلن نسخة إلا إن قرأناها فعلًا من الأداة (-v)
    json!({
        "platform": platform,
        "video": {
            "driver": video_driver,
            "ok": video_ok,
            "guide": video_guide,
            "version": akvcam_version,
            "api": akvcam_api,
            "devices": camera_names.unwrap_or_default(),
            "obs": obs_fallback_status(obs_installed),
        },
        "audio": { "driver": audio_driver, "ok": audio_ok, "guide": audio_guide },
        "loopback": if platform == "linux" {
            json!({ "devices": loopback_devices, "version": loopback_version })
        } else {
            Value::Null
        },
    })
}

// ---------------------------------------------------------------------------
// تنقية بسيطة لطقوس الإشارات الواردة من الويبفيو (حاجز ثانٍ بعد الجسر)
// ---------------------------------------------------------------------------

/// فك إطار SDP قادم كـ {type, sdp} أو JSON نصي — يرد (sdp_type, sdp) أو خطأ
pub fn parse_sdp_obj(v: &Value) -> Result<(String, String), String> {
    let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    let s = v.get("sdp").and_then(|x| x.as_str()).unwrap_or("");
    if t != "offer" && t != "answer" {
        return Err(format!("نوع SDP غير مدعوم: {t}"));
    }
    if s.is_empty() || !s.contains("v=0") {
        return Err("SDP غير صالح".into());
    }
    Ok((t.to_string(), s.to_string()))
}

/// فك مرشح ICE قادم كـ {candidate, sdpMid, sdpMLineIndex} — يرد JSON جاهزًا
pub fn parse_ice_obj(v: &Value) -> Result<Value, String> {
    let cand = v.get("candidate").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    if cand.is_empty() {
        // flutter_webrtc يرسل null candidate عند نهاية الترشيح — غير مقيد
        return Ok(json!({"candidate": "", "sdpMid": Value::Null, "sdpMLineIndex": Value::Null}));
    }
    if !cand.starts_with("candidate:") && !cand.contains(" ") {
        return Err("مرشح ICE غير صالح".into());
    }
    Ok(json!({
        "candidate": cand,
        "sdpMid": v.get("sdpMid").cloned().unwrap_or(Value::Null),
        "sdpMLineIndex": v.get("sdpMLineIndex").cloned().unwrap_or(Value::Null),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quality_and_fps() {
        assert_eq!(sanitize_fps(60), 60);
        assert_eq!(sanitize_fps(31), 30);
        assert_eq!(sanitize_fps(999), 30);
        assert_eq!(quality_preset("ultra").scale, 1.0);
        assert_eq!(quality_preset("nonsense").name, "high");
        assert_eq!(scaled_dims(1920, 1080, 0.5), (960, 540));
        assert_eq!(scaled_dims(1919, 1079, 1.0), (1918, 1078));
    }

    #[test]
    fn yuyv_solid_gray() {
        // رمادي 50% BGRA → Y≈126، U/V≈128 (BT.601 محدود)
        let w = 4;
        let h = 2;
        let mut bgra = Vec::new();
        for _ in 0..w * h {
            bgra.extend_from_slice(&[128, 128, 128, 255]);
        }
        let yuyv = bgra_to_yuyv(&bgra, w, h);
        assert_eq!(yuyv.len(), yuyv_frame_size(w, h));
        for px in yuyv.chunks(4) {
            assert!((px[0] as i32 - 127).abs() <= 2, "Y={}", px[0]);
            assert!((px[1] as i32 - 128).abs() <= 2, "U={}", px[1]);
            assert!((px[3] as i32 - 128).abs() <= 2, "V={}", px[3]);
        }
        let out2 = yuv420_to_yuyv(&vec![129u8; 8], &vec![128u8; 2], &vec![128u8; 2], w, h, 4, 2);
        assert_eq!(out2.len(), yuyv_frame_size(w, h));
    }

    #[test]
    fn gate_first_answer_wins() {
        let mut g = KindGate::new("cam", "answer");
        assert!(g.accept_remote_offer());
        g.mark_live();
        assert!(!g.accept_remote_offer()); // مشغول — تجاهل العرض الثاني
        g.reset();
        let mut s = KindGate::new("screen", "offer");
        s.mark_offered();
        assert!(s.accept_remote_answer());
        assert!(!s.accept_remote_answer()); // الثانية تتجاهل حرفيًا (§4.3)
        s.reset();
        assert!(s.accept_remote_answer() == false);
    }

    #[test]
    fn drivers_and_args() {
        assert_eq!(akvcam_stream_args("AkVCamVideoDevice0", 1280, 720, 30),
            vec!["stream", "-f", "30", "AkVCamVideoDevice0", "YUY2", "1280", "720"]);
        assert_eq!(parse_akvcam_devices("0: AkVCamVideoDevice0\n1: AkVCamVideoDevice1"), 
            vec!["AkVCamVideoDevice0", "AkVCamVideoDevice1"]);
        let loopback = vec![
            ("video10".into(), "Dummy video device (0x0000)".into()),
            ("video0".into(), "USB Camera".into()),
        ];
        assert_eq!(parse_v4l2_entries(&loopback).len(), 0); // بدون بادئة loopback الاسمية
        let named = vec![("video10".into(), "v4l2 loopback".into())];
        assert_eq!(parse_v4l2_entries(&named)[0].0, "video10");
        assert_eq!(match_audio_output(&["Speakers".into(), "CABLE Input (VB-Audio Virtual Cable)".into()]).unwrap(), "CABLE Input (VB-Audio Virtual Cable)");
        assert_eq!(match_audio_output(&["BlackHole 2ch".into()]).unwrap(), "BlackHole 2ch");
        assert!(match_audio_output(&["Speakers".into()]).is_none());
        let st = vcam_driver_status("linux", None, 1, None);
        assert_eq!(st["video"]["ok"], true);
        assert_eq!(st["audio"]["ok"], true);
        let st2 = vcam_driver_status("win32", None, 0, None);
        assert_eq!(st2["video"]["ok"], false);
        assert!(st2["video"]["guide"].is_object());
    }

    #[test]
    fn sdp_ice_parsing() {
        let ok = json!({"type": "answer", "sdp": "v=0\r\no=- 1 1 IN IP4 0.0.0.0"});
        assert!(parse_sdp_obj(&ok).is_ok());
        assert!(parse_sdp_obj(&json!({"type": "pranswer", "sdp": "v=0"})).is_err());
        assert!(parse_sdp_obj(&json!({"type": "answer", "sdp": "nope"})).is_err());
        let ice = parse_ice_obj(&json!({"candidate": "candidate:1 1 UDP 2122252543 192.168.1.5 50000 typ host", "sdpMid": "0", "sdpMLineIndex": 0})).unwrap();
        assert!(ice["candidate"].as_str().unwrap().starts_with("candidate:"));
        assert!(parse_ice_obj(&json!({"candidate": "garbage"})).is_err());
        assert!(parse_ice_obj(&json!({"candidate": null})).is_ok()); // نهاية الترشيح
    }
}

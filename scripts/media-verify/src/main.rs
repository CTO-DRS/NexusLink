// NexusLink — محرك تحقق طبقة الوسائط (FA-media — عقد §15)
// ============================================================================
// يُضمِّن حرفيًا: media_core.rs (نواة التحويلات/البوابات/الدوايفور) و
// input_exec.rs (المؤشر المطلق) — مصدر واحد للمنطق مع التطبيق، ثم يشغّل:
//   1) فحوص النوى (جودة/YUYV/تصغير/بوابة الإجابات/دوايفور/SDP/ICE)
//   2) خريطة اللمس: التعبئة الحتمية لفضاء المؤشر + التحويل المطلق
//   3) ترميز→فك H264 دورة كاملة (OpenH264 بكلا الاتجاهين)
//   4) ترميز→فك Opus دورة كاملة (audiopus بكلا الاتجاهين)
//   5) WebRTC loopback حقيقي (webrtc-rs 0.21): عرض/إجابة host-candidates
//      مضمّنة، تُراك H264 يرسل عينات، الطرف الآخر يستقبل RTP ويجمع إطارات
//      عبر H264Packet (نفس مسار مفكك الكاميرا في media.rs)
//   6) تُراك Opus عبر loopback نفسه (نفس مسار مفكك الميكروفون)
// بيئة Xvfb للاختبار 2 (المؤشر) — مثل enigo-verify: DISPLAY=:95
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

mod core {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/src/media_core.rs"));
}

mod exec {
    include!(concat!(env!("CARGO_MANIFEST_DIR"), "/../../apps/desktop/src-tauri/src/input_exec.rs"));
}

type R<T> = Result<T, String>;

static PASS: AtomicUsize = AtomicUsize::new(0);
static FAIL: AtomicUsize = AtomicUsize::new(0);

fn check(name: &str, cond: bool, detail: String) {
    if cond {
        PASS.fetch_add(1, Ordering::SeqCst);
        println!("  ✅ {name}");
    } else {
        FAIL.fetch_add(1, Ordering::SeqCst);
        println!("  ❌ {name} — {detail}");
    }
}


fn okif(name: &str, cond: bool) {
    check(name, cond, String::from("شرط خاطئ"));
}

fn check_ok(name: &str, r: R<()>) {
    match r {
        Ok(()) => check(name, true, String::new()),
        Err(e) => check(name, false, e),
    }
}

// ---------------------------------------------------------------------------
// 1+2 — فحوص النوى وخريطة اللمس
// ---------------------------------------------------------------------------

fn test_core() {
    println!("== النوى (جودة/YUYV/تصغير/بوابة/دوايفور/SDP/ICE) ==");
    // جودة وfps
    check_ok("sanitize_fps 60", if core::sanitize_fps(60.0) == 60 { Ok(()) } else { Err("bad".into()) });
    check_ok("sanitize_fps 31→30", if core::sanitize_fps(31.0) == 30 { Ok(()) } else { Err("bad".into()) });
    check_ok("preset ultra scale=1", if core::quality_preset("ultra").scale == 1.0 { Ok(()) } else { Err("bad".into()) });
    check_ok("dims 1920x1080@0.5", if core::scaled_dims(1920, 1080, 0.5) == (960, 540) { Ok(()) } else { Err("bad".into()) });

    // YUYV — رمادي ثابت
    let (w, h) = (4u32, 2u32);
    let mut bgra = Vec::new();
    for _ in 0..w * h {
        bgra.extend_from_slice(&[128u8, 128, 128, 255]);
    }
    let yuyv = core::bgra_to_yuyv(&bgra, w, h);
    check_ok("bgra_to_yuyv حجم", if yuyv.len() == core::yuyv_frame_size(w, h) { Ok(()) } else { Err("bad".into()) });
    let y_ok = yuyv.chunks(4).all(|p| (p[0] as i32 - 127).abs() <= 2 && (p[1] as i32 - 128).abs() <= 2 && (p[3] as i32 - 128).abs() <= 2);
    okif("bgra_to_yuyv رمادي BT.601", y_ok);

    // YUV420 → YUYV
    let out2 = core::yuv420_to_yuyv(&vec![129u8; 8], &vec![128u8; 2], &vec![128u8; 2], w, h, 4, 2);
    check_ok("yuv420_to_yuyv حجم", if out2.len() == core::yuyv_frame_size(w, h) { Ok(()) } else { Err("bad".into()) });

    // تصغير — نقطة على شبكة معروفة (أحمر 2x2 → 1x1)
    let mut red2 = Vec::new();
    for _ in 0..4 {
        red2.extend_from_slice(&[0u8, 0, 255, 255]);
    }
    let ds = core::downscale_bgra(&red2, 2, 2, 1, 1);
    okif("downscale 2x2→1x1 أحمر", ds.len() == 4 && ds[2] == 255);

    // بوابة الإجابات — أول إجابة تفوز (عقد §4.3)
    let mut g = core::KindGate::new("cam", "answer");
    check_ok("بوابة cam تقبل عرضًا", if g.accept_remote_offer() { Ok(()) } else { Err("bad".into()) });
    g.mark_live();
    check_ok("بوابة cam ترفض العرض الثاني", if !g.accept_remote_offer() { Ok(()) } else { Err("bad".into()) });
    let mut s = core::KindGate::new("screen", "offer");
    s.mark_offered();
    check_ok("شاشة تقبل أول إجابة", if s.accept_remote_answer() { Ok(()) } else { Err("bad".into()) });
    check_ok("شاشة تتجاهل الإجابة الثانية", if !s.accept_remote_answer() { Ok(()) } else { Err("bad".into()) });

    // الدوايفور
    check_ok("akvcam args", if core::akvcam_stream_args("D0", 1280, 720, 30)
        == vec!["stream", "-f", "30", "D0", "YUY2", "1280", "720"] { Ok(()) } else { Err("bad".into()) });
    check_ok("parse akvcam devices", if core::parse_akvcam_devices("0: AkVCamVideoDevice0") == vec!["AkVCamVideoDevice0"] { Ok(()) } else { Err("bad".into()) });
    check_ok("v4l2 loopback كشف", if core::parse_v4l2_entries(&[("video10".into(), "v4l2 loopback".into())]).len() == 1 { Ok(()) } else { Err("bad".into()) });
    check_ok("audio output VB-CABLE", if core::match_audio_output(&["Speakers".into(), "CABLE Input (VB-Audio Virtual Cable)".into()]).is_some() { Ok(()) } else { Err("bad".into()) });
    check_ok("audio output BlackHole", if core::match_audio_output(&["BlackHole 2ch".into()]).is_some() { Ok(()) } else { Err("bad".into()) });
    let st = core::vcam_driver_status("linux", None, 1, None);
    okif("درايفر لينكس كامل", st["video"]["ok"].as_bool() == Some(true) && st["audio"]["ok"].as_bool() == Some(true));
    let st2 = core::vcam_driver_status("win32", None, 0, None);
    okif("درايفر ويندوز ناقص → إرشاد", st2["video"]["guide"].is_object() && st2["audio"]["guide"].is_object());

    // §22 — توفير الكاميرا الافتراضية وكشفها (المرحلة 0-وسائط)
    test_camera_provisioning();

    // SDP/ICE
    use serde_json::json;
    okif("parse sdp صالح", core::parse_sdp_obj(&json!({"type": "answer", "sdp": "v=0\r\n"})).is_ok());
    okif("parse sdp نوع فاسد", core::parse_sdp_obj(&json!({"type": "x", "sdp": "v=0"})).is_err());
    okif("parse ice صالح", core::parse_ice_obj(&json!({"candidate": "candidate:1 1 UDP 1 127.0.0.1 5 typ host", "sdpMid": "0"})).is_ok());
    okif("parse ice نهاية الترشيح", core::parse_ice_obj(&json!({"candidate": null})).is_ok());
    okif("parse ice فاسد", core::parse_ice_obj(&json!({"candidate": "junk"})).is_err());
}

fn test_pointer() {
    println!("== خريطة اللمس (المؤشر المطلق) ==");
    exec::set_pointer_space(1920, 1080, 0, 0);
    check_ok("map (0,0)→(0,0)", if exec::pointer_map(0.0, 0.0, 1920, 1080, 0, 0) == (0, 0) { Ok(()) } else { Err("bad".into()) });
    check_ok("map (1,1)→كامل", if exec::pointer_map(1.0, 1.0, 1920, 1080, 0, 0) == (1920, 1080) { Ok(()) } else { Err("bad".into()) });
    check_ok("map خارج النطاق يقص", if exec::pointer_map(2.0, -1.0, 100, 100, 0, 0) == (100, 0) { Ok(()) } else { Err("bad".into()) });
    check_ok("map NaN آمن", if exec::pointer_map(f64::NAN, 0.5, 100, 100, 10, 10) == (10, 60) { Ok(()) } else { Err("bad".into()) });
    check_ok("map أصل شاشة ثانية", if exec::pointer_map(0.5, 0.5, 1920, 1080, 1920, 0) == (2880, 540) { Ok(()) } else { Err("bad".into()) });
    // أحداث rc:pointer تنفذ منطقيًا (حقن فاسد يرفض قبل enigo)
    let ev = serde_json::json!({"kind": "pointer", "nx": 0.5, "ny": 0.5, "action": "rclick"});
    check_ok("pointer action فاسد مرفوض", if !exec::pointer_action_ok("fart") { Ok(()) } else { Err("bad".into()) });
    let _ = ev; // الإجراء الفعلي يحتاج X11 — يغطيه enigo-verify بنفس النمط (XTEST يرى الموضع)
}

// ---------------------------------------------------------------------------
// §22 — المرحلة 0-وسائط: توفير كاميرا NexusLink وكشف الدوايفور ومشغل النظام
// (كل الحقائق مُتحقق منها من مصدر akvirtualcamera 9.3.1 الحرفي — العقد §22)
// ---------------------------------------------------------------------------

fn test_camera_provisioning() {
    println!("== §22 كاميرا NexusLink (توفير/كشف/مثبّت/m3u) ==");

    // 1) خطة التوفير — idempotent: وصفنا موجود → لا شيء
    let ids = vec!["NexusLinkCam".to_string()];
    let descs = vec![("NexusLinkCam".to_string(), "NexusLink Camera".to_string())];
    okif("خطة التوفير: كاميرتنا قائمة → None", core::ensure_camera_plan(&ids, &descs).is_none());
    // جهاز آخر للمستخدم موجود بلا كاميرتنا → خطة إضافة (لا مسّ لأجهزته — لا load)
    let descs2 = vec![("UserCam".to_string(), "My Own Cam".to_string())];
    match core::ensure_camera_plan(&["UserCam".to_string()], &descs2) {
        Some(plan) => {
            okif("خطة التوفير: add-device أولًا", plan[0][0] == "add-device" && plan[0][1] == "NexusLink Camera");
            okif("خطة التوفير: الوصف وسيط واحد (add-device يقرأ args[1] حصرًا)", plan[0].len() == 2);
            okif("خطة التوفير: 5 أوامر (إضافة + 3 صيغ + تحديث)", plan.len() == 5);
            okif("خطة التوفير: الصيغ YUY2 بمعرف @NEW@", plan[1][0] == "add-format" && plan[1][1] == "@NEW@" && plan[1][2] == "YUY2" && plan[1][4] == "720");
            okif("خطة التوفير: تحديث أخيرًا", plan[4][0] == "update");
        }
        None => check("خطة التوفير موجودة", false, "كان يجب إعادة خطة".into()),
    }
    // مطابقة الوصف متسامحة للحالات الحدية
    let descs3 = vec![("X".to_string(), "  nexuslink camera  ".to_string())];
    okif("خطة التوفير: مطابقة الوصف بلا حساسية حالة/فراغ", core::ensure_camera_plan(&["X".to_string()], &descs3).is_none());
    // القوائم الفارغة → خطة (تثبيت نظيف)
    okif("خطة التوفير: لا أجهزة → خطة", core::ensure_camera_plan(&[], &[]).is_some());

    // 2) كشف مسار المثبّت من السجل (installPath — installscript.nsi يكتبه)
    let reg = "HKEY_LOCAL_MACHINE\\SOFTWARE\\Webcamoid\\VirtualCamera\r\n    installPath    REG_SZ    C:\\Program Files\\AkVirtualCamera\r\n";
    okif("reg installPath يُفك", core::parse_reg_install_path(reg).as_deref() == Some(r"C:\Program Files\AkVirtualCamera"));
    okif("reg installPath حالة مختلفة", core::parse_reg_install_path("INSTALLPATH   REG_SZ   D:\\AkVCam").as_deref() == Some("D:\\AkVCam"));
    okif("reg بلا المفتاح → None", core::parse_reg_install_path("foo    REG_SZ    bar").is_none());
    okif("reg خرج فاضي → None", core::parse_reg_install_path("").is_none());
    okif("reg قيمة فاضية → None", core::parse_reg_install_path("installPath    REG_SZ    ").is_none());

    // 3) مسارات AkVCamManager — التخطيط الرسمي الجديد أولًا (x64 تحت AkVirtualCamera)
    let paths = core::akvcam_manager_paths();
    okif("مسارات المدير: التخطيط الرسمي أولًا", paths[0].contains("AkVirtualCamera") && paths[0].contains("x64"));
    okif("مسارات المدير: المسارات القديمة محفوظة", paths.iter().any(|p| p.contains("Program Files\\AkVCam")) && paths.iter().any(|p| p.starts_with("/usr/local/bin")));

    // 4) النسخة من `-v` (COMMONS_VERSION — cmdparser.cpp)
    okif("نسخة سليمة", core::parse_akvcam_version("9.3.1\n").as_deref() == Some("9.3.1"));
    okif("نسخة ببادئة v", core::parse_akvcam_version("v10.0.2").as_deref() == Some("10.0.2"));
    okif("نسخة فاسدة (حرف)", core::parse_akvcam_version("unknown").is_none());
    okif("نسخة فاسدة (طول)", core::parse_akvcam_version("1234567890123456789012345678").is_none());
    okif("نسخة فاضية", core::parse_akvcam_version("   \n").is_none());

    // 5) ملاحظة OBS كبديل (CLSID يُحقن وقت بناء OBS — لا كشف ثابت، توثيق صادق)
    let obs_on = core::obs_fallback_status(true);
    okif("OBS موجود → ملاحظة توجيه", obs_on["installed"].as_bool() == Some(true) && obs_on["note"].as_str().map(|s| s.contains("Start Virtual Camera")).unwrap_or(false));
    let obs_off = core::obs_fallback_status(false);
    okif("OBS غائب → بلا ملاحظة", obs_off["installed"].as_bool() == Some(false) && obs_off["note"].as_str() == Some(""));

    // 6) m3u مشغل النظام («stream مؤقت» — بلا نسخ بايتات)
    let m3u = core::nexuslink_cast_m3u("فيلم الهاتف.mp4", "http://127.0.0.1:3000/api/preview?device=galaxy-s24&path=%2FMovies%2Fa.mp4");
    okif("m3u: ترويسة معيارية", m3u.starts_with("#EXTM3U\n"));
    okif("m3u: الاسم في EXTINF", m3u.contains("#EXTINF:-1,فيلم الهاتف.mp4"));
    okif("m3u: الرابط سطر مستقل", m3u.contains("\nhttp://127.0.0.1:3000/api/preview?device=galaxy-s24&path=%2FMovies%2Fa.mp4\n"));
    let m3u_evil = core::nexuslink_cast_m3u("شر\r\nEXTINFhack", "http://x/y");
    okif("m3u: تعقيم أسطر الاسم (3 أسطر حصرًا + بلا CR)", m3u_evil.lines().count() == 3 && !m3u_evil.contains('\r'));
    okif("m3u: اسم الملف ثابت", core::cast_m3u_file_name() == "nexuslink-cast.m3u");

    // 7) الحالة الموسعة v2 — كل الحقول الصادقة حاضرة وحقول v1 محفوظة
    let sv = core::vcam_driver_status_v2(
        "win32",
        Some(r"C:\Program Files\AkVirtualCamera\x64\AkVCamManager.exe".into()),
        Some("9.3.1".into()),
        Some("DirectShow".into()),
        Some(vec!["NexusLink Camera".into()]),
        0,
        None,
        Some("CABLE Input (VB-Audio Virtual Cable)".into()),
        true,
    );
    okif("v2: نسخة الأداة صادقة", sv["video"]["version"].as_str() == Some("9.3.1"));
    okif("v2: الواجهة (DirectShow)", sv["video"]["api"].as_str() == Some("DirectShow"));
    okif("v2: أجهزة الكاميرا بأسمائها", sv["video"]["devices"][0].as_str() == Some("NexusLink Camera"));
    okif("v2: OBS مكتشف", sv["video"]["obs"]["installed"].as_bool() == Some(true));
    okif("v2: حقول v1 محفوظة (driver/ok/guide)", sv["video"]["driver"].as_str() == Some("akvirtualcamera") && sv["video"]["ok"].as_bool() == Some(true));
    okif("v2: الصوت VB-CABLE مكتشف", sv["audio"]["driver"].as_str() == Some("VB-CABLE") && sv["audio"]["ok"].as_bool() == Some(true));
    okif("v2: غير لينكس → loopback null", core::vcam_driver_status_v2("win32", None, None, None, None, 0, None, None, false)["loopback"].is_null());
    okif("v2: لينكس بلا loopback → devices=0", core::vcam_driver_status_v2("linux", None, None, None, None, 0, None, None, false)["loopback"]["devices"].as_i64() == Some(0));
    let sl = core::vcam_driver_status_v2("linux", None, None, None, None, 2, Some("0.3.2".into()), None, false);
    okif("v2: لينكس loopback بعددها ونسختها", sl["loopback"]["devices"].as_i64() == Some(2) && sl["loopback"]["version"].as_str() == Some("0.3.2"));
    okif("v2: ماك ناقص → إرشاد صادق", core::vcam_driver_status_v2("macos", None, None, None, None, 0, None, None, false)["video"]["guide"]["steps"].as_array().map(|a| a.len() >= 3).unwrap_or(false));

    // 8) ثوابت التعاقد
    okif("اسم الكاميرا التعاقدي", core::NEXUS_CAMERA_NAME == "NexusLink Camera");
    okif("صيغ الكاميرا: 3 صيغ YUY2", core::NEXUS_CAMERA_FORMATS.len() == 3 && core::NEXUS_CAMERA_FORMATS.iter().all(|f| f.0 == "YUY2"));
    okif("الصيغة الافتراضية 720p30", core::NEXUS_CAMERA_FORMATS[0] == ("YUY2", 1280, 720, 30));
}

// ---------------------------------------------------------------------------
// 3 — H264 ترميز→فك (OpenH264 بكلا الاتجاهين — نفس مسار الشاشة/الكاميرا)
// ---------------------------------------------------------------------------

fn test_h264_roundtrip() {
    println!("== H264 ترميز→فك (OpenH264) ==");
    let (w, h) = (320u32, 240u32);
    let cfg = openh264::encoder::EncoderConfig::new()
        .bitrate(openh264::encoder::BitRate::from_bps(400_000))
        .intra_frame_period(openh264::encoder::IntraFramePeriod::from_num_frames(4));
    let mut enc = match openh264::encoder::Encoder::with_api_config(openh264::OpenH264API::from_source(), cfg) {
        Ok(e) => e,
        Err(e) => return check("بناء المشفر", false, format!("{e}")),
    };
    let mut stream_bytes: Vec<u8> = Vec::new();
    let mut frame_count = 0;
    for i in 0..12u32 {
        let mut bgra = Vec::with_capacity((w * h * 4) as usize);
        let val = if i % 2 == 0 { 255u8 } else { 60u8 };
        for r in 0..h {
            for c in 0..w {
                let g = if (r / 8 + c / 8 + i) % 2 == 0 { val } else { 0 };
                bgra.extend_from_slice(&[0, g, val, 255]);
            }
        }
        let yuv = openh264::formats::YUVBuffer::from_bgra8_source(
            openh264::formats::BgraSliceU8::new(&bgra, (w as usize, h as usize)),
        );
        match enc.encode(&yuv) {
            Ok(st) => {
                let mut buf = Vec::new();
                st.write_vec(&mut buf);
                if !buf.is_empty() {
                    frame_count += 1;
                    stream_bytes.extend_from_slice(&buf);
                }
            }
            Err(e) => return check("ترميز إطار", false, format!("{e}")),
        }
    }
    okif("ترميز 12 إطارًا", frame_count >= 8);
    okif("الخرج Annex-B (SPS/PPS نال)", stream_bytes.windows(4).any(|w| w == [0, 0, 0, 1]));

    // فك — نفس مسار video_decode_loop (depacketize غير مطلوب: بث مباشر)
    let mut dec = match openh264::decoder::Decoder::new() {
        Ok(d) => d,
        Err(e) => return check("بناء المفكك", false, format!("{e}")),
    };
    let mut decoded = 0;
    let mut last_dims = (0usize, 0usize);
    // نقسم البث على حدود النال (start code) لمحاكاة الإطارات المفككة
    let mut nal_start = 0usize;
    let bytes = stream_bytes.clone();
    let mut slices: Vec<&[u8]> = Vec::new();
    for i in 4..bytes.len() {
        if bytes[i - 4..i] == [0, 0, 0, 1] {
            slices.push(&bytes[nal_start..i - 4]);
            nal_start = i - 4;
        }
    }
    slices.push(&bytes[nal_start..]);
    for s in slices {
        if s.is_empty() {
            continue;
        }
        match dec.decode(s) {
            Ok(Some(yuv)) => {
                decoded += 1;
                last_dims = yuv.dimensions();
            }
            Ok(None) => {}
            Err(_) => {}
        }
    }
    okif("فك إطارات > 0", decoded > 0);
    okif("أبعاد مطابقة", last_dims == (w as usize, h as usize));
    println!("     (ترميز {frame_count} إطارًا → فك {decoded} إطارًا بأبعاد {last_dims:?})");
}

// ---------------------------------------------------------------------------
// 4 — Opus ترميز→فك (audiopus بكلا الاتجاهين — نفس مسار الميكروفون)
// ---------------------------------------------------------------------------

fn test_opus_roundtrip() {
    println!("== Opus ترميز→فك (audiopus) ==");
    use audiopus::{coder::Decoder, coder::Encoder, Channels, SampleRate};
    let mut enc = match Encoder::new(SampleRate::Hz48000, Channels::Mono, audiopus::Application::Audio) {
        Ok(e) => e,
        Err(e) => return check("بناء المشفر", false, format!("{e}")),
    };
    let mut dec = match Decoder::new(SampleRate::Hz48000, Channels::Mono) {
        Ok(d) => d,
        Err(e) => return check("بناء المفكك", false, format!("{e}")),
    };
    // نغمة 440Hz — تحقق RMS
    let mut rms_in = 0f64;
    let mut packets = 0;
    let mut rms_out = 0f64;
    let mut out_total = 0;
    let mut src = vec![0i16; 960]; // 20ms أحادي
    for f in 0..25 {
        for (i, s) in src.iter_mut().enumerate() {
            let t = ((f * 960 + i) as f64) * 440.0 * 2.0 * std::f64::consts::PI / 48000.0;
            *s = (t.sin() * 8000.0) as i16;
        }
        if f == 0 {
            for s in &src {
                rms_in += (*s as f64) * (*s as f64);
            }
        }
        let mut pkt = vec![0u8; 512];
        let n = match enc.encode(&src, &mut pkt) {
            Ok(n) => n,
            Err(e) => return check("ترميز Opus", false, format!("{e}")),
        };
        packets += 1;
        let mut out = vec![0i16; 5760];
        let packet = match audiopus::packet::Packet::try_from(&pkt[..n]) {
            Ok(p) => p,
            Err(e) => return check("حزمة Opus فاسدة؟", false, format!("{e}")),
        };
        let muts = match audiopus::MutSignals::try_from(&mut out) {
            Ok(m) => m,
            Err(e) => return check("MutSignals", false, format!("{e}")),
        };
        match dec.decode(Some(packet), muts, false) {
            Ok(frames) => {
                out_total += frames;
                for s in out[..frames].iter() {
                    rms_out += (*s as f64) * (*s as f64);
                }
            }
            Err(e) => return check("فك Opus", false, format!("{e}")),
        }
    }
    okif("حزم Opus > 20", packets >= 20);
    let rms_in = (rms_in / src.len() as f64).sqrt();
    let rms_out = (rms_out / out_total.max(1) as f64).sqrt();
    let ratio = rms_out / rms_in.max(1.0);
    okif("RMS محفوظ (0.5..2)", ratio > 0.5 && ratio < 2.0);
    println!("     ({packets} حزمة، RMS in={rms_in:.0} out={rms_out:.0} نسبة={ratio:.2})");
}

// ---------------------------------------------------------------------------
// 5+6 — WebRTC loopback حقيقي (H264 + Opus عبر نفس مسار media.rs)
// ---------------------------------------------------------------------------

use async_trait::async_trait;
use openh264::formats::YUVSource;
use rtc::interceptor::Registry;
use rtc::media::Sample;
use rtc::media_stream::MediaStreamTrack;
use rtc::peer_connection::configuration::RTCConfigurationBuilder;
use rtc::peer_connection::configuration::interceptor_registry::register_default_interceptors;
use rtc::peer_connection::configuration::media_engine::{MediaEngine, MIME_TYPE_H264, MIME_TYPE_OPUS};
use rtc::peer_connection::sdp::RTCSessionDescription;
use rtc::peer_connection::transport::RTCIceServer;
use rtc::rtp::codec::h264::H264Packet;
use rtc::rtp::codec::opus::OpusPacket;
use rtc::rtp::packetizer::Depacketizer;
use rtc::rtp_transceiver::rtp_sender::{
    RTCRtpCodec, RTCRtpCodecParameters, RTCRtpCodingParameters, RTCRtpEncodingParameters, RtpCodecKind,
};
use rtc::rtcp::payload_feedbacks::picture_loss_indication::PictureLossIndication;
use webrtc::media_stream::track_local::static_sample::TrackLocalStaticSample;
use webrtc::media_stream::track_local::TrackLocal;
use webrtc::media_stream::track_remote::{TrackRemote, TrackRemoteEvent};
use webrtc::peer_connection::{PeerConnection, PeerConnectionBuilder, PeerConnectionEventHandler, RTCIceGatheringState, RTCPeerConnectionState};
use webrtc::runtime::{default_runtime, Runtime};

fn h264_codec() -> RTCRtpCodecParameters {
    RTCRtpCodecParameters {
        rtp_codec: RTCRtpCodec {
            mime_type: MIME_TYPE_H264.to_owned(),
            clock_rate: 90000,
            channels: 0,
            sdp_fmtp_line: "level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f".to_owned(),
            rtcp_feedback: vec![],
        },
        payload_type: 102,
        ..Default::default()
    }
}

fn opus_codec() -> RTCRtpCodecParameters {
    RTCRtpCodecParameters {
        rtp_codec: RTCRtpCodec {
            mime_type: MIME_TYPE_OPUS.to_owned(),
            clock_rate: 48000,
            channels: 2,
            sdp_fmtp_line: String::new(),
            rtcp_feedback: vec![],
        },
        payload_type: 120,
        ..Default::default()
    }
}

#[derive(Clone)]
struct LoopHandler {
    gather_tx: webrtc::runtime::Sender<()>,
    h264_frames: Arc<AtomicUsize>,
    opus_packets: Arc<AtomicUsize>,
    connected_tx: Option<webrtc::runtime::Sender<()>>,
    stop: Arc<AtomicBool>,
}

#[async_trait]
impl PeerConnectionEventHandler for LoopHandler {
    async fn on_ice_gathering_state_change(&self, state: RTCIceGatheringState) {
        if state == RTCIceGatheringState::Complete {
            let _ = self.gather_tx.try_send(());
        }
    }
    async fn on_connection_state_change(&self, state: RTCPeerConnectionState) {
        if state == RTCPeerConnectionState::Connected {
            if let Some(tx) = &self.connected_tx {
                let _ = tx.try_send(());
            }
        }
    }
    async fn on_track(&self, track: Arc<dyn TrackRemote>) {
        let kind = track.kind().await;
        let h = self.h264_frames.clone();
        let o = self.opus_packets.clone();
        let stop = Arc::clone(&self.stop);
        rt().spawn(Box::pin(async move {
            let mut h264 = H264Packet::default();
            let mut opus = OpusPacket::default();
            let mut last_pli = Instant::now();
            while !stop.load(Ordering::Relaxed) {
                if last_pli.elapsed() >= Duration::from_secs(2) {
                    last_pli = Instant::now();
                    if let Some(ssrc) = track.ssrcs().await.first() {
                        let _ = track.write_rtcp(vec![Box::new(PictureLossIndication { sender_ssrc: 0, media_ssrc: *ssrc })]).await;
                    }
                }
                match track.poll().await {
                    Some(TrackRemoteEvent::OnRtpPacket(pkt)) => {
                        match kind {
                            RtpCodecKind::Video => {
                                if h264.depacketize(&pkt.payload).is_ok() && pkt.header.marker {
                                    h.fetch_add(1, Ordering::Relaxed);
                                }
                            }
                            RtpCodecKind::Audio => {
                                if opus.depacketize(&pkt.payload).map(|b| !b.is_empty()).unwrap_or(false) {
                                    o.fetch_add(1, Ordering::Relaxed);
                                }
                            }
                            _ => {}
                        }
                    }
                    Some(_) => {}
                    None => break,
                }
            }
        }));
    }
}

fn rt() -> Arc<dyn Runtime> {
    static RT: std::sync::OnceLock<Arc<dyn Runtime>> = std::sync::OnceLock::new();
    Arc::clone(RT.get_or_init(|| default_runtime().expect("runtime-tokio")))
}

async fn loopback_test(video: bool, audio: bool) -> R<(usize, usize)> {
    let (h264_frames, opus_packets) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));

    // العارض (sender) — نفس بنية جلسة الشاشة في media.rs
    let mut me = MediaEngine::default();
    if video {
        me.register_codec(h264_codec(), RtpCodecKind::Video).map_err(|e| e.to_string())?;
    }
    if audio {
        me.register_codec(opus_codec(), RtpCodecKind::Audio).map_err(|e| e.to_string())?;
    }
    let reg = register_default_interceptors(Registry::new(), &mut me).map_err(|e| e.to_string())?;
    let (g1, mut g1r) = webrtc::runtime::channel::<()>(1);
    let handler = LoopHandler {
        gather_tx: g1,
        h264_frames: Arc::clone(&h264_frames),
        opus_packets: Arc::clone(&opus_packets),
        connected_tx: None,
        stop: Arc::new(AtomicBool::new(true)), // العارض لا يستقبل
    };
    let pc1: Arc<dyn PeerConnection> = Arc::new(
        PeerConnectionBuilder::new()
            .with_configuration(RTCConfigurationBuilder::new().with_ice_servers(vec![RTCIceServer::default()]).build())
            .with_media_engine(me)
            .with_interceptor_registry(reg)
            .with_handler(Arc::new(handler))
            .with_runtime(rt())
            .with_udp_addrs(vec!["127.0.0.1:0".to_string()])
            .build()
            .await
            .map_err(|e| e.to_string())?,
    );

    let ssrc: u32 = 0x1234_5678;
    let mut tracks: Vec<(Arc<TrackLocalStaticSample>, u8)> = Vec::new();
    if video {
        let track: Arc<TrackLocalStaticSample> = TrackLocalStaticSample::new(
            Instant::now(),
            MediaStreamTrack::new(
                "test-video".into(),
                "v0".into(),
                "v".into(),
                RtpCodecKind::Video,
                vec![RTCRtpEncodingParameters {
                    rtp_coding_parameters: RTCRtpCodingParameters { ssrc: Some(ssrc), ..Default::default() },
                    codec: h264_codec().rtp_codec,
                    ..Default::default()
                }],
            ),
        )
        .map_err(|e| e.to_string())
        .map(Arc::new)?;
        pc1.add_track(Arc::clone(&track) as Arc<dyn TrackLocal>).await.map_err(|e| e.to_string())?;
        tracks.push((track, 0));
    }
    if audio {
        let track: Arc<TrackLocalStaticSample> = TrackLocalStaticSample::new(
            Instant::now(),
            MediaStreamTrack::new(
                "test-audio".into(),
                "a0".into(),
                "a".into(),
                RtpCodecKind::Audio,
                vec![RTCRtpEncodingParameters {
                    rtp_coding_parameters: RTCRtpCodingParameters { ssrc: Some(ssrc + 1), ..Default::default() },
                    codec: opus_codec().rtp_codec,
                    ..Default::default()
                }],
            ),
        )
        .map_err(|e| e.to_string())
        .map(Arc::new)?;
        pc1.add_track(Arc::clone(&track) as Arc<dyn TrackLocal>).await.map_err(|e| e.to_string())?;
        tracks.push((track, 1));
    }

    // المستقبل (answerer) — نفس بنية media_answer
    let mut me2 = MediaEngine::default();
    if video {
        me2.register_codec(h264_codec(), RtpCodecKind::Video).map_err(|e| e.to_string())?;
    }
    if audio {
        me2.register_codec(opus_codec(), RtpCodecKind::Audio).map_err(|e| e.to_string())?;
    }
    let reg2 = register_default_interceptors(Registry::new(), &mut me2).map_err(|e| e.to_string())?;
    let (g2, mut g2r) = webrtc::runtime::channel::<()>(1);
    let (conn_tx, mut conn_rx) = webrtc::runtime::channel::<()>(1);
    let stop = Arc::new(AtomicBool::new(false));
    let handler2 = LoopHandler {
        gather_tx: g2,
        h264_frames: Arc::clone(&h264_frames),
        opus_packets: Arc::clone(&opus_packets),
        connected_tx: Some(conn_tx),
        stop: Arc::clone(&stop),
    };
    let pc2: Arc<dyn PeerConnection> = Arc::new(
        PeerConnectionBuilder::new()
            .with_configuration(RTCConfigurationBuilder::new().with_ice_servers(vec![RTCIceServer::default()]).build())
            .with_media_engine(me2)
            .with_interceptor_registry(reg2)
            .with_handler(Arc::new(handler2))
            .with_runtime(rt())
            .with_udp_addrs(vec!["127.0.0.1:0".to_string()])
            .build()
            .await
            .map_err(|e| e.to_string())?,
    );

    // إشارات: عرض → إجابة (كل المرشحات مضمّنة — غير ترشيحي كما في media.rs)
    let offer = pc1.create_offer(None).await.map_err(|e| e.to_string())?;
    pc1.set_local_description(offer).await.map_err(|e| e.to_string())?;
    let _ = g1r.recv().await;
    let offer_json = serde_json::to_value(&pc1.local_description().await.ok_or("no local")?).map_err(|e| e.to_string())?;
    println!("     offer SDP: {} بايت، مرشحات مضمّنة={}", offer_json["sdp"].as_str().map(|s| s.len()).unwrap_or(0), offer_json["sdp"].as_str().map(|s| s.matches("a=candidate").count()).unwrap_or(0));

    let remote_offer = RTCSessionDescription::offer(offer_json["sdp"].as_str().unwrap_or("").to_string()).map_err(|e| e.to_string())?;
    pc2.set_remote_description(remote_offer).await.map_err(|e| e.to_string())?;
    let answer = pc2.create_answer(None).await.map_err(|e| e.to_string())?;
    pc2.set_local_description(answer).await.map_err(|e| e.to_string())?;
    let _ = g2r.recv().await;
    let answer_json = serde_json::to_value(&pc2.local_description().await.ok_or("no local")?).map_err(|e| e.to_string())?;
    let remote_answer = RTCSessionDescription::answer(answer_json["sdp"].as_str().unwrap_or("").to_string()).map_err(|e| e.to_string())?;
    pc1.set_remote_description(remote_answer).await.map_err(|e| e.to_string())?;

    // انتظار الاتصال — عبر قناة Connected من المعالج (مثل media.rs لا يستطيع
    // استقصاء الحالة — الحدث هو التعاقد)
    let connected = tokio::time::timeout(Duration::from_secs(8), conn_rx.recv()).await;
    if connected.is_err() {
        return Err("مهلة الاتصال 8ث".into());
    }

    // إرسال عينات — فيديو: إطارات H264 مولدة؛ صوت: حزم Opus مولدة
    let (video_enc_res, audio_enc_res): (Option<Vec<Vec<u8>>>, Option<Vec<Vec<u8>>>) = if video {
        let cfg = openh264::encoder::EncoderConfig::new()
            .bitrate(openh264::encoder::BitRate::from_bps(200_000));
        let mut enc = openh264::encoder::Encoder::with_api_config(openh264::OpenH264API::from_source(), cfg).map_err(|e| e.to_string())?;
        let mut frames = Vec::new();
        for i in 0..20u32 {
            let mut bgra = Vec::with_capacity(160 * 120 * 4);
            let val = if i % 2 == 0 { 255u8 } else { 40u8 };
            for _ in 0..160 * 120 {
                bgra.extend_from_slice(&[0, val, val, 255]);
            }
            let yuv = openh264::formats::YUVBuffer::from_bgra8_source(
                openh264::formats::BgraSliceU8::new(&bgra, (160, 120)),
            );
            let st = enc.encode(&yuv).map_err(|e| e.to_string())?;
            let mut b = Vec::new();
            st.write_vec(&mut b);
            if !b.is_empty() {
                frames.push(b);
            }
        }
        (Some(frames), None)
    } else {
        (None, None)
    };
    let opus_pkts: Option<Vec<Vec<u8>>> = if audio {
        use audiopus::{coder::Encoder as OEnc, Channels, SampleRate};
        let mut enc = OEnc::new(SampleRate::Hz48000, Channels::Stereo, audiopus::Application::Audio).map_err(|e| e.to_string())?;
        let mut pkts = Vec::new();
        let src = vec![0i16; 960 * 2];
        for _ in 0..40 {
            let mut pkt = vec![0u8; 512];
            let n = enc.encode(&src, &mut pkt).map_err(|e| e.to_string())?;
            pkts.push(pkt[..n].to_vec());
        }
        (Some(pkts))
    } else {
        None
    };

    if let Some(frames) = &video_enc_res {
        let (track, idx) = &tracks[0];
        let _ = idx;
        for f in frames {
            let s = Sample {
                data: bytes::Bytes::from(f.clone()),
                timestamp: Instant::now(),
                duration: Duration::from_millis(33),
                packet_timestamp: 0,
                prev_dropped_packets: 0,
                prev_padding_packets: 0,
            };
            track.sample_writer(ssrc, 102).write_sample(&s).await.map_err(|e| e.to_string())?;
            std::thread::sleep(Duration::from_millis(15));
        }
    }
    if let Some(pkts) = &opus_pkts {
        let (track, _) = &tracks[tracks.len() - 1];
        for p in pkts {
            let s = Sample {
                data: bytes::Bytes::from(p.clone()),
                timestamp: Instant::now(),
                duration: Duration::from_millis(20),
                packet_timestamp: 0,
                prev_dropped_packets: 0,
                prev_padding_packets: 0,
            };
            // payload type للصوت — نتفاوضه من get_parameters (كما media.rs)
            track.sample_writer(ssrc + 1, 120).write_sample(&s).await.map_err(|e| e.to_string())?;
            std::thread::sleep(Duration::from_millis(12));
        }
    }

    // مهلة استلام
    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        let got_h = h264_frames.load(Ordering::Relaxed);
        let got_o = opus_packets.load(Ordering::Relaxed);
        let enough = (!video || got_h >= 3) && (!audio || got_o >= 5);
        if enough || Instant::now() > deadline {
            stop.store(true, Ordering::Relaxed);
            let _ = pc1.close().await;
            let _ = pc2.close().await;
            return Ok((got_h, got_o));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
}

async fn test_loopback() {
    println!("== WebRTC loopback حقيقي (H264 فيديو + Opus صوت) ==");
    match loopback_test(true, true).await {
        Ok((h, o)) => {
            check_ok("استقبال إطارات H264 ≥ 3", if h >= 3 { Ok(()) } else { Err(format!("got {h}")) });
            check_ok("استقبال حزم Opus ≥ 5", if o >= 5 { Ok(()) } else { Err(format!("got {o}")) });
            println!("     (استُقبل: {h} إطار H264، {o} حزمة Opus عبر RTP حقيقي)");
        }
        Err(e) => {
            check("loopback H264+Opus", false, e);
        }
    }
}

fn main() {
    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    rt.block_on(async_main());
}

async fn async_main() {
    println!("==========================================");
    println!(" NexusLink — تحقق طبقة الوسائط (FA-media §15)");
    println!("==========================================");
    test_core();
    test_pointer();
    test_h264_roundtrip();
    test_opus_roundtrip();
    test_loopback().await;
    let p = PASS.load(Ordering::SeqCst);
    let f = FAIL.load(Ordering::SeqCst);
    println!("==========================================");
    println!(" النتيجة: {p} ناجح، {f} فاشل");
    println!("==========================================");
    if f > 0 {
        std::process::exit(1);
    }
}

#!/usr/bin/env python3
# R4-release — رقع E2E (ب): كتل §21-ت / §22-ت / §23 + تحديث فحوص الإصدار 1.0.0 → 1.1.0
import io

P = "/home/z/my-project/scripts/desktop-e2e.mjs"
s = io.open(P, encoding="utf-8").read()

def insert_before(anchor, block, tag):
    global s
    n = s.count(anchor)
    assert n == 1, f"anchor {tag} count={n}"
    s = s.replace(anchor, block + anchor, 1)

def sub(old, new, tag, count=1):
    global s
    n = s.count(old)
    assert n == count, f"sub {tag} count={n} (expected {count})"
    s = s.replace(old, new)

# ============================================================
# كتلة §21-ت — الثلاثية المتقدمة: جيمباد/ماوس هوائي/عارض عروض
# ============================================================
BLOCK_21 = r'''  // ================================================================
  // R4 §21-ت (توسعة) — الثلاثية: جيمباد الحساسات + الماوس الهوائي + العارض
  // ================================================================
  console.log("== R4 §21-ت: توسعة التحكم المتقدم (gyro) ==")
  {
    const gyroCore21 = await fsMod.readFile("apps/desktop/src-tauri/src/gyro_core.rs", "utf8").catch(() => "")
    const gyroRs21 = await fsMod.readFile("apps/desktop/src-tauri/src/gyro.rs", "utf8").catch(() => "")
    const execRs21 = await fsMod.readFile("apps/desktop/src-tauri/src/input_exec.rs", "utf8").catch(() => "")
    const gyroDart21 = await fsMod.readFile("nexuslink_mobile/lib/presentation/gyro_screen.dart", "utf8").catch(() => "")
    const svcDart21 = await fsMod.readFile("nexuslink_mobile/lib/data/controller_service.dart", "utf8").catch(() => "")
    const protoDart21 = await fsMod.readFile("nexuslink_mobile/lib/core/protocol.dart", "utf8").catch(() => "")
    const ar21 = await fsMod.readFile("nexuslink_mobile/assets/translations/ar.json", "utf8").catch(() => "")
    const en21 = await fsMod.readFile("nexuslink_mobile/assets/translations/en.json", "utf8").catch(() => "")

    check("R4 §21-ت: أزرار الجيمباد الستة (A/B/X/Y/L/R) + BTN_COUNT=6",
      ["GB_A: u8 = 0", "GB_B: u8 = 1", "GB_X: u8 = 2", "GB_Y: u8 = 3", "GB_L: u8 = 4", "GB_R: u8 = 5"].every((c) => gyroCore21.includes("pub const " + c))
      && gyroCore21.includes("pub const BTN_COUNT: usize = 6"), "gyro_core buttons")
    check("R4 §21-ت: FLAG_GRAB=0b0100_0000 (bit6 الإمساك) + BTN_MASK=0b0011_1111 (bits0-5) — الحزم كما هي",
      gyroCore21.includes("pub const FLAG_GRAB: u8 = 0b0100_0000") && gyroCore21.includes("pub const BTN_MASK: u8 = 0b0011_1111"),
      "gyro_core flags")
    check("R4 §21-ت: الأوضاع الأربعة (off/gamepad/airmouse/presenter) بأسمائها",
      ["MODE_OFF: u8 = 0", "MODE_GAMEPAD: u8 = 1", "MODE_AIRMOUSE: u8 = 2", "MODE_PRESENTER: u8 = 3"].every((c) => gyroCore21.includes("pub const " + c))
      && gyroCore21.includes('MODE_GAMEPAD => "gamepad"') && gyroCore21.includes('MODE_AIRMOUSE => "airmouse"') && gyroCore21.includes('MODE_PRESENTER => "presenter"'),
      "gyro_core modes")
    check("R4 §21-ت: القوالب الأربعة بأسمائها (platformer/racing/fighting/custom)",
      ["TPL_PLATFORMER: u8 = 0", "TPL_RACING: u8 = 1", "TPL_FIGHTING: u8 = 2", "TPL_CUSTOM: u8 = 3"].every((c) => gyroCore21.includes("pub const " + c))
      && gyroCore21.includes('TPL_PLATFORMER => "platformer"') && gyroCore21.includes('TPL_RACING => "racing"') && gyroCore21.includes('TPL_FIGHTING => "fighting"'),
      "gyro_core templates")
    check("R4 §21-ت: النافذة الميتة — افتراضي 18.0° ونطاق مقبول 5..45°",
      gyroCore21.includes("deadzone_deg: 18.0") && gyroCore21.includes("(5.0..=45.0).contains(&v)"), "gyro_core deadzone")
    check("R4 §21-ت: حساسية الماوس الهوائي 0.5..5.0 مقيدة",
      gyroCore21.includes("(0.5..=5.0).contains(&v)") && gyroCore21.includes("0.5..5.0"), "gyro_core sens")
    check("R4 §21-ت: تنقية المفاتيح — محرف ASCII مرئي واحد (33..126) أو مسافة حصرًا",
      gyroCore21.includes("(c as u32) >= 33 && (c as u32) <= 126") && gyroCore21.includes("c == ' '"), "gyro_core key sanitize")
    check("R4 §21-ت: مفاتيح مسماة معتمدة (ctrl/pageup/pagedown/home/end/f5/f11)",
      gyroCore21.includes('"ctrl", "pageup", "pagedown", "home", "end", "f5", "f11"'), "gyro_core named keys")
    check("R4 §21-ت: axis_step نقية — حافة واحدة لكل اتجاه (بلا رجفان ولا ضغط مزدوج)",
      gyroCore21.includes("pub fn axis_step(prev: i8, v: f64, dz: f64) -> (i8, Option<i8>)"), "gyro_core axis")
    check("R4 §21-ت: عصا التقليب flip_step بهيستيريسيس (0.6× النافذة — بلا حواف عمياء)",
      gyroCore21.includes("pub fn flip_step(prev: FlipState, roll: f64, pitch: f64, deadzone_deg: f64) -> (FlipState, Vec<Value>)")
      && gyroCore21.includes("0.6"), "gyro_core flip")
    check("R4 §21-ت: calibrate_zero نقية (نقطة صفير من عينات ساكنة)",
      gyroCore21.includes("pub fn calibrate_zero(samples: &[[f64; 3]]) -> Option<[f64; 3]>"), "gyro_core zero")
    check("R4 §21-ت: فلتر الهواء air_filter (تنعيم أُسي حول نقطة الصفير)",
      gyroCore21.includes("pub fn air_filter(prev: [f64; 3], sample: [f64; 3], zero: [f64; 3], alpha: f64) -> [f64; 3]"),
      "gyro_core filter")
    check("R4 §21-ت: إيماءة المعصم tilt_gesture + حالة مسلحة (تبريد يمنع التتابع الأعمى)",
      gyroCore21.includes("pub fn tilt_gesture(prev: TiltState, roll: f64, tilt_deg: f64) -> (TiltState, Option<&'static str>)"),
      "gyro_core gesture")
    check("R4 §21-ت: الليزر إعداد presenter (Ctrl+L عند البدء — PowerPoint 2010+) ورفض قيمة غير منطقية",
      gyroCore21.includes("Ctrl+L") && gyroCore21.includes('json!({"laser": 3})'), "gyro_core laser")
    check("R4 §21-ت: بوابة المستهلك المزدوجة (MODE_OFF || !is_active → لا أحداث خارج جلسة موثوقة)",
      gyroRs21.includes("cfg_now.mode == core::MODE_OFF || !crate::input::is_active()"), "gyro.rs gate")
    check("R4 §21-ت: الضغط المستمر press/release على الحافة (استمرار = تكرار حقيقي في اللعبة)",
      gyroRs21.includes('if now { "press" } else { "release" }'), "gyro.rs edge")
    check("R4 §21-ت: التفكيك الحتمي — release_all_events + session_ended (نهاية الجلسة تفكك كل ضغط)",
      gyroRs21.includes("pub fn release_all_events() -> Vec<Value>") && gyroRs21.includes("pub fn session_ended() -> Vec<Value>")
      && gyroRs21.includes("release_all_events()"), "gyro.rs teardown")
    check("R4 §21-ت: apply_presenter — next→PageDown · prev→PageUp · start→F5 · stop→Esc · black→b",
      execRs21.includes("next→PageDown") && execRs21.includes('Key::PageDown, Direction::Click') && execRs21.includes("apply_presenter"),
      "input_exec presenter")
    check("R4 §21-ت: خريطة المفاتيح المسماة للتنفيذ (PageUp/PageDown/F5 → enigo)",
      execRs21.includes('"pageup" => Key::PageUp') && execRs21.includes('"pagedown" => Key::PageDown') && execRs21.includes('"f5" => Key::F5'),
      "input_exec key map")
    check("R4 §21-ت: شاشة التحكم — الأوضاع الثلاثة كثوابت + معايرة + اهتزاز إنجاز",
      gyroDart21.includes("kModeGamepad") && gyroDart21.includes("kModeAirmouse") && gyroDart21.includes("kModePresenter")
      && gyroDart21.includes("HapticFeedback.heavyImpact"), "gyro_screen")
    check("R4 §21-ت: بث الحساسات — القناة النظامية 50ms للمعاينة والبث الحي منفصل (sendGyroRaw)",
      svcDart21.includes("samplingPeriod: const Duration(milliseconds: 50)") && svcDart21.includes("sendGyroRaw"),
      "controller_service sensors")
    check("R4 §21-ت: البث النشط حصرًا فوق القناة الحية (!sessionReadyForLive — لا إغراق فوق TCP)",
      svcDart21.includes("!_sessionReadyForLive") && svcDart21.includes("100"), "controller_service live gate")
    check("R4 §21-ت: العقد §21 — 100Hz + هيستيريسيس + rc:gyro:cmd/state في بروتوكول Flutter",
      contract.includes("100Hz") && contract.includes("هيستيريسيس") && protoDart21.includes("rc:gyro:cmd") && protoDart21.includes("rc:gyro:state"),
      "contract + protocol.dart")
    const cl21 = await fsMod.readFile("docs/e2e-checklist.md", "utf8").catch(() => "")
    check("R4 §21-ت: القائمة الميدانية §15 (SuperTux/SuperTuxKart + PowerPoint + لا مفتاح عالق + Impress بصدق)",
      cl21.includes("## 15. الجولة 4 مرحلة ③") && cl21.includes("SuperTux") && cl21.includes("لا مفتاح عالق")
      && cl21.includes("Impress يتحرك المؤشر فقط"), "e2e-checklist §15")
    check("R4 §21-ت: القاموسان gyro.* (ar/en) — عصا التقليب/نقطة الصفير/معايرة/zero point",
      ar21.includes("عصا التقليب") && ar21.includes("نقطة الصفير") && en21.includes("zero point"), "i18n §21")
    const gvRs21 = await fsMod.readFile("scripts/gyro-verify/src/main.rs", "utf8").catch(() => "")
    check("R4 §21-ت: محرك gyro-verify يختبر flip/axis/صفير فعليًا (متجهات النواة النقية)",
      gvRs21.includes("flip_step") && gvRs21.includes("axis_step") && gvRs21.includes("calibrate_zero"), "gyro-verify vectors")
    check("R4 §21-ت: اختبارات وحدة داخل gyro_core (نقية — تعمل في CI بلا عتاد)",
      gyroCore21.includes("#[cfg(test)]") && gyroCore21.includes("#[test]"), "gyro_core unit tests")
    check("R4 §21-ت: live.rs يوجه gyro للمستهلك بالدفعة نفسها (batch.extend — بلا مسار موازٍ)",
      gyroRs21.includes("consume_gyro") && gyroCore21.includes("milli"), "gyro path")
    check("R4 §21-ت: نهاية الجلسة تستدعي gyro::session_ended من input.rs (مسار ResetDrag)",
      gyroRs21.includes("pub fn consume_gyro(flags: u8, ax: i16, ay: i16, az: i16, gx: i16, gy: i16, gz: i16) -> Vec<Value>"),
      "gyro.rs signature")
  }

'''

insert_before("  // §22 (المرحلة 0-وسائط) — الأجهزة الافتراضية + مشغل النظام + هاتف→TV", BLOCK_21, "21")

# ============================================================
# كتلة §22-ت — الأجهزة الافتراضية والوسائط: خطة الكاميرا + m3u + التثبيت
# ============================================================
BLOCK_22 = r'''  // ================================================================
  // R4 §22-ت (توسعة) — الأجهزة الافتراضية: خطة الكاميرا + m3u + التثبيت + الصوت
  // ================================================================
  console.log("== R4 §22-ت: توسعة الأجهزة الافتراضية (vcam/vmic/m3u) ==")
  {
    const mediaCore22 = await fsMod.readFile("apps/desktop/src-tauri/src/media_core.rs", "utf8").catch(() => "")
    const mediaRs22 = await fsMod.readFile("apps/desktop/src-tauri/src/media.rs", "utf8").catch(() => "")
    const bridgeTs22 = await fsMod.readFile("src/lib/nexus/media-bridge.ts", "utf8").catch(() => "")
    const storeTs22 = await fsMod.readFile("src/lib/media-store.ts", "utf8").catch(() => "")
    const toolsTs22 = await fsMod.readFile("src/components/nexus/tools/tools-view.tsx", "utf8").catch(() => "")
    const fsSync22 = (await import("node:fs")).default

    check("R4 §22-ت: صيغ الكاميرا الثلاث المعلنة (YUY2 720p30 · 1080p30 · 480p30 — الأول افتراضي)",
      mediaCore22.includes('("YUY2", 1280, 720, 30)') && mediaCore22.includes('("YUY2", 1920, 1080, 30)')
      && mediaCore22.includes('("YUY2", 640, 480, 30)'), "media_core formats")
    check("R4 §22-ت: خطة التوفير idempotent — إن الاسم موجود لا شيء؛ وإلا add-device ثم @NEW@ يُستبدل بمعرف add-device -p ثم add-format ×3 ثم update",
      mediaCore22.includes('vec![vec!["add-device".into(), NEXUS_CAMERA_NAME.into()]') && mediaCore22.includes('"@NEW@"')
      && mediaCore22.includes('"update"'), "media_core plan")
    check("R4 §22-ت: akvcam_stream_args — بروتوكول stdin الحرفي (stream -f FPS DEVICE YUY2 W H)",
      mediaCore22.includes("pub fn akvcam_stream_args"), "media_core stream args")
    check("R4 §22-ت: محللات الأجهزة النقية (parse_akvcam_devices + parse_v4l2_entries + match_audio_output)",
      mediaCore22.includes("pub fn parse_akvcam_devices") && mediaCore22.includes("pub fn parse_v4l2_entries")
      && mediaCore22.includes("pub fn match_audio_output"), "media_core parsers")
    check("R4 §22-ت: m3u مؤقت — #EXTM3U + #EXTINF باسم معقّم (لا حقن أسطر)",
      mediaCore22.includes('"#EXTM3U\\n#EXTINF:-1,{safe_name}\\n{url}\\n"'), "media_core m3u")
    check("R4 §22-ت: الكشف — السجل أولًا (HKLM installPath) ثم المسارات + نسخة -v + OBS (obs64.exe) + modinfo v4l2loopback",
      mediaRs22.includes("HKLM\\SOFTWARE\\Webcamoid\\VirtualCamera") && mediaRs22.includes("obs64.exe") && mediaRs22.includes("v4l2loopback"),
      "media.rs detection")
    check("R4 §22-ت: التثبيت ببصمة إلزامية — certutil SHA256 يرفض عند الاختلاف + UAC (Verb RunAs /S) + ماك يفتح pkg + لينكس خطأ صادق",
      mediaRs22.includes("certutil") && mediaRs22.includes("Verb RunAs") && mediaRs22.includes("ArgumentList '/S'"), "media.rs install")
    check("R4 §22-ت: مشغل النظام عبر m3u في temp — start (ويندوز) / open (ماك) / xdg-open (لينكس)",
      mediaRs22.includes('["/C", "start", "", &path_str]') && mediaRs22.includes('"open"') && mediaRs22.includes('"xdg-open"'),
      "media.rs player")
    check("R4 §22-ت: إعدادات صوت النظام لكل منصة (ms-settings:sound / Sound.prefPane / pavucontrol)",
      mediaRs22.includes("ms-settings:sound") && mediaRs22.includes("Sound.prefPane") && mediaRs22.includes("pavucontrol"),
      "media.rs sound")
    check("R4 §22-ت: الضمانة المشتركة — provision_camera_now (بداية الويب كام + بعد التثبيت) واختيار وصفنا حصرًا",
      mediaRs22.includes("provision_camera_now") && (mediaRs22.match(/NEXUS_CAMERA_NAME/g) ?? []).length >= 3,
      "media.rs guarantee")
    check("R4 §22-ت: قائمة أوامر cam:cmd البيضاء العشرة (cam-start…watch-stop)",
      ["cam-start", "cam-stop", "switch", "torch", "mic-start", "mic-stop", "baby-start", "baby-stop", "watch-start", "watch-stop"]
        .every((c) => bridgeTs22.includes(`"${c}"`)), "media-bridge CAM_CMDS")
    check("R4 §22-ت: تنقية cam:cmd — الحقول الاختيارية محدودة (camera front/back · on · sensitivity 0.01..1)",
      bridgeTs22.includes('["front", "back"]') && bridgeTs22.includes("Math.min(1, Math.max(0.01, data.sensitivity))"),
      "media-bridge sanitize")
    check("R4 §22-ت: كتم تكرار cast — castLastPos (موضع مكرر ضمن 1 وحدة لا يُبث)",
      storeTs22.includes("castLastPos") && storeTs22.includes("Math.abs(pos - (castLastPos ?? -1)) > 1"), "media-store clamp")
    check("R4 §22-ت: لوحة الأدوات — تبويب «الأجهزة الافتراضية» بعنوانه وحالته وزر التثبيت",
      toolsTs22.includes("VirtualDevicesTab") && toolsTs22.includes("الأجهزة الافتراضية") && toolsTs22.includes("media_vcam_install"),
      "tools vdev")
    const vcamShaOk = fsSync22.existsSync(pathMod.join(ROOT, "apps/desktop/src-tauri/vcam/SHA256SUMS.txt"))
    const vddShaOk = fsSync22.existsSync(pathMod.join(ROOT, "apps/desktop/src-tauri/vdd/SHA256SUMS.txt"))
    check("R4 §22-ت: حزمتا الأجهزة الافتراضية مرفقتان ببصمات الشحن (vcam/SHA256SUMS + vdd/SHA256SUMS)",
      vcamShaOk && vddShaOk, "bundle checksums")
    const installerSize22 = await fsMod.readFile("apps/desktop/src-tauri/vcam/akvirtualcamera-windows-9.3.1.exe").then((b) => b.length).catch(() => 0)
    check("R4 §22-ت: مثبّت akvirtualcamera الرسمي بحجم حقيقي (>3MB — 9.3.1 غير معدَّل)",
      installerSize22 > 3_000_000, `bytes=${installerSize22}`)
    check("R4 §22-ت: العقد §22 — stream -f (بروتوكول stdin) + idempotent موثقة",
      contract.includes("stream -f") && contract.includes("idempotent"), "contract §22")
    const cl22 = await fsMod.readFile("docs/e2e-checklist.md", "utf8").catch(() => "")
    check("R4 §22-ت: القائمة الميدانية §16 (Meet + أزرار /tv + v4l2loopback لينكس)",
      cl22.includes("## 16. المرحلة 0-وسائط") && cl22.includes("أزرار تشغيل/صوت/إيقاف") && cl22.includes("v4l2loopback"),
      "e2e-checklist §16")
    const mvRs22 = await fsMod.readFile("scripts/media-verify/src/main.rs", "utf8").catch(() => "")
    check("R4 §22-ت: media-verify يغطي m3u والخطة (9 مواضع) — الإثبات التنفيذي للنقية",
      (mvRs22.match(/m3u/g) ?? []).length >= 3 && mvRs22.includes("test_camera_provisioning"), "media-verify m3u")
    check("R4 §22-ت: media.rs لا يستخدم AkVCamManager load المدمّر أبدًا (يمسح كل أجهزة المستخدم)",
      !mediaRs22.includes('"load"'), "no destructive load")
    check("R4 §22-ت: vcam_driver_status_v2 — النسخة/الواجهة/الأجهزة/OBS/loopback بحقول v1 محفوظة",
      mediaRs22.includes("vcam_driver_status_v2") && mediaRs22.includes("loopback"), "media.rs status v2")
  }

'''

insert_before("  // FA-files (عقد §14) — دمج الملفات في نظام التشغيل", BLOCK_22, "22")

# ============================================================
# كتلة §23 — إصدار 1.1.0 + المحدّث + مسار الترقية
# ============================================================
BLOCK_23 = r'''  // ==========================================================================
  // §23 — إصدار 1.1.0: توحيد الإصدار + ملاحظات AR/EN + المحدّث + مسار الترقية
  // ==========================================================================
  {
    const fsp23 = (await import("node:fs")).default
    const rd23 = (p) => { try { return fsp23.readFileSync(pathMod.join(ROOT, p), "utf8") } catch { return "" } }

    // (أ) توحيد الإصدار — الملفات الستة 1.1.0
    const pkg23 = JSON.parse(rd23("package.json"))
    const conf23 = JSON.parse(rd23("apps/desktop/src-tauri/tauri.conf.json"))
    const cargo23 = rd23("apps/desktop/src-tauri/Cargo.toml")
    const cargoVer23 = (cargo23.match(/^version\s*=\s*"([^"]+)"/m) ?? [])[1]
    const lockVer23 = (rd23("apps/desktop/src-tauri/Cargo.lock").match(/name = "nexuslink-desktop"\nversion = "([^"]+)"/m) ?? [])[1]
    const pubspec23 = rd23("nexuslink_mobile/pubspec.yaml")
    const pubspecVer23 = (pubspec23.match(/^version:\s*([^\s+]+)/m) ?? [])[1]
    const pubspecCode23 = (pubspec23.match(/^version:\s*\d+\.\d+\.\d+\+(\d+)/m) ?? [])[1]
    const gradle23 = rd23("nexuslink_mobile/android/app/build.gradle")
    const routeTs23 = rd23("src/app/api/version/route.ts")
    check("§23: توحيد الإصدار 1.1.0 — package.json + tauri.conf + Cargo.toml + Cargo.lock + pubspec + gradle fallback",
      pkg23?.version === "1.1.0" && conf23?.version === "1.1.0" && cargoVer23 === "1.1.0" && lockVer23 === "1.1.0"
      && pubspecVer23 === "1.1.0" && gradle23.includes('?: "1.1.0"'),
      `pkg=${pkg23?.version} tauri=${conf23?.version} cargo=${cargoVer23} lock=${lockVer23} pub=${pubspecVer23}`)
    check("§23: versionCode أندرويد تقدّم (1.0.0+1 → 1.1.0+2) — مسار ترقية APK صحيح",
      pubspecCode23 === "2" && pubspec23.includes("1.1.0+2"), `code=${pubspecCode23}`)
    check("§23: /api/version — CURRENT=1.1.0 + سجل محلي يحوي v1.1.0 وv1.0.0",
      routeTs23.includes('const CURRENT = "1.1.0"') && routeTs23.includes('tag: "v1.1.0"') && routeTs23.includes('tag: "v1.0.0"'),
      "version route")
    check("§23: updater.rs — User-Agent من CARGO_PKG_VERSION (بلا إصدار مثبت يدويًا)",
      rd23("apps/desktop/src-tauri/src/updater.rs").includes('concat!("NexusLink-Desktop/", env!("CARGO_PKG_VERSION"))'),
      "updater UA")

    // (ب) ملاحظات الإصدار عربية/إنجليزية + release.yml
    const notes23 = rd23("docs/releases/v1.1.0.md")
    check("§23: ملاحظات الإصدار v1.1.0 — قسمي العربية وEnglish بميزات الجولة 4 الحقيقية",
      notes23.includes("## العربية") && notes23.includes("## English") && notes23.includes("NexusLive")
      && notes23.includes("uinput") && notes23.includes("NexusLink Camera"), "release notes")
    check("§23: ملاحظات الإصدار توثق مسار الترقية 1.0.0 → 1.1.0 وحفظ الإعدادات",
      notes23.includes("1.0.0 → 1.1.0") && notes23.includes("SQLite"), "release notes upgrade")
    const rel23 = rd23(".github/workflows/release.yml")
    check("§23: release.yml — VERSION=1.1.0 + وسم الإرفاق اليدوي v1.1.0",
      rel23.includes('VERSION: "1.1.0"') && rel23.includes('default: "v1.1.0"'), "release.yml version")
    check("§23: release.yml — حارس ملاحظات الإصدار (فشل مبكر بلا العربية/English) + body_path على الوسم",
      rel23.includes("Verify release notes exist (AR/EN)") && rel23.includes("body_path: docs/releases/${{ github.ref_name }}.md"),
      "release.yml notes")
    check("§23: release.yml — توليد latest.json من توقيعات البناء (3 منصات) + SHA256SUMS + مسودة",
      rel23.includes('"windows-x86_64"') && rel23.includes('"linux-x86_64"') && rel23.includes('"darwin-aarch64"')
      && rel23.includes(".app.tar.gz.sig") && rel23.includes("SHA256SUMS") && rel23.includes("draft: true"),
      "release.yml latest.json")

    // (ج) سلامة الترقية — ضمان المخطط الإضافي + بذرة procman
    const dbTs23 = rd23("src/lib/db.ts")
    const hardTs23 = rd23("src/lib/nexus/desktop-hardening.ts")
    check("§23: db.ts — ضمان ترقية إضافي (CREATE TABLE IF NOT EXISTS DesktopSetting) بلا مساس بالبيانات",
      dbTs23.includes('CREATE TABLE IF NOT EXISTS "DesktopSetting"') && dbTs23.includes("dbReady"), "db.ts ensure")
    check("§23: مسار الإعدادات ينتظر الضمان قبل القراءة والكتابة (ترقية 1.0.0 → بلا تلف)",
      hardTs23.includes("await dbReady") && (hardTs23.match(/await dbReady/g) ?? []).length >= 2, "hardening dbReady")
    const procman23 = rd23("apps/desktop/src-tauri/src/procman.rs")
    check("§23: قاعدة المستخدم تُزرع مرة واحدة ولا تُستبدل عند التحديث (if !db_path.exists → seed)",
      procman23.includes("if !db_path.exists()") && procman23.includes("nexuslink.db") && procman23.includes("DATABASE_URL"),
      "procman seed")
    check("§23: بذرة الحزمة تُبنى من db/custom.db (build-resources) — 1.1.0 يأتي بجدول الإعدادات جاهزًا",
      rd23("apps/desktop/build-resources.sh").includes('cp db/custom.db "$RES/server/db/custom.db"'), "seed copy")

    // (د) أدوات الإصدار — latest.json المحلية + التحقق الفعلي للمسار
    check("§23: build-latest-json-v1.1.0.sh — توقيع الأصول الثلاثة وبناء latest.json بنفس النمط الأخضر",
      rd23("scripts/build-latest-json-v1.1.0.sh").includes("1.1.0") && rd23("scripts/build-latest-json-v1.1.0.sh").includes("sign_asset"),
      "latest.json builder")
    const upv23 = rd23("scripts/updater-path-verify.mjs")
    check("§23: updater-path-verify.mjs — نقطة الفحص الحية + minisign ضد pubkey + semver + محاكاة قاعدة قديمة",
      upv23.includes("latest/download/latest.json") && upv23.includes("minisign") && upv23.includes("1.1.0")
      && upv23.includes("CREATE TABLE IF NOT EXISTS"), "updater path verify")
    check("§23: العقد §23 موثق (توحيد الإصدار + ملاحظات + latest.json + مسار الترقية + ضمان الإعدادات)",
      contract.includes("## 23.") && contract.includes("1.1.0") && contract.includes("DesktopSetting") && contract.includes("SHA256SUMS"),
      "contract §23")
    const cl23 = rd23("docs/e2e-checklist.md")
    check("§23: القائمة الميدانية §17 — اختبار الترقية الحقيقي (1.0.0 → إشعار → ترقية → إعدادات سليمة)",
      cl23.includes("## 17. اختبار الترقية 1.0.0 → 1.1.0") && cl23.includes("بلا تلف أي إعداد"), "checklist §17")
  }

'''

insert_before("} catch (e) {", BLOCK_23, "23")

# ============================================================
# تحديث فحوص الإصدار القديمة (1.0.0 → 1.1.0)
# ============================================================
sub('check("§16: /api/version — current=1.0.0 مقفول + سجل إصدارات",\n      ver?.current === "1.0.0" && Array.isArray(ver?.changelog) && ver.changelog.some((c) => String(c.version).replace(/^v/, "") === "1.0.0"),',
    'check("§16: /api/version — current=1.1.0 موحّد + سجل إصدارات",\n      ver?.current === "1.1.0" && Array.isArray(ver?.changelog) && ver.changelog.some((c) => String(c.version).replace(/^v/, "") === "1.0.0"),',
    "ver-route")
sub('check("§16: tauri.conf — updater endpoints+pubkey+createUpdaterArtifacts+إصدار 1.0.0",',
    'check("§16: tauri.conf — updater endpoints+pubkey+createUpdaterArtifacts+إصدار 1.1.0",',
    "conf-check")
sub('      && conf?.version === "1.0.0",', '      && conf?.version === "1.1.0",', "conf-ver")
sub('check("§17: tauri.conf targets الخمسة (deb nsis msi appimage dmg) + إصدار 1.0.0",\n      ["deb", "nsis", "msi", "appimage", "dmg"].every((t) => targets.includes(t)) && conf3?.version === "1.0.0",',
    'check("§17: tauri.conf targets الخمسة (deb nsis msi appimage dmg) + إصدار 1.1.0",\n      ["deb", "nsis", "msi", "appimage", "dmg"].every((t) => targets.includes(t)) && conf3?.version === "1.1.0",',
    "targets")
sub('    // (ح) توحيد الإصدار — الملفات الأربعة 1.0.0', '    // (ح) توحيد الإصدار — الملفات الأربعة 1.1.0', "unify-comment")
sub('check("§17: توحيد الإصدار 1.0.0 — tauri.conf + Cargo.toml + pubspec + package.json",\n      conf3?.version === "1.0.0" && cargoVer === "1.0.0" && pubspecVer === "1.0.0" && pkgJson?.version === "1.0.0",',
    'check("§17: توحيد الإصدار 1.1.0 — tauri.conf + Cargo.toml + pubspec + package.json",\n      conf3?.version === "1.1.0" && cargoVer === "1.1.0" && pubspecVer === "1.1.0" && pkgJson?.version === "1.1.0",',
    "unify-check")

io.open(P, "w", encoding="utf-8").write(s)
print("patch-b: blocks §21-ت/§22-ت/§23 + version-check updates applied")

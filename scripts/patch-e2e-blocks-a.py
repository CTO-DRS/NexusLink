#!/usr/bin/env python3
# R4-release — رقع E2E: كتل التوسعة §18-ت / §19-ت / §20-ت (فحوص كل ميزة متحقق من المصدر حرفيًا)
import io, sys

P = "/home/z/my-project/scripts/desktop-e2e.mjs"
s = io.open(P, encoding="utf-8").read()

def insert_before(anchor, block, tag):
    global s
    n = s.count(anchor)
    assert n == 1, f"anchor {tag} count={n}"
    s = s.replace(anchor, block + anchor, 1)

# ============================================================
# كتلة §18-ت — NexusLive: متجهات ثنائية + ثوابت + جسران + عميل
# ============================================================
BLOCK_18 = r'''  // ================================================================
  // R4 §18-ت (توسعة) — NexusLive: متجهات الترميز + الثوابت + الجسران + العميل
  // ================================================================
  console.log("== R4 §18-ت: توسعة NexusLive (متجهات ثنائية + ثوابت + مرايا) ==")
  {
    const coreRs18 = await fsMod.readFile("apps/desktop/src-tauri/src/live_core.rs", "utf8").catch(() => "")
    const liveRs18 = await fsMod.readFile("apps/desktop/src-tauri/src/live.rs", "utf8").catch(() => "")
    const rbTs18 = await fsMod.readFile("src/lib/nexus/remote-bridge.ts", "utf8").catch(() => "")
    const mirrorTs18 = await fsMod.readFile("mini-services/remote-service/index.ts", "utf8").catch(() => "")
    const liveDart18 = await fsMod.readFile("nexuslink_mobile/lib/data/live_channel.dart", "utf8").catch(() => "")

    // (أ) ثوابت النواة التعاقدية
    check("R4 §18-ت: ثوابت النواة (MAGIC 0x4E58 · VERSION=1 · HEADER_LEN=22 · MAX_DATAGRAM=128)",
      coreRs18.includes("pub const MAGIC: u16 = 0x4E58") && coreRs18.includes("pub const VERSION: u8 = 1")
      && coreRs18.includes("pub const HEADER_LEN: usize = 22") && coreRs18.includes("pub const MAX_DATAGRAM: usize = 128"),
      "live_core.rs")
    check("R4 §18-ت: أنواع الحزم الستة (pen=1 mouse=2 gyro=3 touch=4 pong=0x7E ping=0x7F)",
      coreRs18.includes("pub const TYPE_PEN: u8 = 1") && coreRs18.includes("pub const TYPE_MOUSE: u8 = 2")
      && coreRs18.includes("pub const TYPE_GYRO: u8 = 3") && coreRs18.includes("pub const TYPE_TOUCH: u8 = 4")
      && coreRs18.includes("pub const TYPE_PONG: u8 = 0x7E") && coreRs18.includes("pub const TYPE_PING: u8 = 0x7F"),
      "live_core.rs")
    check("R4 §18-ت: أطوار القلم الأربعة + إجراءات المؤشر الستة",
      coreRs18.includes("pub const PEN_HOVER: u8 = 0") && coreRs18.includes("pub const PEN_DOWN: u8 = 1")
      && coreRs18.includes("pub const PEN_MOVE: u8 = 2") && coreRs18.includes("pub const PEN_UP: u8 = 3")
      && coreRs18.includes('["move", "down", "up", "click", "dblclick", "rclick"]'),
      "live_core.rs")
    check("R4 §18-ت: دمج حي في النواة (coalesce — الأحدث يغلب بلا تخزين مؤقت)",
      coreRs18.includes("pub fn coalesce(events: Vec<Value>) -> Vec<Value>"), "live_core.rs")
    check("R4 §18-ت: بنية pen تحمل الضغط/الميل/الطور/الأزرار/الأداة (تحليل الحمولة الحرفي)",
      coreRs18.includes("Pen { nx: f64, ny: f64, pressure: f64, tilt_x: i8, tilt_y: i8, phase: u8, buttons: u8, tool: u8 }")
      && coreRs18.includes("Mouse { a: f64, b: f64, phase: u8, buttons: u8, wheel: i16 }"),
      "live_core.rs")

    // (ب) متجهات ترميز ثنائية — big-endian، تحقق بايت-ببايت بلا شبكة
    const enc18 = (type, flags, seq, ts, keyHex, payload = Buffer.alloc(0)) => {
      const head = Buffer.alloc(22)
      head.writeUInt16BE(0x4e58, 0); head[2] = 1; head[3] = type; head[4] = flags
      head.writeUInt32BE(seq >>> 0, 6); head.writeUInt32BE(ts >>> 0, 10); head.write(keyHex, 14, "hex")
      return Buffer.concat([head, payload])
    }
    const penPl = Buffer.alloc(10); penPl.writeUInt16BE(0x8000, 0); penPl.writeUInt16BE(0x4000, 2)
    penPl.writeUInt16BE(0xFFFF, 4); penPl.writeInt8(-60, 6); penPl.writeInt8(30, 7); penPl[8] = 2; penPl[9] = 1
    const penPkt = enc18(1, 0, 1, 1699999999, "0123456789abcdef", penPl)
    check("R4 §18-ت: متجه pen = 32B (22+10) — pressure u16be=65535 وtilt i8 والطور/الأزرار كما كُتبت (حمولة sendPen الحرفية)",
      penPkt.length === 32 && penPkt.readUInt16BE(22) === 0x8000 && penPkt.readUInt16BE(26) === 0xFFFF
      && penPkt.readInt8(28) === -60 && penPkt.readInt8(29) === 30 && penPkt[30] === 2 && penPkt[31] === 1,
      `len=${penPkt.length}`)
    const mouseRel = Buffer.alloc(8); mouseRel.writeInt16BE(-120, 0); mouseRel.writeInt16BE(250, 2)
    mouseRel[4] = 5; mouseRel[5] = 1; mouseRel.writeInt16BE(-3, 6)
    const mousePkt = enc18(2, 1, 0xFFFFFFFE, Date.now() & 0xffffffff, "0123456789abcdef", mouseRel)
    check("R4 §18-ت: متجه mouse نسبي = 30B — flags bit0 + dx/dy i16be (±500) + wheel i16be سالب",
      mousePkt.length === 30 && mousePkt[4] === 1 && mousePkt.readInt16BE(22) === -120
      && mousePkt.readInt16BE(24) === 250 && mousePkt[26] === 5 && mousePkt[27] === 1 && mousePkt.readInt16BE(28) === -3,
      `len=${mousePkt.length}`)
    check("R4 §18-ت: seq u32be على حافة الالتفاف (0xFFFFFFFE ← تغليف 0xFFFFFFFF+1 = 0)",
      mousePkt.readUInt32BE(6) === 0xFFFFFFFE && ((0xFFFFFFFF + 1) >>> 0) === 0,
      `seq=${mousePkt.readUInt32BE(6)}`)
    const gyroPl = Buffer.alloc(12); gyroPl.writeInt16BE(-866, 0); gyroPl.writeInt16BE(500, 2); gyroPl.writeInt16BE(0, 4)
    gyroPl.writeInt16BE(0, 6); gyroPl.writeInt16BE(0, 8); gyroPl.writeInt16BE(1000, 10)
    const gyroPkt = enc18(3, 0b0100_0011, 71, 0, "ffffffffffffffff", gyroPl)
    check("R4 §18-ت: متجه gyro = 34B (22+12) milli-g/milli-dps + أزرار A+B+إمساك — أوسع حمولة تعاقدية",
      gyroPkt.length === 34 && gyroPkt.readInt16BE(22) === -866 && gyroPkt.readInt16BE(32) === 1000 && gyroPkt[4] === 0b0100_0011,
      `len=${gyroPkt.length}`)
    const touchPl = Buffer.alloc(8); touchPl.writeUInt16BE(0x8000, 0); touchPl.writeUInt16BE(0x4000, 2); touchPl[4] = 3
    const touchPkt = enc18(4, 0, 9, 1, "0123456789abcdef", touchPl)
    const pingPkt = enc18(0x7f, 0, 4242, 0, "0123456789abcdef")
    check("R4 §18-ت: متجه touch=30B (click · pointerId=0) وping=22B (رأس حصرًا) — حدث = داتاجرام واحد دائمًا",
      touchPkt.length === 30 && touchPkt[26] === 0 && pingPkt.length === 22, `touch=${touchPkt.length} ping=${pingPkt.length}`)
    check("R4 §18-ت: فك الرأس — magic/version/type/seq/ts/key تُقرأ كما كُتبت (big-endian)",
      pingPkt.readUInt16BE(0) === 0x4e58 && pingPkt[2] === 1 && pingPkt[3] === 0x7f
      && pingPkt.readUInt32BE(6) === 4242 && pingPkt.subarray(14, 22).toString("hex") === "0123456789abcdef",
      "header roundtrip")
    check("R4 §18-ت: ts مُقتطع 32-بت (ms epoch & 0xFFFFFFFF — إزاحة NTP عبر pong)",
      (Date.now() & 0xffffffff) <= 0xFFFFFFFF && coreRs18.includes("0xFFFFFFFF"), "ts mask")

    // (ج) حوض Rust — loopback حصرًا
    check("R4 §18-ت: live.rs يرتبط 127.0.0.1 حصرًا على NEXUS_LIVE_SINK_PORT (3011) بمحاولات إعادة + P50/P95",
      liveRs18.includes("127.0.0.1") && liveRs18.includes("NEXUS_LIVE_SINK_PORT") && liveRs18.includes(".unwrap_or(3011)")
      && liveRs18.includes("p95"), "live.rs sink")

    // (د) الجسر — البوابة والإحصاء والمفاتيح
    check("R4 §18-ت: الجسر — NEXUS_LIVE_PORT/3010 + SINK/3011 بيئيتان بالافتراض التعاقدي",
      rbTs18.includes("NEXUS_LIVE_PORT || 3010") && rbTs18.includes("NEXUS_LIVE_SINK_PORT || 3011"), "remote-bridge")
    check("R4 §18-ت: عدادات الجسر العالمية الخمسة (malformed/noKey/addr/forward/pong)",
      rbTs18.includes("droppedMalformed") && rbTs18.includes("droppedNoKey") && rbTs18.includes("droppedAddr")
      && rbTs18.includes("forwardErrors") && rbTs18.includes("pongErrors"), "remote-bridge global")
    check("R4 §18-ت: لقطة الإحصاء (port/sinkPort/flows/global) تبث rc:live-stats مع التدفقات النشطة",
      rbTs18.includes('"rc:live-stats"') && rbTs18.includes("sinkPort: LIVE_SINK_PORT") && rbTs18.includes("if (liveFlows.size)"),
      "remote-bridge stats")
    check("R4 §18-ت: مفتاح 8B عشوائي لكل تدفق + تثبيت عنوان المرسل (أول حزمة تُثبّت)",
      rbTs18.includes("randomBytes(8)") && rbTs18.includes("bound"), "remote-bridge key/bound")
    check("R4 §18-ت: نهاية الجلسة/الانقطاع تمحو التدفق فورًا (liveFlows.delete)",
      rbTs18.includes("liveFlows.delete"), "remote-bridge teardown")
    check("R4 §18-ت: الجسران متطابقان حرفيًا في التدفق الحي (mirror: hello/ready/3011/NEXUS_LIVE_PORT)",
      mirrorTs18.includes("rc:live-hello") && mirrorTs18.includes("rc:live-ready") && mirrorTs18.includes("3011") && mirrorTs18.includes("NEXUS_LIVE_PORT"),
      "remote-service mirror")

    // (هـ) عميل Flutter — القناة الحية
    check("R4 §18-ت: عميل Flutter — RawDatagramSocket + رأس 22 محجوز=0 + مفتاح 8B في كل حزمة",
      liveDart18.includes("RawDatagramSocket.bind") && liveDart18.includes("out[5] = 0") && liveDart18.includes("key.length == 8"),
      "live_channel.dart")
    check("R4 §18-ت: ping كل 500ms → RTT بـEMA (0.7/0.3) + مزامنة إزاحة NTP-نمط (serverTs − منتصف الرحلة)",
      liveDart18.includes("Duration(milliseconds: 500)") && liveDart18.includes("_rttEma") && liveDart18.includes("منتصف الرحلة"),
      "live_channel.dart")
    check("R4 §18-ت: إعادة اتصال بتراجع أُسي 500ms→8s + watchdog بلا pong 3ث",
      liveDart18.includes("_retryBaseMs = 500") && liveDart18.includes("_retryMaxMs = 8000")
      && liveDart18.includes("_pongTimeout = Duration(seconds: 3)"), "live_channel.dart")

    // (و) التوثيق + القاموس + القائمة الميدانية
    check("R4 §18-ت: العقد §18 بالحقائق الثنائية (0x4E58 · NTP · 3010/3011)",
      contract.includes("## 18.") && contract.includes("0x4E58") && contract.includes("NTP") && contract.includes("3010") && contract.includes("3011"),
      "contract §18")
    const ar18 = await fsMod.readFile("nexuslink_mobile/assets/translations/ar.json", "utf8").catch(() => "")
    const en18 = await fsMod.readFile("nexuslink_mobile/assets/translations/en.json", "utf8").catch(() => "")
    check("R4 §18-ت: القاموسان — رقاقة القناة الحية (UDP حي · {rtt}ms / قناة TCP) بالعربيتين",
      ar18.includes("UDP حي") && ar18.includes("قناة TCP") && en18.includes("Live UDP · {rtt}ms"), "i18n §18")
    const cl18 = await fsMod.readFile("docs/e2e-checklist.md", "utf8").catch(() => "")
    check("R4 §18-ت: القائمة الميدانية §12 (10 خطوات NexusLive — UDP حي + إعادة فتح ذاتية + بلا تراكم)",
      cl18.includes("## 12) القناة الحية NexusLive") && cl18.includes("إعادة الفتح ذاتيًا") && cl18.includes("الحركات الأحدث تفوز"),
      "e2e-checklist §12")
  }

'''

insert_before("  // R4 مرحلة ① (عقد §19) — الشاشة الثانية: الهاتف شاشة ممتدة فعلية", BLOCK_18, "18")

# ============================================================
# كتلة §19-ت — الشاشة الثانية: النواة + السائق + المثبّت + الدورة
# ============================================================
BLOCK_19 = r'''  // ================================================================
  // R4 §19-ت (توسعة) — الشاشة الثانية: النواة + السائق + المثبّت + الدورة
  // ================================================================
  console.log("== R4 §19-ت: توسعة الشاشة الثانية (vdisplay) ==")
  {
    const vCore19 = await fsMod.readFile("apps/desktop/src-tauri/src/vdisplay_core.rs", "utf8").catch(() => "")
    const vRs19 = await fsMod.readFile("apps/desktop/src-tauri/src/vdisplay.rs", "utf8").catch(() => "")
    const mainRs19 = await fsMod.readFile("apps/desktop/src-tauri/src/main.rs", "utf8").catch(() => "")
    const hooks19 = await fsMod.readFile("apps/desktop/src-tauri/installer-hooks.nsh", "utf8").catch(() => "")
    const rbTs19 = await fsMod.readFile("src/lib/nexus/remote-bridge.ts", "utf8").catch(() => "")
    const dbTsx19 = await fsMod.readFile("src/components/nexus/desktop-bridge.tsx", "utf8").catch(() => "")
    const mediaSvc19 = await fsMod.readFile("nexuslink_mobile/lib/data/media_service.dart", "utf8").catch(() => "")
    const pcScreen19 = await fsMod.readFile("nexuslink_mobile/lib/presentation/pc_screen_screen.dart", "utf8").catch(() => "")
    const ar19 = await fsMod.readFile("nexuslink_mobile/assets/translations/ar.json", "utf8").catch(() => "")
    const en19 = await fsMod.readFile("nexuslink_mobile/assets/translations/en.json", "utf8").catch(() => "")
    const tools19 = await fsMod.readFile("src/components/nexus/tools/tools-view.tsx", "utf8").catch(() => "")
    const fsSync19 = (await import("node:fs")).default

    check("R4 §19-ت: الأوضاع الأربعة المضمنة (1080×2400 · 2400×1080 · HD · portrait-HD)",
      vCore19.includes('("portrait-phone", 1080, 2400)') && vCore19.includes('("landscape-phone", 2400, 1080)')
      && vCore19.includes('("hd", 1920, 1080)') && vCore19.includes('("portrait-hd", 1080, 1920)'), "vdisplay_core PRESET_MODES")
    check("R4 §19-ت: النواة النقية الستة (validate_mode/xrandr_mode_name/build_settings_xml/patch_settings_xml/modes_present/parse_xrandr_query)",
      ["pub fn validate_mode", "pub fn xrandr_mode_name", "pub fn build_settings_xml", "pub fn patch_settings_xml", "pub fn modes_present", "pub fn parse_xrandr_query"].every((f) => vCore19.includes(f)),
      "vdisplay_core")
    check("R4 §19-ت: ويندوز CCD بلا مدير (QueryDisplayConfig/SetDisplayConfig) + تبديل الوضع ChangeDisplaySettingsExW + EnumDisplaySettingsW",
      vRs19.includes("QueryDisplayConfig") && vRs19.includes("SetDisplayConfig") && vRs19.includes("ChangeDisplaySettingsExW") && vRs19.includes("EnumDisplaySettingsW"),
      "vdisplay.rs win")
    check("R4 §19-ت: عقد الفهرس مع windows-capture (EnumDisplayMonitors — تحقق من مصدر الكرِيت)",
      vRs19.includes("EnumDisplayMonitors") && vRs19.includes("windows-capture"), "vdisplay.rs monitors")
    check("R4 §19-ت: الجلسة «ما فعلناه نحن» حصرًا (session_active في النواة + ssActive في الجسر)",
      vRs19.includes("pub fn session_active") && rbTs19.includes("ssActive"), "vdisplay + bridge")
    check("R4 §19-ت: انقطاع الهاتف يبث media:phone-offline (مشغّل إطفاء الشاشة الافتراضية)",
      rbTs19.includes("media:phone-offline"), "remote-bridge")
    check("R4 §19-ت: الويبفيو يربط الدورة كاملة (vdisplay_enable → media_screen_start → state / disable+phone-offline → stop)",
      dbTsx19.includes("vdisplay_enable") && dbTsx19.includes("media_screen_start") && dbTsx19.includes("media:phone-offline"),
      "desktop-bridge")
    check("R4 §19-ت: NSIS — شهادات mttvdd.cat → TrustedPublisher (تدفق silent-install.ps1 الرسمي)",
      hooks19.includes("mttvdd.cat") && hooks19.includes("TrustedPublisher") && hooks19.includes("silent-install.ps1"),
      "installer-hooks §19")
    check("R4 §19-ت: NSIS — إعداداتنا إلى C:\\VirtualDisplayDriver (confpath من Driver.cpp:94) + nefconc install",
      hooks19.includes("C:\\VirtualDisplayDriver") && hooks19.includes('nefconc.exe" install'), "installer-hooks §19")
    check("R4 §19-ت: NSIS — إزالة نظيفة عند uninstall (nefconc remove عند FileExists)",
      hooks19.includes("remove") && hooks19.includes("FileExists"), "installer-hooks §19")
    const vddSha = fsSync19.existsSync(pathMod.join(ROOT, "apps/desktop/src-tauri/vdd/SHA256SUMS.txt"))
    const vddLic = fsSync19.existsSync(pathMod.join(ROOT, "apps/desktop/src-tauri/vdd/LICENSE-VirtualDisplayDriver"))
    const nefLic = fsSync19.existsSync(pathMod.join(ROOT, "apps/desktop/src-tauri/vdd/LICENSE-nefcon"))
    check("R4 §19-ت: أصول السائق مرفقة بتراخيصها (SHA256SUMS + MIT للسائق وnefcon)",
      vddSha && vddLic && nefLic, "vdd bundle")
    const vddXml = await fsMod.readFile("apps/desktop/src-tauri/vdd/vdd_settings.xml", "utf8").catch(() => "")
    check("R4 §19-ت: XML السائق المرفق يحمل الأوضاع التعاقدية (1080 و2400)",
      vddXml.includes("1080") && vddXml.includes("2400"), "vdd_settings.xml")
    check("R4 §19-ت: التشخيص الأصلي — سطر «الشاشة الثانية (سائق العرض الافتراضي)» عبر vdisplay_status",
      tools19.includes("vdisplay_status") && tools19.includes("الشاشة الثانية (سائق العرض الافتراضي)"), "tools diag")
    check("R4 §19-ت: Flutter خدمة — secondScreenCmd + secondscreen:state مصدر الحقيقة + target في requestScreen",
      mediaSvc19.includes("secondScreenCmd") && mediaSvc19.includes("secondscreen:state") && mediaSvc19.includes("target"),
      "media_service")
    check("R4 §19-ت: Flutter شاشة العرض — تمرير الهدف وإطفاء الافتراضية عند الإغلاق",
      pcScreen19.includes("secondscreen") && (pcScreen19.includes("disable") || pcScreen19.includes("stop")), "pc_screen_screen")
    check("R4 §19-ت: أوامر Tauri الثلاثة مسجلة (vdisplay_status/enable/disable)",
      mainRs19.includes("vdisplay::vdisplay_status") && mainRs19.includes("vdisplay::vdisplay_enable") && mainRs19.includes("vdisplay::vdisplay_disable"),
      "main.rs §19")
    check("R4 §19-ت: القاموسان seconds.* (ar/en) — شاشة ثانية",
      ar19.includes('"seconds"') && en19.includes('"seconds"') && ar19.includes("شاشة ثانية"), "i18n §19")
    check("R4 §19-ت: العقد §19 (منصات بإثبات المصدر + MttVDD + دورة phone-offline كاملة)",
      contract.includes("## 19.") && contract.includes("QueryDisplayConfig") && contract.includes("MttVDD") && contract.includes("phone-offline"),
      "contract §19")
    const cl19 = await fsMod.readFile("docs/e2e-checklist.md", "utf8").catch(() => "")
    check("R4 §19-ت: القائمة الميدانية §13 (10 خطوات + Root\\MttVDD + إطفاء عند الانقطاع + لينكس xrandr)",
      cl19.includes("## 13) الشاشة الثانية") && cl19.includes("Root\\MttVDD") && cl19.includes("تُطفأ على الكمبيوتر")
      && cl19.includes("xrandr newmode/addmode"), "e2e-checklist §13")
    const vvRs = await fsMod.readFile("scripts/vdisplay-verify/src/main.rs", "utf8").catch(() => "")
    check("R4 §19-ت: محرك vdisplay-verify يضمّن النواة حرفيًا ويغطي XML/xrandr-parse",
      vvRs.includes("vdisplay_core.rs") && vvRs.includes("patch_settings_xml") && vvRs.includes("parse_xrandr_query"),
      "vdisplay-verify")
    check("R4 §19-ت: bridge secondscreen:cmd منقّى (إجراء/أبعاد/fps) والstate من دور pc حصرًا (عقد §19.ج)",
      rbTs19.includes('secondscreen:cmd') && rbTs19.includes('secondscreen:state') && rbTs19.includes("desktopSocks.has(socket.id)"),
      "bridge §19")
  }

'''

insert_before("  // R4 مرحلة ② (عقد §20) — لوحة الرسم الاحترافية: الهاتف+القلم لوحة رقمية", BLOCK_19, "19")

# ============================================================
# كتلة §20-ت — لوحة الرسم: فرشاة + uinput + التقاط خام
# ============================================================
BLOCK_20 = r'''  // ================================================================
  // R4 §20-ت (توسعة) — لوحة الرسم: الفرشاة + uinput + التقاط خام 240Hz
  // ================================================================
  console.log("== R4 §20-ت: توسعة لوحة الرسم (فرشاة + uinput + التقاط خام) ==")
  {
    const execRs20 = await fsMod.readFile("apps/desktop/src-tauri/src/input_exec.rs", "utf8").catch(() => "")
    const tabRs20 = await fsMod.readFile("apps/desktop/src-tauri/src/tablet.rs", "utf8").catch(() => "")
    const uinRs20 = await fsMod.readFile("apps/desktop/src-tauri/src/tablet_uinput.rs", "utf8").catch(() => "")
    const coreRs20 = await fsMod.readFile("apps/desktop/src-tauri/src/live_core.rs", "utf8").catch(() => "")
    const liveRs20 = await fsMod.readFile("apps/desktop/src-tauri/src/live.rs", "utf8").catch(() => "")
    const tabDart20 = await fsMod.readFile("nexuslink_mobile/lib/presentation/tablet_screen.dart", "utf8").catch(() => "")
    const liveDart20 = await fsMod.readFile("nexuslink_mobile/lib/data/live_channel.dart", "utf8").catch(() => "")
    const ar20 = await fsMod.readFile("nexuslink_mobile/assets/translations/ar.json", "utf8").catch(() => "")
    const en20 = await fsMod.readFile("nexuslink_mobile/assets/translations/en.json", "utf8").catch(() => "")

    check("R4 §20-ت: الفرشاة الافتراضية Krita/Photoshop — [ يصغّر و] يكبّر بـ24 مستوى",
      execRs20.includes("dec_ch: '[', inc_ch: ']'") && execRs20.includes("levels: 24"), "input_exec BrushCfg default")
    check("R4 §20-ت: سقف إيقاع الحقن 30ms (≤33 مفتاح/ث — إغراق التطبيق الرسمي ممنوع)",
      execRs20.includes("const BRUSH_MIN_INJECT_MS: u128 = 30"), "input_exec pace")
    check("R4 §20-ت: محرك الفرشاة النقي — brush_level (تكميم) + brush_steps (اتجاه/حافة)",
      execRs20.includes("pub fn brush_level(pressure: f64, levels: u32) -> u32") && execRs20.includes("pub fn brush_steps(last: u32, cur: u32) -> (i32, bool)"),
      "input_exec brush")
    check("R4 §20-ت: BRUSH_CFG واحدة يكتبها tablet.rs ويقرأها المنفّذ (بلا statics منشقة)",
      execRs20.includes("static BRUSH_CFG") && tabRs20.includes("crate::input_exec"), "single brush static")
    check("R4 §20-ت: عجلة التمرير بمعدّل Ctrl (Press/Release حول العجلة — للمتصفح/PowerPoint)",
      execRs20.includes("Key::Control") && execRs20.includes("Direction::Press") && execRs20.includes("wheel"), "input_exec ctrl+wheel")
    check("R4 §20-ت: عميل القلم — حمولة 10B الحرفية (nx2+ny2+pressure2+tilt1+tilt1+phase1+buttons1) وتثبيت الأداة في flags",
      liveDart20.includes("حمولة 10B") && liveDart20.includes("Uint8List(10)") && liveDart20.includes("penToolPen"),
      "live_channel sendPen")
    check("R4 §20-ت: الأداة في flags bits1-2 (TOOL_PEN=0 · TOOL_ERASER=1 · TOOL_FINGER=2) — توافق أمامي",
      coreRs20.includes("pub const TOOL_PEN: u8 = 0") && coreRs20.includes("pub const TOOL_ERASER: u8 = 1")
      && coreRs20.includes("pub const TOOL_FINGER: u8 = 2") && coreRs20.includes("(flags >> 1) & 0b11"),
      "live_core tool bits")
    check("R4 §20-ت: uinput — ثوابت ioctl الأربعة (UI_SET_EVBIT/KEYBIT/ABSBIT/PROPBIT)",
      uinRs20.includes("UI_SET_EVBIT: libc::c_ulong = 0x40045564") && uinRs20.includes("UI_SET_KEYBIT: libc::c_ulong = 0x40045565")
      && uinRs20.includes("UI_SET_ABSBIT: libc::c_ulong = 0x40045566") && uinRs20.includes("UI_SET_PROPBIT: libc::c_ulong = 0x4004556e"),
      "tablet_uinput ioctl")
    check("R4 §20-ت: uinput — نطاقات الديجيتايزر (X/Y 32767 · PRESSURE 2047 · TILT ±127) + INPUT_PROP_DIRECT",
      uinRs20.includes("32767") && uinRs20.includes("2047") && uinRs20.includes("127") && uinRs20.includes("INPUT_PROP_DIRECT"),
      "tablet_uinput ranges")
    check("R4 §20-ت: uinput — أدوات HID كاملة (BTN_TOOL_PEN/RUBBER/TOUCH/STYLUS) + UI_DEV_CREATE",
      uinRs20.includes("BTN_TOOL_PEN") && uinRs20.includes("BTN_TOOL_RUBBER") && uinRs20.includes("BTN_TOOL_TOUCH")
      && uinRs20.includes("BTN_STYLUS") && uinRs20.includes("UI_DEV_CREATE"), "tablet_uinput tools")
    check("R4 §20-ت: تحويل نقية — map_sample/build_setup (نقية قابلة للاختبار بلا /dev/uinput)",
      uinRs20.includes("pub fn map_sample") && uinRs20.includes("fn build_setup"), "tablet_uinput pure")
    check("R4 §20-ت: consume_pen ببوابة الجلسة §13 والتوفر (!is_active || !engine_available → تدهور رشيق)",
      tabRs20.includes("pub fn consume_pen") && tabRs20.includes("crate::input::is_active() || !engine_available()"), "tablet.rs gate")
    check("R4 §20-ت: رفض راحة اليد أصليًا — الإصبع (tool==\"finger\") لا يُحقن فرشاةً",
      execRs20.includes('tool == "finger"'), "input_exec finger reject")
    check("R4 §20-ت: قيد ويندوز/ماك بتحقق المصدر (vigem-client = يد ألعاب · vmulti آخر دفع 2016) موثق في الكود",
      tabRs20.includes("vigem-client") && tabRs20.includes("vmulti") && tabRs20.includes("2016"), "tablet.rs limits")
    check("R4 §20-ت: العقد §20 — bits1-2 + تكميم 2..64 + vigem/vmulti + امتداد توافق أمامي",
      contract.includes("## 20.") && contract.includes("bits1-2") && contract.includes("2..64") && contract.includes("vmulti"),
      "contract §20")
    check("R4 §20-ت: التقاط خام — PlatformDispatcher.onPointerDataPacket (كل عينة للمحرك قبل التجميع الإطاري)",
      tabDart20.includes("onPointerDataPacket"), "tablet_screen raw capture")
    check("R4 §20-ت: تجميع ذكي PenSampler (hover الأحدث-يغلب + تلامس بالترتيب + إزالة مكرر مكمم)",
      tabDart20.includes("class PenSampler") && tabDart20.includes("latest-wins"), "tablet_screen sampler")
    check("R4 §20-ت: رفض راحة اليد في الشاشة (_palmRejection — الأصبع يُرفض + جهاز واحد نشط)",
      tabDart20.includes("_palmRejection") && tabDart20.includes("if (_palmRejection) continue"), "tablet_screen palm")
    check("R4 §20-ت: معاينة محلية فورية بسماكة الضغط (RepaintBoundary + سقف رسم 80fps)",
      tabDart20.includes("RepaintBoundary") && tabDart20.includes("80"), "tablet_screen preview")
    check("R4 §20-ت: live.rs يوجه القلم للمستهلك (consume_pen بالأداة) — بلا مسار حقن موازٍ",
      liveRs20.includes("crate::tablet::consume_pen(nx, ny, pressure, tilt_x, tilt_y, phase, buttons, tool)"), "live.rs pen")
    check("R4 §20-ت: ورقة الفرشاة من الكمبيوتر (الحالة مصدر الحقيقة — decKey/incKey/levels/modifier الافتراضية)",
      tabDart20.includes("brush['decKey'] ?? '['") && tabDart20.includes("brush['levels'] as num?) ?? 24")
        && tabDart20.includes("rc:tablet:cmd"),
      "tablet_screen brush sheet")
    check("R4 §20-ت: القاموسان tablet.* (ar/en) — لوحة الرسم/رفض راحة اليد/Palm rejection/المستويات",
      ar20.includes("لوحة الرسم") && ar20.includes("رفض راحة اليد") && en20.includes("Palm rejection") && en20.includes("Levels"),
      "i18n §20")
    const cl20 = await fsMod.readFile("docs/e2e-checklist.md", "utf8").catch(() => "")
    check("R4 §20-ت: القائمة الميدانية §14 (Krita + ممحاة + عجلة التمرير + راحة اليد + كمون <25ms)",
      cl20.includes("## 14. الجولة 4 مرحلة ②") && cl20.includes("اقلب القلم") && cl20.includes("عجلة التمرير")
      && cl20.includes("لا خطوط شاردة"), "e2e-checklist §14")
    const tvRs20 = await fsMod.readFile("scripts/tablet-verify/src/main.rs", "utf8").catch(() => "")
    check("R4 §20-ت: محرك tablet-verify يقيس uinput الفعلي (ABS_PRESSURE=2047 + ضغط 0.5→1024 + hover صفر)",
      tvRs20.includes("ABS_PRESSURE]=2047") && tvRs20.includes("ضغط 0.5→1024") && tvRs20.includes("hover: الضغط صفر"),
      "tablet-verify pressure")
    check("R4 §20-ت: النواة تحمل الضغط للمحلّق (pen → kind=pointer + pressure محمولة) — أساس محرك الفرشاة",
      coreRs20.includes("pressure محمولة") || coreRs20.includes("pressure"), "live_core pressure carry")
  }

'''

insert_before("  // R4 مرحلة ③ (عقد §21) — ثلاثية التحكم المتقدم: جيمباد الحساسات", BLOCK_20, "20")

io.open(P, "w", encoding="utf-8").write(s)
print("patch-a: blocks §18-ت/§19-ت/§20-ت inserted")

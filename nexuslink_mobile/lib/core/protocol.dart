/// ثوابت بروتوكول Nexus — مستخرجة حرفيًا من السيرفر
/// (المرجع: docs/protocol-contract.md — المصدر الوحيد للحقيقة).
class NexusPorts {
  static const int rest = 3000;
  static const int comms = 3003; // جسر الاتصالات (إشعارات/SMS/مكالمات)
  static const int remote = 3004; // جسر التحكم عن بُعد
  static const int media = 3005; // الوسائط والكاميرا (WebRTC)
  static const int guard = 3006; // الحماية: منارة القرب + أوامر الجهاز
  static const int prod = 3007; // الإنتاجية: الحافظة الموحدة/التسليم
  static const int sec = 3009; // قناة E2E المشفرة
  static const int liveUdp = 3010; // الجولة 4 — NexusLive: قناة الإدخال الحي (UDP)
  static const int liveSink = 3011; // حوض Rust على loopback حصرًا (داخلي بالكمبيوتر)
  static const int gateway = 81; // بوابة Caddy: ?XTransformPort=<port>
}

/// أحداث جسر الحماية 3006 — القناة الدائمة للوكيل (Foreground Service).
class GuardEvents {
  static const String helloPhone = 'guard:hello-phone';
  static const String beacon = 'prox:beacon';
  static const String proxState = 'prox:state';
  static const String devState = 'dev:state';
  static const String devAcked = 'dev:acked';
  static const String devLog = 'dev:log';

  // أوامر الكمبيوتر → الهاتف (تُستمع الآن، تُنفَّذ بالتدريج في المراحل التالية)
  static const String devRing = 'dev:ring';
  static const String devRingStop = 'dev:ring-stop';
  static const String devLight = 'dev:light';
  static const String devLost = 'dev:lost';
  static const String devLostOff = 'dev:lost-off';
  static const String devWipe = 'dev:wipe';
  static const String devAlarm = 'dev:alarm';
  static const String devQs = 'dev:qs';
  static const String devApp = 'dev:app';

  // أحداث نقل الملفات الحقيقية على نفس القناة الدائمة (عقد §8):
  // السيرفر → الهاتف: عرض ملف قادم + أوامر تحكم من الكمبيوتر
  // الهاتف → السيرفر: قرار القبول/الرفض + تقدم + حالة
  static const String txOffer = 'tx:offer';
  static const String txAccept = 'tx:accept';
  static const String txReject = 'tx:reject';
  static const String txProgress = 'tx:progress';
  static const String txState = 'tx:state';
  static const String txPause = 'tx:pause';
  static const String txResume = 'tx:resume';
  static const String txCancel = 'tx:cancel';
}

/// أحداث التحكم باللمس والحقن (عقد §4.8 — FA-7 بديل AirMirror) على قناة 3006.
/// أوامر الويب تصل الهاتف مباشرة عبر الجسر (بلا بث)، وتُنفَّذ فقط خلال جلسة نشطة.
class CtlEvents {
  // الجلسة
  static const String ctlStart = 'dev:ctl-start'; // ويب → هاتف (مباشر)
  static const String ctlStop = 'dev:ctl-stop'; // ويب → هاتف (مباشر)
  static const String ctlState = 'dev:ctl-state'; // هاتف → ويب (بث)

  // الإدخال (يُنفَّذ فقط إذا كانت الجلسة نشطة)
  static const String touch = 'dev:touch';
  static const String text = 'dev:text';
  static const String key = 'dev:key';

  // تقارير الهاتف
  static const String touchAck = 'dev:touch-ack';
  static const String screen = 'dev:screen'; // أبعاد الشاشة الحقيقية
}

/// الجولة 5 (عقد §24) — التحكم بهاتف من هاتف آخر عبر المركز (هاتف→هاتف).
/// نفس بروتوكول FA-7 حرفيًا بعد التوجيه: الهاتف أ يطلب [ctlStart]/يقطع [ctlStop]
/// ثم يستقبل [ctlState]/[touchAck]/[rejected] الموجهة إليه، ويرسل [touch]/[text]/[key]
/// بنفس أسماء أحداث الويب — فكل تنفيذ على الهاتف ب يبقى كما هو حرفيًا.
/// [agentsList] بث قائمة الهواتف الوكيلة الحية للاختيار، و[screenInfo] بث
/// أبعاد شاشة أي وكيل (موسومة بـ deviceId — يُفلتر بمعرف الهدف).
class P2pEvents {
  // إرسال من الهاتف أ
  static const String ctlStart = 'p2p:ctl-start'; // {from, target, name?}
  static const String ctlStop = 'p2p:ctl-stop'; // {target}

  // استقبال على الهاتف أ (توجيه مستهدف من الجسر)
  static const String ctlState = 'dev:ctl-state'; // {active, controller, target?, reason?}
  static const String touchAck = 'dev:touch-ack';
  static const String rejected = 'p2p:ctl-rejected'; // {reason, from, target}
  static const String agentsList = 'guard:agents'; // {agents:[{deviceId,name}], sessions}

  // إرسال الإدخال (أسماء أحداث الويب نفسها — التوجيه حسب الجلسة الموثقة)
  static const String touch = 'dev:touch';
  static const String text = 'dev:text';
  static const String key = 'dev:key';
  static const String screenInfo = 'guard:screen'; // {w,h,density,deviceId}

  /// أسباب الرفض من الجسر (p2p:ctl-rejected.reason).
  static const reasons = {
    'identity': 'identity',
    'untrusted': 'untrusted',
    'target-untrusted': 'target-untrusted',
    'self': 'self',
    'target-offline': 'target-offline',
    'target-busy': 'target-busy',
    'already-controlling': 'already-controlling',
    'no-session': 'no-session',
  };
}

/// أحداث جسر الوسائط 3005 (عقد §4.3 + إضافات FA-8) — كاميرا/ميكروفون/مراقبة.
class MediaEvents {
  static const String role = 'media:role'; // تسجيل role=phone
  static const String hello = 'media:hello';
  static const String roleAck = 'media:role-ack';
  static const String phoneOnline = 'media:phone-online';
  static const String log = 'media:log';

  // إشارات WebRTC — الهاتف صاحب الوسائط ينشئ offer، الكمبيوتر يجيب answer
  static const String rtcOffer = 'rtc:offer';
  static const String rtcAnswer = 'rtc:answer';
  static const String rtcIce = 'rtc:ice';

  // حالة الكاميرا + مصراع + أوامر الوسائط
  static const String camState = 'cam:state';
  static const String camShutter = 'cam:shutter'; // {timer, flash, camera}
  static const String camCaptured = 'cam:captured'; // {name, device}
  static const String camCmd = 'cam:cmd'; // {action, camera?, on?, sensitivity?}

  // تنبيهات المراقبة
  static const String secMotion = 'sec:motion'; // {source, level}
  static const String babyAlert = 'baby:alert'; // {from, level}

  // المستشعرات (FA-8) — للويب كجيمباد لاحقًا
  static const String sensorStream = 'sensor:stream'; // {a?, g?, ts}

  // FA-media (عقد §15) — عرض شاشة الكمبيوتر على الهاتف:
  // screen:req/stop/set من الهاتف (تنقية الجسر: fps 15..60 + quality low..ultra)
  // screen:state من الكمبيوتر (on/w/h/fps + error عند الفشل)
  static const String screenReq = 'screen:req';
  static const String screenStop = 'screen:stop';
  static const String screenSet = 'screen:set';
  static const String screenState = 'screen:state';

  // الجولة 5 (عقد §24) — مرآة الهاتف: بث شاشة هاتف لهاتف آخر عبر نفس إشارات
  // rtc:offer/answer/ice بنوع kind='mirror' (الناشر: هاتف ب بـ getDisplayMedia
  // — العارض: هاتف أ يجيب). الكمبيوتر يتجاهل النوع حرفيًا (حارس الويب)،
  // وقاعدة §4.3 سارية: أول إجابة تُقبل لكل جلسة.

  // R4 مرحلة ① (عقد §19) — الشاشة الثانية: الهاتف شاشة ممتدة فعلية
  static const String secondScreenCmd = 'secondscreen:cmd'; // enable|disable {w,h,fps,quality}
  static const String secondScreenState = 'secondscreen:state'; // {active,target,w,h,error}
  static const String phoneOffline = 'media:phone-offline'; // انقطاع الهاتف (إطفاء ذكي على الكمبيوتر)

  // زمن الاستجابة
  static const String ping = 'media:ping';
  static const String pong = 'media:pong';
}

/// أحداث جسر التحكم 3004 (عقد §4.2 + §4.9 FA-9) — الهاتف طرف متحكم بالكمبيوتر.
class RcEvents {
  static const String hello = 'rc:hello'; // {desktop:{name, mac, power}}
  static const String helloController = 'rc:hello-controller'; // {name}
  static const String controllerOnline = 'rc:controller-online';

  // إدخال (بوابة الطاقة سارية على الجسر)
  static const String move = 'rc:move'; // {dx, dy, source?, drag?}
  static const String click = 'rc:click'; // {button: left|right, type: tap|double}
  static const String scroll = 'rc:scroll'; // {dy}
  static const String pinch = 'rc:pinch'; // {scale}
  static const String key = 'rc:key'; // {ch?} أو {special}
  static const String presenter = 'rc:presenter'; // {action: next|prev|start|stop|black} — FA-input §13
  static const String media = 'rc:media'; // {action, value?}
  static const String power = 'rc:power'; // {action}
  static const String wol = 'rc:wol'; // {mac}
  static const String clipboard = 'rc:clipboard'; // {direction: toPc|pull, text?}
  static const String handoff = 'rc:handoff'; // {url, title?} — FA-9
  /// FA-media (عقد §15) — مؤشر مطلق على الشاشة المعروضة في الهاتف:
  /// {nx, ny (0..1 على إطار البث), action: move|down|up|click|dblclick|rclick}
  /// — يُنفّذ مطلقًا في فضاء سطح المكتب المركّب خلال جلسة تحكم موثوقة (§13).
  static const String pointer = 'rc:pointer';

  // FA-input (عقد §13) — دورة حياة جلسة التحكم الموثوقة:
  // إرسال: {action: "start"|"stop", deviceId, name?} · {action: "hb"} نبض 2ث
  // استقبال: {active: true, controller: {deviceId, name}, at} |
  //          {active: false, reason: "phone-stop"|"desktop-stop"|"timeout"|"disconnected", at}
  static const String session = 'rc:session';

  // الجولة 4 (عقد §18) — القناة الحية NexusLive (UDP):
  // إرسال: rc:live-hello (هاتف موثوق + جلسة نشطة) — رد: rc:live-ready
  // {port, key (16-hex), mtu, proto} — إحصاء دوري: rc:live-stats
  static const String liveHello = 'rc:live-hello';
  static const String liveReady = 'rc:live-ready';
  static const String liveStats = 'rc:live-stats';

  // الجولة 4 مرحلة ② (عقد §20) — لوحة الرسم:
  // إرسال: rc:tablet:cmd {cmd: get|set, mode?, pressure?, decKey?, incKey?, levels?, modifier?}
  // استقبال: rc:tablet:state {mode, available, note, brush{...}, stats} — من دور pc حصرًا
  static const String tabletCmd = 'rc:tablet:cmd';
  static const String tabletState = 'rc:tablet:state';

  // الجولة 4 مرحلة ③ (عقد §21) — التحكم المتقدم (جيمباد الحساسات/الماوس
  // الهوائي المعاير/عارض العروض):
  // إرسال: rc:gyro:cmd {cmd: get|set, mode?, template?, deadzoneDeg?, sens?,
  //                     shakeDegS?, tiltDeg?, laser?, calibrate?, keyA?..keyR?}
  // استقبال: rc:gyro:state {mode, template, map{...}, stats, calibrated} — من دور pc حصرًا
  static const String gyroCmd = 'rc:gyro:cmd';
  static const String gyroState = 'rc:gyro:state';

  // استقبال
  static const String desktopClipboard = 'desktop:clipboard'; // {text, at?}
  static const String desktopState = 'desktop:state';
  static const String desktopWake = 'desktop:wake';
  static const String rejected = 'rc:rejected'; // {reason, ev}
  static const String log = 'rc:log';

  static const String ping = 'rc:ping';
  static const String pong = 'rc:pong';
}

/// أحداث جسر الإنتاجية 3007 — النصوص/الروابط السريعة والحافظة الموحدة.
class ProdEvents {
  static const String hello = 'prod:hello';
  static const String log = 'prod:log';
  static const String clipNew = 'clip:new';
  static const String clipClear = 'clip:cleared';
  static const String handNew = 'hand:new';
  static const String handOpened = 'hand:opened';
  static const String photoNew = 'photo:new';
}

/// أحداث جسر الاتصالات 3003 (سيلزمها المرحلة القادمة — محفوظة هنا كعقد).
class CommsEvents {
  static const String hello = 'bridge:hello';
  static const String notifMirror = 'notif:mirror';
  static const String smsIncoming = 'sms:incoming';
  static const String smsStatus = 'sms:status';
  static const String callIncoming = 'call:incoming';
  static const String callState = 'call:state';
  static const String dndState = 'dnd:state';
}

/// حمولة QR الاقتران — يجب أن تطابق src/app/api/devices/qr/route.ts.
class NexusQr {
  static const int version = 1;
  static const String proto = 'Nexus/1.2';
}

/// مهل الاتصال (مللي ثانية).
class Timeouts {
  static const Duration healthCheck = Duration(seconds: 4);
  static const Duration restCall = Duration(seconds: 8);
  static const Duration socketConnect = Duration(seconds: 10);
  static const Duration beaconEvery = Duration(seconds: 5);
  static const Duration stateReportEvery = Duration(seconds: 30);
}

/// ثوابت نقل الملفات — مطابقة لعقد السيرفر (§8).
class TxProtocol {
  /// حجم القطعة الافتراضي للرفع (السيرفر يقبل حتى 8MB).
  static const int uploadChunk = 2 * 1024 * 1024; // 2MB

  /// مجلد الوجهة الافتراضي داخل مرآة الجهاز على السيرفر.
  static const String uploadDir = '/Downloads';

  /// مجلد الاستقبال المحلي على الهاتف (تنشر فيه Kotlin عبر MediaStore).
  static const String recvDirName = 'NexusLink';

  /// مهلة قطعة الرفع الواحدة.
  static const Duration chunkTimeout = Duration(seconds: 30);

  /// إرسال tx:progress مُخفّف (كل هذا القدر أو كل قطعة، أيهما أبطأ).
  static const Duration progressEvery = Duration(milliseconds: 800);
}

/// أحداث قناة الأمان المشفرة 3009 (عقد §4.6 + §9 — FA-10).
/// السوكِت نفسه يعيش في Kotlin (SecChannel) — هذه الثوابت للعرض والتوثيق،
/// والواجهة تستقبل الحالة عبر EventChannel (kind: "sec"/"wipe"/"lost").
class SecEvents {
  static const String hello = 'sec:hello'; // {port, suite, peers, stealth, counters}
  static const String announce = 'sec:announce'; // {role:"phone", deviceId, name, pub, eph}
  static const String pendingTrust = 'sec:pending-trust'; // {alertId, probeId}
  static const String rejected = 'sec:rejected'; // {reason}
  static const String kexPeer = 'kex:peer'; // {deviceId, name, role, pub, eph, sid, epoch?}
  static const String kexUpdate = 'kex:update'; // {eph, epoch}
  static const String peers = 'sec:peers';
  static const String frame = 'sec:frame'; // {to, from, kind, e, iv, ct, seq}
  static const String nack = 'sec:nack'; // {seq, reason}
  static const String lockCmd = 'sec:lock-cmd'; // بث: قفل التطبيق (احتياطي غير مشفر)
  static const String lostCmd = 'sec:lost-cmd'; // بث: وضع الفقدان {message, locate}
  static const String wipeCmd = 'sec:wipe-cmd'; // بث: مسح آمن {passes}
  static const String lockState = 'sec:lock-state'; // من الهاتف: {deviceId, locked, lost, ...}
  static const String wipeState = 'sec:wipe-state'; // من الهاتف: {ok, count, bytes}
  static const String audit = 'sec:audit'; // {actor, action, detail, severity}
  static const String permSet = 'sec:perm-set'; // {feature, deviceId, enabled}
  static const String permGet = 'sec:perm-get';
  static const String permRules = 'perm:rules';

  /// أنواع الإطارات المشفرة (بعد الفك في Kotlin/الويب).
  static const List<String> frameKinds = ['cmd', 'ack', 'perm-denied', 'clip', 'lost-state', 'file-meta', 'file-chunk', 'file-end'];

  /// ميزات الصلاحيات العشر — نفس قائمة العقد §4.6.
  static const List<String> features = [
    'file_transfer', 'clipboard', 'notifications', 'remote_input', 'media',
    'camera', 'microphone', 'system_commands', 'contacts', 'screen_mirror',
  ];
}

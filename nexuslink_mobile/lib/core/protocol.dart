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

import 'dart:io';

/// FA-power (عقد §12) — إرسال حزمة Wake-on-LAN السحرية مباشرة عبر UDP broadcast.
///
/// «الكمبيوتر نائم → من الهاتف ضغطة إيقاظ»: عندما يصبح السيرفر غير قابل
/// للوصول (الكمبيوتر نائم/مطفأ) ترسل الحزمة من الهاتف مباشرة — بلا أي
/// اتصال مسبق بالسيرفر. 102 بايت = 6×FF + MAC×16 (عنوان MAC الكمبيوتر
/// المعلن منه عند كل اتصال سابق عبر desktop:register/rc:hello).
class WolService {
  WolService._();

  /// المنفذ التعاقدي للحزم السحرية (Discard/WoL القياسي)
  static const int wolPort = 9;

  /// يرسل الحزمة إلى 255.255.255.255:9 + broadcast الشبكة الفرعية للخادم
  /// (إن توفر) [attempts] مرات، ويعيد عدد الإرسالات الناجحة (0 = فشل كلي).
  static Future<int> sendMagicPacket(
    String mac, {
    List<String> extraTargets = const [],
    int attempts = 3,
  }) async {
    final norm = normalizeMac(mac);
    if (norm == null) return 0;
    final bytes = packet(norm);
    final targets = <String>{'255.255.255.255', ...extraTargets.where((t) => t.isNotEmpty)}.toList();
    RawDatagramSocket? sock;
    var sent = 0;
    try {
      sock = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0, reuseAddress: true);
      sock.broadcastEnabled = true;
      for (var i = 0; i < attempts; i++) {
        for (final t in targets) {
          try {
            final n = sock.send(bytes, InternetAddress(t), wolPort);
            if (n == bytes.length) sent++;
          } catch (_) {
            // وجهة واحدة مرفوضة لا تُسقط البقية
          }
        }
        if (i < attempts - 1) {
          await Future<void>.delayed(const Duration(milliseconds: 120));
        }
      }
    } catch (_) {
      // بلا شبكة/رفض أذونات — يعيد العدد الحالي (غالبًا 0)
    } finally {
      try {
        sock?.close();
      } catch (_) {}
    }
    return sent;
  }

  /// الحزمة السحرية: 6 بايتات FF ثم عنوان MAC مكرر 16 مرة (102 بايت)
  static List<int> packet(String normalizedMac) {
    final macBytes = normalizedMac
        .split(':')
        .map((h) => int.parse(h, radix: 16))
        .toList(growable: false);
    final out = <int>[for (var i = 0; i < 6; i++) 0xFF];
    for (var r = 0; r < 16; r++) {
      out.addAll(macBytes);
    }
    return out;
  }

  /// تطبيع MAC (شرطات → نقطتان، أحرف كبيرة) أو null إن كان غير صالح
  static String? normalizeMac(String raw) {
    final up = raw.trim().toUpperCase().replaceAll('-', ':');
    if (!RegExp(r'^([0-9A-F]{2}:){5}[0-9A-F]{2}$').hasMatch(up)) return null;
    return up;
  }

  /// broadcast الشبكة الفرعية من IP الخادم المحفوظ (192.168.1.2 → 192.168.1.255)
  /// — وجهة إضافية أضمن وصولًا من 255.255.255.255 على بعض الراوترات.
  static String? subnetBroadcast(String? host) {
    final h = host?.trim() ?? '';
    if (!RegExp(r'^\d{1,3}(\.\d{1,3}){3}$').hasMatch(h)) return null;
    final p = h.split('.');
    return '${p[0]}.${p[1]}.${p[2]}.255';
  }
}

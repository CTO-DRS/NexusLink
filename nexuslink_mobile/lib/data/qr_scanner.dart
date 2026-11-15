import 'package:flutter/services.dart';

/// G3 — مسح QR الاقتران محليًا بلا أي SDK سحابي.
///
/// كان المسح عبر mobile_scanner (يعتمد Google ML Kit + مكونات Firebase على
/// أندرويد). الآن الماسح أصلي: ZXing (zxing-android-embedded + com.google.zxing:core)
/// — مكتبة Java مفتوحة المصدر تعمل كليًا على الجهاز، بلا Google Play Services،
/// بلا نماذج تُنزَّل، وبلا أي اتصال شبكي. الاستدعاء عبر القناة الموجودة
/// "nexuslink/agent" (الأسلوب scanQr في MainActivity.kt).
class QrScanner {
  static const MethodChannel _ch = MethodChannel('nexuslink/agent');

  /// يفتح شاشة الكاميرا الأصلية ويعيد نص رمز QR، أو null عند الإلغاء/الفشل
  /// (رفض إذن الكاميرا، بيئة بلا أندرويد…).
  static Future<String?> scan({String? prompt}) async {
    try {
      return await _ch.invokeMethod<String>('scanQr', {'prompt': prompt ?? ''});
    } on MissingPluginException {
      return null;
    } on PlatformException {
      return null;
    }
  }
}

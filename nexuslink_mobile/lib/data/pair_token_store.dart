import 'package:shared_preferences/shared_preferences.dart';

/// G1 — تخزين رمز اقتران البوابة لكل خادم (مفتاح host:port).
///
/// الرمز يصل مرة واحدة في QR الاقتران (payload.pair) ويُعاد استعماله في كل
/// اتصال لاحق بنفس الخادم (إعادة الاتصال، الاكتشاف، الإقلاع التلقائي).
/// التخزين داخل مساحة التطبيق الخاصة (SharedPreferences) — نفس مستوى حماية
/// إعدادات الخدمة الأصلية `nexus_agent` التي تحمل الرمز للإقلاع التلقائي.
class PairTokenStore {
  static String _k(String serverKey) => 'nexus.pairToken.$serverKey';

  static Future<String?> load(String serverKey) async {
    final p = await SharedPreferences.getInstance();
    final v = p.getString(_k(serverKey));
    return (v == null || v.isEmpty) ? null : v;
  }

  static Future<void> save(String serverKey, String token) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_k(serverKey), token);
  }

  static Future<void> forget(String serverKey) async {
    final p = await SharedPreferences.getInstance();
    await p.remove(_k(serverKey));
  }
}

/// P1 — هوية الكمبيوتر الثابتة (pcId) لكل خادم (مفتاح host:port).
/// تُحفظ بعد اقتران ناجح من /__gw/health، وتُستعمل لإيجاد الكمبيوتر عبر المنارة
/// إذا تغيّر عنوانه (docs/protocol-contract.md §44).
class PcIdStore {
  static String _k(String serverKey) => 'nexus.pcId.$serverKey';

  static Future<String?> load(String serverKey) async {
    final p = await SharedPreferences.getInstance();
    final v = p.getString(_k(serverKey));
    return (v == null || v.isEmpty) ? null : v;
  }

  static Future<void> save(String serverKey, String pcId) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_k(serverKey), pcId);
  }

  static Future<void> forget(String serverKey) async {
    final p = await SharedPreferences.getInstance();
    await p.remove(_k(serverKey));
  }
}

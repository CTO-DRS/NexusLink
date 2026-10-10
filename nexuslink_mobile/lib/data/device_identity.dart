import 'package:flutter/services.dart';

/// هوية الجهاز على الشبكة — تُقرأ من الطبقة الأصلية (Kotlin) عبر MethodChannel.
/// المعرّف الثابت: Settings.Secure.ANDROID_ID (لا صلاحيات، ثابت لكل تطبيق/جهاز).
class DeviceIdentity {
  final String stableId;
  final String name; // مثل: "samsung SM-S928B"
  final String model;
  final String manufacturer;
  final String os; // مثل: "Android 15 (SDK 35)"
  final int battery;

  const DeviceIdentity({
    required this.stableId,
    required this.name,
    required this.model,
    required this.manufacturer,
    required this.os,
    required this.battery,
  });

  static const MethodChannel _ch = MethodChannel('nexuslink/agent');

  static Future<DeviceIdentity> load() async {
    try {
      final raw = await _ch.invokeMethod<Map<Object?, Object?>>('deviceInfo');
      final m = raw?.cast<String, dynamic>() ?? const {};
      final model = '${m['model'] ?? 'Android'}';
      final manufacturer = '${m['manufacturer'] ?? ''}'.trim();
      final name = ('${m['deviceName'] ?? ''}'.trim().isNotEmpty)
          ? '${m['deviceName']}'
          : (manufacturer.isEmpty ? model : '$manufacturer $model');
      return DeviceIdentity(
        stableId: '${m['androidId'] ?? ''}',
        name: name,
        model: model,
        manufacturer: manufacturer,
        os: '${m['os'] ?? 'Android'}',
        battery: (m['battery'] as num?)?.toInt() ?? 100,
      );
    } on PlatformException {
      // محاكي/منصة بلا قناة أصلية — هوية تقديرية (للتطوير فقط)
      return const DeviceIdentity(
        stableId: 'dev-fallback-0001',
        name: 'Nexus Android (dev)',
        model: 'Generic',
        manufacturer: '',
        os: 'Android (dev)',
        battery: 100,
      );
    } on MissingPluginException {
      return const DeviceIdentity(
        stableId: 'dev-fallback-0001',
        name: 'Nexus Android (dev)',
        model: 'Generic',
        manufacturer: '',
        os: 'Android (dev)',
        battery: 100,
      );
    }
  }
}

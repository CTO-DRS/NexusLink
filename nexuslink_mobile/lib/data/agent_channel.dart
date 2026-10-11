import 'dart:convert';

import 'package:flutter/services.dart';

import '../domain/models.dart';

/// جسر إلى الخدمة الخلفية الأصلية (Kotlin Foreground Service):
/// - بدء/إيقاف الوكيل الذي يحمل اتصال socket.io الدائم (جسر الحماية 3006).
/// - EventChannel يبث تغيّرات الحالة (online/offline/reconnecting…) للواجهة.
class AgentChannel {
  static const MethodChannel _ch = MethodChannel('nexuslink/agent');
  static const EventChannel _events = EventChannel('nexuslink/agent/events');

  /// أحداث الحالة (Stream بلا انقطاع؛ أعد الاستماع عند فتح الواجهة).
  Stream<AgentEvent> get events => _events
      .receiveBroadcastStream()
      .map((e) => AgentEvent.tryParse((e as Map?)?.cast<Object?, Object?>() ?? const {}))
      .where((e) => e != null)
      .map((e) => e!);

  /// كل الأحداث الخام من الخدمة الأصلية (حالات + نقل tx + صور + مشاركة).
  /// كل عنصر: {kind: 'state'|'tx'|'photos'|'share', ...}
  Stream<Map<Object?, Object?>> get rawEvents => _events
      .receiveBroadcastStream()
      .map((e) => (e as Map?)?.cast<Object?, Object?>() ?? const <Object?, Object?>{})
      .where((m) => m.isNotEmpty);

  /// بدء الوكيل الخلفي. القيم تُمرَّر كما هي إلى الـ Intent Extras.
  Future<bool> start({
    required ServerEndpoint endpoint,
    required int bridgePort, // 3006 حاليًا (جسر الحماية = قناة الحضور)
    required String deviceId,
    required String deviceName,
  }) async {
    try {
      final ok = await _ch.invokeMethod<bool>('startAgent', {
        'host': endpoint.host,
        'port': endpoint.port,
        'mode': endpoint.mode.name,
        'bridgePort': bridgePort,
        'deviceId': deviceId,
        'deviceName': deviceName,
        'serverKey': endpoint.key,
      });
      return ok ?? false;
    } on PlatformException catch (e) {
      throw AgentChannelException('تعذّر بدء الخدمة الخلفية: ${e.message ?? e.code}');
    } on MissingPluginException {
      throw AgentChannelException('القناة الأصلية غير متاحة في هذه البيئة (محرر/محاكي بلا أندرويد)');
    }
  }

  Future<void> stop() async {
    try {
      await _ch.invokeMethod('stopAgent');
    } catch (_) {/* لا شيء */}
  }

  // ==================== FA-10: الأمان ====================

  /// PBKDF2-SHA256 150k — عبر Kotlin (مطابق صيغة الويب بايتًا ببايت).
  Future<Map<String, dynamic>> pbkdf2Hash(String secret, {String? saltB64}) async {
    try {
      final r = await _ch.invokeMethod<Map<Object?, Object?>>('pbkdf2Hash', {
        'secret': secret,
        'saltB64': saltB64,
      });
      return (r ?? const {}).cast<String, Object?>().map((k, v) => MapEntry(k, v ?? ''));
    } catch (_) {
      return const {};
    }
  }

  Future<bool> pbkdf2Verify(String secret, String salt, String hash) async {
    try {
      return await _ch.invokeMethod<bool>('pbkdf2Verify', {
            'secret': secret,
            'salt': salt,
            'hash': hash,
          }) ??
          false;
    } catch (_) {
      return false;
    }
  }

  /// لقطة قناة الأمان (online/kex/sas/fingerprint/lost).
  Future<Map<String, dynamic>> secSnapshot() async {
    try {
      final r = await _ch.invokeMethod<Map<Object?, Object?>>('secSnapshot');
      return (r ?? const {}).cast<String, Object?>().map((k, v) => MapEntry(k, v ?? ''));
    } catch (_) {
      return const {};
    }
  }

  /// الملفات المستلمة (Download/NexusLink) — {name, size}.
  Future<List<Map<String, dynamic>>> secListFiles() async {
    try {
      final r = await _ch.invokeMethod<Map<Object?, Object?>>('secListFiles');
      final files = (r?['files'] as List?) ?? const [];
      return files
          .whereType<Map>()
          .map((f) => <String, dynamic>{
                'name': '${f['name'] ?? ''}',
                'size': (f['size'] as num?)?.toInt() ?? 0,
              })
          .toList();
    } catch (_) {
      return const [];
    }
  }

  /// حذف آمن بتمريرات (3 أو 7) — من الزر أو أمر السيرفر.
  Future<bool> secWipe(int passes) async {
    try {
      return await _ch.invokeMethod<bool>('secWipe', {'passes': passes}) ?? false;
    } catch (_) {
      return false;
    }
  }

  /// قفل فوري للتطبيق (زر الواجهة).
  Future<void> secLockNow() async {
    try {
      await _ch.invokeMethod('secLockNow');
    } catch (_) {}
  }

  Future<void> secUnlock() async {
    try {
      await _ch.invokeMethod('secUnlock');
    } catch (_) {}
  }

  /// إلغاء وضع الفقدان من الواجهة.
  Future<void> lostStop() async {
    try {
      await _ch.invokeMethod('lostStop');
    } catch (_) {}
  }

  /// تكوين القفل: تُقرأ من الخدمة في sec:lock-state.
  Future<void> setLockConfig({required bool hasPin, required bool hasBiometric, required int autoLockSec}) async {
    try {
      await _ch.invokeMethod('setLockConfig', {
        'hasPin': hasPin,
        'hasBiometric': hasBiometric,
        'autoLockSec': autoLockSec,
      });
    } catch (_) {}
  }

  /// حالة قفل الواجهة من Dart (تُبَث للويب عبر sec:lock-state).
  Future<void> setLocked(bool locked) async {
    try {
      await _ch.invokeMethod('setLocked', {'locked': locked});
    } catch (_) {}
  }

  /// الإقلاع التلقائي مع النظام (BootReceiver).
  Future<void> setAutoStart(bool on) async {
    try {
      await _ch.invokeMethod('setAutoStart', {'on': on});
    } catch (_) {}
  }

  /// مفتاح ميزة في لوحة الأذونات (تقرأه بوابة الأوامر في Kotlin).
  Future<void> setSecFeature(String feature, bool enabled) async {
    try {
      await _ch.invokeMethod('setSecFeature', {'feature': feature, 'enabled': enabled});
    } catch (_) {}
  }

  /// آخر حالة معروفة داخل الخدمة (للمزامنة عند إعادة فتح الواجهة).
  Future<String> lastState() async {
    try {
      return await _ch.invokeMethod<String>('lastState') ?? 'stopped';
    } catch (_) {
      return 'stopped';
    }
  }

  /// فك JSON من تفاصيل الحدث (إن وُجدت) — أداة مساعدة للسجل.
  static Map<String, dynamic>? decodeDetail(Object? raw) {
    try {
      if (raw is Map) return raw.cast<String, dynamic>();
      if (raw is String) return Map<String, dynamic>.from(jsonDecode(raw));
    } catch (_) {}
    return null;
  }
}

class AgentChannelException implements Exception {
  final String message;
  AgentChannelException(this.message);
  @override
  String toString() => message;
}

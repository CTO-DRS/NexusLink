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

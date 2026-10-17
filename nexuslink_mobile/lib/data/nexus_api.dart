import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/protocol.dart';
import '../domain/models.dart';

/// عميل REST لسيرفر NexusLink — يطابق أشكال /api/* في السيرفر حرفيًا.
class NexusApi {
  final ServerEndpoint endpoint;
  final http.Client _client = http.Client();

  NexusApi(this.endpoint);

  /// فحص الصحة: GET /api/tools/ping — يقيس RTT فعليًا.
  /// يرمي [HealthException] عند الفشل.
  Future<int> healthCheck() async {
    final sw = Stopwatch()..start();
    try {
      final res = await _client
          .get(endpoint.api('tools/ping'), headers: {'Accept': 'application/json'})
          .timeout(Timeouts.healthCheck);
      sw.stop();
      if (res.statusCode != 200) {
        throw HealthException('HTTP ${res.statusCode}');
      }
      final j = jsonDecode(res.body);
      if (j is! Map || j['pong'] != true) {
        throw HealthException('مصابيح خاطئة في ping');
      }
      return sw.elapsedMilliseconds;
    } on TimeoutException {
      throw HealthException('انتهت مهلة الفحص');
    } catch (e) {
      if (e is HealthException) rethrow;
      throw HealthException('$e');
    }
  }

  /// تسجيل الجهاز: POST /api/devices {action:"pair", …}
  /// الحقول مطابقة لما يقبلها السيرفر (بعد إصلاح الحقول الاختيارية للوكيل).
  /// [secret] = سر آخر رمز QR مُصدَر (G-1 عقد §6): الاقتران يُرفض 403 بدونه،
  /// ويأتي من مسح الكاميرا أو — للإدخال اليدوي — من جلب /api/devices/qr (عقد §7).
  Future<NexusDevice> pair({
    required String stableId,
    required String deviceName,
    required String model,
    required String os,
    required int battery,
    required int storageTotal,
    required int storageUsed,
    required String ip,
    String? secret,
  }) async {
    final body = jsonEncode({
      'action': 'pair',
      'id': stableId,
      'name': deviceName,
      'kind': 'phone',
      'model': model,
      'os': os,
      'battery': battery,
      'storageTotal': storageTotal,
      'storageUsed': storageUsed,
      'ip': ip,
      if (secret != null) 'secret': secret,
    });
    final res = await _client
        .post(
          endpoint.api('devices'),
          headers: {'Content-Type': 'application/json'},
          body: body,
        )
        .timeout(Timeouts.restCall);
    if (res.statusCode == 403) {
      // G-1 — رفض مسبب من السيرفر: reason ∈ {no-window, missing, expired, invalid}
      final j = jsonDecode(res.body);
      final reason = (j is Map ? j['reason'] : null) ?? 'unknown';
      final err = (j is Map ? j['error'] : null) ?? 'رُفض الاقتران';
      throw PairingRejectedException(reason: '$reason', serverMessage: '$err');
    }
    if (res.statusCode != 200) {
      throw ApiException('pair رفضه السيرفر: HTTP ${res.statusCode}');
    }
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    if (j['ok'] != true || j['device'] is! Map) {
      throw ApiException('استجابة pair غير متوقعة');
    }
    return NexusDevice.fromJson((j['device'] as Map).cast<String, dynamic>());
  }

  /// قائمة الأجهزة: GET /api/devices → {devices:[…]}
  Future<List<NexusDevice>> devices() async {
    final res = await _client
        .get(endpoint.api('devices'), headers: {'Accept': 'application/json'})
        .timeout(Timeouts.restCall);
    if (res.statusCode != 200) throw ApiException('devices: HTTP ${res.statusCode}');
    final j = jsonDecode(res.body);
    final list = (j is Map ? j['devices'] : null) as List?;
    return (list ?? const [])
        .whereType<Map>()
        .map((m) => NexusDevice.fromJson(m.cast<String, dynamic>()))
        .toList();
  }

  /// حمولة QR الحالية (تُستخدم للعرض/التصحيح اليدوي — المسح يقرأ الصورة نفسها).
  Future<({String code, Map<String, dynamic> payload})> pairingQr() async {
    final res = await _client
        .get(endpoint.api('devices/qr'))
        .timeout(Timeouts.restCall);
    if (res.statusCode != 200) throw ApiException('devices/qr: HTTP ${res.statusCode}');
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    return (
      code: '${j['code'] ?? ''}',
      payload: (j['payload'] as Map?)?.cast<String, dynamic>() ?? const {},
    );
  }

  void close() => _client.close();
}

class HealthException implements Exception {
  final String message;
  HealthException(this.message);
  @override
  String toString() => message;
}

class ApiException implements Exception {
  final String message;
  ApiException(this.message);
  @override
  String toString() => message;
}

/// G-1 (عقد §6) — رفض الاقتران بسبب فشل تحقق سر QR.
/// reason ∈ {no-window, missing, expired, invalid} — يعرض للمستخدم [serverMessage].
class PairingRejectedException implements Exception {
  final String reason;
  final String serverMessage;
  PairingRejectedException({required this.reason, required this.serverMessage});
  @override
  String toString() => serverMessage;
}

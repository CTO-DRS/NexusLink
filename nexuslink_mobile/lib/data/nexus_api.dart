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

  /// قياس الاقتران الفوري (عقد §30 — M1.1): GET /api/pair-metrics —
  /// بيانات وصفية حصرًا (أرقام وأزمنة — لا محتوى).
  Future<PairMetricsStats> pairMetrics() async {
    final res = await _client
        .get(endpoint.api('pair-metrics'), headers: {'Accept': 'application/json'})
        .timeout(Timeouts.restCall);
    if (res.statusCode != 200) throw ApiException('pair-metrics: HTTP ${res.statusCode}');
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    final stats = (j['stats'] as Map?)?.cast<String, dynamic>() ?? const {};
    return PairMetricsStats.fromJson(stats);
  }

  // ===========================================================================
  // §53 — التسليم اليدوي الذكي (SMART-HANDOFF): دفع من الهاتف إلى حاسوب المالك
  // ---------------------------------------------------------------------------
  // POST /api/handoff {action:'push', kind, payload, sourceDevice, note}
  // الأسباب المغلقة مطابقة للسيرفر حرفيًا: unknown-kind · empty-payload ·
  // url-too-long (2048) · url-scheme (http/https حصرًا) · url-no-host ·
  // text-too-long (8192) · rate-limited (429).
  // ===========================================================================

  /// دفع رابط أو نص إلى قائمة التسليم على الكمبيوتر — يظهر في جرس الشريط العلوي.
  /// يرمي [ApiException] برمز السبب الحرفي من السيرفر عند الرفض.
  Future<void> handoffPush({
    required String kind, // 'url' | 'text'
    required String payload,
    String? note,
    String? sourceDevice,
  }) async {
    const urlMax = 2048;
    const textMax = 8192;
    // تحقق محلي مرآة للسيرفر — رسالة أسرع وبلا رحلة شبكة عبثية
    if (kind != 'url' && kind != 'text') throw ApiException('unknown-kind');
    if (payload.trim().isEmpty) throw ApiException('empty-payload');
    if (kind == 'url') {
      if (payload.length > urlMax) throw ApiException('url-too-long');
      final u = Uri.tryParse(payload);
      if (u == null || (u.scheme != 'http' && u.scheme != 'https')) {
        throw ApiException('url-scheme');
      }
      if (u.host.isEmpty) throw ApiException('url-no-host');
    } else {
      if (payload.length > textMax) throw ApiException('text-too-long');
    }
    final res = await _client
        .post(
          endpoint.api('handoff'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({
            'action': 'push',
            'kind': kind,
            'payload': payload,
            if (sourceDevice != null) 'sourceDevice': sourceDevice,
            if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
          }),
        )
        .timeout(Timeouts.restCall);
    final j = jsonDecode(res.body);
    final ok = j is Map && j['ok'] == true;
    if (res.statusCode == 429) throw ApiException('rate-limited');
    if (res.statusCode != 200 || !ok) {
      final err = (j is Map ? j['error'] : null) ?? 'HTTP ${res.statusCode}';
      throw ApiException('$err');
    }
  }

  // ===========================================================================
  // §55 — الماسح الموثق الحي (SCAN-TO-PDF): دورة open → page → seal
  // ---------------------------------------------------------------------------
  // الصور تُرفع JPEG بايتات حقيقية (فحص سحر FFD8FF على السيرفر) وتُدمج في PDF
  // على حاسوب المالك حصرًا — بلا سحابة ولا وسيط.
  // السقوف: 30 صفحة/جلسة · 12MB/صفحة · 3 جلسات مفتوحة · 60 صفحة/دقيقة.
  // ===========================================================================

  /// فتح جلسة مسح جديدة: POST /api/scan {action:'open', title?}
  Future<ScanSession> scanOpen({String? title}) async {
    final res = await _client
        .post(
          endpoint.api('scan'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'action': 'open', if (title != null) 'title': title}),
        )
        .timeout(Timeouts.restCall);
    final j = jsonDecode(res.body);
    if (res.statusCode != 200 || j is! Map || j['ok'] != true) {
      final err = (j is Map ? j['error'] : null) ?? 'HTTP ${res.statusCode}';
      throw ApiException('scan-open: $err');
    }
    return ScanSession.fromJson((j['session'] as Map).cast<String, dynamic>());
  }

  /// حالة الجلسة (بلا بايتات صور): GET /api/scan?id=…
  Future<ScanSession> scanGet(String sessionId) async {
    final res = await _client
        .get(endpoint.api('scan', {'id': sessionId}))
        .timeout(Timeouts.restCall);
    final j = jsonDecode(res.body);
    if (res.statusCode != 200 || j is! Map || j['ok'] != true) {
      final err = (j is Map ? j['error'] : null) ?? 'HTTP ${res.statusCode}';
      throw ApiException('scan-get: $err');
    }
    return ScanSession.fromJson((j['session'] as Map).cast<String, dynamic>());
  }

  /// رفع صفحة JPEG: POST /api/scan/page?id=… (multipart حقل file)
  Future<ScanPage> scanAddPage(
    String sessionId, {
    required String fileName,
    required List<int> bytes,
  }) async {
    if (bytes.length > 12 * 1024 * 1024) throw ApiException('page-too-large');
    final req = http.MultipartRequest('POST', endpoint.api('scan/page', {'id': sessionId}))
      ..files.add(http.MultipartFile.fromBytes('file', bytes, filename: fileName));
    final streamed =
        await _client.send(req).timeout(Timeouts.restCall * 4); // الرفع أبطأ من REST
    final res = await http.Response.fromStream(streamed).timeout(Timeouts.restCall);
    final j = jsonDecode(res.body);
    if (res.statusCode != 200 || j is! Map || j['ok'] != true) {
      final err = (j is Map ? j['error'] : null) ?? 'HTTP ${res.statusCode}';
      throw ApiException('scan-page: $err');
    }
    return ScanPage.fromJson((j['page'] as Map).cast<String, dynamic>());
  }

  /// فعل على صفحة: rotate {n, deg∈0|90|180|270} · move {n? from,to} · remove {n}
  /// POST /api/scan {action, id, …}
  Future<ScanSession> scanAct(
    String sessionId, {
    required String action,
    Map<String, dynamic> args = const {},
  }) async {
    final res = await _client
        .post(
          endpoint.api('scan'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'action': action, 'id': sessionId, ...args}),
        )
        .timeout(Timeouts.restCall);
    final j = jsonDecode(res.body);
    if (res.statusCode != 200 || j is! Map || j['ok'] != true) {
      final err = (j is Map ? j['error'] : null) ?? 'HTTP ${res.statusCode}';
      throw ApiException('scan-$action: $err');
    }
    return ScanSession.fromJson((j['session'] as Map).cast<String, dynamic>());
  }

  /// الختم: بناء PDF على حاسوب المالك — POST /api/scan {action:'seal', id}
  Future<ScanSeal> scanSeal(String sessionId) async {
    final res = await _client
        .post(
          endpoint.api('scan'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'action': 'seal', 'id': sessionId}),
        )
        .timeout(Timeouts.restCall * 6); // بناء PDF قد يطيل
    final j = jsonDecode(res.body);
    if (res.statusCode != 200 || j is! Map || j['ok'] != true) {
      final err = (j is Map ? j['error'] : null) ?? 'HTTP ${res.statusCode}';
      throw ApiException('scan-seal: $err');
    }
    return ScanSeal(
      file: '${j['file'] ?? ''}',
      bytes: (j['bytes'] as num?)?.toInt() ?? 0,
      pages: (j['pages'] as num?)?.toInt() ?? 0,
      target: '${j['target'] ?? ''}',
    );
  }

  /// إلغاء الجلسة وحذف صفحاتها: POST /api/scan {action:'cancel', id}
  Future<void> scanCancel(String sessionId) async {
    final res = await _client
        .post(
          endpoint.api('scan'),
          headers: {'Content-Type': 'application/json'},
          body: jsonEncode({'action': 'cancel', 'id': sessionId}),
        )
        .timeout(Timeouts.restCall);
    final j = jsonDecode(res.body);
    if (res.statusCode != 200 || j is! Map || j['ok'] != true) {
      final err = (j is Map ? j['error'] : null) ?? 'HTTP ${res.statusCode}';
      throw ApiException('scan-cancel: $err');
    }
  }

  void close() => _client.close();
}

// -----------------------------------------------------------------------------
// نماذج §55 — أشكال مطابقة لـ publicSession/addScanPage/sealScanSession حرفيًا
// -----------------------------------------------------------------------------

/// صفحة في جلسة مسح — كما يعيدها السيرفر {n, name, size, rotate, at}
class ScanPage {
  final int n;
  final String name;
  final int size;
  final int rotate; // 0 | 90 | 180 | 270
  final int at;

  const ScanPage({required this.n, required this.name, required this.size, required this.rotate, required this.at});

  factory ScanPage.fromJson(Map<String, dynamic> j) => ScanPage(
        n: (j['n'] as num?)?.toInt() ?? 0,
        name: '${j['name'] ?? ''}',
        size: (j['size'] as num?)?.toInt() ?? 0,
        rotate: (j['rotate'] as num?)?.toInt() ?? 0,
        at: (j['at'] as num?)?.toInt() ?? 0,
      );
}

/// جلسة مسح — {id, title, status, createdAt, sealedFile, pages[]}
class ScanSession {
  final String id;
  final String title;
  final String status; // open | sealed | cancelled
  final int createdAt;
  final String? sealedFile;
  final List<ScanPage> pages;

  const ScanSession({
    required this.id,
    required this.title,
    required this.status,
    required this.createdAt,
    this.sealedFile,
    required this.pages,
  });

  factory ScanSession.fromJson(Map<String, dynamic> j) => ScanSession(
        id: '${j['id'] ?? ''}',
        title: '${j['title'] ?? ''}',
        status: '${j['status'] ?? 'open'}',
        createdAt: (j['createdAt'] as num?)?.toInt() ?? 0,
        sealedFile: j['sealedFile'] is String ? j['sealedFile'] as String : null,
        pages: ((j['pages'] as List?) ?? const [])
            .whereType<Map>()
            .map((m) => ScanPage.fromJson(m.cast<String, dynamic>()))
            .toList(),
      );
}

/// نتيجة الختم — {file, bytes, pages, target} على حاسوب المالك
class ScanSeal {
  final String file;
  final int bytes;
  final int pages;
  final String target;

  const ScanSeal({required this.file, required this.bytes, required this.pages, required this.target});
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

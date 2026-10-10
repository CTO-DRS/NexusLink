import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../core/protocol.dart';
import '../domain/models.dart';

/// نتائج عمليات النقل — أشكال مطابقة حرفيًا لعقد السيرفر §8.
class UploadInit {
  final String uploadId;
  final int received; // حجم الجزئي الموجود لدى السيرفر (استئناف)
  final String jobId;
  final int chunkSize;
  const UploadInit({required this.uploadId, required this.received, required this.jobId, required this.chunkSize});

  static UploadInit fromJson(Map<String, dynamic> j) => UploadInit(
        uploadId: '${j['uploadId'] ?? ''}',
        received: (j['received'] as num?)?.toInt() ?? 0,
        jobId: '${j['jobId'] ?? ''}',
        chunkSize: (j['chunkSize'] as num?)?.toInt() ?? TxProtocol.uploadChunk,
      );
}

class UploadStatus {
  final int received;
  final int size;
  final String name;
  final String status;
  const UploadStatus({required this.received, required this.size, required this.name, required this.status});

  static UploadStatus fromJson(Map<String, dynamic> j) => UploadStatus(
        received: (j['received'] as num?)?.toInt() ?? 0,
        size: (j['size'] as num?)?.toInt() ?? 0,
        name: '${j['name'] ?? ''}',
        status: '${j['status'] ?? 'unknown'}',
      );
}

/// استثناءات النقل.
class TxException implements Exception {
  final String message;
  TxException(this.message);
  @override
  String toString() => message;
}

/// رفض السيرفر بسبب انزياح الإزاحة — يحمل الحجم الفعلي لإعادة الضبط.
class TxDriftException implements Exception {
  final int received;
  TxDriftException(this.received);
  @override
  String toString() => 'drift: received=$received';
}

/// السيرفر أوقف الجلسة (pause من الكمبيوتر).
class TxPausedException implements Exception {
  final int received;
  TxPausedException(this.received);
  @override
  String toString() => 'paused: received=$received';
}

/// عميل نقل الملفات فوق REST السيرفر (البايتات عبر HTTP المجزّأ، الإشارات عبر socket).
/// يطابق مسارات السيرفر حرفيًا:
///  · /api/fs/upload  (init/PUT/complete/pause/resume/abort/status)
///  · /api/preview?device=&path=&download=1  مع ترويسة Range للتنزيل والاستئناف
class NexusTransferApi {
  final ServerEndpoint endpoint;
  final http.Client _client = http.Client();

  NexusTransferApi(this.endpoint);

  Map<String, String> get _jsonHeaders => {'Content-Type': 'application/json', 'Accept': 'application/json'};

  // ------------------------------------------------------------------
  // رفع: جلسة مجزّأة قابلة للاستئناف
  // ------------------------------------------------------------------

  /// {op:"init"} — يعيد uploadId و[received] (حجم الجزئي الموجود للاستئناف).
  /// [taskId] معرّف مستقر من الهاتف: إعادة الطلب بعد أي انقطاع تعيد نفس الجلسة.
  Future<UploadInit> uploadInit({
    required String deviceId,
    required String name,
    required int size,
    String? mime,
    String? localPath,
    String dir = TxProtocol.uploadDir,
    String? taskId,
    int chunkSize = TxProtocol.uploadChunk,
  }) async {
    final res = await _client
        .post(
          endpoint.api('fs/upload'),
          headers: _jsonHeaders,
          body: jsonEncode({
            'op': 'init',
            'deviceId': deviceId,
            'path': dir,
            'name': name,
            'size': size,
            if (mime != null) 'mime': mime,
            if (localPath != null) 'localPath': localPath,
            'chunkSize': chunkSize,
            if (taskId != null) 'taskId': taskId,
          }),
        )
        .timeout(Timeouts.restCall);
    final j = _decode(res);
    if (res.statusCode != 200 || j['ok'] != true) {
      throw TxException('upload init فشل: ${j['error'] ?? 'HTTP ${res.statusCode}'}');
    }
    return UploadInit.fromJson(j);
  }

  /// PUT قطعة بايتات خام عند إزاحة محددة → يعيد الحجم المتراكم بعد الكتابة.
  Future<int> uploadChunk(String uploadId, int offset, Uint8List bytes) async {
    final uri = endpoint.api('fs/upload', {'upload': uploadId, 'offset': '$offset'});
    final req = http.Request('PUT', uri)..bodyBytes = bytes;
    final res = await _client.send(req).then(http.Response.fromStream).timeout(TxProtocol.chunkTimeout);
    final j = _decode(res);
    if (res.statusCode == 200 && j['ok'] == true) {
      return (j['received'] as num?)?.toInt() ?? offset + bytes.length;
    }
    if (j['drift'] == true) throw TxDriftException((j['received'] as num?)?.toInt() ?? 0);
    if (j['paused'] == true) throw TxPausedException((j['received'] as num?)?.toInt() ?? 0);
    throw TxException('upload chunk فشل: ${j['error'] ?? 'HTTP ${res.statusCode}'}');
  }

  /// {op:"complete"} → المهمة النهائية (done) + مسار الوجهة الافتراضي.
  Future<TransferJob> uploadComplete(String uploadId) async {
    final j = await _op('complete', uploadId);
    final job = j['job'];
    if (job is! Map) throw TxException('استجابة complete بلا مهمة');
    return TransferJob.fromJson(Map<String, dynamic>.from(job));
  }

  Future<void> uploadPause(String uploadId) async => _op('pause', uploadId);
  Future<void> uploadResume(String uploadId) async => _op('resume', uploadId);

  /// {op:"abort"} — يحذف الجزئي لدى السيرفر ويقفل المهمة.
  Future<void> uploadAbort(String uploadId) async => _op('abort', uploadId);

  /// GET ?upload=<id> → الحجم المتراكم لدى السيرفر (للاستئناف بعد إعادة التشغيل).
  Future<UploadStatus> uploadStatus(String uploadId) async {
    final res = await _client
        .get(endpoint.api('fs/upload', {'upload': uploadId}), headers: _jsonHeaders)
        .timeout(Timeouts.restCall);
    final j = _decode(res);
    if (res.statusCode != 200 || j['ok'] != true) {
      throw TxException('upload status: ${j['error'] ?? 'HTTP ${res.statusCode}'}');
    }
    return UploadStatus.fromJson(j);
  }

  Future<Map<String, dynamic>> _op(String op, String uploadId) async {
    final res = await _client
        .post(
          endpoint.api('fs/upload'),
          headers: _jsonHeaders,
          body: jsonEncode({'op': op, 'uploadId': uploadId}),
        )
        .timeout(Timeouts.restCall);
    final j = _decode(res);
    if (res.statusCode != 200 || j['ok'] != true) {
      throw TxException('upload $op فشل: ${j['error'] ?? 'HTTP ${res.statusCode}'}');
    }
    return j;
  }

  // ------------------------------------------------------------------
  // تنزيل: بث بترويسة Range (الاستئناف من أي إزاحة)
  // ------------------------------------------------------------------

  /// رابط التنزيل من جهاز افتراضي على السيرفر (نفس معاينة الويب).
  Uri downloadUrl(String srcDeviceId, String vPath) => endpoint.api('preview', {
        'device': srcDeviceId,
        'path': vPath,
        'download': '1',
      });

  /// يفتح بثًّا جزئيًا من [offset]. 206 متوقع؛ 200 يعني تجاهل السيرفر للـ Range.
  Future<http.StreamedResponse> openRange(Uri url, int offset) async {
    final req = http.Request('GET', url);
    if (offset > 0) req.headers['Range'] = 'bytes=$offset-';
    final res = await _client.send(req).timeout(const Duration(seconds: 20));
    if (res.statusCode != 200 && res.statusCode != 206) {
      await res.stream.drain<void>().catchError((_) {});
      throw TxException('تنزيل رُفض: HTTP ${res.statusCode}');
    }
    return res;
  }

  /// حالات المهام من السيرفر (للمطابقة بعد إعادة التشغيل).
  Future<List<TransferJob>> serverJobs() async {
    final res = await _client
        .get(endpoint.api('transfer'), headers: _jsonHeaders)
        .timeout(Timeouts.restCall);
    if (res.statusCode != 200) throw TxException('transfer: HTTP ${res.statusCode}');
    final j = _decode(res);
    final list = (j['jobs'] as List?) ?? const [];
    return list.whereType<Map>().map((m) => TransferJob.fromJson(m.cast<String, dynamic>())).toList();
  }

  Map<String, dynamic> _decode(http.Response res) {
    try {
      final v = jsonDecode(utf8.decode(res.bodyBytes));
      if (v is Map) return v.cast<String, dynamic>();
    } catch (_) {}
    return <String, dynamic>{};
  }

  void close() => _client.close();
}

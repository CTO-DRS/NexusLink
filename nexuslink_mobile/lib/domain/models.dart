import 'dart:convert';

import '../core/protocol.dart';

/// أنماط الوصول إلى السيرفر:
/// - gateway: كل شيء عبر منفذ واحد (بوابة Caddy:81) — REST مباشرة و
///   socket.io عبر ?XTransformPort=<port> (نفس نمط عميل الويب).
/// - direct: REST على 3000 وsocket.io مباشرة على منفذ كل جسر.
enum AccessMode { gateway, direct }

/// نقطة وصول سيرفر NexusLink.
class ServerEndpoint {
  final String host;
  final int port; // منفذ الوصول: البوابة (81) أو REST المباشر (3000)
  final AccessMode mode;

  const ServerEndpoint({required this.host, required this.port, required this.mode});

  String get key => '$host:$port';

  /// أساس REST: http://host:port/api
  Uri api(String path, [Map<String, String>? query]) => Uri(
        scheme: 'http',
        host: host,
        port: port,
        path: 'api/$path',
        queryParameters: query,
      );

  /// عنوان socket.io لجسر معين (مثل NexusPorts.guard).
  /// gateway → نفس المنفذ مع XTransformPort (كما يفعل عميل الويب عبر Caddy).
  /// direct  → المنفذ مباشرة (socket.io server path "/" يقبل أي مسار).
  SocketTarget socketTarget(int bridgePort) => AccessMode.gateway == mode
      ? SocketTarget(url: 'http://$host:$port', query: {'XTransformPort': '$bridgePort'})
      : SocketTarget(url: 'http://$host:$bridgePort', query: const {});

  factory ServerEndpoint.fromJson(Map<String, dynamic> j) => ServerEndpoint(
        host: j['host'] as String,
        port: j['port'] as int,
        mode: (j['mode'] ?? 'gateway') == 'direct' ? AccessMode.direct : AccessMode.gateway,
      );

  Map<String, dynamic> toJson() => {'host': host, 'port': port, 'mode': mode.name};

  @override
  String toString() => key;
}

/// هدف اتصال socket.io.
class SocketTarget {
  final String url;
  final Map<String, String> query;
  const SocketTarget({required this.url, required this.query});
}

/// حمولة QR كما يولّدها السيرفر: GET /api/devices/qr
/// {v, proto, host, port, secret, ts, name, ports{...}}
class QrPayload {
  final String host;
  final int port;
  final String secret;
  final String name;
  final int ts;

  const QrPayload({required this.host, required this.port, required this.secret, required this.name, required this.ts});

  static QrPayload? tryParse(String raw) {
    final j = _tryJson(raw);
    if (j == null) return null;
    if (j['proto'] != NexusQr.proto || j['v'] != NexusQr.version) return null;
    final host = j['host'];
    final secret = j['secret'];
    if (host is! String || host.isEmpty || secret is! String || secret.isEmpty) return null;
    final port = j['port'];
    return QrPayload(
      host: host,
      port: port is int ? port : int.tryParse('$port') ?? NexusPorts.gateway,
      secret: secret,
      name: (j['name'] as String?) ?? 'NexusLink PC',
      ts: (j['ts'] as num?)?.toInt() ?? 0,
    );
  }

  /// يقبل نص JSON الصريح، أو أي نص يحتوي كائن JSON بين محارف أخرى.
  static Map<String, dynamic>? _tryJson(String s) {
    final candidates = <String>[s.trim()];
    final start = s.indexOf('{');
    final end = s.lastIndexOf('}');
    if (start >= 0 && end > start) candidates.add(s.substring(start, end + 1));
    for (final c in candidates) {
      try {
        final decoded = jsonDecode(c);
        if (decoded is Map<String, dynamic>) return decoded;
        if (decoded is Map) return decoded.map((k, v) => MapEntry('$k', v));
      } catch (_) {/* المحاولة التالية */}
    }
    return null;
  }

  /// هل السر طازج (≤ 5 دقائق)؟ السيرفر يبطل السر القديم عند التوليد الجديد.
  bool get isFresh => ts > 0 && DateTime.now().millisecondsSinceEpoch - ts <= 5 * 60 * 1000;
}

/// جهاز مقترن — مرآة حرفية لـ NexusDevice في السيرفر (src/lib/nexus/types.ts).
class NexusDevice {
  final String id;
  final String name;
  final String kind; // phone | tablet | desktop | tv
  final String state; // connected | offline | pairing
  final String mode; // wifi | hotspot | usb
  final String ip;
  final int battery;
  final int storageTotal;
  final int storageUsed;
  final int lastSeen;
  final int rttMs;
  final int pairedAt;
  final bool trusted;

  const NexusDevice({
    required this.id,
    required this.name,
    required this.kind,
    required this.state,
    required this.mode,
    required this.ip,
    required this.battery,
    required this.storageTotal,
    required this.storageUsed,
    required this.lastSeen,
    required this.rttMs,
    required this.pairedAt,
    required this.trusted,
  });

  factory NexusDevice.fromJson(Map<String, dynamic> j) => NexusDevice(
        id: '${j['id'] ?? ''}',
        name: '${j['name'] ?? ''}',
        kind: '${j['kind'] ?? 'phone'}',
        state: '${j['state'] ?? 'offline'}',
        mode: '${j['mode'] ?? 'wifi'}',
        ip: '${j['ip'] ?? ''}',
        battery: (j['battery'] as num?)?.toInt() ?? 0,
        storageTotal: (j['storageTotal'] as num?)?.toInt() ?? 0,
        storageUsed: (j['storageUsed'] as num?)?.toInt() ?? 0,
        lastSeen: (j['lastSeen'] as num?)?.toInt() ?? 0,
        rttMs: (j['rttMs'] as num?)?.toInt() ?? 0,
        pairedAt: (j['pairedAt'] as num?)?.toInt() ?? 0,
        trusted: j['trusted'] == true,
      );

  bool get isThisPhone => kind == 'phone';

  String humanStorage() {
    String h(int b) {
      if (b >= 1024 * 1024 * 1024) return '${(b / (1024 * 1024 * 1024)).toStringAsFixed(0)}GB';
      if (b >= 1024 * 1024) return '${(b / (1024 * 1024)).toStringAsFixed(0)}MB';
      return '$b B';
    }

    return '${h(storageUsed)} / ${h(storageTotal)}';
  }
}

/// سجل دخول السجل النشط (عرض فقط — المحل هو الرing buffer في providers).
class LogEntry {
  final DateTime at;
  final String text;
  final String kind; // ok | info | warn | error
  const LogEntry(this.text, {required this.kind, required this.at});

  Map<String, dynamic> toJson() => {'text': text, 'kind': kind, 'at': at.millisecondsSinceEpoch};
  factory LogEntry.fromJson(Map<String, dynamic> j) => LogEntry(
        '${j['text'] ?? ''}',
        kind: '${j['kind'] ?? 'info'}',
        at: DateTime.fromMillisecondsSinceEpoch((j['at'] as num?)?.toInt() ?? 0),
      );
}

/// حالة الوكيل الخلفي (يأتي من الـ Foreground Service عبر EventChannel).
enum AgentLinkState { stopped, connecting, online, offline, reconnecting }

/// عرض ملف قادم — مرآة حدث tx:offer على جسر الحماية (عقد §8).
class TxOfferEvent {
  final String id; // معرّف مهمة السيرفر tx_…
  final String fileName;
  final int size;
  final String? mime;
  final String from; // اسم الجهاز المرسل
  final String srcDeviceId; // الجهاز الافتراضي المصدر
  final String srcVPath; // مسار الملف الافتراضي
  final int at;

  const TxOfferEvent({
    required this.id,
    required this.fileName,
    required this.size,
    required this.from,
    required this.srcDeviceId,
    required this.srcVPath,
    required this.at,
    this.mime,
  });

  static TxOfferEvent? tryParse(Map<Object?, Object?> m) {
    final id = '${m['id'] ?? ''}';
    if (id.isEmpty) return null;
    return TxOfferEvent(
      id: id,
      fileName: '${m['fileName'] ?? 'ملف'}',
      size: (m['size'] as num?)?.toInt() ?? 0,
      mime: m['mime'] as String?,
      from: '${m['from'] ?? 'الكمبيوتر'}',
      srcDeviceId: '${m['srcDeviceId'] ?? ''}',
      srcVPath: '${m['srcVPath'] ?? '/'}',
      at: (m['at'] as num?)?.toInt() ?? 0,
    );
  }
}

/// نص سريع وارد — مرآة حدث clip:new على جسر الإنتاجية (عقد §4.5).
class ClipItem {
  final String id;
  final String deviceId;
  final String deviceName;
  final String kind; // text | image | file
  final String content;
  final String? fileName;
  final int size;
  final String mode; // auto | manual
  final int createdAt;

  const ClipItem({
    required this.id,
    required this.deviceId,
    required this.deviceName,
    required this.kind,
    required this.content,
    required this.size,
    required this.mode,
    required this.createdAt,
    this.fileName,
  });

  static ClipItem? tryParse(Map<Object?, Object?> m) {
    final id = '${m['id'] ?? ''}';
    if (id.isEmpty) return null;
    return ClipItem(
      id: id,
      deviceId: '${m['deviceId'] ?? ''}',
      deviceName: '${m['deviceName'] ?? ''}',
      kind: '${m['kind'] ?? 'text'}',
      content: '${m['content'] ?? ''}',
      fileName: m['fileName'] as String?,
      size: (m['size'] as num?)?.toInt() ?? 0,
      mode: '${m['mode'] ?? 'manual'}',
      createdAt: (m['createdAt'] as num?)?.toInt() ?? 0,
    );
  }
}

/// رابط/تسليم وارد — مرآة حدث hand:new (عقد §4.5).
class HandItem {
  final String id;
  final String deviceId;
  final String deviceName;
  final String kind; // link | video | article
  final String title;
  final String url;
  final String status;
  final int createdAt;

  const HandItem({
    required this.id,
    required this.deviceId,
    required this.deviceName,
    required this.kind,
    required this.title,
    required this.url,
    required this.status,
    required this.createdAt,
  });

  static HandItem? tryParse(Map<Object?, Object?> m) {
    final id = '${m['id'] ?? ''}';
    final url = '${m['url'] ?? ''}';
    if (id.isEmpty || url.isEmpty) return null;
    return HandItem(
      id: id,
      deviceId: '${m['deviceId'] ?? ''}',
      deviceName: '${m['deviceName'] ?? ''}',
      kind: '${m['kind'] ?? 'link'}',
      title: '${m['title'] ?? url}',
      url: url,
      status: '${m['status'] ?? 'new'}',
      createdAt: (m['createdAt'] as num?)?.toInt() ?? 0,
    );
  }
}


/// مرآة حرفية لـ TransferJob في السيرفر (src/lib/nexus/types.ts).
class TransferJob {
  final String id;
  final String deviceId;
  final String deviceName;
  final String direction; // out | in
  final String fileName;
  final String srcPath;
  final String destPath;
  final int totalBytes;
  final int transferred;
  final String status; // queued|active|paused|done|error
  final int speedBps;
  final int chunksTotal;
  final int chunksDone;
  final int chunkSize;
  final int startedAt;
  final String? error;
  final bool agent; // يُدار بواسطة وكيل حقيقي
  final String? uploadId;
  final String? srcDeviceId;
  final String? mime;

  const TransferJob({
    required this.id,
    required this.deviceId,
    required this.deviceName,
    required this.direction,
    required this.fileName,
    required this.srcPath,
    required this.destPath,
    required this.totalBytes,
    required this.transferred,
    required this.status,
    required this.speedBps,
    required this.chunksTotal,
    required this.chunksDone,
    required this.chunkSize,
    required this.startedAt,
    this.error,
    this.agent = false,
    this.uploadId,
    this.srcDeviceId,
    this.mime,
  });

  factory TransferJob.fromJson(Map<String, dynamic> j) => TransferJob(
        id: '${j['id'] ?? ''}',
        deviceId: '${j['deviceId'] ?? ''}',
        deviceName: '${j['deviceName'] ?? ''}',
        direction: '${j['direction'] ?? 'out'}',
        fileName: '${j['fileName'] ?? ''}',
        srcPath: '${j['srcPath'] ?? ''}',
        destPath: '${j['destPath'] ?? ''}',
        totalBytes: (j['totalBytes'] as num?)?.toInt() ?? 0,
        transferred: (j['transferred'] as num?)?.toInt() ?? 0,
        status: '${j['status'] ?? 'queued'}',
        speedBps: (j['speedBps'] as num?)?.toInt() ?? 0,
        chunksTotal: (j['chunksTotal'] as num?)?.toInt() ?? 0,
        chunksDone: (j['chunksDone'] as num?)?.toInt() ?? 0,
        chunkSize: (j['chunkSize'] as num?)?.toInt() ?? 0,
        startedAt: (j['startedAt'] as num?)?.toInt() ?? 0,
        error: j['error'] as String?,
        agent: j['agent'] == true,
        uploadId: j['uploadId'] as String?,
        srcDeviceId: j['srcDeviceId'] as String?,
        mime: j['mime'] as String?,
      );
}


class AgentEvent {
  final AgentLinkState state;
  final String serverKey;
  final String? detail;
  final DateTime at;

  const AgentEvent(this.state, {required this.serverKey, this.detail, required this.at});

  static AgentEvent? tryParse(Map<Object?, Object?> raw) {
    try {
      final state = switch ('${raw['state']}') {
        'online' => AgentLinkState.online,
        'connecting' => AgentLinkState.connecting,
        'reconnecting' => AgentLinkState.reconnecting,
        'offline' => AgentLinkState.offline,
        'stopped' => AgentLinkState.stopped,
        _ => null,
      };
      if (state == null) return null;
      return AgentEvent(
        state,
        serverKey: '${raw['serverKey'] ?? ''}',
        detail: raw['detail'] as String?,
        at: DateTime.now(),
      );
    } catch (_) {
      return null;
    }
  }
}

/// نتيجة اكتشاف mDNS.
class DiscoveredServer {
  final String name;
  final String host;
  final int port; // بوابة
  final Map<String, String> txt;

  const DiscoveredServer({required this.name, required this.host, required this.port, required this.txt});

  String get proto => txt['proto'] ?? 'Nexus/1.2';
  int get guardPort => int.tryParse(txt['guard'] ?? '') ?? NexusPorts.guard;
}

/// العتبة التعاقدية M1.1 — الاقتران الفوري الكامل (QR → أول قيمة)
class PairTarget {
  static const int ms = 30000;
}

/// قياس الاقتران الفوري (عقد §30 — بند M1.1): إحصاء زمن
/// «من إصدار QR إلى أول قيمة» — بيانات وصفية حصرًا (لا محتوى).
class PairMetricsStats {
  final double? lastTotalMs; // إجمالي آخر اقتران مكتمل
  final int completed; // عدد السلاسل المكتملة
  final double? p95Ms;
  final double? maxMs;
  final double? passRate; // 0..1

  const PairMetricsStats({
    this.lastTotalMs,
    this.completed = 0,
    this.p95Ms,
    this.maxMs,
    this.passRate,
  });

  factory PairMetricsStats.fromJson(Map<String, dynamic> j) {
    double? num2d(dynamic v) => v is num ? v.toDouble() : null;
    return PairMetricsStats(
      lastTotalMs: num2d(j['last']),
      completed: (j['completed'] as num?)?.toInt() ?? 0,
      p95Ms: num2d(j['p95']),
      maxMs: num2d(j['max']),
      passRate: num2d(j['passRate']),
    );
  }
}

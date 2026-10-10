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

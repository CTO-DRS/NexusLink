import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

/// P1: receiving the PC's discovery beacon (docs/protocol-contract.md §44).
///
/// The gateway announces `{proto, v, pcId, name, port}` over UDP 41234
/// (broadcast + multicast 239.255.77.77) and answers a probe with a unicast
/// reply. pcId is stable and does not change with the IP, so the phone matches
/// it to find the PC after DHCP gives it a new address.
///
/// The beacon carries no token: the stored pairing token is still the only
/// thing that opens the gateway (G1). Fields outside the whitelist are ignored.
class BeaconHit {
  final String pcId;
  final String name;
  final String host;
  final int port;

  const BeaconHit({required this.pcId, required this.name, required this.host, required this.port});

  String get key => '$host:$port';
}

class BeaconListener {
  static const int udpPort = 41234;
  static const String proto = 'nexuslink-beacon';
  static final InternetAddress _mcast = InternetAddress('239.255.77.77');
  static final RegExp _pcIdRe = RegExp(r'^[a-f0-9]{32}$');

  RawDatagramSocket? _sock;
  final StreamController<BeaconHit> _hits = StreamController<BeaconHit>.broadcast();

  Stream<BeaconHit> get hits => _hits.stream;
  bool get isActive => _sock != null;

  /// Strict parsing: an unexpected shape or a field out of range = ignore.
  static BeaconHit? parse(List<int> data, String host) {
    if (data.length > 512) return null;
    try {
      final j = jsonDecode(utf8.decode(data));
      if (j is! Map || j['proto'] != proto || j['v'] != 1 || j['probe'] == true) return null;
      final pcId = j['pcId'];
      final port = j['port'];
      final name = j['name'];
      if (pcId is! String || !_pcIdRe.hasMatch(pcId)) return null;
      if (port is! int || port < 1 || port > 65535) return null;
      return BeaconHit(
        pcId: pcId,
        name: name is String && name.isNotEmpty ? (name.length > 64 ? name.substring(0, 64) : name) : 'Nexus PC',
        host: host,
        port: port,
      );
    } catch (_) {
      return null;
    }
  }

  Future<void> start() async {
    if (_sock != null) return;
    try {
      final s = await RawDatagramSocket.bind(InternetAddress.anyIPv4, udpPort, reuseAddress: true);
      s.broadcastEnabled = true;
      try {
        s.joinMulticast(_mcast);
      } catch (e) {
        debugPrint('[beacon] multicast join failed: $e');
      }
      s.listen((ev) {
        if (ev != RawSocketEvent.read) return;
        final dg = s.receive();
        if (dg == null) return;
        final hit = parse(dg.data, dg.address.address);
        if (hit != null) _hits.add(hit);
      });
      _sock = s;
      debugPrint('[beacon] listening on UDP $udpPort');
    } catch (e) {
      debugPrint('[beacon] failed to start: $e');
      _sock = null;
    }
  }

  /// Probe to 255.255.255.255 and to the /24 broadcast of every local IPv4
  /// address. The reply comes back unicast, so it gets through even where
  /// the network filters the periodic broadcast or multicast.
  Future<void> probe() async {
    final s = _sock;
    if (s == null) return;
    final msg = utf8.encode(jsonEncode({'proto': proto, 'v': 1, 'probe': true}));
    final targets = <String>{'255.255.255.255'};
    try {
      for (final ni in await NetworkInterface.list(type: InternetAddressType.IPv4)) {
        for (final a in ni.addresses) {
          if (a.isLoopback) continue;
          final p = a.address.split('.');
          if (p.length == 4) targets.add('${p[0]}.${p[1]}.${p[2]}.255');
        }
      }
    } catch (_) {/* the generic target is enough */}
    for (final t in targets) {
      try {
        s.send(msg, InternetAddress(t), udpPort);
      } catch (_) {/* some networks refuse broadcast */}
    }
  }

  /// Find the PC by its pcId: listen and probe within [timeout].
  Future<BeaconHit?> find(String pcId, {Duration timeout = const Duration(seconds: 5)}) async {
    await start();
    if (_sock == null) return null;
    final c = Completer<BeaconHit?>();
    final sub = hits.where((h) => h.pcId == pcId).listen((h) {
      if (!c.isCompleted) c.complete(h);
    });
    final repeat = Timer.periodic(const Duration(milliseconds: 1200), (_) => probe());
    await probe();
    final hit = await c.future.timeout(timeout, onTimeout: () => null);
    repeat.cancel();
    await sub.cancel();
    return hit;
  }

  void stop() {
    _sock?.close();
    _sock = null;
  }
}

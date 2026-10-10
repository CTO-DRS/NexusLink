import 'package:bonsoir/bonsoir.dart';
import 'package:flutter/foundation.dart';

import 'models.dart';

/// اكتشاف سيرفرات NexusLink تلقائيًا عبر mDNS (خدمة _nexuslink._tcp).
/// السيرفر يعلن عن نفسه من comms-service (bonjour-service) بنفس النوع.
class DiscoveryService {
  static const String serviceType = '_nexuslink._tcp';

  BonsoirDiscovery? _discovery;
  final List<DiscoveredServer> _found = [];
  final List<void Function(DiscoveredServer)> _onFound = [];

  List<DiscoveredServer> get found => List.unmodifiable(_found);
  bool get isActive => _discovery != null;

  /// تسجيل مستمع قبل أو بعد بدء البحث (يستدعى فورًا إن وُجدت نتائج).
  void addListener(void Function(DiscoveredServer) cb) {
    _onFound.add(cb);
    for (final s in _found) {
      cb(s);
    }
  }

  Future<void> start() async {
    if (_discovery != null) return;
    try {
      final discovery = BonsoirDiscovery(type: serviceType);
      final ready = await discovery.ready;
      if (!ready) {
        debugPrint('[mdns] discovery not ready (multicast غير متاح؟)');
        return;
      }
      _discovery = discovery;
      await discovery.discoverServices();
      discovery.eventStream?.listen(_onEvent, onError: (Object e) {
        debugPrint('[mdns] stream error: $e');
        stop();
      });
      debugPrint('[mdns] searching $serviceType …');
    } catch (e) {
      debugPrint('[mdns] فشل بدء الاكتشاف: $e');
      _discovery = null;
    }
  }

  void _onEvent(BonsoirDiscoveryEvent event) {
    switch (event.type) {
      case BonsoirDiscoveryEventType.discoveryServiceResolved:
        final svc = event.service;
        if (svc == null) return;
        final host = svc.host ?? '';
        if (host.isEmpty) return;
        final attrs = <String, String>{
          for (final e in svc.attributes.entries) '${e.key}': '${e.value ?? ''}',
        };
        // تجاهل خدماتنا السابقة بنفس الاسم+العنوان
        final server = DiscoveredServer(
          name: svc.name,
          host: host,
          port: svc.port,
          txt: attrs,
        );
        final exists = _found.any((s) => s.host == server.host && s.port == server.port);
        if (!exists) {
          _found.add(server);
          for (final cb in List.of(_onFound)) {
            cb(server);
          }
        }
      case BonsoirDiscoveryEventType.discoveryServiceLost:
        final svc = event.service;
        if (svc == null) return;
        _found.removeWhere((s) => s.name == svc.name && s.port == svc.port);
      default:
        break;
    }
  }

  Future<void> stop() async {
    try {
      await _discovery?.stop();
    } catch (_) {/* تجاهل */}
    _discovery = null;
  }
}

import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as sio;

import '../core/protocol.dart';
import '../domain/models.dart';
import 'transfer_engine.dart';

/// حدث أمر تحكم من الكمبيوتر على مهمة تنزيل (pause/resume/cancel).
class TxCommand {
  final String event; // tx:pause | tx:resume | tx:cancel
  final String offerId;
  const TxCommand(this.event, this.offerId);
}

/// قنوات الإشارة الحية من الواجهة — تُبنى بنمط الوكيل نفسه (gateway/direct):
///  · 3006 (guard): tx:offer + tx:pause/resume/cancel من الكمبيوتر، وإرسال
///    قراراتنا (tx:accept/reject/state/progress) عبر [send].
///  · 3007 (prod): النصوص السريعة clip:new + الروابط hand:new.
/// تعمل أثناء حياة الواجهة؛ الخدمة الخلفية (Kotlin) تحمل القناة نفسها
/// أثناء غياب الواجهة وتنشر الإشعارات.
class AgentSignaling implements TxSignaling {
  sio.Socket? _guard;
  sio.Socket? _prod;

  final _offers = StreamController<TxOfferEvent>.broadcast();
  final _clips = StreamController<ClipItem>.broadcast();
  final _hands = StreamController<HandItem>.broadcast();
  final _commands = StreamController<TxCommand>.broadcast();

  Stream<TxOfferEvent> get offers => _offers.stream;
  Stream<ClipItem> get clips => _clips.stream;
  Stream<HandItem> get hands => _hands.stream;
  Stream<TxCommand> get commands => _commands.stream;

  bool get isConnected => _guard?.connected ?? false;

  /// أنشئ القناتين لنقطة نهاية سيرفر.
  void connect({
    required String host,
    required int port,
    required String mode, // gateway | direct
  }) {
    disconnect();

    _guard = _open(
      host: host, port: port, mode: mode, bridgePort: NexusPorts.guard,
      onEvent: _onGuardEvent,
    );
    _prod = _open(
      host: host, port: port, mode: mode, bridgePort: NexusPorts.prod,
      onEvent: _onProdEvent,
    );
  }

  sio.Socket _open({
    required String host,
    required int port,
    required String mode,
    required int bridgePort,
    required void Function(String event, dynamic data) onEvent,
  }) {
    final url = mode == 'gateway' ? 'http://$host:$port' : 'http://$host:$bridgePort';
    final builder = sio.OptionBuilder()
        .enableReconnection()
        .setReconnectionDelay(2000)
        .setReconnectionDelayMax(15000)
        .setTimeout(Timeouts.socketConnect.inMilliseconds);
    if (mode == 'gateway') {
      // نفس نمط عميل الويب: Caddy يوجّه ?XTransformPort إلى منفذ الجسر
      builder.setQuery({'XTransformPort': '$bridgePort'});
    }
    final socket = sio.io(url, builder.build());

    void bind(String event) {
      socket.on(event, (data) => onEvent(event, data));
    }

    bind(GuardEvents.txOffer);
    bind(GuardEvents.txPause);
    bind(GuardEvents.txResume);
    bind(GuardEvents.txCancel);
    bind(ProdEvents.clipNew);
    bind(ProdEvents.handNew);
    socket.connect();
    return socket;
  }

  void _onGuardEvent(String event, dynamic data) {
    final m = _firstMap(data);
    if (m == null) return;
    switch (event) {
      case GuardEvents.txOffer:
        final offer = TxOfferEvent.tryParse(m);
        if (offer != null) _offers.add(offer);
      case GuardEvents.txPause:
        _commands.add(TxCommand('tx:pause', '${m['id'] ?? ''}'));
      case GuardEvents.txResume:
        _commands.add(TxCommand('tx:resume', '${m['id'] ?? ''}'));
      case GuardEvents.txCancel:
        _commands.add(TxCommand('tx:cancel', '${m['id'] ?? ''}'));
    }
  }

  void _onProdEvent(String event, dynamic data) {
    final m = _firstMap(data);
    if (m == null) return;
    switch (event) {
      case ProdEvents.clipNew:
        final clip = ClipItem.tryParse(m);
        if (clip != null) _clips.add(clip);
      case ProdEvents.handNew:
        final hand = HandItem.tryParse(m);
        if (hand != null) _hands.add(hand);
    }
  }

  static Map<Object?, Object?>? _firstMap(dynamic data) {
    if (data is List) {
      for (final item in data) {
        if (item is Map && item.isNotEmpty) return item.cast<Object?, Object?>();
      }
      return null;
    }
    if (data is Map) return data.cast<Object?, Object?>();
    return null;
  }

  // ---- TxSignaling: إرسال قرارات الهاتف على قناة 3006 ----
  @override
  void send(String event, Map<String, dynamic> data) {
    try {
      _guard?.emit(event, data);
    } catch (_) {/* القناة منقطعة — سيُعاد الإرسال عند الاستئناف */}
  }

  void disconnect() {
    for (final s in [_guard, _prod]) {
      try {
        s?.disconnect();
      } catch (_) {}
    }
    _guard = null;
    _prod = null;
  }

  void dispose() {
    disconnect();
    _offers.close();
    _clips.close();
    _hands.close();
    _commands.close();
  }
}

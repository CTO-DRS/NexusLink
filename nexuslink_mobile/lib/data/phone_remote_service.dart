import 'dart:async';

import 'package:flutter/services.dart';
import 'package:socket_io_client/socket_io_client.dart' as sio;

import '../core/protocol.dart';

// ---------------------------------------------------------------------------
// الجولة 5 (عقد §24) — التحكم بهاتف من هاتف آخر عبر المركز (هاتف→هاتف).
//
// الهاتف أ (هذه الخدمة) يفتح سوكِت واجهة إلى جسر الحماية 3006 بنفس نمط
// AgentSignaling/ControllerService حرفيًا (gateway ?XTransformPort / direct):
//  · يطلب جلسة p2p:ctl-start {from, target} — فيوجّها الجسر للهاتف ب بعد
//    بوابة الثقة (موثوقان + بلا تحكم ذاتي + هدف حي وغير مشغول).
//  · التأكيد يأتي من ب نفسه عبر dev:ctl-state الموجهة (حوار «سماح» القائم
//    في Kotlin يبقى كما هو حرفيًا — لا شاشة تأكيد جديدة ولا بروتوكول موازٍ).
//  · الإدخال يُرسل بأسماء أحداث الويب نفسها (dev:touch/text/key) — الجسر
//    يوجهها خلال الجلسة الموثقة حصرًا، ويحوّل إقرارات التنفيذ dev:touch-ack.
//  · guard:agents قائمة الوكلاء الحية + guard:screen أبعاد الهدف (فلترة deviceId).
// ---------------------------------------------------------------------------

/// حالة واجهة الهاتف أ — مصدر الحقيقة الوحيد للشاشة.
class PhoneRemoteUiState {
  /// idle = بلا اتصال · online = الجسر متصل · session = جلسة موثقة نشطة
  final String phase;
  final bool bridgeOnline;
  final bool sessionActive;
  final String targetId;
  final String targetName;
  final String? endReason;
  final String? lastRejected;
  final ({int w, int h, int density})? targetScreen;
  final List<({String deviceId, String name})> agents;
  final int acks;
  final int touches;
  final List<String> log;

  const PhoneRemoteUiState({
    this.phase = 'idle',
    this.bridgeOnline = false,
    this.sessionActive = false,
    this.targetId = '',
    this.targetName = '',
    this.endReason,
    this.lastRejected,
    this.targetScreen,
    this.agents = const [],
    this.acks = 0,
    this.touches = 0,
    this.log = const [],
  });

  PhoneRemoteUiState copyWith({
    String? phase,
    bool? bridgeOnline,
    bool? sessionActive,
    String? targetId,
    String? targetName,
    String? endReason,
    bool clearEndReason = false,
    String? lastRejected,
    bool clearRejected = false,
    ({int w, int h, int density})? targetScreen,
    bool clearTargetScreen = false,
    List<({String deviceId, String name})>? agents,
    int? acks,
    int? touches,
    List<String>? log,
  }) {
    return PhoneRemoteUiState(
      phase: phase ?? this.phase,
      bridgeOnline: bridgeOnline ?? this.bridgeOnline,
      sessionActive: sessionActive ?? this.sessionActive,
      targetId: targetId ?? this.targetId,
      targetName: targetName ?? this.targetName,
      endReason: clearEndReason ? null : (endReason ?? this.endReason),
      lastRejected: clearRejected ? null : (lastRejected ?? this.lastRejected),
      targetScreen: clearTargetScreen ? null : (targetScreen ?? this.targetScreen),
      agents: agents ?? this.agents,
      acks: acks ?? this.acks,
      touches: touches ?? this.touches,
      log: log ?? this.log,
    );
  }
}

/// خدمة التحكم بهاتف آخر — دورة الحياة مرتبطة بشاشة التحكم (تفتح/تُغلق معها).
class PhoneRemoteService {
  final String deviceId;
  final String deviceName;

  PhoneRemoteService({required this.deviceId, required this.deviceName});

  sio.Socket? _socket;
  Timer? _pingTimer;
  PhoneRemoteUiState _state = const PhoneRemoteUiState();
  final _stateCtl = StreamController<PhoneRemoteUiState>.broadcast();
  Stream<PhoneRemoteUiState> get stateStream => _stateCtl.stream;
  PhoneRemoteUiState get state => _state;
  bool get isConnected => _socket?.connected ?? false;

  void _patch(PhoneRemoteUiState Function(PhoneRemoteUiState) fn) {
    _state = fn(_state);
    _stateCtl.add(_state);
  }

  void _addLog(String text) {
    final log = <String>[text, ..._state.log];
    if (log.length > 40) log.removeRange(40, log.length);
    _patch((s) => s.copyWith(log: log));
  }

  // ------------------------------------------------------------------
  // الاتصال بقناة 3006 (نفس بناء AgentSignaling حرفيًا)
  // ------------------------------------------------------------------

  bool connect({
    required String host,
    required int port,
    required String mode, // gateway | direct
  }) {
    disconnect();
    try {
      const bridgePort = NexusPorts.guard;
      final url = mode == 'gateway' ? 'http://$host:$port' : 'http://$host:$bridgePort';
      final builder = sio.OptionBuilder()
          .enableReconnection()
          .setReconnectionDelay(2000)
          .setReconnectionDelayMax(15000)
          .setTimeout(Timeouts.socketConnect.inMilliseconds);
      if (mode == 'gateway') builder.setQuery({'XTransformPort': '$bridgePort'});
      final socket = sio.io(url, builder.build());

      void bind(String event, void Function(dynamic) fn) => socket.on(event, fn);

      socket.onConnect((_) {
        _patch((s) => s.copyWith(bridgeOnline: true, phase: 'online', clearEndReason: true));
        _addLog('قناة الحماية 3006 متصلة — بانتظار قائمة الهواتف');
      });
      socket.onDisconnect((_) {
        // انقطاع القناة = نهاية الجلسة دائمًا (الجسر يقطع الطرف الآخر فورًا)
        _patch((s) => PhoneRemoteUiState(
              phase: 'idle',
              log: s.log,
              endReason: 'disconnected',
            ));
      });

      bind(P2pEvents.agentsList, _onAgents);
      bind(P2pEvents.ctlState, _onCtlState);
      bind(P2pEvents.touchAck, _onTouchAck);
      bind(P2pEvents.rejected, _onRejected);
      bind(P2pEvents.screenInfo, _onScreenInfo);

      socket.connect();
      _socket = socket;
      _pingTimer = Timer.periodic(const Duration(seconds: 8), (_) => _ping());
      return true;
    } catch (_) {
      return false;
    }
  }

  void _ping() {
    try {
      _socket?.emit('rc:ping', {'t': DateTime.now().millisecondsSinceEpoch});
    } catch (_) {}
  }

  void disconnect() {
    // احتياط بروتوكولي: أي جلسة قائمة تُقطع قبل هدم السوكِت (قطع فوري للطرف الآخر)
    _stopControl(silent: true);
    _pingTimer?.cancel();
    _pingTimer = null;
    try {
      _socket?.clearListeners();
      _socket?.disconnect();
    } catch (_) {}
    _socket = null;
    _patch((s) => PhoneRemoteUiState(phase: 'idle', log: s.log));
  }

  Future<void> dispose() async {
    disconnect();
    await _stateCtl.close();
  }

  // ------------------------------------------------------------------
  // الجلسة
  // ------------------------------------------------------------------

  /// طلب التحكم بهاتف آخر — الجسر يوجّه لهدفٍ موثوق وحيٍّ وغير مشغول فقط.
  void requestControl(String targetId, String targetName) {
    final sk = _socket;
    if (sk == null || !sk.connected) return;
    if (targetId == deviceId) return; // حاجز ثانٍ: لا تحكم ذاتي من الواجهة أيضًا
    _patch((s) => s.copyWith(
          phase: 'pending',
          targetId: targetId,
          targetName: targetName,
          clearEndReason: true,
          clearRejected: true,
          clearTargetScreen: true,
        ));
    _addLog('طلب تحكم: ${targetName.isEmpty ? targetId : targetName}…');
    sk.emit(P2pEvents.ctlStart, {
      'from': deviceId,
      'target': targetId,
      'name': deviceName,
    });
  }

  /// قطع فوري من طرف المتحكم — يصل الهدف dev:ctl-stop فورًا عبر الجسر.
  void _stopControl({bool silent = false}) {
    final sk = _socket;
    final target = _state.targetId;
    final had = _state.sessionActive || _state.phase == 'pending';
    if (sk != null && sk.connected && had && target.isNotEmpty) {
      try {
        sk.emit(P2pEvents.ctlStop, {'target': target});
      } catch (_) {}
    }
    if (!silent && had) {
      _patch((s) => s.copyWith(
            phase: 'online',
            sessionActive: false,
            endReason: 'controller-stop',
            clearTargetScreen: true,
          ));
    }
  }

  void stopControl() => _stopControl();

  // ------------------------------------------------------------------
  // الإدخال (أسماء أحداث الويب نفسها — التوجيه حسب الجلسة الموثقة حصرًا)
  // ------------------------------------------------------------------

  void sendTouch(Map<String, dynamic> payload) {
    final sk = _socket;
    if (sk == null || !sk.connected || !_state.sessionActive) return;
    try {
      sk.emit(P2pEvents.touch, payload);
      _patch((s) => s.copyWith(touches: s.touches + 1));
    } catch (_) {}
  }

  void sendText(String text) {
    final sk = _socket;
    if (sk == null || !sk.connected || !_state.sessionActive) return;
    if (text.length > 2000) return;
    try {
      sk.emit(P2pEvents.text, {'text': text});
    } catch (_) {}
  }

  void sendKey(String action) {
    final sk = _socket;
    if (sk == null || !sk.connected || !_state.sessionActive) return;
    const allowed = {'back', 'home', 'recents', 'notifications', 'keyboard'};
    if (!allowed.contains(action)) return;
    try {
      sk.emit(P2pEvents.key, {'action': action});
    } catch (_) {}
  }

  // ------------------------------------------------------------------
  // الاستقبال
  // ------------------------------------------------------------------

  void _onAgents(dynamic raw) {
    final m = _firstMap(raw);
    if (m == null) return;
    final list = (m['agents'] as List?) ?? const [];
    final agents = <({String deviceId, String name})>[];
    for (final item in list) {
      if (item is! Map) continue;
      final id = '${item['deviceId'] ?? ''}';
      if (id.isEmpty || id == deviceId) continue; // نفسي لا تُعرض هدفًا أبدًا
      agents.add((deviceId: id, name: '${item['name'] ?? id}'));
    }
    _patch((s) => s.copyWith(agents: agents));
  }

  void _onCtlState(dynamic raw) {
    final m = _firstMap(raw);
    if (m == null) return;
    // التوجيه المستهدف يحمل target = معرفي (الجسر لا يوجه لغير صاحبه)
    if (m['active'] == true) {
      final target = '${m['target'] ?? _state.targetId}';
      _patch((s) => s.copyWith(
            phase: 'session',
            sessionActive: true,
            targetId: target,
            clearEndReason: true,
            clearRejected: true,
          ));
      _addLog('التحكم مفعّل — ${_state.targetName.isEmpty ? target : _state.targetName}');
    } else {
      final reason = '${m['reason'] ?? 'stopped'}';
      _patch((s) => s.copyWith(
            phase: 'online',
            sessionActive: false,
            endReason: reason,
            clearTargetScreen: true,
          ));
      _addLog('انتهت الجلسة: $reason');
    }
  }

  void _onTouchAck(dynamic raw) {
    final m = _firstMap(raw);
    if (m == null) return;
    _patch((s) => s.copyWith(acks: s.acks + 1));
  }

  void _onRejected(dynamic raw) {
    final m = _firstMap(raw);
    if (m == null) return;
    final reason = '${m['reason'] ?? '?'}';
    _patch((s) => s.copyWith(
          phase: 'online',
          sessionActive: false,
          lastRejected: reason,
        ));
    _addLog('رُفض الطلب: $reason');
    HapticFeedback.selectionClick();
  }

  void _onScreenInfo(dynamic raw) {
    final m = _firstMap(raw);
    if (m == null) return;
    // أبعاد أي وكيل — نستقبل أبعاد هدفنا حصرًا (توسيم deviceId من الجسر)
    if ('${m['deviceId'] ?? ''}' != _state.targetId) return;
    final w = (m['w'] as num?)?.toInt() ?? 0;
    final h = (m['h'] as num?)?.toInt() ?? 0;
    if (w <= 0 || h <= 0) return;
    _patch((s) => s.copyWith(
          targetScreen: (w: w, h: h, density: (m['density'] as num?)?.toInt() ?? 0),
        ));
    _addLog('أبعاد شاشة الهدف: $w×$h');
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
}

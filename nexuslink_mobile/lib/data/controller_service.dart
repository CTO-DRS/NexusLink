import 'dart:async';

import 'package:flutter/services.dart';
import 'package:sensors_plus/sensors_plus.dart';
import 'package:socket_io_client/socket_io_client.dart' as sio;

import '../core/protocol.dart';

/// طور الجسر — مرآة لسلوك media_service.
enum RcBridgePhase { offline, connecting, online }

/// لقطة حالة طبقة التحكم — يستهلكها مزوّد Riverpod وشاشة جهاز التحكم.
class RcUiState {
  final RcBridgePhase phase;
  final String desktopName;
  final String desktopMac;
  final String desktopPower; // on | sleeping | off | ...

  final String? lastRejected; // سبب آخر رفض (rc:rejected)
  final String? lastEvent; // آخر حدث ارتُد لنا (ev)

  final String? lastPcClipboard; // آخر نص وصل من الكمبيوتر
  final int? lastPcClipboardAt;

  final bool clipboardWatch; // المراقبة نشطة (استقصاء أثناء فتح الشاشة)
  final bool clipboardAuto; // إرسال تلقائي عند النسخ
  final int clipPushes; // عدد دفعات الحافظة المرسلة

  final bool airmouseOn;
  final List<double> gyro; // [x,y,z] آخر قراءة
  final int airmouseMoves;

  final int handoffSent;
  final int latencyMs;
  final String? lastError;

  const RcUiState({
    this.phase = RcBridgePhase.offline,
    this.desktopName = '',
    this.desktopMac = '',
    this.desktopPower = 'on',
    this.lastRejected,
    this.lastEvent,
    this.lastPcClipboard,
    this.lastPcClipboardAt,
    this.clipboardWatch = false,
    this.clipboardAuto = true,
    this.clipPushes = 0,
    this.airmouseOn = false,
    this.gyro = const [0, 0, 0],
    this.airmouseMoves = 0,
    this.handoffSent = 0,
    this.latencyMs = 0,
    this.lastError,
  });

  RcUiState copyWith({
    RcBridgePhase? phase,
    String? desktopName,
    String? desktopMac,
    String? desktopPower,
    String? lastRejected,
    String? lastEvent,
    String? lastPcClipboard,
    int? lastPcClipboardAt,
    bool? clipboardWatch,
    bool? clipboardAuto,
    int? clipPushes,
    bool? airmouseOn,
    List<double>? gyro,
    int? airmouseMoves,
    int? handoffSent,
    int? latencyMs,
    String? lastError,
    bool clearError = false,
  }) =>
      RcUiState(
        phase: phase ?? this.phase,
        desktopName: desktopName ?? this.desktopName,
        desktopMac: desktopMac ?? this.desktopMac,
        desktopPower: desktopPower ?? this.desktopPower,
        lastRejected: lastRejected ?? this.lastRejected,
        lastEvent: lastEvent ?? this.lastEvent,
        lastPcClipboard: lastPcClipboard ?? this.lastPcClipboard,
        lastPcClipboardAt: lastPcClipboardAt ?? this.lastPcClipboardAt,
        clipboardWatch: clipboardWatch ?? this.clipboardWatch,
        clipboardAuto: clipboardAuto ?? this.clipboardAuto,
        clipPushes: clipPushes ?? this.clipPushes,
        airmouseOn: airmouseOn ?? this.airmouseOn,
        gyro: gyro ?? this.gyro,
        airmouseMoves: airmouseMoves ?? this.airmouseMoves,
        handoffSent: handoffSent ?? this.handoffSent,
        latencyMs: latencyMs ?? this.latencyMs,
        lastError: clearError ? null : (lastError ?? this.lastError),
      );
}

/// FA-9 — خدمة التحكم بالكمبيوتر عبر جسر 3004 (عقد §4.2 + §4.9).
///
/// الهاتف يسجل نفسه `rc:hello-controller` ويستخدم أحداث rc:* لإدارة مؤشر
/// الكمبيوتر: لوحة لمس/كيبورد/ماوس هوائي (جيروسكوب)/وسائط/طاقة+Wake-on-LAN/
/// حافظة موحدة/تسليم روابط. بوابة الطاقة على الجسر ترفض الإدخال عندما يكون
/// الكمبيوتر مطفأ، وتوقظه إن كان ساكنًا.
class ControllerService {
  final String deviceName;

  ControllerService({required this.deviceName});

  sio.Socket? _socket;
  StreamSubscription<GyroscopeEvent>? _gyroSub;
  Timer? _clipTimer;
  Timer? _pingTimer;

  final _state = StreamController<RcUiState>.broadcast();
  RcUiState _cur = const RcUiState();
  RcUiState get state => _cur;

  /// تدفق الحالة للواجهة.
  Stream<RcUiState> get stateStream => _state.stream;

  // الماوس الهوائي
  final List<double> _smooth = [0, 0]; // [dx مُنعّم, dy مُنعّم]
  static const double _airGain = 220.0; // معامل تحويل rad/s → بكسل/ث
  static const double _deadzone = 0.02; // عتبة ميتة rad/s
  static const double _alpha = 0.55; // تنعيم أُسي

  // الحافظة الموحدة
  String? _lastPhoneClip; // آخر قيمة حافظة هاتف شوهدت

  void _patch(RcUiState Function(RcUiState) fn) {
    _cur = fn(_cur);
    if (!_state.isClosed) _state.add(_cur);
  }

  static Map<Object?, Object?>? _map(dynamic data) {
    if (data is List) {
      for (final item in data) {
        if (item is Map && item.isNotEmpty) return item.cast<Object?, Object?>();
      }
      return null;
    }
    if (data is Map) return data.cast<Object?, Object?>();
    return null;
  }

  // ------------------------------------------------------------------
  // الاتصال بقناة 3004
  // ------------------------------------------------------------------

  bool connect({
    required String host,
    required int port,
    required String mode, // gateway | direct
  }) {
    disconnect();
    try {
      const bridgePort = NexusPorts.remote;
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
        socket.emit(RcEvents.helloController, {'name': deviceName});
        _patch((s) => s.copyWith(phase: RcBridgePhase.online, clearError: true));
      });
      socket.onDisconnect((_) {
        _patch((s) => s.copyWith(phase: RcBridgePhase.connecting));
        _startAirmouse(false);
      });

      bind(RcEvents.hello, _onHello);
      bind(RcEvents.desktopClipboard, _onDesktopClipboard);
      bind(RcEvents.rejected, _onRejected);
      bind(RcEvents.pong, _onPong);

      socket.connect();
      _socket = socket;
      _pingTimer = Timer.periodic(const Duration(seconds: 6), (_) => ping());
      return true;
    } catch (_) {
      return false;
    }
  }

  void disconnect() {
    _pingTimer?.cancel();
    _pingTimer = null;
    _clipTimer?.cancel();
    _clipTimer = null;
    _startAirmouse(false);
    try {
      _socket?.clearListeners();
      _socket?.disconnect();
    } catch (_) {}
    _socket = null;
    _patch((s) => RcUiState(clipboardAuto: s.clipboardAuto));
  }

  // ------------------------------------------------------------------
  // الاستقبال
  // ------------------------------------------------------------------

  void _onHello(dynamic raw) {
    final m = _map(raw);
    if (m == null) return;
    final d = (m['desktop'] is Map) ? (m['desktop'] as Map).cast<Object?, Object?>() : null;
    if (d == null) return;
    _patch((s) => s.copyWith(
          desktopName: '${d['name'] ?? ''}',
          desktopMac: '${d['mac'] ?? ''}',
          desktopPower: '${d['power'] ?? 'on'}',
        ));
  }

  void _onDesktopClipboard(dynamic raw) {
    final m = _map(raw);
    if (m == null) return;
    final text = '${m['text'] ?? ''}';
    if (text.isEmpty) return;
    // منع الصدى: النص نفسه أرسلناه من الهاتف للتو
    if (text == _lastPhoneClip) return;
    _patch((s) => s.copyWith(lastPcClipboard: text, lastPcClipboardAt: DateNow.now()));
  }

  void _onRejected(dynamic raw) {
    final m = _map(raw);
    if (m == null) return;
    _patch((s) => s.copyWith(
          lastRejected: '${m['reason'] ?? '?'}',
          lastEvent: '${m['ev'] ?? '?'}',
        ));
  }

  void _onPong(dynamic raw) {
    final m = _map(raw);
    final t = (m?['t'] as num?)?.toInt();
    if (t == null) return;
    final dt = DateNow.now() - t;
    if (dt >= 0 && dt < 60000) _patch((s) => s.copyWith(latencyMs: dt));
  }

  bool get _ready {
    final sk = _socket;
    return sk != null && sk.connected && _cur.desktopPower != 'off' && _cur.desktopPower != 'shutting-down';
  }

  // ------------------------------------------------------------------
  // الإرسال — إدخال المؤشر والكيبورد
  // ------------------------------------------------------------------

  /// حركة نسبية للمؤشر (نسبية إلى ارتفاع لوحة اللمس على الشاشة).
  void move(double dx, double dy, {String source = 'touchpad', bool drag = false}) {
    final sk = _socket;
    if (sk == null || !sk.connected) return;
    if (dx == 0 && dy == 0) return;
    final data = <String, dynamic>{
      'dx': _clamp(dx), 'dy': _clamp(dy), 'source': source,
    };
    if (drag) data['drag'] = true;
    sk.emit(RcEvents.move, data);
  }

  void click({String button = 'left', String type = 'tap'}) {
    final sk = _socket;
    if (sk == null || !sk.connected) return;
    sk.emit(RcEvents.click, {'button': button, 'type': type});
  }

  void scroll(double dy) {
    final sk = _socket;
    if (sk == null || !sk.connected) return;
    if (dy == 0) return;
    sk.emit(RcEvents.scroll, {'dy': _clamp(dy)});
  }

  void pinch(double scale) {
    final sk = _socket;
    if (sk == null || !sk.connected) return;
    sk.emit(RcEvents.pinch, {'scale': _clamp(scale, hi: 8)});
  }

  void key(String ch) {
    final sk = _socket;
    if (sk == null || !sk.connected) return;
    if (ch.isEmpty) return;
    sk.emit(RcEvents.key, {'ch': ch});
  }

  void keySpecial(String special) {
    final sk = _socket;
    if (sk == null || !sk.connected) return;
    const allowed = {'backspace', 'enter', 'space', 'up', 'down', 'left', 'right', 'esc', 'tab'};
    if (!allowed.contains(special)) return;
    sk.emit(RcEvents.key, {'special': special});
  }

  void media(String action, {double? value}) {
    final sk = _socket;
    if (sk == null || !sk.connected) return;
    final data = <String, dynamic>{'action': action};
    if (value != null) data['value'] = _clamp(value, hi: 100);
    sk.emit(RcEvents.media, data);
  }

  void power(String action) {
    final sk = _socket;
    if (sk == null || !sk.connected) return;
    // FA-power (عقد §12): logout أمر نظام معتمد (تأكيد أمان 10ث في الطبقة الأصلية)
    const allowed = {'shutdown', 'restart', 'sleep', 'hibernate', 'lock', 'unlock', 'logout'};
    if (!allowed.contains(action)) return;
    sk.emit(RcEvents.power, {'action': action});
  }

  void wakeLan(String mac) {
    final sk = _socket;
    if (sk == null || !sk.connected) return;
    final norm = mac.trim().replaceAll('-', ':').toUpperCase();
    sk.emit(RcEvents.wol, {'mac': norm});
  }

  /// دفع نص حافظة الهاتف إلى الكمبيوتر (اختبار النجاح: Ctrl+V هناك).
  Future<void> pushClipboard([String? explicit]) async {
    final sk = _socket;
    if (sk == null || !sk.connected) return;
    var text = explicit;
    if (text == null || text.isEmpty) {
      try {
        text = await Clipboard.getData(Clipboard.kTextPlain).then((v) => v?.text);
      } catch (_) {
        return;
      }
    }
    if (text == null || text.isEmpty) return;
    _lastPhoneClip = text;
    sk.emit(RcEvents.clipboard, {'direction': 'toPc', 'text': text});
    _patch((s) => s.copyWith(clipPushes: s.clipPushes + 1));
  }

  /// طلب حافظة الكمبيوتر (يرد الكمبيوتر بـ desktop:clipboard).
  void pullPcClipboard() {
    final sk = _socket;
    if (sk == null || !sk.connected) return;
    sk.emit(RcEvents.clipboard, {'direction': 'pull'});
  }

  /// FA-clipboard-sync — نص خارجي وضعه غيرنا في حافظة الهاتف (من الكمبيوتر عبر
  /// الخدمة الأصلية، أو من النسخ التلقائي للنصوص الواردة): تحديث الحرس كي
  /// لا تعيده مراقبة الشاشة المفتوحة إلى الكمبيوتر (حرس الحلقة، عقد §11.ج).
  void markExternal(String text) {
    if (text.isEmpty) return;
    _lastPhoneClip = text;
  }

  /// تسليم رابط «أكمل من حيث توقفت» إلى الكمبيوتر.
  void handoff(String url, {String? title}) {
    final sk = _socket;
    if (sk == null || !sk.connected) return;
    final u = url.trim();
    if (u.isEmpty) return;
    if (!(u.startsWith('http://') || u.startsWith('https://'))) {
      _patch((s) => s.copyWith(lastError: 'التسليم يقبل روابط http/https فقط'));
      return;
    }
    if (u.length > 2048) {
      _patch((s) => s.copyWith(lastError: 'الرابط أطول من الحد (2048)'));
      return;
    }
    sk.emit(RcEvents.handoff, {'url': u, 'title': title?.trim()});
    _patch((s) => s.copyWith(handoffSent: s.handoffSent + 1, clearError: true));
  }

  void ping() {
    final sk = _socket;
    if (sk == null || !sk.connected) return;
    sk.emit(RcEvents.ping, {'t': DateNow.now()});
  }

  static double _clamp(double v, {double hi = 200}) =>
      v.isFinite ? (v < -hi ? -hi : (v > hi ? hi : v)) : 0;

  // ------------------------------------------------------------------
  // الماوس الهوائي (البند 3) — جيروسكوب → حركة مؤشر
  // ------------------------------------------------------------------

  /// إيماءة التفعيل: الزر أو 3 نقرات سريعة (تديرها الشاشة) — هنا التشغيل الفعلي.
  void _startAirmouse(bool on) {
    if (on == _cur.airmouseOn) return;
    if (on) {
      _smooth[0] = 0;
      _smooth[1] = 0;
      _gyroSub = gyroscopeEventStream(samplingPeriod: const Duration(milliseconds: 50)).listen(
        (e) {
          // التدوير حول Y = أفقي، حول X = عمودي (بيان الهاتف رأسيًا)
          final rx = e.y.clamp(-8.0, 8.0);
          final ry = -e.x.clamp(-8.0, 8.0);
          _smooth[0] = _smooth[0] * (1 - _alpha) + rx * _alpha;
          _smooth[1] = _smooth[1] * (1 - _alpha) + ry * _alpha;
          final dx = _smooth[0] * _airGain * 0.05; // 50ms عينة
          final dy = _smooth[1] * _airGain * 0.05;
          if (_smooth[0].abs() > _deadzone || _smooth[1].abs() > _deadzone) {
            move(dx, dy, source: 'airmouse');
            _patch((s) => s.copyWith(
                  gyro: [e.x, e.y, e.z],
                  airmouseMoves: s.airmouseMoves + 1,
                ));
          }
        },
        onError: (_) => _startAirmouse(false),
      );
      _patch((s) => s.copyWith(airmouseOn: true));
    } else {
      _gyroSub?.cancel();
      _gyroSub = null;
      _patch((s) => s.copyWith(airmouseOn: false));
    }
  }

  void setAirmouse(bool on) => _startAirmouse(on);

  // ------------------------------------------------------------------
  // الحافظة الموحدة (البند 5) — مراقبة حافظة الهاتف أثناء فتح الشاشة
  // ------------------------------------------------------------------

  /// تشغيل/إيقاف المراقبة — استقصاء كل 1.5 ثانية (بلا خدمات خلفية: قيد Android 10+).
  void setClipboardWatch(bool on) {
    if (on == _cur.clipboardWatch) return;
    _clipTimer?.cancel();
    _clipTimer = null;
    if (on) {
      _clipTimer = Timer.periodic(const Duration(milliseconds: 1500), (_) => _checkClipboard());
      _checkClipboard();
    }
    _patch((s) => s.copyWith(clipboardWatch: on));
  }

  void setClipboardAuto(bool on) {
    _patch((s) => s.copyWith(clipboardAuto: on));
  }

  Future<void> _checkClipboard() async {
    if (!_ready) return;
    try {
      final text = await Clipboard.getData(Clipboard.kTextPlain).then((v) => v?.text);
      if (text == null || text.isEmpty) return;
      if (text == _lastPhoneClip) return;
      _lastPhoneClip = text;
      if (_cur.clipboardAuto) {
        final sk = _socket;
        if (sk == null || !sk.connected) return;
        sk.emit(RcEvents.clipboard, {'direction': 'toPc', 'text': text});
        _patch((s) => s.copyWith(clipPushes: s.clipPushes + 1));
      }
    } catch (_) {}
  }

  /// نسخ نص الكمبيوتر الوارد إلى حافظة الهاتف.
  Future<void> copyPcToPhone() async {
    final t = _cur.lastPcClipboard;
    if (t == null || t.isEmpty) return;
    try {
      await Clipboard.setData(ClipboardData(text: t));
      _lastPhoneClip = t; // منع الإرسال المترجع
    } catch (_) {}
  }

  void dispose() {
    disconnect();
    _state.close();
  }
}

/// غلاف صغير لجمع الزمن بالملي ثانية (يسهل الاستبدال في الاختبارات).
class DateNow {
  static int now() => DateTime.now().millisecondsSinceEpoch;
}

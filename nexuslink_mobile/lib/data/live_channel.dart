import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

/// NexusLive — عميل القناة الحية UDP (الجولة 4 — عقد §18)
/// ============================================================================
/// «كل ميزة حساسة للأداء تعمل فوق قناة UDP عالية التردد»: عميل الهاتف يرسل
/// داتاجرامًا واحدًا لكل حدث (≤32B — ضبط حزمة واحدة، لا تجزئة) إلى جسر
/// سطح المكتب :3010، ويعيد التوجيه داخليًا إلى حوض Rust (loopback :3011).
///
/// · إعادة الاتصال: watchdog بلا pong لمدة 3ث → طلب rc:live-hello مجددًا
///   عبر السوكِت التعاقدي (callback يملكه controller_service) بتراجع أُسي
///   500ms→8s يُصفَّر عند أول pong.
/// · قياس RTT: ping كل 500ms → pong من الجسر (نفس seq) → EMA α=0.3،
///   ومزامنة إزاحة ساعة NTP-نمط: offset ≈ pongTs − (t0+t1)/2 — ts حزم
///   البيانات = ساعة الهاتف + الإزاحة (كمون طرف-إلى-طرف يقيسه live.rs).
/// · الثقة: مفتاح 8B من rc:live-ready يُلحق بكل حزمة (بايتات 14..22) —
///   بلا جلسة/مفتاح ترفض الحزم عند الجسر صامتًا.
///
/// تخطيط الحزمة (big-endian — مرآة حرفية لlive_core.rs):
///   رأس 20B: magic u16=0x4E58 · ver u8=1 · type u8 · flags u8 (bit0=نسبي
///   للماوس) · محجوز u8 · seq u32 · ts u32 (ms epoch مقتطعة) · key 8B
///   pen 12B: nx·ny u16 · pressure u16 · tiltX·tiltY i8 · phase u8 · buttons u8
///   mouse 10B: nx|dx · ny|dy (مطلق u16 / نسبي i16 ±500) · phase u8 · buttons u8 · wheel i16
///   gyro 12B: ax·ay·az·gx·gy·gz i16 (milli-g / milli-dps)
///   touch 8B: nx·ny u16 · action u8 · pointerId u8 · pad u16
///   ping 0B (يرد الجسر pong type=0x7E بنفس seq وts=زمن الجسر)

enum LivePhase { idle, opening, ready, error }

/// طور القلم (pen.phase)
enum PenPhase { hover, down, move, up }

/// إجراءات الماوس/اللمس (تطابق POINTER_ACTIONS في input_exec §15)
enum LiveAction { move, down, up, click, dblclick, rclick }

class LiveStats {
  final int sent;
  final int pongs;
  final int reconnects;
  final int sendErrors;
  final double rttMs; // EMA
  final int offsetMs; // ساعة الهاتف + offset ≈ ساعة الجسر
  final int lastPongAt; // epoch ms
  final LivePhase phase;
  final String? lastError;

  const LiveStats({
    this.sent = 0,
    this.pongs = 0,
    this.reconnects = 0,
    this.sendErrors = 0,
    this.rttMs = 0,
    this.offsetMs = 0,
    this.lastPongAt = 0,
    this.phase = LivePhase.idle,
    this.lastError,
  });
}

class LiveChannel {
  LiveChannel(this._requestHello);

  /// طلب فتح/إعادة فتح التدفق — يمسكه controller_service (يبث rc:live-hello
  /// فوق socket.io — القناة التعاقدية للثقة حصرًا)
  final void Function() _requestHello;

  // ثوابت البروتوكول (عقد §18 — مرآة live_core.rs)
  static const int _magic = 0x4E58;
  static const int _version = 1;
  static const int _typePen = 1;
  static const int _typeMouse = 2;
  static const int _typeGyro = 3;
  static const int _typeTouch = 4;
  static const int _typePing = 0x7F;
  static const int _typePong = 0x7E;
  static const int _headerLen = 22; // magic2+ver1+type1+flags1+rsv1+seq4+ts4+key8
  static const int _maxDatagram = 128;

  // أطوار القلم وإجراءات المؤشر (قيم التعاقد)
  static const int _penHover = 0, _penDown = 1, _penMove = 2, _penUp = 3;

  /// أداة القلم (الجولة 4 مرحلة ② عقد §20 — flags bits1-2 لحزمة pen)
  static const int penToolPen = 0;
  static const int penToolEraser = 1;
  static const int penToolFinger = 2;
  static const int _actMove = 0,
      _actDown = 1,
      _actUp = 2,
      _actClick = 3,
      _actDblclick = 4,
      _actRclick = 5;

  // ضبط التوقيت
  static const Duration _pingEvery = Duration(milliseconds: 500);
  static const Duration _pongTimeout = Duration(seconds: 3);
  static const int _retryBaseMs = 500;
  static const int _retryMaxMs = 8000;

  RawDatagramSocket? _sock;
  InternetAddress? _addr;
  int _port = 0;
  List<int> _key = const [];
  int _seq = 0;
  StreamSubscription<RawSocketEvent>? _sub;

  Timer? _pingTimer;
  Timer? _retryTimer;
  int _retryBackoffMs = _retryBaseMs;
  final Map<int, int> _pings = {}; // seq → t0 (epoch ms هاتف)

  double _rttEma = 0;
  int _offsetMs = 0;
  int _sent = 0;
  int _pongs = 0;
  int _sendErrors = 0;
  int _reconnects = 0;
  int _lastPongAt = 0;
  LivePhase _phase = LivePhase.idle;
  String? _lastError;

  final StreamController<LiveStats> _stats = StreamController<LiveStats>.broadcast();
  LiveStats _cur = const LiveStats();

  LiveStats get state => _cur;
  Stream<LiveStats> get statsStream => _stats.stream;
  bool get isActive => _cur.phase == LivePhase.ready && _sock != null && _key.isNotEmpty;

  void _patch(LiveStats Function(LiveStats) fn) {
    _cur = fn(_cur);
    if (!_stats.isClosed) _stats.add(_cur);
  }

  // --------------------------------------------------------------------------
  // دورة الحياة — تديرها controller_service عبر أحداث الجسر التعاقدية
  // --------------------------------------------------------------------------

  /// rc:live-ready وصل: فتح السوكِت وبدء النبض. host = عنوان الكمبيوتر
  /// المعروف لدى الهاتف (نفس مضيف socket.io — UDP مباشر بلا بوابة TCP).
  Future<void> activate({required String host, required int port, required String keyHex}) async {
    deactivate(silent: true);
    _patch((s) => s.copyWith(phase: LivePhase.opening, clearError: true));
    try {
      final addr = InternetAddress(host);
      final sock = await RawDatagramSocket.bind(InternetAddress.anyIPv4, 0);
      _addr = addr;
      _port = port;
      _key = _hexDecode(keyHex);
      _sock = sock;
      _sub = sock.listen(_onEvent);
      _pingTimer = Timer.periodic(_pingEvery, (_) => _ping());
      _watchdogStart();
      _patch((s) => s.copyWith(phase: LivePhase.ready));
    } catch (e) {
      _lastError = 'فشل فتح القناة الحية: $e';
      _patch((s) => s.copyWith(phase: LivePhase.error, lastError: _lastError));
      _scheduleRetry();
    }
  }

  /// إنهاء القناة (نهاية جلسة/انقطاع سوكِت/إغلاق شاشة)
  void deactivate({bool silent = false, String? reason}) {
    _pingTimer?.cancel();
    _pingTimer = null;
    _retryTimer?.cancel();
    _retryTimer = null;
    _sub?.cancel();
    _sub = null;
    try {
      _sock?.close();
    } catch (_) {}
    _sock = null;
    _key = const [];
    _pings.clear();
    _phase = silent ? LivePhase.idle : LivePhase.idle;
    if (!silent) {
      _patch((s) => LiveStats(
            sent: _sent,
            pongs: _pongs,
            reconnects: _reconnects,
            sendErrors: _sendErrors,
            rttMs: s.rttMs,
            offsetMs: s.offsetMs,
            phase: LivePhase.idle,
            lastError: reason,
          ));
    }
  }

  void dispose() {
    deactivate(silent: true);
    _stats.close();
  }

  // --------------------------------------------------------------------------
  // الاستقبال — pong فقط (الجسر لا يرسل غيره إلى الهاتف)
  // --------------------------------------------------------------------------

  void _onEvent(RawSocketEvent ev) {
    final sock = _sock;
    if (sock == null || ev != RawSocketEvent.read) return;
    final dg = sock.receive();
    if (dg == null || dg.data.length < _headerLen) return;
    final b = dg.data;
    final bd = ByteData.sublistView(b);
    if (bd.getUint16(0, Endian.big) != _magic || b[2] != _version) return;
    if (b[3] != _typePong) return;
    final seq = bd.getUint32(6, Endian.big);
    final serverTs = bd.getUint32(10, Endian.big);
    final t0 = _pings.remove(seq);
    if (t0 == null) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final rtt = (now - t0).clamp(0, 60000).toDouble();
    // مزامنة إزاحة NTP-نمط: serverTs ≈ منتصف الرحلة + offset
    final offset = serverTs - ((t0 + now) ~/ 2);
    _rttEma = _rttEma <= 0 ? rtt : (_rttEma * 0.7 + rtt * 0.3);
    _offsetMs = _rttEma <= 0 ? offset : (offset * 0.3 + _offsetMs * 0.7).round();
    _lastPongAt = now;
    _retryBackoffMs = _retryBaseMs; // نجاح — تصفير التراجع
    _pongs++;
    _patch((s) => s.copyWith(
          sent: _sent,
          pongs: _pongs,
          rttMs: _rttEma,
          offsetMs: _offsetMs,
          phase: LivePhase.ready,
          clearError: true,
        ));
  }

  // --------------------------------------------------------------------------
  // النبض + إعادة الاتصال (بتراجع أُسي)
  // --------------------------------------------------------------------------

  void _ping() {
    if (!isActive) return;
    final seq = _nextSeq();
    final t0 = DateTime.now().millisecondsSinceEpoch;
    _pings[seq] = t0;
    if (_pings.length > 32) {
      // تنظيف نبضات بلا رد (قناة فاقدة) — أقدمها
      _pings.remove(_pings.keys.first);
    }
    final raw = _encode(_typePing, 0, seq, _rawTs(), _key, const []);
    _sendRaw(raw);
  }

  void _watchdogStart() {
    _retryTimer?.cancel();
    _retryTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!isActive) return;
      final idle = DateTime.now().millisecondsSinceEpoch - _lastPongAt;
      if (_lastPongAt != 0 && idle > _pongTimeout.inMilliseconds) {
        _reconnects++;
        _patch((s) => s.copyWith(reconnects: _reconnects, phase: LivePhase.opening));
        _requestHello();
      } else if (_lastPongAt == 0 && idle > _pongTimeout.inMilliseconds && _sent > 0) {
        // فُتحت القناة ولم يرد pong قط — أعد الطلب
        _reconnects++;
        _patch((s) => s.copyWith(reconnects: _reconnects));
        _requestHello();
      }
    });
  }

  void _scheduleRetry() {
    _retryTimer?.cancel();
    _retryTimer = Timer(Duration(milliseconds: _retryBackoffMs), () {
      _retryBackoffMs = (_retryBackoffMs * 2).clamp(_retryBaseMs, _retryMaxMs);
      if (!isActive) _requestHello();
    });
  }

  // --------------------------------------------------------------------------
  // الإرسال — دالة عامة لكل الأنواع (داتاجرام واحد لكل حدث — عقد §18)
  // --------------------------------------------------------------------------

  int _nextSeq() => _seq = (_seq + 1) & 0xFFFFFFFF;

  int _rawTs() => DateTime.now().millisecondsSinceEpoch & 0xFFFFFFFF;

  /// ts بيانات = ساعة الهاتف + الإزاحة المقدرة (كمون طرف-إلى-طرف عند Rust)
  int _syncedTs() => (DateTime.now().millisecondsSinceEpoch + _offsetMs) & 0xFFFFFFFF;

  List<int> _encode(int type, int flags, int seq, int ts, List<int> key, List<int> payload) {
    final out = Uint8List(_headerLen + payload.length);
    final bd = ByteData.sublistView(out);
    bd.setUint16(0, _magic, Endian.big);
    out[2] = _version;
    out[3] = type;
    out[4] = flags;
    out[5] = 0; // محجوز
    bd.setUint32(6, seq, Endian.big);
    bd.setUint32(10, ts, Endian.big);
    out.setRange(14, 22, key.length == 8 ? key : List<int>.filled(8, 0));
    out.setRange(_headerLen, out.length, payload);
    return out;
  }

  void _sendRaw(List<int> raw) {
    final sock = _sock;
    final addr = _addr;
    if (sock == null || addr == null || !isActive) return;
    if (raw.length > _maxDatagram) return; // حاجز دفاعي (التعاقد ≤32 فعليًا)
    try {
      sock.send(raw, addr, _port);
      _sent++;
      // بلا patch لكل إرسال — القناة تصل 240Hz والإشعار يغرق الواجهة؛
      // العدادات تتحدث على نبض pong (كل 500ms) وفي انتقالات الحالة
    } catch (e) {
      _sendErrors++;
      _patch((s) => s.copyWith(sendErrors: _sendErrors, phase: LivePhase.error, lastError: 'فشل إرسال: $e'));
      deactivate(silent: true);
      _scheduleRetry();
    }
  }

  // --------------------------------------------------------------------------
  // واجهات الإرسال المباشر (تستهلكها مهام المراحل القادمة + شاشة التحكم)
  // --------------------------------------------------------------------------

  /// قلم: إحداثيات 0..1 + ضغط 0..1 + ميل ±60 + طور + أزرار (bit0=زر خلفي)
  /// + أداة (§20: 0=قلم 1=ممحاة 2=إصبع — flags bits1-2؛ خارجها يطبع قلمًا
  /// توافقًا مع ترميز live_core)
  void sendPen(double nx, double ny, double pressure,
      {int tiltX = 0, int tiltY = 0, required PenPhase phase, int buttons = 0, int tool = penToolPen}) {
    // حمولة 10B: nx2+ny2+pressure2+tilt1+tilt1+phase1+buttons1 (عقد §18)
    final p = Uint8List(10);
    final bd = ByteData.sublistView(p);
    bd.setUint16(0, (nx.clamp(0.0, 1.0) * 65535).round(), Endian.big);
    bd.setUint16(2, (ny.clamp(0.0, 1.0) * 65535).round(), Endian.big);
    bd.setUint16(4, (pressure.clamp(0.0, 1.0) * 65535).round(), Endian.big);
    p[6] = tiltX.clamp(-60, 60) & 0xFF;
    p[7] = tiltY.clamp(-60, 60) & 0xFF;
    p[8] = switch (phase) {
      PenPhase.hover => _penHover,
      PenPhase.down => _penDown,
      PenPhase.move => _penMove,
      PenPhase.up => _penUp,
    };
    p[9] = buttons & 0xFF;
    final t = tool > penToolFinger ? penToolPen : tool;
    _sendRaw(_encode(_typePen, t << 1, _nextSeq(), _syncedTs(), _key, p));
  }

  /// ماوس نسبي (ماوس هوائي/لوحة لمس): إزاحة ±500 بكسل + أزرار bit0=أيسر مضغوط
  /// (حالة الزر في كل حزمة — دلالة حية ذاتية التصحيح ضد فقد الحزم) + عجلة.
  void sendMouseRel(double dx, double dy,
      {bool leftDown = false, int phase = _actMove, int wheel = 0}) {
    // حمولة 8B: dx2+dy2+phase1+buttons1+wheel2 — flags bit0=1 (نسبي)
    final p = Uint8List(8);
    final bd = ByteData.sublistView(p);
    bd.setInt16(0, dx.clamp(-500.0, 500.0).round(), Endian.big);
    bd.setInt16(2, dy.clamp(-500.0, 500.0).round(), Endian.big);
    p[4] = phase & 0xFF;
    p[5] = leftDown ? 1 : 0;
    bd.setInt16(6, wheel.clamp(-100, 100), Endian.big);
    _sendRaw(_encode(_typeMouse, 0x01, _nextSeq(), _syncedTs(), _key, p));
  }

  /// ماوس مطلق (مؤشر عرض تقديمي): إحداثيات 0..1 + إجراء + عجلة
  void sendMouseAbs(double nx, double ny,
      {required LiveAction action, int wheel = 0}) {
    final p = Uint8List(8);
    final bd = ByteData.sublistView(p);
    bd.setUint16(0, (nx.clamp(0.0, 1.0) * 65535).round(), Endian.big);
    bd.setUint16(2, (ny.clamp(0.0, 1.0) * 65535).round(), Endian.big);
    p[4] = action.index & 0xFF;
    p[5] = 0;
    bd.setInt16(6, wheel.clamp(-100, 100), Endian.big);
    _sendRaw(_encode(_typeMouse, 0x00, _nextSeq(), _syncedTs(), _key, p));
  }

  /// جيروسكوب/تسارع خام: تسارع milli-g + دوران milli-dps (مستهلكه مهمة الجيمباد)
  void sendGyro(List<double> accel, List<double> gyro) {
    if (accel.length < 3 || gyro.length < 3) return;
    final p = Uint8List(12);
    final bd = ByteData.sublistView(p);
    for (var i = 0; i < 3; i++) {
      bd.setInt16(i * 2, (accel[i] * 1000).round().clamp(-32768, 32767), Endian.big);
      bd.setInt16(6 + i * 2, (gyro[i] * 1000).round().clamp(-32768, 32767), Endian.big);
    }
    _sendRaw(_encode(_typeGyro, 0, _nextSeq(), _syncedTs(), _key, p));
  }

  /// لمس على الشاشة المعروضة: إحداثيات 0..1 + إجراء (نفس ptr الستة)
  void sendTouch(double nx, double ny, {required LiveAction action, int pointerId = 0}) {
    final p = Uint8List(8);
    final bd = ByteData.sublistView(p);
    bd.setUint16(0, (nx.clamp(0.0, 1.0) * 65535).round(), Endian.big);
    bd.setUint16(2, (ny.clamp(0.0, 1.0) * 65535).round(), Endian.big);
    p[4] = action.index & 0xFF;
    p[5] = pointerId & 0xFF;
    // pad u16 يبقى صفرًا
    _sendRaw(_encode(_typeTouch, 0, _nextSeq(), _syncedTs(), _key, p));
  }

  // --------------------------------------------------------------------------

  static List<int> _hexDecode(String hex) {
    final h = hex.replaceAll(RegExp('[^0-9a-fA-F]'), '');
    if (h.length != 16) return const [];
    final out = List<int>.filled(8, 0);
    for (var i = 0; i < 8; i++) {
      out[i] = int.parse(h.substring(i * 2, i * 2 + 2), radix: 16);
    }
    return out;
  }
}

extension on LiveStats {
  LiveStats copyWith({
    int? sent,
    int? pongs,
    int? reconnects,
    int? sendErrors,
    double? rttMs,
    int? offsetMs,
    LivePhase? phase,
    String? lastError,
    bool clearError = false,
  }) {
    return LiveStats(
      sent: sent ?? this.sent,
      pongs: pongs ?? this.pongs,
      reconnects: reconnects ?? this.reconnects,
      sendErrors: sendErrors ?? this.sendErrors,
      rttMs: rttMs ?? this.rttMs,
      offsetMs: offsetMs ?? this.offsetMs,
      lastPongAt: lastPongAt,
      phase: phase ?? this.phase,
      lastError: clearError ? null : (lastError ?? this.lastError),
    );
  }
}

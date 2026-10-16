import 'dart:async';

import 'dart:math' as math;

import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:image/image.dart' as img;
import 'package:sensors_plus/sensors_plus.dart';
import 'package:socket_io_client/socket_io_client.dart' as sio;

import '../core/protocol.dart';
import 'native_bridge.dart';
import 'transfer_api.dart';

/// طُوَر جلسة وسائط واحدة (كاميرا/ميك/طفل).
enum MediaPhase { idle, connecting, live, error }

class MediaKindState {
  final MediaPhase phase;
  final String? error;
  const MediaKindState({this.phase = MediaPhase.idle, this.error});
}

/// لقطة كاملة لحالة طبقة الوسائط — يستهلكها مزوّد Riverpod وشاشة الوسائط.
class MediaUiState {
  final bool bridgeOnline;
  final MediaKindState cam;
  final MediaKindState mic;
  final MediaKindState baby;

  final String facing; // front | back
  final bool torch;
  final bool watchOn;
  final double sensitivity; // 0..1

  final int motionCount;
  final int? lastMotionAt;
  final int lastMotionLevel;

  final bool shutterBusy;
  final int shutterCountdown; // ثوانٍ متبقية (0 = لا عد)
  final String? lastShotName;
  final String? lastError;

  final int babyLevel; // 0..100 (getStats audioLevel)
  final int babyAlerts;

  final bool sensorsOn;
  final List<double> acc; // [x,y,z]
  final List<double> gyro; // [x,y,z]
  final int sensorMsgs;

  final MediaStream? previewStream; // المعاينة المصغرة للكاميرا

  // FA-media (عقد §15) — عرض شاشة الكمبيوتر (الاتجاه المعاكس: الكمبيوتر صاحب الوسائط)
  final MediaKindState screen;
  final MediaStream? screenStream; // تدفق الفيديو الوارد من الكمبيوتر
  final int screenW; // أبعاد سطح المكتب الملتقط (أساس خريطة اللمس)
  final int screenH;
  final int screenFps;

  // R4 ① (عقد §19) — الشاشة الثانية: حالة الكمبيوتر الصادقة
  final bool ssActive;
  final String ssTarget; // "screen:N" — هدف البث الجاري
  final int ssW;
  final int ssH;
  final String? ssError;

  // الجولة 5 (عقد §24) — مرآة الهاتف (هاتف→هاتف): kind='mirror'
  // mirrorRole: 'share' = أنا أنشر شاشتي · 'view' = أنا أعرض شاشة هاتف آخر
  final MediaKindState mirror;
  final MediaStream? mirrorStream; // تدفق الهاتف الآخر الوارد (عارض)
  final String mirrorRole;

  const MediaUiState({
    this.bridgeOnline = false,
    this.cam = const MediaKindState(),
    this.mic = const MediaKindState(),
    this.baby = const MediaKindState(),
    this.facing = 'back',
    this.torch = false,
    this.watchOn = false,
    this.sensitivity = 0.5,
    this.motionCount = 0,
    this.lastMotionAt,
    this.lastMotionLevel = 0,
    this.shutterBusy = false,
    this.shutterCountdown = 0,
    this.lastShotName,
    this.lastError,
    this.babyLevel = 0,
    this.babyAlerts = 0,
    this.sensorsOn = false,
    this.acc = const [0, 0, 0],
    this.gyro = const [0, 0, 0],
    this.sensorMsgs = 0,
    this.previewStream,
    this.screen = const MediaKindState(),
    this.screenStream,
    this.screenW = 0,
    this.screenH = 0,
    this.screenFps = 30,
    this.ssActive = false,
    this.ssTarget = '',
    this.ssW = 0,
    this.ssH = 0,
    this.ssError,
    this.mirror = const MediaKindState(),
    this.mirrorStream,
    this.mirrorRole = '',
  });

  bool get anyStreamOn =>
      cam.phase == MediaPhase.live ||
      cam.phase == MediaPhase.connecting ||
      mic.phase == MediaPhase.live ||
      mic.phase == MediaPhase.connecting ||
      baby.phase == MediaPhase.live ||
      baby.phase == MediaPhase.connecting;

  MediaUiState copyWith({
    bool? bridgeOnline,
    MediaKindState? cam,
    MediaKindState? mic,
    MediaKindState? baby,
    String? facing,
    bool? torch,
    bool? watchOn,
    double? sensitivity,
    int? motionCount,
    int? lastMotionAt,
    int? lastMotionLevel,
    bool? shutterBusy,
    int? shutterCountdown,
    String? lastShotName,
    String? lastError,
    bool clearError = false,
    int? babyLevel,
    int? babyAlerts,
    bool? sensorsOn,
    List<double>? acc,
    List<double>? gyro,
    int? sensorMsgs,
    MediaStream? previewStream,
    bool clearPreview = false,
    MediaKindState? screen,
    MediaStream? screenStream,
    bool clearScreenStream = false,
    int? screenW,
    int? screenH,
    int? screenFps,
    bool? ssActive,
    String? ssTarget,
    int? ssW,
    int? ssH,
    String? ssError,
    bool clearSsError = false,
    MediaKindState? mirror,
    MediaStream? mirrorStream,
    bool clearMirrorStream = false,
    String? mirrorRole,
  }) =>
      MediaUiState(
        bridgeOnline: bridgeOnline ?? this.bridgeOnline,
        cam: cam ?? this.cam,
        mic: mic ?? this.mic,
        baby: baby ?? this.baby,
        facing: facing ?? this.facing,
        torch: torch ?? this.torch,
        watchOn: watchOn ?? this.watchOn,
        sensitivity: sensitivity ?? this.sensitivity,
        motionCount: motionCount ?? this.motionCount,
        lastMotionAt: lastMotionAt ?? this.lastMotionAt,
        lastMotionLevel: lastMotionLevel ?? this.lastMotionLevel,
        shutterBusy: shutterBusy ?? this.shutterBusy,
        shutterCountdown: shutterCountdown ?? this.shutterCountdown,
        lastShotName: lastShotName ?? this.lastShotName,
        lastError: clearError ? null : (lastError ?? this.lastError),
        babyLevel: babyLevel ?? this.babyLevel,
        babyAlerts: babyAlerts ?? this.babyAlerts,
        sensorsOn: sensorsOn ?? this.sensorsOn,
        acc: acc ?? this.acc,
        gyro: gyro ?? this.gyro,
        sensorMsgs: sensorMsgs ?? this.sensorMsgs,
        previewStream: clearPreview ? null : (previewStream ?? this.previewStream),
        screen: screen ?? this.screen,
        screenStream: clearScreenStream ? null : (screenStream ?? this.screenStream),
        screenW: screenW ?? this.screenW,
        screenH: screenH ?? this.screenH,
        screenFps: screenFps ?? this.screenFps,
        ssActive: ssActive ?? this.ssActive,
        ssTarget: ssTarget ?? this.ssTarget,
        ssW: ssW ?? this.ssW,
        ssH: ssH ?? this.ssH,
        ssError: clearSsError ? null : (ssError ?? this.ssError),
        mirror: mirror ?? this.mirror,
        mirrorStream: clearMirrorStream ? null : (mirrorStream ?? this.mirrorStream),
        mirrorRole: mirrorRole ?? this.mirrorRole,
      );
}

/// خدمة طبقة الوسائط والكاميرا (FA-8) — عقد §4.3 على قناة 3005.
///
/// تسلسل WebRTC: الهاتف صاحب الوسائط ينشئ `rtc:offer {kind, sdp}` لكل جلسة
/// (cam | mic | baby)، الكمبيوتر يجيب `rtc:answer` ويتبادلان `rtc:ice`.
/// المراقبة: بث كاميرا مستمر + كشف حركة بفروق الإطارات (captureFrame →
/// تصغير → فرق لوميناني — بلا AI) → sec:motion.
/// مراقبة الأطفال: صوت فقط + WakeLock جزئي + getStats audioLevel → baby:alert.
class MediaService {
  final String deviceId;
  final String deviceName;
  final NexusTransferApi api; // رفع الصور كملفات (نفس بروتوكول §8)
  final NativeBridge native;

  MediaService({
    required this.deviceId,
    required this.deviceName,
    required this.api,
    required this.native,
  });

  sio.Socket? _socket;
  /// FA-media (§15) — اتصال عرض شاشة الكمبيوتر (الكمبيوتر صاحب الوسائط)
  RTCPeerConnection? _screenPc;
  /// الجولة 5 (§24) — مرآة الهاتف هاتف→هاتف (ناشر kind=mirror أو عارضه)
  RTCPeerConnection? _mirrorPc;

  // جلسات WebRTC حية (نوعها: cam | mic | baby)
  final Map<String, RTCPeerConnection> _pcs = {};
  final Map<String, MediaStream> _locals = {};
  final Map<String, bool> _answered = {};

  MediaUiState _state = const MediaUiState();
  final _stateCtl = StreamController<MediaUiState>.broadcast();
  Stream<MediaUiState> get stateStream => _stateCtl.stream;
  MediaUiState get state => _state;

  void _patch(MediaUiState Function(MediaUiState) fn) {
    _state = fn(_state);
    _stateCtl.add(_state);
    _pushSnapshot();
  }

  /// لقطة مختصرة للخدمة الأصلية (dev:state.media) — مفاتيح بسيطة فقط.
  /// تُدفع فقط عند تغيّر فعلي (نبضات المستشعرات كل 50ms لا يجب أن تصل هنا).
  String _lastSnapshot = '';

  void _pushSnapshot() {
    final camLive = _state.cam.phase == MediaPhase.live;
    final camConn = _state.cam.phase == MediaPhase.connecting;
    final micLive = _state.mic.phase == MediaPhase.live;
    final babyLive = _state.baby.phase == MediaPhase.live;
    final key = '$camLive|$camConn|$micLive|$babyLive|${_state.watchOn}|${_state.torch}|${_state.facing}|${_state.sensorsOn}';
    if (key == _lastSnapshot) return;
    _lastSnapshot = key;
    native.setMediaState({
      'cam': camLive,
      'camConnecting': camConn,
      'mic': micLive,
      'baby': babyLive,
      'watch': _state.watchOn,
      'torch': _state.torch,
      'facing': _state.facing,
      'sensors': _state.sensorsOn,
      'ringing': false,
    });
    _syncStreamNotification();
  }

  void _syncStreamNotification() {
    final on = _state.anyStreamOn;
    if (on) {
      final parts = <String>[];
      if (_state.cam.phase == MediaPhase.live) parts.add('الكاميرا');
      if (_state.mic.phase == MediaPhase.live) parts.add('الميكروفون');
      if (_state.baby.phase == MediaPhase.live) parts.add('مراقبة الأطفال');
      native.mediaNotify(
        show: true,
        title: 'بث نشط عبر NexusLink',
        body: '${parts.join(' · ')} — يُبث إلى السيرفر الآن',
      );
    } else {
      native.mediaNotify(show: false);
    }
  }

  // ------------------------------------------------------------------
  // الاتصال بقناة 3005
  // ------------------------------------------------------------------

  bool connect({
    required String host,
    required int port,
    required String mode, // gateway | direct
  }) {
    disconnect();
    try {
      const bridgePort = NexusPorts.media;
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
        socket.emit(MediaEvents.role, {'role': 'phone', 'name': deviceName, 'deviceId': deviceId});
        _patch((s) => s.copyWith(bridgeOnline: true));
      });
      socket.onDisconnect((_) => _patch((s) => s.copyWith(bridgeOnline: false)));

      bind(MediaEvents.roleAck, (_) {});
      bind(MediaEvents.hello, (_) {});

      bind(MediaEvents.rtcAnswer, _onAnswer);
      bind(MediaEvents.rtcIce, _onRemoteIce);
      bind(MediaEvents.rtcOffer, _onScreenOffer); // FA-media: عرض شاشة الكمبيوتر (§15)
      // الجولة 5 (§24) — مرآة الهاتف: معالجات موازية تنجو مبكرة للأنواع/الأدوار
      // غير الخاصة بها (المعالجات القائمة تفلتر from='pc' حصرًا، وهذه تفلتر
      // from='phone' + kind='mirror' — بلا تداخل ولا ازدواج).
      bind(MediaEvents.rtcAnswer, _onMirrorAnswer);
      bind(MediaEvents.rtcIce, _onMirrorIce);
      bind(MediaEvents.rtcOffer, _onMirrorOffer);
      bind(MediaEvents.screenState, _onScreenState);
      bind(MediaEvents.secondScreenState, _onSsState); // R4 ① (§19)
      bind(MediaEvents.camCmd, _onCamCmd);
      bind(MediaEvents.camShutter, (d) {
        final m = _map(d);
        if (m == null) return;
        final timer = (m['timer'] as num?)?.toInt() ?? 0;
        final flash = m['flash'] == true;
        final camera = '${m['camera'] ?? 'back'}';
        unawaited(capturePhoto(timerSec: timer, flash: flash, facing: camera));
      });

      socket.connect();
      _socket = socket;
      return true;
    } catch (_) {
      return false;
    }
  }

  void disconnect() {
    try {
      _socket?.clearListeners();
      _socket?.disconnect();
    } catch (_) {}
    _socket = null;
    stopAll(reason: 'disconnected');
    unawaited(_teardownScreen()); // FA-media: تفكيك جلسة عرض الشاشة أيضًا
    unawaited(_teardownMirror()); // الجولة 5 (§24): تفكيك مرآة الهاتف (كلا الدورين)
    _patch((s) => s.copyWith(
          bridgeOnline: false,
          clearPreview: true,
          screen: const MediaKindState(),
          mirror: const MediaKindState(),
          clearMirrorStream: true,
          mirrorRole: '',
        ));
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

  void _emit(String event, Map<String, dynamic> data) {
    try {
      _socket?.emit(event, data);
    } catch (_) {}
  }

  // ------------------------------------------------------------------
  // جلسات WebRTC (cam | mic | baby) — البند 1 و4 و5
  // ------------------------------------------------------------------

  Future<void> startKind(String kind, {String? camera}) async {
    if (_pcs.containsKey(kind)) {
      if (kind == 'cam' && camera != null && camera != _state.facing) {
        await switchCamera();
      }
      return; // الجلسة قائمة بالفعل
    }
    // كاميرا واحدة في الوقت نفسه: بث الكاميرا والمراقبة نفس المسار
    _patch((s) => s.copyWith(
          cam: kind == 'cam' ? const MediaKindState(phase: MediaPhase.connecting) : s.cam,
          mic: kind == 'mic' ? const MediaKindState(phase: MediaPhase.connecting) : s.mic,
          baby: kind == 'baby' ? const MediaKindState(phase: MediaPhase.connecting) : s.baby,
          lastError: null,
          clearError: true,
        ));
    try {
      final media = <String, dynamic>{
        // كل الجلسات بصوت (كويب كام = مكالمة كاملة) — الفيديو للكاميرا فقط
        'audio': true,
        'video': kind == 'cam'
            ? <String, dynamic>{
                'facingMode': camera ?? _state.facing,
                'width': {'ideal': 1280},
                'height': {'ideal': 720},
                'frameRate': {'ideal': 30, 'max': 30},
              }
            : false,
      };
      final stream = await navigator.mediaDevices.getUserMedia(media);
      final pc = await createPeerConnection({'iceServers': const []});

      for (final track in stream.getTracks()) {
        await pc.addTrack(track, stream);
      }
      pc.onIceCandidate = (c) {
        if (c.candidate == null) return;
        _emit(MediaEvents.rtcIce, {
          'kind': kind,
          'candidate': {
            'candidate': c.candidate,
            'sdpMid': c.sdpMid,
            'sdpMLineIndex': c.sdpMLineIndex,
          },
        });
      };
      pc.onConnectionState = (st) {
        if (st == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
          _setPhase(kind, MediaPhase.live);
          if (kind == 'cam') _startMotionIfArmed();
          if (kind == 'baby') _startBabyStats();
        } else if (st == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
            st == RTCPeerConnectionState.RTCPeerConnectionStateClosed ||
            st == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
          unawaited(stopKind(kind, reason: 'rtc-$st'));
        }
      };

      _pcs[kind] = pc;
      _locals[kind] = stream;
      _answered[kind] = false;

      final offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      final desc = await pc.getLocalDescription();
      if (desc != null) {
        _emit(MediaEvents.rtcOffer, {
          'kind': kind,
          'sdp': {'type': desc.type, 'sdp': desc.sdp},
        });
      }

      if (kind == 'cam') {
        _patch((s) => s.copyWith(
              facing: camera ?? s.facing,
              previewStream: stream,
              clearPreview: false,
            ));
        _emitCamState(active: true);
      }
      if (kind == 'baby') await native.babyWake(true);
    } catch (e) {
      _setPhase(kind, MediaPhase.error, e.toString());
      _patch((s) => s.copyWith(lastError: 'فشل بدء $kind: $e'));
      _teardown(kind);
    }
  }

  Future<void> stopKind(String kind, {String reason = 'manual'}) async {
    final wasWatch = kind == 'cam' && _state.watchOn;
    await _teardown(kind);
    _patch((s) => s.copyWith(
          cam: kind == 'cam' ? const MediaKindState() : s.cam,
          mic: kind == 'mic' ? const MediaKindState() : s.mic,
          baby: kind == 'baby' ? const MediaKindState() : s.baby,
          watchOn: wasWatch ? false : s.watchOn,
          previewStream: kind == 'cam' ? null : s.previewStream,
          clearPreview: kind == 'cam',
          babyLevel: kind == 'baby' ? 0 : s.babyLevel,
        ));
    if (kind == 'baby') await native.babyWake(false);
    if (kind == 'cam') {
      _motionArmed = false;
      _motionTimer?.cancel();
      _motionTimer = null;
      _prevLuma = null;
      _emitCamState(active: false);
    }
    if (kind == 'baby') _babyStatsTimer?.cancel();
  }

  Future<void> stopAll({String reason = 'manual'}) async {
    for (final kind in List<String>.from(_pcs.keys)) {
      await stopKind(kind, reason: reason);
    }
    _patch((s) => s.copyWith(
          watchOn: false,
          previewStream: null,
          clearPreview: true,
          babyLevel: 0,
        ));
    await native.babyWake(false);
    await native.mediaNotify(show: false);
  }

  Future<void> _teardown(String kind) async {
    _answered.remove(kind);
    final stream = _locals.remove(kind);
    final pc = _pcs.remove(kind);
    try {
      for (final t in stream?.getTracks() ?? const <MediaStreamTrack>[]) {
        try {
          await t.stop();
        } catch (_) {}
      }
      try {
        stream?.dispose();
      } catch (_) {}
      try {
        await pc?.close();
      } catch (_) {}
    } catch (_) {}
  }

  void _setPhase(String kind, MediaPhase phase, [String? error]) {
    final st = MediaKindState(phase: phase, error: error);
    _patch((s) => s.copyWith(
          cam: kind == 'cam' ? st : s.cam,
          mic: kind == 'mic' ? st : s.mic,
          baby: kind == 'baby' ? st : s.baby,
        ));
  }

  Future<void> _onAnswer(dynamic raw) async {
    final m = _map(raw);
    if (m == null) return;
    // من دور الكمبيوتر فقط — أول إجابة تُقبل لكل جلسة (عقد §4.3 FA-8)
    if ('${m['from'] ?? ''}' != 'pc') return;
    final kind = '${m['kind'] ?? ''}';
    final pc = _pcs[kind];
    if (pc == null || _answered[kind] == true) return;
    final sdp = m['sdp'];
    if (sdp is! Map) return;
    try {
      await pc.setRemoteDescription(
        RTCSessionDescription('${sdp['sdp']}', '${sdp['type']}'),
      );
      _answered[kind] = true;
    } catch (e) {
      _setPhase(kind, MediaPhase.error, 'answer: $e');
    }
  }

  // ------------------------------------------------------------------
  // FA-media (عقد §15) — عرض شاشة الكمبيوتر: الكمبيوتر صاحب الوسائط —
  // نستقبل rtc:offer kind=screen ونجيب، وبث مرشحاتنا trickle.
  // ------------------------------------------------------------------
  Future<void> _onScreenOffer(dynamic raw) async {
    final m = _map(raw);
    if (m == null) return;
    if ('${m['from'] ?? ''}' != 'pc') return; // من الكمبيوتر فقط
    if ('${m['kind'] ?? ''}' != 'screen') return; // أنواع الكاميرا مسارها مستقل
    if (_screenPc != null) return; // جلسة قائمة — أول عرض فقط (§4.3)
    final sdp = m['sdp'];
    if (sdp is! Map) return;
    _patch((s) => s.copyWith(
          screen: const MediaKindState(phase: MediaPhase.connecting),
          lastError: null,
          clearError: true,
        ));
    try {
      final pc = await createPeerConnection({'iceServers': const []});
      pc.onIceCandidate = (c) {
        if (c.candidate == null) return;
        _emit(MediaEvents.rtcIce, {
          'kind': 'screen',
          'candidate': {
            'candidate': c.candidate,
            'sdpMid': c.sdpMid,
            'sdpMLineIndex': c.sdpMLineIndex,
          },
        });
      };
      pc.onTrack = (event) {
        // تدفق الشاشة الوارد — أول stream في الحدث
        final streams = event.streams;
        if (streams.isNotEmpty) {
          _patch((s) => s.copyWith(screenStream: streams.first, clearScreenStream: false));
        }
      };
      pc.onConnectionState = (st) {
        if (st == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
          _patch((s) => s.copyWith(screen: const MediaKindState(phase: MediaPhase.live)));
        } else if (st == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
            st == RTCPeerConnectionState.RTCPeerConnectionStateClosed ||
            st == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
          unawaited(stopScreen(reason: 'rtc-$st'));
        }
      };
      _screenPc = pc;
      await pc.setRemoteDescription(RTCSessionDescription('${sdp['sdp']}', '${sdp['type']}'));
      final answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      final desc = await pc.getLocalDescription();
      if (desc != null) {
        _emit(MediaEvents.rtcAnswer, {
          'kind': 'screen',
          'sdp': {'type': desc.type, 'sdp': desc.sdp},
        });
      }
    } catch (e) {
      _patch((s) => s.copyWith(
            screen: MediaKindState(phase: MediaPhase.error, error: '$e'),
            lastError: 'فشل عرض الشاشة: $e',
          ));
      await _teardownScreen();
    }
  }

  void _onScreenState(dynamic raw) {
    final m = _map(raw);
    if (m == null) return;
    if ('${m['from'] ?? ''}' == 'phone') return; // صدى
    if (m['on'] == false) {
      // الكمبيوتر أوقف البث (أو فشل بدؤه)
      unawaited(_teardownScreen());
      _patch((s) => s.copyWith(screen: const MediaKindState()));
      final err = '${m['error'] ?? ''}';
      if (err.isNotEmpty) {
        _patch((s) => s.copyWith(lastError: 'بث الشاشة: $err'));
      }
      return;
    }
    // أبعاد سطح المكتب — أساس خريطة اللمس (تحويل الشاشة المعروضة → مطلق)
    final w = (m['w'] as num?)?.toInt() ?? 0;
    final h = (m['h'] as num?)?.toInt() ?? 0;
    final fps = (m['fps'] as num?)?.toInt() ?? 30;
    _patch((s) => s.copyWith(screenW: w, screenH: h, screenFps: fps));
  }

  /// طلب بدء عرض شاشة الكمبيوتر (عقد §15 — screen:req على 3005)
  /// R4 ①: target اختياري — "screen:N" لشاشة بعينها أو "screen:virtual"
  /// للشاشة الافتراضية (تمكين تلقائي على الكمبيوتر ثم بثها).
  void requestScreen({int? fps, String? quality, String? target}) {
    final data = <String, dynamic>{'action': 'start'};
    if (fps != null) data['fps'] = fps;
    if (quality != null) data['quality'] = quality;
    if (target != null && target.isNotEmpty) data['target'] = target;
    _emit(MediaEvents.screenReq, data);
  }

  /// R4 ① (عقد §19) — الشاشة الثانية: تمكين/إطفاء على الكمبيوتر
  /// (الكمبيوتر يفعّل العرض الافتراضي ويبدأ بثه تلقائيًا ويرد secondscreen:state)
  void secondScreenCmd(String action, {int? w, int? h, int? fps, String? quality}) {
    final data = <String, dynamic>{'action': action};
    if (w != null) data['w'] = w;
    if (h != null) data['h'] = h;
    if (fps != null) data['fps'] = fps;
    if (quality != null) data['quality'] = quality;
    _emit(MediaEvents.secondScreenCmd, data);
  }

  /// حالة الشاشة الثانية من الكمبيوتر — مصدر الحقيقة الوحيد (عقد §19)
  void _onSsState(dynamic raw) {
    final m = _map(raw);
    if (m == null) return;
    final active = m['active'] == true;
    final target = '${m['target'] ?? ''}';
    final w = (m['w'] as num?)?.toInt() ?? 0;
    final h = (m['h'] as num?)?.toInt() ?? 0;
    final err = m['error'] as String?;
    _patch((s) => s.copyWith(
          ssActive: active,
          ssTarget: target,
          ssW: w,
          ssH: h,
          ssError: err,
          clearSsError: err == null,
        ));
  }

  /// طلب تغيير الجودة أثناء البث
  void setScreenQuality({int? fps, String? quality}) {
    final data = <String, dynamic>{'action': 'set'};
    if (fps != null) data['fps'] = fps;
    if (quality != null) data['quality'] = quality;
    _emit(MediaEvents.screenSet, data);
  }

  /// إيقاف العرض (طلب + تفكيك محلي)
  Future<void> stopScreen({String reason = 'manual'}) async {
    _emit(MediaEvents.screenStop, {'action': 'stop'});
    await _teardownScreen();
    _patch((s) => s.copyWith(
          screen: const MediaKindState(),
          screenW: 0,
          screenH: 0,
          clearScreenStream: true,
        ));
  }

  Future<void> _teardownScreen() async {
    final pc = _screenPc;
    _screenPc = null;
    try {
      await pc?.close();
    } catch (_) {}
    _patch((s) => s.copyWith(clearScreenStream: true));
  }

  // ------------------------------------------------------------------
  // الجولة 5 (عقد §24) — مرآة الهاتف هاتف→هاتف (kind='mirror'):
  //  · الناشر (الهاتف ب): Helper.requestCapturePermission (حوار النظام) ←
  //    FGS بنوع mediaProjection (شرط أندرويد 14+ المتحقق من مصدر المكوّن —
  //    الموافقة أولًا ثم الخدمة ثم createVirtualDisplay) ← getDisplayMedia
  //    (يستخدم بيانات الموافقة المخزّنة — بلا حوار ثانٍ) ← rtc:offer kind=mirror.
  //  · العارض (الهاتف أ): يجيب rtc:offer kind=mirror from=phone — نفس مسار
  //    _onScreenOffer حرفيًا مع قبول دور الهاتف، وقاعدة §4.3: أول إجابة تُقبل.
  // ------------------------------------------------------------------

  /// بدء مشاركة شاشة هذا الهاتف (الهاتف ب) — تصل لهاتف واحد على الأقل يجيب.
  Future<void> startScreenShare() async {
    if (_mirrorPc != null) return; // جلسة قائمة
    if (_state.mirrorRole == 'view') return; // عارض وناشر في آن واحد — مسار واحد
    _patch((s) => s.copyWith(
          mirror: const MediaKindState(phase: MediaPhase.connecting),
          mirrorRole: 'share',
          lastError: null,
          clearError: true,
        ));
    try {
      // 1) موافقة النظام (تُخزَّن داخليًا في المكوّن) — قبل FGS (شرط أندرويد 14)
      final granted = await Helper.requestCapturePermission(fullScreenOnly: true);
      if (granted != true) {
        _patch((s) => s.copyWith(
              mirror: const MediaKindState(),
              mirrorRole: '',
            ));
        return; // المستخدم رفض حوار النظام — بلا خطأ
      }
      // 2) الخدمة الأمامية بنوع mediaProjection (الموافقة حُصلت — الترتيب صحيح)
      await native.startScreenShareService();
      // 3) الالتقاط: المكوّن يستخدم البيانات المخزّنة (بلا حوار ثانٍ)
      final stream = await navigator.mediaDevices.getDisplayMedia(const {
        'audio': false,
        'video': true,
      });
      final pc = await createPeerConnection({'iceServers': const []});
      for (final track in stream.getTracks()) {
        await pc.addTrack(track, stream);
      }
      pc.onIceCandidate = (c) {
        if (c.candidate == null) return;
        _emit(MediaEvents.rtcIce, {
          'kind': 'mirror',
          'candidate': {
            'candidate': c.candidate,
            'sdpMid': c.sdpMid,
            'sdpMLineIndex': c.sdpMLineIndex,
          },
        });
      };
      pc.onConnectionState = (st) {
        if (st == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
          _patch((s) => s.copyWith(mirror: const MediaKindState(phase: MediaPhase.live)));
        } else if (st == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
            st == RTCPeerConnectionState.RTCPeerConnectionStateClosed ||
            st == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
          unawaited(stopScreenShare(reason: 'rtc-$st'));
        }
      };
      _mirrorPc = pc;
      final offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      final desc = await pc.getLocalDescription();
      if (desc != null) {
        _emit(MediaEvents.rtcOffer, {
          'kind': 'mirror',
          'sdp': {'type': desc.type, 'sdp': desc.sdp},
        });
      }
    } catch (e) {
      _patch((s) => s.copyWith(
            mirror: MediaKindState(phase: MediaPhase.error, error: '$e'),
            lastError: 'فشل مشاركة الشاشة: $e',
          ));
      await _teardownMirror();
    }
  }

  /// إيقاف مشاركة الشاشة (الهاتف ب) — تفكيك كامل + إطفاء الخدمة الأمامية.
  Future<void> stopScreenShare({String reason = 'manual'}) async {
    final hadShare = _state.mirrorRole == 'share';
    if (hadShare) await _teardownMirror();
    _patch((s) => s.copyWith(
          mirror: const MediaKindState(),
          mirrorRole: s.mirrorRole == 'share' ? '' : s.mirrorRole,
        ));
    if (hadShare) {
      try {
        await native.stopScreenShareService();
      } catch (_) {}
    }
  }

  /// تفكيك اتصال المرآة (أي دور) — المسارات فقط، الحالة يديرها المستدعي.
  Future<void> _teardownMirror() async {
    final pc = _mirrorPc;
    _mirrorPc = null;
    try {
      await pc?.close();
    } catch (_) {}
  }

  /// إجابة العارض (هاتف أ) على عرضنا (هاتف ب) — أول إجابة تُقبل (§4.3).
  Future<void> _onMirrorAnswer(dynamic raw) async {
    final m = _map(raw);
    if (m == null) return;
    if ('${m['from'] ?? ''}' != 'phone') return; // العارض هاتف — الكمبيوتر مستبعد
    if ('${m['kind'] ?? ''}' != 'mirror') return;
    final pc = _mirrorPc;
    if (pc == null) return;
    final sdp = m['sdp'];
    if (sdp is! Map) return;
    try {
      await pc.setRemoteDescription(RTCSessionDescription('${sdp['sdp']}', '${sdp['type']}'));
    } catch (e) {
      _patch((s) => s.copyWith(
            mirror: MediaKindState(phase: MediaPhase.error, error: 'answer: $e'),
            lastError: 'إجابة العارض فشلت: $e',
          ));
      await stopScreenShare(reason: 'answer-failed');
    }
  }

  /// عرض شاشة هاتف آخر (الهاتف أ) — استقبال rtc:offer kind=mirror من دور phone
  /// وإجابته — نفس مسار _onScreenOffer حرفيًا (§15) مع قبول دور الهاتف.
  Future<void> _onMirrorOffer(dynamic raw) async {
    final m = _map(raw);
    if (m == null) return;
    if ('${m['from'] ?? ''}' != 'phone') return; // من هاتف فقط
    if ('${m['kind'] ?? ''}' != 'mirror') return; // أنواع الكاميرا/الكمبيوتر مساراتها مستقلة
    if (_mirrorPc != null) return; // جلسة قائمة — أول عرض فقط (§4.3)
    if (_state.mirrorRole == 'share') return; // ناشر حاليًا — دور واحد في آن واحد
    final sdp = m['sdp'];
    if (sdp is! Map) return;
    _patch((s) => s.copyWith(
          mirror: const MediaKindState(phase: MediaPhase.connecting),
          mirrorRole: 'view',
          lastError: null,
          clearError: true,
        ));
    try {
      final pc = await createPeerConnection({'iceServers': const []});
      pc.onIceCandidate = (c) {
        if (c.candidate == null) return;
        _emit(MediaEvents.rtcIce, {
          'kind': 'mirror',
          'candidate': {
            'candidate': c.candidate,
            'sdpMid': c.sdpMid,
            'sdpMLineIndex': c.sdpMLineIndex,
          },
        });
      };
      pc.onTrack = (event) {
        // تدفق شاشة الهاتف الآخر الوارد — أول stream في الحدث
        final streams = event.streams;
        if (streams.isNotEmpty) {
          _patch((s) => s.copyWith(mirrorStream: streams.first, clearMirrorStream: false));
        }
      };
      pc.onConnectionState = (st) {
        if (st == RTCPeerConnectionState.RTCPeerConnectionStateConnected) {
          _patch((s) => s.copyWith(mirror: const MediaKindState(phase: MediaPhase.live)));
        } else if (st == RTCPeerConnectionState.RTCPeerConnectionStateFailed ||
            st == RTCPeerConnectionState.RTCPeerConnectionStateClosed ||
            st == RTCPeerConnectionState.RTCPeerConnectionStateDisconnected) {
          // الناشر أوقف المشاركة أو انقطع — تفكيك صامت (نفس سلوك مسار §15)
          unawaited(_teardownMirror());
          _patch((s) => s.copyWith(
                mirror: const MediaKindState(),
                clearMirrorStream: true,
                mirrorRole: s.mirrorRole == 'view' ? '' : s.mirrorRole,
              ));
        }
      };
      _mirrorPc = pc;
      await pc.setRemoteDescription(RTCSessionDescription('${sdp['sdp']}', '${sdp['type']}'));
      final answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      final desc = await pc.getLocalDescription();
      if (desc != null) {
        _emit(MediaEvents.rtcAnswer, {
          'kind': 'mirror',
          'sdp': {'type': desc.type, 'sdp': desc.sdp},
        });
      }
    } catch (e) {
      _patch((s) => s.copyWith(
            mirror: MediaKindState(phase: MediaPhase.error, error: '$e'),
            lastError: 'فشل عرض شاشة الهاتف: $e',
          ));
      await _teardownMirror();
      _patch((s) => s.copyWith(mirrorRole: s.mirrorRole == 'view' ? '' : s.mirrorRole));
    }
  }

  /// مرشحات الطرف الآخر (هاتف) — المسار القائم _onRemoteIce يفلتر from='phone'
  /// حصرًا (سلوك الكمبيوتر)، وهذا المعالج المتوازي يخدم المرآة فقط.
  Future<void> _onMirrorIce(dynamic raw) async {
    final m = _map(raw);
    if (m == null) return;
    if ('${m['from'] ?? ''}' != 'phone') return;
    if ('${m['kind'] ?? ''}' != 'mirror') return;
    final pc = _mirrorPc;
    if (pc == null) return;
    final c = m['candidate'];
    if (c is! Map) return;
    try {
      await pc.addCandidate(RTCIceCandidate(
        '${c['candidate'] ?? ''}',
        c['sdpMid'] as String?,
        (c['sdpMLineIndex'] as num?)?.toInt(),
      ));
    } catch (_) {}
  }

  Future<void> _onRemoteIce(dynamic raw) async {
    final m = _map(raw);
    if (m == null) return;
    if ('${m['from'] ?? ''}' == 'phone') return; // صدى أو دور آخر — تجاهل
    final kind = '${m['kind'] ?? ''}';
    final pc = _pcs[kind];
    if (pc == null) return;
    final c = m['candidate'];
    if (c is! Map) return;
    try {
      await pc.addCandidate(RTCIceCandidate(
        '${c['candidate'] ?? ''}',
        c['sdpMid'] as String?,
        (c['sdpMLineIndex'] as num?)?.toInt(),
      ));
    } catch (_) {}
  }

  // ------------------------------------------------------------------
  // أوامر الويب cam:cmd (عقد §4.3 FA-8) + حالة الكاميرا
  // ------------------------------------------------------------------

  Future<void> _onCamCmd(dynamic raw) async {
    final m = _map(raw);
    if (m == null) return;
    final action = '${m['action'] ?? ''}';
    switch (action) {
      case 'cam-start':
        await startKind('cam', camera: '${m['camera'] ?? _state.facing}');
      case 'cam-stop':
        await stopKind('cam');
      case 'switch':
        await switchCamera();
      case 'torch':
        await setTorch(m['on'] != false);
      case 'mic-start':
        await startKind('mic');
      case 'mic-stop':
        await stopKind('mic');
      case 'baby-start':
        await startKind('baby');
      case 'baby-stop':
        await stopKind('baby');
      case 'watch-start':
        _watchSensitivity = ((m['sensitivity'] as num?)?.toDouble() ?? _state.sensitivity)
            .clamp(0.01, 1.0);
        _patch((s) => s.copyWith(sensitivity: _watchSensitivity, watchOn: true));
        await startKind('cam');
        // الكاميرا قد تكون حية بالفعل — فعّل كاشف الحركة فورًا
        if (_pcs.containsKey('cam')) _startMotionIfArmed();
      case 'watch-stop':
        _patch((s) => s.copyWith(watchOn: false));
        await stopKind('cam');
    }
  }

  void _emitCamState({required bool active}) {
    _emit(MediaEvents.camState, {
      'deviceId': deviceId,
      'active': active,
      'facing': _state.facing,
      'torch': _state.torch,
      'real': true,
      'mode': 'webrtc',
      'watch': _state.watchOn,
    });
  }

  // ---- واجهة داخل التطبيق للمراقبة (البند 3) ----

  /// فعّل وضع المراقبة (بث + كشف حركة) — يُستدعى من التطبيق بعد/مع بدء الكاميرا.
  Future<void> armWatch(double sensitivity) async {
    _watchSensitivity = sensitivity.clamp(0.01, 1.0);
    _patch((s) => s.copyWith(watchOn: true, sensitivity: _watchSensitivity));
    _emitCamState(active: _pcs.containsKey('cam'));
    if (_pcs.containsKey('cam')) _startMotionIfArmed();
  }

  /// عطّل كشف الحركة مع إبقاء/إيقاف البث حسب طلب المستدعي.
  Future<void> disarmWatch() async {
    _patch((s) => s.copyWith(watchOn: false));
    _motionArmed = false;
    _motionTimer?.cancel();
    _motionTimer = null;
    _prevLuma = null;
    _emitCamState(active: _pcs.containsKey('cam'));
  }

  void setSensitivity(double v) {
    _watchSensitivity = v.clamp(0.01, 1.0);
  }

  /// تبديل أمامية/خلفية (البند 1) — نفس المسار دون إعادة تفاوض.
  Future<void> switchCamera() async {
    final stream = _locals['cam'];
    final tracks = stream?.getVideoTracks() ?? const <MediaStreamTrack>[];
    if (tracks.isEmpty) return;
    try {
      await Helper.switchCamera(tracks.first);
      final next = _state.facing == 'front' ? 'back' : 'front';
      _patch((s) => s.copyWith(facing: next));
      _emitCamState(active: true);
    } catch (e) {
      _patch((s) => s.copyWith(lastError: 'تبديل الكاميرا فشل: $e'));
    }
  }

  /// فلاش/كشاف أثناء البث (البند 1) — عبر مسار التتبع نفسه.
  Future<void> setTorch(bool on) async {
    final stream = _locals['cam'];
    final tracks = stream?.getVideoTracks() ?? const <MediaStreamTrack>[];
    if (tracks.isEmpty) return;
    try {
      await tracks.first.setTorch(on);
      _patch((s) => s.copyWith(torch: on));
      _emitCamState(active: true);
    } catch (e) {
      _patch((s) => s.copyWith(
            torch: false,
            lastError: 'الكشاف غير مدعوم على هذه الكاميرا: $e',
          ));
    }
  }

  // ------------------------------------------------------------------
  // المراقبة وكشف الحركة (البند 3) — فروق إطارات بلا AI
  // ------------------------------------------------------------------

  bool _motionArmed = false;
  double _watchSensitivity = 0.5;
  Timer? _motionTimer;
  List<int>? _prevLuma;
  bool _sampling = false;
  int _aboveCount = 0;
  int _lastMotionEmit = 0;

  void _startMotionIfArmed() {
    if (!_state.watchOn) return;
    _motionArmed = true;
    _prevLuma = null;
    _motionTimer?.cancel();
    _motionTimer = Timer.periodic(const Duration(milliseconds: 900), (_) => _sampleMotion());
  }

  Future<void> _sampleMotion() async {
    if (!_motionArmed || _sampling) return;
    final stream = _locals['cam'];
    final tracks = stream?.getVideoTracks() ?? const <MediaStreamTrack>[];
    if (tracks.isEmpty) return;
    _sampling = true;
    try {
      final buf = await tracks.first.captureFrame(); // JPEG ملف مؤقت (ناتج FrameCapturer)
      final bytes = buf.asUint8List();
      final frame = img.decodeImage(bytes);
      if (frame == null) return;
      final small = img.copyResize(frame, width: 80);
      final w = small.width;
      final h = small.height;
      final luma = List<int>.filled(w * h, 0);
      var i = 0;
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          final p = small.getPixel(x, y);
          // لوميناني تقريبي (Rec.601) على قنوات 8 بت
          final r = p.r;
          final g = p.g;
          final b = p.b;
          luma[i++] = ((r * 299 + g * 587 + b * 114) ~/ 1000) & 0xff;
        }
      }
      final prev = _prevLuma;
      _prevLuma = luma;
      if (prev == null || prev.length != luma.length) return;
      var acc = 0;
      for (var k = 0; k < luma.length; k++) {
        acc += (luma[k] - prev[k]).abs();
      }
      final score = acc / (luma.length * 255); // 0..1
      // عتبة من الحساسية: 0..1 → عتبة 0.14..0.02
      final threshold = 0.14 - 0.12 * _watchSensitivity;
      if (score >= threshold) {
        _aboveCount++;
      } else {
        _aboveCount = 0;
      }
      // تأكيد عيّنتين متتاليتين + تهدئة 10 ثوانٍ
      if (_aboveCount >= 2 && DateTime.now().millisecondsSinceEpoch - _lastMotionEmit > 10000) {
        _lastMotionEmit = DateTime.now().millisecondsSinceEpoch;
        _aboveCount = 0;
        final level = math.min(100, (score * 400).round());
        _emit(MediaEvents.secMotion, {'source': deviceName, 'level': level});
        _patch((s) => s.copyWith(
              motionCount: s.motionCount + 1,
              lastMotionAt: _lastMotionEmit,
              lastMotionLevel: level,
            ));
      }
    } catch (_) {
      // إطار فاشل — العينة القادمة تعيد المحاولة
    } finally {
      _sampling = false;
    }
  }

  // ------------------------------------------------------------------
  // مستوى صوت مراقبة الأطفال (البند 4) — getStats audioLevel
  // ------------------------------------------------------------------

  Timer? _babyStatsTimer;
  int _lastCryAlert = 0;

  void _startBabyStats() {
    _babyStatsTimer?.cancel();
    _babyStatsTimer = Timer.periodic(const Duration(seconds: 2), (_) async {
      final pc = _pcs['baby'];
      if (pc == null) return;
      try {
        final stats = await pc.getStats();
        double? level;
        for (final r in stats) {
          final v = r.values;
          if (v['type'] == 'media-source' && v['kind'] == 'audio') {
            final a = (v['audioLevel'] as num?)?.toDouble();
            if (a != null) level = a;
          }
        }
        if (level == null) return;
        final pct = math.min(100, (level * 400).round());
        _patch((s) => s.copyWith(babyLevel: pct));
        // بكاء/صوت مرتفع → تنبيه بتهدئة 20 ثانية (عقد §4.3 baby:alert)
        if (level >= 0.09 &&
            DateTime.now().millisecondsSinceEpoch - _lastCryAlert > 20000) {
          _lastCryAlert = DateTime.now().millisecondsSinceEpoch;
          _emit(MediaEvents.babyAlert, {'from': deviceName, 'level': pct});
          _patch((s) => s.copyWith(babyAlerts: s.babyAlerts + 1));
        }
      } catch (_) {}
    });
  }

  // ------------------------------------------------------------------
  // التقاط صورة بأمر السيرفر (البند 2) — مؤقت + فلاش → ملف
  // ------------------------------------------------------------------

  bool _shutterBusy = false;
  Timer? _shutterTimer;

  Future<void> capturePhoto({
    required int timerSec,
    required bool flash,
    required String facing,
  }) async {
    if (_shutterBusy) {
      _patch((s) => s.copyWith(lastError: 'التقاط جارٍ بالفعل — تم تجاهل الطلب'));
      return;
    }
    _shutterBusy = true;
    _patch((s) => s.copyWith(shutterBusy: true, clearError: true));
    MediaStream? tmp;
    MediaStreamTrack? vTrack;
    var torchHeld = false;
    try {
      // كاميرا مشغولة ببث؟ استخدم تتبعها إن كان الوجه متطابقًا — وإلا افتح مسارًا مؤقتًا
      final liveStream = _locals['cam'];
      if (liveStream != null && _state.facing == facing) {
        vTrack = liveStream.getVideoTracks().isNotEmpty ? liveStream.getVideoTracks().first : null;
      } else {
        if (_locals.containsKey('cam')) {
          await stopKind('cam'); // وجه مختلف — حرر الكاميرا ثم افتح المطلوب
        }
        tmp = await navigator.mediaDevices.getUserMedia({
          'audio': false,
          'video': {'facingMode': facing},
        });
        vTrack = tmp.getVideoTracks().first;
      }
      if (vTrack == null) throw Exception('لا تتبع فيديو');

      if (flash && facing == 'back') {
        try {
          await vTrack.setTorch(true);
          torchHeld = true;
        } catch (_) {}
      }

      // العد التنازلي (مؤقت السيرفر 0..30 ثانية — عقد §4.3)
      if (timerSec > 0) {
        for (var left = timerSec; left > 0; left--) {
          _patch((s) => s.copyWith(shutterCountdown: left));
          await Future<void>.delayed(const Duration(seconds: 1));
        }
        _patch((s) => s.copyWith(shutterCountdown: 0));
      }

      final buf = await vTrack.captureFrame();
      final bytes = buf.asUint8List();
      final name = 'Nexus-Shot-${DateTime.now().millisecondsSinceEpoch ~/ 1000}.jpg';

      // رفع كملف إلى جذر الجهاز (نفس بروتوكول §8 — init/PUT/complete)
      final init = await api.uploadInit(
        deviceId: deviceId,
        name: name,
        size: bytes.length,
        mime: 'image/jpeg',
        dir: '/Pictures',
        taskId: 'shot-$name',
      );
      var offset = init.received;
      while (offset < bytes.length) {
        final end = math.min(offset + TxProtocol.uploadChunk, bytes.length);
        offset = await api.uploadChunk(init.uploadId, offset, bytes.sublist(offset, end));
      }
      await api.uploadComplete(init.uploadId);

      if (torchHeld) {
        try {
          await vTrack.setTorch(false);
        } catch (_) {}
        torchHeld = false;
      }

      _emit(MediaEvents.camCaptured, {'name': name, 'device': deviceName});
      _patch((s) => s.copyWith(lastShotName: name, shutterBusy: false, shutterCountdown: 0));
    } catch (e) {
      _emit(MediaEvents.camCaptured, {'name': '', 'device': deviceName, 'error': '$e'});
      _patch((s) => s.copyWith(lastError: 'فشل الالتقاط: $e', shutterBusy: false, shutterCountdown: 0));
    } finally {
      if (torchHeld) {
        try {
          await vTrack?.setTorch(false);
        } catch (_) {}
      }
      if (tmp != null) {
        try {
          for (final t in tmp.getTracks()) {
            await t.stop();
          }
          tmp.dispose();
        } catch (_) {}
      }
      _shutterTimer?.cancel();
      _shutterTimer = null;
      _shutterBusy = false;
      _patch((s) => s.copyWith(shutterBusy: false, shutterCountdown: 0));
    }
  }

  // ------------------------------------------------------------------
  // المستشعرات للويب (البند 6) — جيروسكوب/تسارع 20Hz عبر WebSocket
  // ------------------------------------------------------------------

  StreamSubscription<AccelerometerEvent>? _accSub;
  StreamSubscription<GyroscopeEvent>? _gyroSub;
  Timer? _sensorTimer;
  List<double> _acc = const [0, 0, 0];
  List<double> _gyro = const [0, 0, 0];
  int _sensorSent = 0;

  void startSensors() {
    if (_state.sensorsOn) return;
    _accSub?.cancel();
    _gyroSub?.cancel();
    _accSub = accelerometerEventStream(samplingPeriod: const Duration(milliseconds: 50)).listen((e) {
      _acc = [e.x, e.y, e.z];
    });
    _gyroSub = gyroscopeEventStream(samplingPeriod: const Duration(milliseconds: 50)).listen((e) {
      _gyro = [e.x, e.y, e.z];
    });
    _sensorTimer?.cancel();
    _sensorTimer = Timer.periodic(const Duration(milliseconds: 50), (_) {
      final a = _acc;
      final g = _gyro;
      if (a.every((v) => v == 0.0) && g.every((v) => v == 0.0)) return;
      _emit(MediaEvents.sensorStream, {
        'a': [a[0], a[1], a[2]],
        'g': [g[0], g[1], g[2]],
        'ts': DateTime.now().millisecondsSinceEpoch,
      });
      _sensorSent++;
      _patch((s) => s.copyWith(acc: a, gyro: g, sensorMsgs: _sensorSent));
    });
    _patch((s) => s.copyWith(sensorsOn: true));
  }

  void stopSensors() {
    _accSub?.cancel();
    _gyroSub?.cancel();
    _accSub = null;
    _gyroSub = null;
    _sensorTimer?.cancel();
    _sensorTimer = null;
    _patch((s) => s.copyWith(sensorsOn: false));
  }

  Future<void> dispose() async {
    disconnect();
    stopSensors();
    await _stateCtl.close();
  }
}

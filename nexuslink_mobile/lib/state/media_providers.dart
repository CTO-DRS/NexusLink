import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/media_service.dart';
import '../data/transfer_api.dart';
import 'providers.dart';
import 'transfer_providers.dart';

// ---------------------------------------------------------------------------
// FA-8 — طبقة الكاميرا والصوت في تطبيق الهاتف (عقد §4.3 على قناة 3005).
//
// MediaController:
//  · يبني MediaService عند اتصال الخادم (endpoint + deviceId) ويقطعه عند الفصل.
//  · يبث حالة الخدمة (جلسات WebRTC/المراقبة/المستشعرات) للواجهة.
//  · يستقبل زر «إيقاف البث» من إشعار النظام (kind == 'mediastop').
// ---------------------------------------------------------------------------

class MediaController extends Notifier<MediaUiState> {
  MediaService? _svc;
  StreamSubscription<MediaUiState>? _sub;
  String? _boundKey;

  @override
  MediaUiState build() {
    ref.onDispose(() {
      _sub?.cancel();
      _sub = null;
      unawaited(_svc?.dispose());
      _svc = null;
      _boundKey = null;
    });

    // الارتباط بدورة حياة الاتصال: عند online نبني الخدمة، وعند الفصل نوقفها
    ref.listen(connectionProvider, (prev, next) {
      final m = next.value;
      final endpoint = m?.endpoint;
      final online = m?.isOnline == true && endpoint != null;
      if (online) {
        unawaited(_ensure(endpoint, m));
      } else {
        unawaited(_teardown());
      }
    });

    // حالة أولية إن كان الاتصال جاهزًا قبل الاستماع
    final conn = ref.read(connectionProvider).value;
    if (conn?.isOnline == true && conn?.endpoint != null) {
      unawaited(_ensure(conn!.endpoint!, conn));
    }
    return state = const MediaUiState();
  }

  Future<void> _ensure(endpoint, conn) async {
    final key = endpoint.key;
    if (_svc != null && _boundKey == key) return;
    await _teardown();

    String deviceId = '';
    try {
      final me = conn?.me;
      if (me != null && me.id.isNotEmpty) deviceId = me.id;
    } catch (_) {}
    if (deviceId.isEmpty) {
      try {
        final identity = await ref.read(deviceIdentityProvider.future);
        deviceId = identity.stableId;
      } catch (_) {}
    }
    String name = 'Nexus Android';
    try {
      final identity = await ref.read(deviceIdentityProvider.future);
      name = identity.name;
    } catch (_) {}

    final svc = MediaService(
      deviceId: deviceId,
      deviceName: name,
      api: NexusTransferApi(endpoint),
      native: ref.read(nativeBridgeProvider),
    );
    _svc = svc;
    _boundKey = key;
    _sub = svc.stateStream.listen((s) {
      if (_svc == svc) state = s;
    });
    final ok = svc.connect(host: endpoint.host, port: endpoint.port, mode: endpoint.mode.name);
    ref.read(activityLogProvider.notifier).add(
          ok
              ? 'قناة الوسائط 3005 جاهزة — الكاميرا والميكروفون قابلان للبث'
              : 'فشل بدء قناة الوسائط 3005',
          kind: ok ? 'ok' : 'error',
        );
    state = svc.state;
  }

  Future<void> _teardown() async {
    _sub?.cancel();
    _sub = null;
    final svc = _svc;
    _svc = null;
    _boundKey = null;
    if (svc != null) {
      await svc.dispose();
      ref.read(activityLogProvider.notifier).add('أُوقفت قناة الوسائط مع انقطاع الخادم', kind: 'info');
    }
  }

  // ---- استدعاءات الواجهة ----

  Future<void> startCam(String facing) async {
    await _svc?.startKind('cam', camera: facing);
  }

  Future<void> stopCam() async {
    await _svc?.stopKind('cam');
  }

  Future<void> switchCamera() async {
    await _svc?.switchCamera();
  }

  Future<void> setTorch(bool on) async {
    await _svc?.setTorch(on);
  }

  Future<void> startMic() async {
    await _svc?.startKind('mic');
  }

  Future<void> stopMic() async {
    await _svc?.stopKind('mic');
  }

  // FA-media (عقد §15) — عرض شاشة الكمبيوتر: طلب/إيقاف/جودة
  void requestScreen({int? fps, String? quality}) =>
      _svc?.requestScreen(fps: fps, quality: quality);

  void setScreenQuality({int? fps, String? quality}) =>
      _svc?.setScreenQuality(fps: fps, quality: quality);

  Future<void> stopScreen() async {
    await _svc?.stopScreen();
  }

  Future<void> startBaby() async {
    await _svc?.startKind('baby');
  }

  Future<void> stopBaby() async {
    await _svc?.stopKind('baby');
  }

  /// المراقبة = بث كاميرا مستمر + كشف حركة (البند 3).
  Future<void> startWatch() async {
    final svc = _svc;
    if (svc == null) return;
    await svc.startKind('cam');
    // تفعيل الحركة يحدث تلقائيًا عند وصول الجلسة إلى live عبر watchOn
    await svc.armWatch(state.sensitivity);
  }

  Future<void> stopWatch() async {
    await _svc?.disarmWatch();
    await _svc?.stopKind('cam');
  }

  void setSensitivity(double v) {
    _svc?.setSensitivity(v);
    state = state.copyWith(sensitivity: v);
  }

  /// التقاط صورة بأمر الويب أو من التطبيق (البند 2).
  Future<void> capturePhoto({int timerSec = 0, bool flash = false, String facing = 'back'}) async {
    await _svc?.capturePhoto(timerSec: timerSec, flash: flash, facing: facing);
  }

  void startSensors() {
    _svc?.startSensors();
  }

  void stopSensors() {
    _svc?.stopSensors();
  }

  /// زر «إيقاف البث» من إشعار النظام (mediastop من EventChannel).
  Future<void> stopEverything() async {
    await _svc?.stopAll();
  }
}

final mediaControllerProvider = NotifierProvider<MediaController, MediaUiState>(MediaController.new);

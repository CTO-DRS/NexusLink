import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/phone_remote_service.dart';
import 'providers.dart';

// ---------------------------------------------------------------------------
// الجولة 5 (عقد §24) — مزود التحكم بهاتف آخر (هاتف→هاتف عبر المركز).
// الارتباط بدورة حياة الاتصال مثل MediaController حرفيًا: عند online نبني
// PhoneRemoteService ونفتح سوكِت 3006 (نمط AgentSignaling)، وعند الفصل
// نهدمه — مع إرسال p2p:ctl-stop أولًا (قطع فوري للهدف).
// ---------------------------------------------------------------------------

/// مزود الحالة الحي (يشاهده PhoneRemoteScreen).
final phoneRemoteProvider =
    NotifierProvider<PhoneRemoteController, PhoneRemoteUiState>(PhoneRemoteController.new);

class PhoneRemoteController extends Notifier<PhoneRemoteUiState> {
  PhoneRemoteService? _svc;
  StreamSubscription<PhoneRemoteUiState>? _sub;
  String? _boundKey;

  @override
  PhoneRemoteUiState build() {
    ref.onDispose(() {
      _sub?.cancel();
      _sub = null;
      unawaited(_svc?.dispose());
      _svc = null;
      _boundKey = null;
    });

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

    final conn = ref.read(connectionProvider).value;
    if (conn?.isOnline == true && conn?.endpoint != null) {
      unawaited(_ensure(conn!.endpoint!, conn));
    }
    return state = const PhoneRemoteUiState();
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

    final svc = PhoneRemoteService(deviceId: deviceId, deviceName: name);
    _svc = svc;
    _boundKey = key;
    _sub = svc.stateStream.listen((s) {
      if (_svc == svc) state = s;
    });
    final ok = svc.connect(host: endpoint.host, port: endpoint.port, mode: endpoint.mode.name);
    ref.read(activityLogProvider.notifier).add(
          ok
              ? 'قناة التحكم بين الهواتف 3006 جاهزة — اختَر هاتفًا للتحكم به'
              : 'فشل بدء قناة التحكم بين الهواتف',
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
      await svc.dispose(); // ترسل p2p:ctl-stop إن وُجدت جلسة قبل الهدم
      ref.read(activityLogProvider.notifier).add('أُوقفت قناة التحكم بين الهواتف', kind: 'info');
    }
  }

  // ---- استدعاءات الواجهة ----

  /// طلب التحكم بهاتف آخر (الجسر يوجّه بعد بوابة الثقة — الهدف يؤكد).
  void requestControl(String targetId, String targetName) {
    if (_svc == null) {
      ref.read(activityLogProvider.notifier).add('لا قناة حية للتحكم بين الهواتف — اتصل بالخادم أولًا', kind: 'error');
      return;
    }
    _svc!.requestControl(targetId, targetName);
  }

  /// قطع فوري من طرف المتحكم.
  void stopControl() => _svc?.stopControl();

  // ---- الإدخال (أسماء أحداث الويب نفسها — تنفيذ الهدف عبر خدمة الإتاحة القائمة) ----

  void sendTouch(Map<String, dynamic> payload) => _svc?.sendTouch(payload);

  void sendText(String text) => _svc?.sendText(text);

  void sendKey(String action) => _svc?.sendKey(action);
}

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/controller_service.dart';
import 'providers.dart';

// ---------------------------------------------------------------------------
// FA-9 — الهاتف طرف متحكم (عقد §4.9 على قناة 3004).
//
// ControllerController:
//  · يبني ControllerService عند اتصال الخادم (endpoint) ويقطعه عند الفصل.
//  · يبث حالة الخدمة (الجسر/الكمبيوتر/الحافظة/الماوس الهوائي) للواجهة.
// ---------------------------------------------------------------------------

class ControllerController extends Notifier<RcUiState> {
  ControllerService? _svc;
  StreamSubscription<RcUiState>? _sub;
  String? _boundKey;

  @override
  RcUiState build() {
    ref.onDispose(() {
      _sub?.cancel();
      _sub = null;
      _svc?.dispose();
      _svc = null;
      _boundKey = null;
    });

    // الارتباط بدورة حياة الاتصال — نفس نمط media_providers
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
    return state = const RcUiState();
  }

  Future<void> _ensure(endpoint, conn) async {
    final key = endpoint.key;
    if (_svc != null && _boundKey == key) return;
    await _teardown();

    String name = 'Nexus Android';
    try {
      final identity = await ref.read(deviceIdentityProvider.future);
      name = identity.name;
    } catch (_) {}

    final svc = ControllerService(deviceName: name);
    _svc = svc;
    _boundKey = key;
    _sub = svc.stateStream.listen((s) {
      if (_svc == svc) state = s;
    });
    final ok = svc.connect(host: endpoint.host, port: endpoint.port, mode: endpoint.mode.name);
    ref.read(activityLogProvider.notifier).add(
          ok
              ? 'قناة التحكم 3004 جاهزة — هاتفك الآن جهاز تحكم للكمبيوتر'
              : 'فشل بدء قناة التحكم 3004',
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
      svc.dispose();
      ref.read(activityLogProvider.notifier).add('أُوقفت قناة التحكم مع انقطاع الخادم', kind: 'info');
    }
  }

  // ---- استدعاءات الواجهة ----

  void move(double dx, double dy, {String source = 'touchpad', bool drag = false}) {
    _svc?.move(dx, dy, source: source, drag: drag);
  }

  void click({String button = 'left', String type = 'tap'}) {
    _svc?.click(button: button, type: type);
  }

  void scroll(double dy) => _svc?.scroll(dy);

  void pinch(double scale) => _svc?.pinch(scale);

  void key(String ch) => _svc?.key(ch);

  void keySpecial(String special) => _svc?.keySpecial(special);

  void media(String action, {double? value}) => _svc?.media(action, value: value);

  void power(String action) => _svc?.power(action);

  void wakeLan([String? mac]) {
    final svc = _svc;
    if (svc == null) return;
    final use = (mac == null || mac.trim().isEmpty) ? state.desktopMac : mac;
    if (use.isEmpty) return;
    svc.wakeLan(use);
  }

  Future<void> pushClipboard([String? text]) => _svc?.pushClipboard(text) ?? Future.value();

  /// FA-clipboard-sync — تحديث حرس الحلقة: نص خارجي وُضع في حافظة الهاتف
  /// (من الكمبيوتر) كي لا تعيده مراقبة الشاشة المفتوحة (عقد §11.ج).
  void markExternal(String text) => _svc?.markExternal(text);

  void pullPcClipboard() => _svc?.pullPcClipboard();

  void handoff(String url, {String? title}) => _svc?.handoff(url, title: title);

  void setAirmouse(bool on) => _svc?.setAirmouse(on);

  void setClipboardWatch(bool on) => _svc?.setClipboardWatch(on);

  void setClipboardAuto(bool on) => _svc?.setClipboardAuto(on);

  Future<void> copyPcToPhone() => _svc?.copyPcToPhone() ?? Future.value();
}

final controllerControllerProvider =
    NotifierProvider<ControllerController, RcUiState>(ControllerController.new);

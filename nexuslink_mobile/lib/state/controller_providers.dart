import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/controller_service.dart';
import '../domain/wol_service.dart';
import 'providers.dart';

// ---------------------------------------------------------------------------
// FA-9 — الهاتف طرف متحكم (عقد §4.9 على قناة 3004).
//
// ControllerController:
//  · يبني ControllerService عند اتصال الخادم (endpoint) ويقطعه عند الفصل.
//  · يبث حالة الخدمة (الجسر/الكمبيوتر/الحافظة/الماوس الهوائي) للواجهة.
//  · FA-power (عقد §12): يخزن MAC/اسم الكمبيوتر المعلن (rc:hello) في
//    SharedPreferences — هو ما يُستعمل لاحقًا للإيقاظ المباشر دون اتصال.
// ---------------------------------------------------------------------------

/// مفاتيح التخزين المحلي لهوية الكمبيوتر (الإيقاظ دون اتصال)
const String kPrefDesktopMac = 'nexus.desktopMac';
const String kPrefDesktopName = 'nexus.desktopName';

/// MAC الكمبيوتر المحفوظ — يُستعمل لشاشة «الكمبيوتر نائم — إيقاظ؟»
final storedDesktopMacProvider = FutureProvider<String>((ref) async {
  final p = await SharedPreferences.getInstance();
  return p.getString(kPrefDesktopMac) ?? '';
});

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
    String stableId = '';
    try {
      final identity = await ref.read(deviceIdentityProvider.future);
      name = identity.name;
      // FA-input (عقد §13) — الهوية الثابتة لحاجز الثقة (جلسة التحكم للأجهزة الموثوقة)
      stableId = identity.stableId;
    } catch (_) {}

    final svc = ControllerService(deviceName: name, deviceId: stableId);
    _svc = svc;
    _boundKey = key;
    _sub = svc.stateStream.listen((s) {
      if (_svc == svc) {
        state = s;
        // FA-power — حفظ MAC/الاسم المعلن من rc:hello للإيقاظ لاحقًا دون اتصال
        if (s.desktopMac.isNotEmpty) {
          unawaited(_persistDesktop(s.desktopMac, s.desktopName));
        }
      }
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

  /// FA-media (عقد §15) — لمس على الشاشة المعروضة: مؤشر مطلق (nx,ny ∈ 0..1)
  void sendPointer(double nx, double ny, {String action = 'move'}) {
    _svc?.sendPointer(nx, ny, action: action);
  }

  void key(String ch) => _svc?.key(ch);

  void keySpecial(String special) => _svc?.keySpecial(special);

  void presenter(String action) => _svc?.presenter(action);

  /// FA-input (عقد §13) — دورة حياة جلسة التحكم: تبدأ مع فتح الشاشة
  /// وتنتهي بإغلاقها، مع نبض 2ث يحييها على الجسر.
  void startSession() => _svc?.startControlSession();

  void stopSession() => _svc?.stopControlSession();

  void media(String action, {double? value}) => _svc?.media(action, value: value);

  void power(String action) => _svc?.power(action);

  /// FA-power — حفظ هوية الكمبيوتر المعلنة (MAC/اسم) في التخزين المحلي
  Future<void> _persistDesktop(String mac, String name) async {
    try {
      final p = await SharedPreferences.getInstance();
      await p.setString(kPrefDesktopMac, mac);
      if (name.isNotEmpty) await p.setString(kPrefDesktopName, name);
    } catch (_) {/* تخزين غير متاح — الإيقاظ سيقرأ من الحالة الحية فقط */}
  }

  /// MAC الكمبيوتر المتاح للإيقاظ: الحي أولًا ثم المحفوظ
  Future<String> _wakeMac() async {
    final live = state.desktopMac.trim();
    if (live.isNotEmpty) return live;
    try {
      final p = await SharedPreferences.getInstance();
      return p.getString(kPrefDesktopMac) ?? '';
    } catch (_) {
      return '';
    }
  }

  /// FA-power — إيقاظ مباشر عبر UDP broadcast (عند تعذر الوصول للسيرفر):
  /// حزمة سحرية إلى 255.255.255.255:9 + broadcast الشبكة الفرعية للخادم.
  /// يعيد عدد الإرسالات الناجحة (0 = فشل — MAC غائب/لا شبكة).
  Future<int> wakeDirect({String? serverHost}) async {
    final mac = await _wakeMac();
    if (mac.isEmpty) return 0;
    final targets = <String>[
      if (serverHost != null && serverHost.isNotEmpty)
        WolService.subnetBroadcast(serverHost) ?? '',
    ].where((t) => t.isNotEmpty).toList();
    final sent = await WolService.sendMagicPacket(mac, extraTargets: targets);
    ref.read(activityLogProvider.notifier).add(
          sent > 0
              ? 'أُرسلت حزمة إيقاظ (Wake-on-LAN) إلى $mac — $sent إرسالة'
              : 'فشل إرسال حزمة الإيقاظ إلى $mac',
          kind: sent > 0 ? 'ok' : 'error',
        );
    return sent;
  }

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

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../data/media_service.dart';
import '../data/nexus_api.dart';
import '../data/phone_remote_service.dart';
import '../domain/models.dart';
import '../state/media_providers.dart';
import '../state/phone_remote_providers.dart';
import '../state/providers.dart';
import '../state/transfer_providers.dart' show nativeBridgeProvider;

/// الجولة 5 (عقد §24) — «التحكم بهاتف من هاتف آخر»: الهاتف أ يعرض شاشة
/// الهاتف ب (مرآة WebRTC kind=mirror) ويتحكم بها عن بُعد عبر المركز.
/// نفس أسماء أحداث الويب (dev:touch/text/key) — الجسر يوجّه خلال الجلسة
/// الموثقة حصرًا، وتنفيذ اللمس على الهدف عبر خدمة الإتاحة القائمة حرفيًا.
class PhoneRemoteScreen extends ConsumerStatefulWidget {
  const PhoneRemoteScreen({super.key});

  @override
  ConsumerState<PhoneRemoteScreen> createState() => _PhoneRemoteScreenState();
}

class _PhoneRemoteScreenState extends ConsumerState<PhoneRemoteScreen> {
  static const fallbackScreen = (w: 1080, h: 2340, density: 440);
  // حدود الإيماءات — نفس ثوابت واجهة الويب (remote-touch-tab) حرفيًا
  static const tapSlopPx = 7.0;
  static const longMs = 550;

  ({double dx, double dy, int t})? _press;
  ({double dx, double dy})? _last;
  ({double dx, double dy, double dt})? _twoFinger; // تمرير بإصبعين
  int _seq = 1;
  final _renderer = RTCVideoRenderer();
  bool _rendererReady = false;
  bool _loadingDevices = false;
  List<NexusDevice> _devices = [];
  final _textCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _initRenderer();
    _refreshDevices();
  }

  Future<void> _initRenderer() async {
    try {
      await _renderer.initialize();
      if (mounted) setState(() => _rendererReady = true);
    } catch (_) {}
  }

  Future<void> _refreshDevices() async {
    final conn = ref.read(connectionProvider).value;
    final ep = conn?.endpoint;
    if (ep == null) return;
    setState(() => _loadingDevices = true);
    try {
      final devices = await NexusApi(ep).devices();
      if (mounted) setState(() => _devices = devices);
    } catch (_) {
    } finally {
      if (mounted) setState(() => _loadingDevices = false);
    }
  }

  @override
  void dispose() {
    // قطع فوري عند مغادرة الشاشة — الجلسة واجهة-حياة (عقد §24.أمن)
    ref.read(phoneRemoteProvider.notifier).stopControl();
    _textCtrl.dispose();
    _renderer.dispose();
    super.dispose();
  }

  ({int w, int h, int density}) get _targetScreen =>
      ref.read(phoneRemoteProvider).targetScreen ?? fallbackScreen;

  ({int x, int y}) _toTarget(Offset local, Size box) {
    final t = _targetScreen;
    return (
      x: ((local.dx / box.width) * t.w).round().clamp(0, t.w),
      y: ((local.dy / box.height) * t.h).round().clamp(0, t.h),
    );
  }

  // ---------- الإيماءات (نفس نموذج الويب: نقرة/ضغط مطول/سحبة/تمرير) ----------

  void _onPanStart(DragStartDetails d) {
    _press = (dx: d.localPosition.dx, dy: d.localPosition.dy, t: DateTime.now().millisecondsSinceEpoch);
    _last = (dx: d.localPosition.dx, dy: d.localPosition.dy);
  }

  void _onPanUpdate(DragUpdateDetails d) {
    _last = (dx: d.localPosition.dx, dy: d.localPosition.dy);
  }

  void _onPanEnd(DragEndDetails _) => _finishPress();

  void _onPanCancel() => _finishPress();

  void _finishPress() {
    final press = _press;
    final last = _last;
    _press = null;
    _last = null;
    final remote = ref.read(phoneRemoteProvider);
    final ctrl = ref.read(phoneRemoteProvider.notifier);
    if (press == null || last == null || !remote.sessionActive) return;
    final box = _surfaceSize;
    if (box == null) return;
    final p1 = _toTarget(Offset(press.dx, press.dy), box);
    final p2 = _toTarget(Offset(last.dx, last.dy), box);
    final dist = ((last.dx - press.dx) * (last.dx - press.dx) + (last.dy - press.dy) * (last.dy - press.dy));
    final dur = DateTime.now().millisecondsSinceEpoch - press.t;
    if (dist < tapSlopPx * tapSlopPx) {
      if (dur >= longMs) {
        ctrl.sendTouch({'op': 'long', 'x': p1.x, 'y': p1.y, 'durationMs': 700, 'seq': _seq++});
      } else {
        ctrl.sendTouch({'op': 'tap', 'x': p1.x, 'y': p1.y, 'seq': _seq++});
      }
    } else {
      ctrl.sendTouch({
        'op': 'swipe',
        'x': p1.x, 'y': p1.y, 'x2': p2.x, 'y2': p2.y,
        'durationMs': (dur.clamp(90, 1200)),
        'seq': _seq++,
      });
    }
  }

  // تمرير بإصبعين — سحبة عمودية على الهدف (عجلة الويب مقابلها هذا)
  void _onScaleStart(ScaleStartDetails d) {
    if (d.pointerCount < 2) return;
    _twoFinger = (dx: d.localFocalPoint.dx, dy: d.localFocalPoint.dy, dt: 0);
  }

  void _onScaleUpdate(ScaleUpdateDetails d) {
    final start = _twoFinger;
    if (start == null || d.pointerCount < 2) return;
    final dy = d.localFocalPoint.dy - start.dy;
    if (dy.abs() < 24) return;
    final box = _surfaceSize;
    if (box == null) return;
    final remote = ref.read(phoneRemoteProvider);
    final ctrl = ref.read(phoneRemoteProvider.notifier);
    if (!remote.sessionActive) return;
    final p = _toTarget(d.localFocalPoint, box);
    final t = _targetScreen;
    // الإصبع ينزل مع المحتوى (مثل الهاتف): أسفل المحتوى = سحبة لأعلى
    final y2 = (p.y - dy.round() * 2).clamp(0, t.h);
    ctrl.sendTouch({
      'op': 'scroll',
      'x': p.x, 'y': p.y, 'x2': p.x, 'y2': y2,
      'durationMs': 240,
      'seq': _seq++,
    });
    _twoFinger = (dx: d.localFocalPoint.dx, dy: d.localFocalPoint.dy, dt: 0);
  }

  void _onScaleEnd(ScaleEndDetails _) => _twoFinger = null;

  Size? get _surfaceSize {
    final box = _surfaceKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return null;
    return box.size;
  }

  final GlobalKey _surfaceKey = GlobalKey();

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final remote = ref.watch(phoneRemoteProvider);
    final media = ref.watch(mediaControllerProvider);
    final me = ref.watch(connectionProvider).value?.me;

    // مرآة الهاتف الآخر — جهّز العارض مع التدفق الوارد
    if (_rendererReady && media.mirrorStream != null && _renderer.srcObject != media.mirrorStream) {
      _renderer.srcObject = media.mirrorStream;
    }

    // الهواتف المقترنة الأخرى (REST) + حالة الحياة من الجسر (guard:agents)
    final liveIds = remote.agents.map((a) => a.deviceId).toSet();
    final others = _devices
        .where((d) => d.kind == 'phone' && d.id != me?.id && d.id.isNotEmpty)
        .toList();

    return Scaffold(
      appBar: AppBar(
        title: Text('p2p.title'.tr()),
        actions: [
          IconButton(
            onPressed: _loadingDevices ? null : _refreshDevices,
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'common.refresh'.tr(),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          // ==== حالة الجلسة ====
          if (remote.sessionActive) ...[
            _sessionCard(cs, remote),
            const SizedBox(height: 14),
            _surfaceCard(cs, remote, media),
            const SizedBox(height: 14),
            _systemKeysCard(cs, remote),
            const SizedBox(height: 14),
            _textInputCard(cs, remote),
            const SizedBox(height: 14),
          ] else ...[
            if (remote.phase == 'pending') ...[
              Card(
                color: cs.secondaryContainer,
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(children: [
                    Icon(Icons.hourglass_top_rounded, color: cs.onSecondaryContainer),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'p2p.waitingConfirm'.tr(args: [remote.targetName]),
                        style: TextStyle(fontWeight: FontWeight.w800, color: cs.onSecondaryContainer),
                      ),
                    ),
                    TextButton(
                      onPressed: () => ref.read(phoneRemoteProvider.notifier).stopControl(),
                      child: Text('common.cancel'.tr()),
                    ),
                  ]),
                ),
              ),
              const SizedBox(height: 14),
            ],
            _targetsHeader(cs, remote),
            const SizedBox(height: 6),
            _targetsList(cs, others, liveIds),
            const SizedBox(height: 14),
            _explainCard(cs),
          ],
          // ==== سجل صغير ====
          if (remote.log.isNotEmpty)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final l in remote.log.take(5))
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: 2),
                        child: Text(l, style: TextStyle(fontSize: 11.5, color: cs.onSurface.withOpacity(.65))),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }

  // ==== بطاقة الجلسة النشطة (قطع فوري) ====
  Widget _sessionCard(ColorScheme cs, PhoneRemoteUiState remote) {
    return Card(
      color: cs.errorContainer,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              Icon(Icons.smartphone_rounded, color: cs.onErrorContainer),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'p2p.controlling'.tr(args: [remote.targetName.isEmpty ? remote.targetId : remote.targetName]),
                  style: TextStyle(fontWeight: FontWeight.w800, color: cs.onErrorContainer),
                ),
              ),
            ]),
            if (remote.lastRejected != null) ...[
              const SizedBox(height: 8),
              Text(
                'p2p.rejectedReason'.tr(args: [remote.lastRejected!]),
                style: TextStyle(fontSize: 12, color: cs.onErrorContainer.withOpacity(.8)),
              ),
            ],
            const SizedBox(height: 10),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: cs.error, foregroundColor: cs.onError),
              onPressed: () => ref.read(phoneRemoteProvider.notifier).stopControl(),
              icon: const Icon(Icons.link_off_rounded),
              label: Text('p2p.cutNow'.tr()),
            ),
          ],
        ),
      ),
    );
  }

  // ==== سطح الهدف: المرآة الحية أو شبكة إرشادية ====
  Widget _surfaceCard(ColorScheme cs, PhoneRemoteUiState remote, MediaUiState media) {
    final t = remote.targetScreen ?? fallbackScreen;
    final live = media.mirror.phase == MediaPhase.live && media.mirrorStream != null;
    final connecting = media.mirror.phase == MediaPhase.connecting;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(children: [
          Text('p2p.targetSurface'.tr(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const Spacer(),
          Text(
            '${t.w}×${t.h}',
            style: TextStyle(fontSize: 11, color: cs.onSurface.withOpacity(.55), fontFamily: 'monospace'),
          ),
          const SizedBox(width: 8),
          if (live)
            Icon(Icons.videocam_rounded, size: 16, color: cs.primary)
          else if (connecting)
            const SizedBox(
              width: 13, height: 13,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          else
            Icon(Icons.videocam_off_rounded, size: 16, color: cs.onSurface.withOpacity(.35)),
        ]),
        const SizedBox(height: 6),
        Center(
          child: GestureDetector(
            onPanStart: _onPanStart,
            onPanUpdate: _onPanUpdate,
            onPanEnd: _onPanEnd,
            onPanCancel: _onPanCancel,
            onScaleStart: _onScaleStart,
            onScaleUpdate: _onScaleUpdate,
            onScaleEnd: _onScaleEnd,
            child: Container(
              key: _surfaceKey,
              width: 250,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(22),
                border: Border.all(color: cs.outline.withOpacity(.6), width: 4),
                color: Colors.black,
              ),
              child: AspectRatio(
                aspectRatio: t.w / t.h,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(17),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      if (live)
                        RTCVideoView(_renderer, objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitContain)
                      else
                        _gridPlaceholder(cs, remote),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _gridPlaceholder(ColorScheme cs, PhoneRemoteUiState remote) {
    return Container(
      color: const Color(0xFF09090b),
      child: Stack(
        children: [
          Positioned.fill(
            child: Opacity(
              opacity: .13,
              child: Column(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  for (var i = 0; i < 6; i++)
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        for (var j = 0; j < 4; j++)
                          Container(width: 1, height: 26, color: Colors.white),
                      ],
                    ),
                ],
              ),
            ),
          ),
          Center(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 18),
              child: Text(
                remote.sessionActive ? 'p2p.noMirrorHint'.tr() : 'p2p.startHint'.tr(),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 10.5, height: 1.6, color: Colors.white.withOpacity(.45)),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ==== أزرار النظام (نفس أزرار الويب) ====
  Widget _systemKeysCard(ColorScheme cs, PhoneRemoteUiState remote) {
    final keys = [
      ('back', Icons.arrow_back_rounded, 'p2p.keyBack'.tr()),
      ('home', Icons.home_rounded, 'p2p.keyHome'.tr()),
      ('recents', Icons.layers_rounded, 'p2p.keyRecents'.tr()),
      ('notifications', Icons.notifications_rounded, 'p2p.keyNotif'.tr()),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('p2p.systemKeys'.tr(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 6),
        Row(
          children: [
            for (final (action, icon, label) in keys) ...[
              Expanded(
                child: OutlinedButton(
                  onPressed: remote.sessionActive
                      ? () {
                          ref.read(phoneRemoteProvider.notifier).sendKey(action);
                          HapticFeedback.selectionClick();
                        }
                      : null,
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                  child: Column(children: [
                    Icon(icon, size: 20),
                    const SizedBox(height: 3),
                    Text(label, style: const TextStyle(fontSize: 10)),
                  ]),
                ),
              ),
              if (action != keys.last.$1) const SizedBox(width: 8),
            ],
          ],
        ),
      ],
    );
  }

  // ==== الإدخال النصي في الحقل المركّز على الهدف ====
  Widget _textInputCard(ColorScheme cs, PhoneRemoteUiState remote) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('p2p.textTitle'.tr(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 6),
        Row(children: [
          Expanded(
            child: TextField(
              controller: _textCtrl,
              decoration: InputDecoration(
                hintText: 'p2p.textHint'.tr(),
                isDense: true,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
              onSubmitted: (v) {
                if (v.isNotEmpty && remote.sessionActive) {
                  ref.read(phoneRemoteProvider.notifier).sendText(v);
                  _textCtrl.clear();
                }
              },
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filled(
            onPressed: remote.sessionActive && _textCtrl.text.isNotEmpty
                ? () {
                    ref.read(phoneRemoteProvider.notifier).sendText(_textCtrl.text);
                    _textCtrl.clear();
                  }
                : null,
            icon: const Icon(Icons.send_rounded),
          ),
        ]),
      ],
    );
  }

  Widget _targetsHeader(ColorScheme cs, PhoneRemoteUiState remote) {
    return Row(children: [
      Text('p2p.targetsTitle'.tr(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
      const SizedBox(width: 8),
      if (!remote.bridgeOnline)
        Text('p2p.bridgeOffline'.tr(), style: TextStyle(fontSize: 11, color: cs.error)),
    ]);
  }

  Widget _targetsList(ColorScheme cs, List<NexusDevice> others, Set<String> liveIds) {
    if (_loadingDevices && others.isEmpty) {
      return const Center(child: Padding(padding: EdgeInsets.all(18), child: CircularProgressIndicator()));
    }
    if (others.isEmpty) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            'p2p.noTargets'.tr(),
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 12.5, height: 1.6, color: cs.onSurface.withOpacity(.6)),
          ),
        ),
      );
    }
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (final d in others) ...[
            ListTile(
              leading: Icon(
                Icons.smartphone_rounded,
                color: liveIds.contains(d.id) ? cs.primary : cs.onSurface.withOpacity(.35),
              ),
              title: Text(d.name, style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text(
                liveIds.contains(d.id) ? 'p2p.targetLive'.tr() : 'p2p.targetOffline'.tr(),
                style: TextStyle(
                  fontSize: 11,
                  color: liveIds.contains(d.id) ? cs.primary : cs.onSurface.withOpacity(.45),
                ),
              ),
              trailing: const Icon(Icons.chevron_right_rounded),
              enabled: liveIds.contains(d.id),
              onTap: () => ref.read(phoneRemoteProvider.notifier).requestControl(d.id, d.name),
            ),
            if (d != others.last) const Divider(height: 1),
          ],
        ],
      ),
    );
  }

  Widget _explainCard(ColorScheme cs) {
    final native = ref.watch(nativeBridgeProvider);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('p2p.howTitle'.tr(), style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            Text(
              'p2p.howBody'.tr(),
              style: TextStyle(fontSize: 12.5, height: 1.7, color: cs.onSurface.withOpacity(.75)),
            ),
            const SizedBox(height: 8),
            TextButton.icon(
              onPressed: () {
                native.openAppDetails();
                HapticFeedback.selectionClick();
              },
              icon: const Icon(Icons.lock_open_rounded, size: 18),
              label: Text('unblock.openCenterShort'.tr(), style: const TextStyle(fontSize: 12.5)),
            ),
          ],
        ),
      ),
    );
  }
}

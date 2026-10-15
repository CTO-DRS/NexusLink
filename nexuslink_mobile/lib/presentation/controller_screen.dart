import 'dart:async';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/controller_service.dart';
import 'tablet_screen.dart';
import 'gyro_screen.dart';
import '../state/controller_providers.dart';
import '../state/transfer_providers.dart';

/// شاشة جهاز التحكم (FA-9) — الهاتف طرف متحكم للكمبيوتر عبر قناة 3004:
/// لوحة لمس، كيبورد عربي/إنجليزي، ماوس هوائي بالجيروسكوب، وسائط وطاقة،
/// حافظة موحدة، وتسليم «أكمل من حيث توقفت».
class RcScreen extends ConsumerStatefulWidget {
  const RcScreen({super.key});

  @override
  ConsumerState<RcScreen> createState() => _RcScreenState();
}

class _RcScreenState extends ConsumerState<RcScreen>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final TabController _tabs = TabController(length: 6, vsync: this);
  final _handoffUrl = TextEditingController();
  final _handoffTitle = TextEditingController();
  final _kbdCtrl = TextEditingController();
  String? _sharedText;
  ControllerController? _ctl;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _ctl = ref.read(controllerControllerProvider.notifier);
    _ctl!.setClipboardWatch(true);
    // FA-input (عقد §13) — جلسة التحكم الموثوقة: تبدأ مع فتح الشاشة
    // (نبض 2ث) وتنتهي بإغلاقها — الطبقة الأصلية على الكمبيوتر ترفض
    // كل الإدخال ما لم تكن الجلسة نشطة (الأجهزة الموثوقة فقط).
    _ctl!.startSession();
    _drainShare();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _ctl?.setClipboardWatch(false);
    _ctl?.stopSession();
    _tabs.dispose();
    _handoffUrl.dispose();
    _handoffTitle.dispose();
    _kbdCtrl.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _drainShare();
  }

  /// زر مشاركة النظام → NexusLink → أسحبها هنا (نص/رابط).
  Future<void> _drainShare() async {
    try {
      final intake = await ref.read(nativeBridgeProvider).drainShare();
      if (!mounted || intake.text == null || intake.text!.isEmpty) return;
      setState(() => _sharedText = intake.text);
      final t = intake.text!.trim();
      if (t.startsWith('http://') || t.startsWith('https://')) {
        _handoffUrl.text = t;
      }
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final st = ref.watch(controllerControllerProvider);
    final ctl = ref.read(controllerControllerProvider.notifier);

    return Column(
      children: [
        _StatusHeader(st: st),
        // FA-input (عقد §13) — شريط الجلسة: حالة الجلسة + القطع الفوري (بند 7)
        _SessionBar(st: st, ctl: ctl),
        TabBar(
          controller: _tabs,
          isScrollable: true,
          tabAlignment: TabAlignment.start,
          labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
          tabs: [
            Tab(icon: const Icon(Icons.touch_app_rounded, size: 18), text: 'rctl.tab.pad'.tr()),
            Tab(icon: const Icon(Icons.keyboard_rounded, size: 18), text: 'rctl.tab.kbd'.tr()),
            Tab(icon: const Icon(Icons.sensors_rounded, size: 18), text: 'rctl.tab.air'.tr()),
            Tab(icon: const Icon(Icons.system_update_rounded, size: 18), text: 'rctl.tab.sys'.tr()),
            Tab(icon: const Icon(Icons.content_paste_rounded, size: 18), text: 'rctl.tab.clip'.tr()),
            Tab(icon: const Icon(Icons.send_to_mobile_rounded, size: 18), text: 'rctl.tab.hand'.tr()),
          ],
        ),
        Expanded(
          child: TabBarView(
            controller: _tabs,
            children: [
              _PadTab(st: st, ctl: ctl),
              _KbdTab(st: st, ctl: ctl, ctrl: _kbdCtrl),
              _AirTab(st: st, ctl: ctl),
              _SysTab(st: st, ctl: ctl),
              _ClipTab(st: st, ctl: ctl),
              _HandTab(
                st: st,
                ctl: ctl,
                urlCtrl: _handoffUrl,
                titleCtrl: _handoffTitle,
                sharedText: _sharedText,
                onClearShared: () => setState(() => _sharedText = null),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// الرأس
// ---------------------------------------------------------------------------

class _StatusHeader extends StatelessWidget {
  final RcUiState st;
  const _StatusHeader({required this.st});

  @override
  Widget build(BuildContext context) {
    final online = st.phase == RcBridgePhase.online;
    final powerColor = switch (st.desktopPower) {
      'on' => Colors.green,
      'sleeping' || 'locked' => Colors.amber,
      _ => Colors.red,
    };
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 8),
      child: Row(
        children: [
          Icon(Icons.computer_rounded,
              size: 18, color: online ? Theme.of(context).colorScheme.primary : Theme.of(context).disabledColor),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              online
                  ? '${st.desktopName.isEmpty ? 'rctl.desktop'.tr() : st.desktopName} · ${'rctl.power'.tr()}: ${st.desktopPower}'
                  : 'rctl.offline'.tr(),
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.bold,
                color: online ? null : Theme.of(context).colorScheme.error,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          Container(width: 8, height: 8, decoration: BoxDecoration(color: powerColor, shape: BoxShape.circle)),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// FA-input (عقد §13) — شريط جلسة التحكم: حالة موثوقة + القطع الفوري (بند 7)
// ---------------------------------------------------------------------------

class _SessionBar extends StatelessWidget {
  final RcUiState st;
  final ControllerController ctl;
  const _SessionBar({required this.st, required this.ctl});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (st.sessionActive) {
      return Container(
        margin: const EdgeInsets.fromLTRB(14, 0, 14, 6),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: const Color(0xFF2E1065).withOpacity(0.75),
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: const Color(0xFFA78BFA).withOpacity(0.55)),
        ),
        child: Row(
          children: [
            Container(
              width: 8, height: 8,
              decoration: BoxDecoration(
                color: const Color(0xFFA78BFA),
                shape: BoxShape.circle,
                boxShadow: [BoxShadow(color: const Color(0xFFA78BFA).withOpacity(0.6), blurRadius: 6)],
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'rctl.session.active'.tr(namedArgs: {'name': st.desktopName.isEmpty ? 'rctl.desktop'.tr() : st.desktopName}),
                style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            // الجولة 4 (عقد §18) — رقاقة القناة الحية: UDP جاهز (RTT حي) /
            // جارٍ الفتح / فوق socket.io (رجوع TCP الافتراضي)
            _LiveChip(st: st),
            const SizedBox(width: 6),
            TextButton.icon(
              onPressed: () => ctl.stopSession(),
              icon: const Icon(Icons.link_off_rounded, size: 14),
              label: Text('rctl.session.cut'.tr(), style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
              style: TextButton.styleFrom(
                foregroundColor: Colors.white,
                backgroundColor: Colors.red.shade600,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
          ],
        ),
      );
    }
    // بلا جلسة — عرض سبب آخر إنهاء إن وُجد (بدء من الكمبيوتر/مهلة/غير موثوق)
    final reason = st.sessionEndReason;
    if (reason == null || st.phase != RcBridgePhase.online) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 0, 14, 4),
      child: Text(
        'rctl.session.ended'.tr(namedArgs: {'r': reason}),
        style: TextStyle(fontSize: 10.5, color: theme.hintColor),
      ),
    );
  }
}

/// الجولة 4 (عقد §18) — رقاقة القناة الحية NexusLive:
/// أخضر = الإدخال الحي فوق UDP (مع RTT الحي) · كهرماني = جارٍ فتح التدفق ·
/// رمادي = الإدخال فوق socket.io (TCP الافتراضي) — صدق حالة دون تزييف.
class _LiveChip extends StatelessWidget {
  final RcUiState st;
  const _LiveChip({required this.st});

  @override
  Widget build(BuildContext context) {
    final (Color bg, Color fg, String label) = st.liveReady
        ? (
            const Color(0xFF064E3B),
            const Color(0xFF6EE7B7),
            'rctl.live.ready'.tr(namedArgs: {'rtt': '${st.liveRttMs}'}),
          )
        : st.liveOpening
            ? (
                const Color(0xFF78350F),
                const Color(0xFFFCD34D),
                'rctl.live.opening'.tr(),
              )
            : (
                Colors.white.withOpacity(0.12),
                Colors.white70,
                'rctl.live.tcp'.tr(),
              );
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: fg.withOpacity(0.45)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(st.liveReady ? Icons.bolt_rounded : Icons.timeline_rounded, size: 11, color: fg),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.bold, color: fg)),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// أدوات مشتركة
// ---------------------------------------------------------------------------

class _Card extends StatelessWidget {
  final String title;
  final IconData icon;
  final Widget? trailing;
  final List<Widget> children;
  const _Card({required this.title, required this.icon, this.trailing, required this.children});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withOpacity(0.35),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: theme.colorScheme.primary),
              const SizedBox(width: 6),
              Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
              if (trailing != null) ...[const Spacer(), trailing!],
            ],
          ),
          const SizedBox(height: 10),
          ...children,
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// تبويب 1: لوحة اللمس
// ---------------------------------------------------------------------------

class _PadTab extends StatefulWidget {
  final RcUiState st;
  final ControllerController ctl;
  const _PadTab({required this.st, required this.ctl});

  @override
  State<_PadTab> createState() => _PadTabState();
}

class _PadTabState extends State<_PadTab> {
  double _speed = 1.0;
  bool _dragMode = false;
  String _hint = '';

  void _hint_(String s) => setState(() => _hint = s);

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        _Card(
          title: 'rctl.pad.title'.tr(),
          icon: Icons.touch_app_rounded,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Container(
                height: 260,
                color: theme.colorScheme.surface,
                child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () {
                    if (_dragMode) return;
                    widget.ctl.click();
                    _hint_('rctl.pad.tap'.tr());
                  },
                  onDoubleTap: () {
                    widget.ctl.click(type: 'double');
                    _hint_('rctl.pad.dbl'.tr());
                  },
                  onLongPressStart: (_) {
                    setState(() => _dragMode = true);
                    HapticFeedback.selectionClick();
                  },
                  onLongPressEnd: (_) {
                    setState(() => _dragMode = false);
                  },
                  onScaleUpdate: (d) {
                    final delta = d.focalPointDelta;
                    if (d.pointerCount >= 2) {
                      // إصبعان: تفرّق → قرص، عمودي → تمرير
                      if ((d.scale - _lastScale).abs() > 0.005) {
                        final ds = d.scale / (_lastScale == 0 ? 1 : _lastScale);
                        widget.ctl.pinch(ds);
                        _lastScale = d.scale;
                      } else if (delta.dy.abs() > 0.5) {
                        widget.ctl.scroll(delta.dy * 0.5);
                      }
                      return;
                    }
                    _lastScale = 1;
                    if (delta.distance < 0.3) return;
                    final dx = delta.dx / 430 * _speed;
                    final dy = delta.dy / 430 * _speed;
                    widget.ctl.move(dx, dy, drag: _dragMode);
                    if (_dragMode) _hint_('rctl.pad.drag'.tr());
                  },
                  onScaleEnd: (_) => _lastScale = 1,
                ),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: () => widget.ctl.click(),
                    icon: const Icon(Icons.radio_button_unchecked_rounded, size: 16),
                    label: Text('rctl.pad.left'.tr(), style: const TextStyle(fontSize: 12)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: () => widget.ctl.click(button: 'right'),
                    icon: const Icon(Icons.more_vert_rounded, size: 16),
                    label: Text('rctl.pad.right'.tr(), style: const TextStyle(fontSize: 12)),
                  ),
                ),
              ],
            ),
            Row(
              children: [
                Text('rctl.pad.speed'.tr(), style: const TextStyle(fontSize: 12)),
                Expanded(
                  child: Slider(
                    value: _speed,
                    min: 0.4,
                    max: 3,
                    divisions: 13,
                    label: '×${_speed.toStringAsFixed(1)}',
                    onChanged: (v) => setState(() => _speed = v),
                  ),
                ),
                Switch(
                  value: _dragMode,
                  onChanged: (v) => setState(() => _dragMode = v),
                ),
                Text('rctl.pad.dragk'.tr(), style: const TextStyle(fontSize: 11)),
              ],
            ),
            Text(
              _hint.isEmpty ? 'rctl.pad.hint'.tr() : _hint,
              style: TextStyle(fontSize: 10.5, color: theme.hintColor),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ],
    );
  }

  double _lastScale = 1;
}

// ---------------------------------------------------------------------------
// تبويب 2: كيبورد
// ---------------------------------------------------------------------------

class _KbdTab extends StatefulWidget {
  final RcUiState st;
  final ControllerController ctl;
  final TextEditingController ctrl;
  const _KbdTab({required this.st, required this.ctl, required this.ctrl});

  @override
  State<_KbdTab> createState() => _KbdTabState();
}

class _KbdTabState extends State<_KbdTab> {
  String _prev = '';
  int _sent = 0;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        _Card(
          title: 'rctl.kbd.title'.tr(),
          icon: Icons.keyboard_rounded,
          children: [
            TextField(
              controller: widget.ctrl,
              maxLines: 4,
              keyboardType: TextInputType.multiline,
              decoration: InputDecoration(
                hintText: 'rctl.kbd.hint'.tr(),
                border: const OutlineInputBorder(),
                isDense: true,
              ),
              onChanged: (text) {
                // نرسل ما زاد حرفًا حرفًا (عربي/إنجليزي حسب لوحة النظام)
                if (text.length > _prev.length && text.startsWith(_prev)) {
                  final added = text.substring(_prev.length);
                  for (final ch in added.runes.take(12)) {
                    widget.ctl.key(String.fromCharCode(ch));
                    _sent++;
                  }
                } else if (text.length < _prev.length) {
                  final removed = _prev.length - text.length;
                  for (var i = 0; i < removed && i < 12; i++) {
                    widget.ctl.keySpecial('backspace');
                    _sent++;
                  }
                }
                _prev = text;
                if (mounted) setState(() {});
              },
            ),
            const SizedBox(height: 8),
            Text('rctl.kbd.live'.tr(namedArgs: {'n': '$_sent'}),
                style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final e in const [
                  ('enter', Icons.keyboard_return_rounded), ('space', Icons.space_bar_rounded),
                  ('backspace', Icons.backspace_rounded), ('tab', Icons.keyboard_tab_rounded),
                  ('esc', Icons.highlight_remove_rounded), ('up', Icons.arrow_upward_rounded),
                  ('down', Icons.arrow_downward_rounded), ('left', Icons.arrow_back_rounded),
                  ('right', Icons.arrow_forward_rounded),
                ])
                  OutlinedButton.icon(
                    onPressed: () => widget.ctl.keySpecial(e.$1),
                    icon: Icon(e.$2, size: 14),
                    label: Text('rctl.kbd.sp.${e.$1}'.tr(), style: const TextStyle(fontSize: 11)),
                  ),
              ],
            ),
          ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// تبويب 3: الماوس الهوائي
// ---------------------------------------------------------------------------

class _AirTab extends StatefulWidget {
  final RcUiState st;
  final ControllerController ctl;
  const _AirTab({required this.st, required this.ctl});

  @override
  State<_AirTab> createState() => _AirTabState();
}

class _AirTabState extends State<_AirTab> {
  int _taps = 0;
  Timer? _gestureT;

  /// إيماءة التفعيل: 3 نقرات سريعة على البطاقة خلال 900ms.
  void _gestureTap() {
    _taps++;
    _gestureT?.cancel();
    _gestureT = Timer(const Duration(milliseconds: 900), () {
      if (_taps >= 3) {
        final next = !widget.st.airmouseOn;
        widget.ctl.setAirmouse(next);
        HapticFeedback.mediumImpact();
      }
      _taps = 0;
      if (mounted) setState(() {});
    });
    setState(() {});
  }

  @override
  void dispose() {
    _gestureT?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final st = widget.st;
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        _Card(
          title: 'rctl.air.title'.tr(),
          icon: Icons.sensors_rounded,
          trailing: Switch(
            value: st.airmouseOn,
            onChanged: (v) => widget.ctl.setAirmouse(v),
          ),
          children: [
            GestureDetector(
              onTap: _gestureTap,
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: st.airmouseOn
                      ? Colors.green.withOpacity(0.12)
                      : Theme.of(context).colorScheme.surface,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: st.airmouseOn ? Colors.green : Theme.of(context).dividerColor,
                  ),
                ),
                child: Column(
                  children: [
                    Icon(
                      st.airmouseOn ? Icons.mouse_rounded : Icons.mouse_outlined,
                      size: 34,
                      color: st.airmouseOn ? Colors.green : Theme.of(context).hintColor,
                    ),
                    const SizedBox(height: 6),
                    Text(
                      st.airmouseOn ? 'rctl.air.on'.tr() : 'rctl.air.off'.tr(),
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
                    ),
                    const SizedBox(height: 4),
                    Text('rctl.air.gesture'.tr(namedArgs: {'n': '$_taps'}),
                        style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor)),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 10),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('rctl.air.gyro'.tr(),
                    style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor)),
                Text(
                  '[${st.gyro.map((v) => v.toStringAsFixed(1)).join(', ')}]',
                  style: const TextStyle(fontSize: 10.5, fontFamily: 'monospace'),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text('rctl.air.moves'.tr(namedArgs: {'n': '${st.airmouseMoves}'}),
                style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor)),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: () => widget.ctl.click(),
                    icon: const Icon(Icons.radio_button_unchecked_rounded, size: 16),
                    label: Text('rctl.pad.left'.tr(), style: const TextStyle(fontSize: 12)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: () => widget.ctl.click(button: 'right'),
                    icon: const Icon(Icons.more_vert_rounded, size: 16),
                    label: Text('rctl.pad.right'.tr(), style: const TextStyle(fontSize: 12)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// تبويب 4: الوسائط والطاقة (نظام)
// ---------------------------------------------------------------------------

class _SysTab extends StatefulWidget {
  final RcUiState st;
  final ControllerController ctl;
  const _SysTab({required this.st, required this.ctl});

  @override
  State<_SysTab> createState() => _SysTabState();
}

class _SysTabState extends State<_SysTab> {
  double _volume = 50;

  Future<void> _confirm(BuildContext context, String action, String label) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: Text('rctl.sys.confirm'.tr(), style: const TextStyle(fontSize: 16)),
        content: Text('rctl.sys.confirmBody'.tr(namedArgs: {'a': label})),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: Text('common.cancel'.tr())),
          FilledButton(onPressed: () => Navigator.pop(d, true), child: Text('common.ok'.tr())),
        ],
      ),
    );
    if (ok == true) widget.ctl.power(action);
  }

  @override
  Widget build(BuildContext context) {
    final st = widget.st;
    final ctl = widget.ctl;
    final rejected = st.lastRejected;
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        // FA-input (عقد §13) — العرض التقديمي: PageUp/PageDown + F5/Esc (بند 4)
        _Card(
          title: 'rctl.present.title'.tr(),
          icon: Icons.slideshow_rounded,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                IconButton.filledTonal(
                  onPressed: () => ctl.presenter('prev'),
                  icon: const Icon(Icons.navigate_before_rounded, size: 26),
                  tooltip: 'rctl.present.prev'.tr(),
                ),
                FilledButton.icon(
                  onPressed: () => ctl.presenter('start'),
                  icon: const Icon(Icons.play_arrow_rounded, size: 18),
                  label: Text('rctl.present.start'.tr(), style: const TextStyle(fontSize: 12)),
                ),
                FilledButton.tonalIcon(
                  onPressed: () => ctl.presenter('stop'),
                  icon: const Icon(Icons.stop_rounded, size: 18),
                  label: Text('rctl.present.stop'.tr(), style: const TextStyle(fontSize: 12)),
                ),
                IconButton.filledTonal(
                  onPressed: () => ctl.presenter('next'),
                  icon: const Icon(Icons.navigate_next_rounded, size: 26),
                  tooltip: 'rctl.present.next'.tr(),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Center(
              child: Text(
                'rctl.present.hint'.tr(),
                style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor),
                textAlign: TextAlign.center,
              ),
            ),
          ],
        ),
        _Card(
          title: 'rctl.sys.media'.tr(),
          icon: Icons.play_circle_rounded,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                IconButton.filledTonal(
                  onPressed: () => ctl.media('prev'),
                  icon: const Icon(Icons.skip_previous_rounded),
                ),
                IconButton.filled(
                  onPressed: () => ctl.media('toggle'),
                  icon: const Icon(Icons.play_arrow_rounded, size: 28),
                ),
                IconButton.filledTonal(
                  onPressed: () => ctl.media('next'),
                  icon: const Icon(Icons.skip_next_rounded),
                ),
                IconButton.filledTonal(
                  onPressed: () => ctl.media('mute'),
                  icon: const Icon(Icons.volume_off_rounded),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text('rctl.sys.vol'.tr(), style: const TextStyle(fontSize: 11)),
            Slider(
              value: _volume,
              onChanged: (v) {
                setState(() => _volume = v);
                ctl.media('volume', value: v);
              },
            ),
          ],
        ),
        _Card(
          title: 'rctl.sys.power'.tr(),
          icon: Icons.power_settings_new_rounded,
          children: [
            if (rejected != null)
              Container(
                margin: const EdgeInsets.only(bottom: 8),
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.errorContainer.withOpacity(0.4),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text('rctl.sys.rejected'.tr(namedArgs: {'r': rejected}),
                    style: const TextStyle(fontSize: 11)),
              ),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final e in const [
                  ('lock', Icons.lock_rounded), ('logout', Icons.logout_rounded),
                  ('sleep', Icons.brightness_2_rounded),
                  ('hibernate', Icons.dark_mode_rounded), ('restart', Icons.refresh_rounded),
                  ('shutdown', Icons.power_settings_new_rounded),
                ])
                  FilledButton.tonalIcon(
                    onPressed: () => _confirm(context, e.$1, 'rctl.sys.act.${e.$1}'.tr()),
                    icon: Icon(e.$2, size: 15),
                    label: Text('rctl.sys.act.${e.$1}'.tr(), style: const TextStyle(fontSize: 11.5)),
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Text('rctl.sys.wol'.tr(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
            Text(
              st.desktopMac.isEmpty ? 'rctl.sys.macEmpty'.tr() : st.desktopMac,
              style: const TextStyle(fontSize: 11, fontFamily: 'monospace'),
            ),
            const SizedBox(height: 6),
            FilledButton.icon(
              onPressed: () async {
                // FA-power — متصل: عبر قناة 3004 (rc:wol) · غير متصل: UDP مباشر
                if (st.phase == RcBridgePhase.online) {
                  ctl.wakeLan();
                } else {
                  final sent = await ctl.wakeDirect();
                  if (!context.mounted) return;
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(sent > 0 ? 'wake.sent'.tr() : 'wake.fail'.tr()),
                      duration: const Duration(seconds: 4),
                    ),
                  );
                }
              },
              icon: const Icon(Icons.bolt_rounded, size: 16),
              label: Text('rctl.sys.wake'.tr(), style: const TextStyle(fontSize: 12)),
            ),
          ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// تبويب 5: الحافظة الموحدة
// ---------------------------------------------------------------------------

class _ClipTab extends StatelessWidget {
  final RcUiState st;
  final ControllerController ctl;
  const _ClipTab({required this.st, required this.ctl});

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        _Card(
          title: 'rctl.clip.title'.tr(),
          icon: Icons.content_paste_rounded,
          trailing: Text('rctl.clip.count'.tr(namedArgs: {'n': '${st.clipPushes}'}),
              style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor)),
          children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: Text('rctl.clip.watch'.tr(), style: const TextStyle(fontSize: 12.5)),
              subtitle: Text('rctl.clip.watchSub'.tr(), style: const TextStyle(fontSize: 10.5)),
              value: st.clipboardWatch,
              onChanged: (v) => ctl.setClipboardWatch(v),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: Text('rctl.clip.auto'.tr(), style: const TextStyle(fontSize: 12.5)),
              subtitle: Text('rctl.clip.autoSub'.tr(), style: const TextStyle(fontSize: 10.5)),
              value: st.clipboardAuto,
              onChanged: (v) => ctl.setClipboardAuto(v),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => ctl.pushClipboard(),
                    icon: const Icon(Icons.upload_rounded, size: 16),
                    label: Text('rctl.clip.send'.tr(), style: const TextStyle(fontSize: 12)),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: () => ctl.pullPcClipboard(),
                    icon: const Icon(Icons.download_rounded, size: 16),
                    label: Text('rctl.clip.pull'.tr(), style: const TextStyle(fontSize: 12)),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text('rctl.clip.fromPc'.tr(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            Container(
              width: double.infinity,
              constraints: const BoxConstraints(minHeight: 70),
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Theme.of(context).dividerColor),
              ),
              child: Text(
                st.lastPcClipboard == null
                    ? 'rctl.clip.empty'.tr()
                    : (st.lastPcClipboard!.length > 300
                        ? '${st.lastPcClipboard!.substring(0, 300)}…'
                        : st.lastPcClipboard!),
                style: const TextStyle(fontSize: 12),
              ),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: st.lastPcClipboard == null ? null : () => ctl.copyPcToPhone(),
              icon: const Icon(Icons.copy_rounded, size: 15),
              label: Text('rctl.clip.copyPhone'.tr(), style: const TextStyle(fontSize: 12)),
            ),
          ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// تبويب 6: التسليم «أكمل من حيث توقفت»
// ---------------------------------------------------------------------------

class _HandTab extends StatelessWidget {
  final RcUiState st;
  final ControllerController ctl;
  final TextEditingController urlCtrl;
  final TextEditingController titleCtrl;
  final String? sharedText;
  final VoidCallback onClearShared;

  const _HandTab({
    required this.st,
    required this.ctl,
    required this.urlCtrl,
    required this.titleCtrl,
    required this.sharedText,
    required this.onClearShared,
  });

  @override
  Widget build(BuildContext context) {
    final isUrl = sharedText != null &&
        (sharedText!.startsWith('http://') || sharedText!.startsWith('https://'));
    return ListView(
      padding: const EdgeInsets.all(14),
      children: [
        if (sharedText != null)
          _Card(
            title: 'rctl.hand.shared'.tr(),
            icon: Icons.share_rounded,
            children: [
              Text(sharedText!, style: const TextStyle(fontSize: 12), maxLines: 4, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: isUrl
                          ? () {
                              ctl.handoff(sharedText!.trim(), title: sharedText!.trim());
                              onClearShared();
                            }
                          : null,
                      icon: const Icon(Icons.send_rounded, size: 15),
                      label: Text('rctl.hand.openPc'.tr(), style: const TextStyle(fontSize: 12)),
                    ),
                  ),
                  IconButton(
                    onPressed: onClearShared,
                    icon: const Icon(Icons.close_rounded, size: 16),
                  ),
                ],
              ),
              if (!isUrl)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text('rctl.hand.notUrl'.tr(),
                      style: TextStyle(fontSize: 10.5, color: Theme.of(context).colorScheme.error)),
                ),
            ],
          ),
        _Card(
          title: 'rctl.hand.title'.tr(),
          icon: Icons.send_to_mobile_rounded,
          trailing: Text('rctl.hand.count'.tr(namedArgs: {'n': '${st.handoffSent}'}),
              style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor)),
          children: [
            TextField(
              controller: urlCtrl,
              keyboardType: TextInputType.url,
              decoration: InputDecoration(
                hintText: 'rctl.hand.urlHint'.tr(),
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: titleCtrl,
              decoration: InputDecoration(
                hintText: 'rctl.hand.titleHint'.tr(),
                border: const OutlineInputBorder(),
                isDense: true,
              ),
            ),
            const SizedBox(height: 8),
            if (st.lastError != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(st.lastError!,
                    style: TextStyle(fontSize: 11, color: Theme.of(context).colorScheme.error)),
              ),
            FilledButton.icon(
              onPressed: () => ctl.handoff(urlCtrl.text.trim(), title: titleCtrl.text.trim()),
              icon: const Icon(Icons.send_rounded, size: 16),
              label: Text('rctl.hand.send'.tr(), style: const TextStyle(fontSize: 12)),
            ),
            const SizedBox(height: 8),
            Text('rctl.hand.explain'.tr(),
                style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor)),
          ],
        ),
        // الجولة 4 مرحلة ② (عقد §20) — لوحة الرسم الاحترافية
        _Card(
          title: 'tablet.entry'.tr(),
          icon: Icons.draw_rounded,
          children: [
            Text('tablet.entryDesc'.tr(),
                style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor)),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const TabletScreen()),
              ),
              icon: const Icon(Icons.draw_rounded, size: 16),
              label: Text('tablet.open'.tr(), style: const TextStyle(fontSize: 12)),
            ),
          ],
        ),
        // الجولة 4 مرحلة ③ (عقد §21) — ثلاثية التحكم المتقدم (جيمباد الحساسات
        // + الماوس الهوائي المعاير + عارض العروض بالمؤقت)
        _Card(
          title: 'gyro.entry'.tr(),
          icon: Icons.sports_esports_rounded,
          children: [
            Text('gyro.entryDesc'.tr(),
                style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor)),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: () => Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const GyroScreen()),
              ),
              icon: const Icon(Icons.sports_esports_rounded, size: 16),
              label: Text('gyro.open'.tr(), style: const TextStyle(fontSize: 12)),
            ),
          ],
        ),
      ],
    );
  }
}

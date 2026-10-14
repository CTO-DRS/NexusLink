import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/live_channel.dart';
import '../state/controller_providers.dart';

// ============================================================================
// الجولة 4 مرحلة ② (عقد §20) — لوحة الرسم الاحترافية: الهاتف+القلم لوحة رقمية.
// · التقاط خام: PlatformDispatcher.onPointerDataPacket — كل عينة ينتجها
//   المحرك (حتى دفعات 240Hz) قبل أي تجميع إطاري، بسلسلة Callback الأصلية
//   (إطار العمل يعمل كما هو) — tilt/orientation وpressure كاملان.
// · تجميع ذكي (PenSampler): hover الأحدث فقط (latest-wins — دلالة القناة
//   الحية نفسها)، وأحداث التلامس كلها بالترتيب، والمكرر المكمم يُهمل —
//   داتاجرام واحد لكل حدث (عقد §18 حرفيًا، لا بروتوكول موازٍ).
// · راحة اليد: الأصبع (touch) يُرفض افتراضيًا — القلم والممحاة فقط.
// · المعاينة المحلية فورية (قبل الشبكة) بخط سماكته = الضغط — تأخير بصري
//   أدنى (RepaintBoundary + سقف رسم 80fps).
// · الإرسال: sendPen (ضغط/ميل/أداة) فوق UDP حصرًا خلال جلسة نشطة — والوضع
//   والإعدادات من الكمبيوتر (rc:tablet:state — مصدر الحقيقة).
// ============================================================================

/// عينة قلم بعد التطبيع (0..1) — مستقلة عن dart:ui (نقية قابلة للاختبار)
class PenSample {
  final int tool; // 0=قلم 1=ممحاة 2=إصبع (§20)
  final int phase; // 0=hover 1=down 2=move 3=up
  final double nx, ny, pressure;
  final int tiltX, tiltY, buttons;
  const PenSample({
    required this.tool,
    required this.phase,
    required this.nx,
    required this.ny,
    required this.pressure,
    required this.tiltX,
    required this.tiltY,
    required this.buttons,
  });
}

/// تجميع ذكي — hover الأحدث فقط، والتلامس كله بالترتيب (نقية — §20)
class PenSampler {
  final List<PenSample> _q = [];
  PenSample? _hover;

  void add(PenSample s) {
    if (s.phase == 0) {
      _hover = s; // hover: الأحدث يغلب — لا تراكم
      return;
    }
    if (_hover != null) {
      _q.add(_hover!); // آخر hover قبل أول تلامس (الموضع قبل النزول)
      _hover = null;
    }
    _q.add(s);
  }

  List<PenSample> drain() {
    if (_hover != null) {
      _q.add(_hover!);
      _hover = null;
    }
    if (_q.isEmpty) return const [];
    final out = List<PenSample>.from(_q);
    _q.clear();
    return out;
  }
}

/// نقطة معاينة محلية
class _TrailPoint {
  final Offset p;
  final double w;
  final bool eraser;
  const _TrailPoint(this.p, this.w, this.eraser);
}

class TabletScreen extends ConsumerStatefulWidget {
  const TabletScreen({super.key});
  @override
  ConsumerState<TabletScreen> createState() => _TabletScreenState();
}

class _TabletScreenState extends ConsumerState<TabletScreen> {
  static const int _maxStrokes = 10;
  static const int _maxPointsPerStroke = 900;

  final GlobalKey _surfaceKey = GlobalKey();
  final PenSampler _sampler = PenSampler();
  Timer? _flushTimer;

  // سلسلة الالتقاط الخام — الأصل يُعاد عند الإغلاق (إطار العمل سليم)
  ui.PointerDataPacketCallback? _origPacketCb;
  int? _activeDevice; // أول قلم يملك السطر (تعدد أجهزة مرفوض)
  int? _lastSig; // توقيع مكمم لآخر عينة تلامس أُرسلت (إزالة المكرر)

  // الخيارات
  bool _palmRejection = true;
  bool _showPreview = true;

  // المعاينة المحلية — gen ينبض ليعيد الرسم فقط (بلا rebuild شجرة)
  final List<List<_TrailPoint>> _strokes = [];
  final ValueNotifier<int> _trailGen = ValueNotifier<int>(0);
  final ValueNotifier<double> _pressureUi = ValueNotifier<double>(0);
  int _lastPaintMs = 0;
  int _lastTool = 0;

  @override
  void initState() {
    super.initState();
    _origPacketCb = WidgetsBinding.instance.platformDispatcher.onPointerDataPacket;
    WidgetsBinding.instance.platformDispatcher.onPointerDataPacket = _onPacket;
    // تفريغ كل 4ms — داتاجرام لكل حدث، سقف كمون تجميع محدود (§20)
    _flushTimer = Timer.periodic(const Duration(milliseconds: 4), (_) => _flush());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(controllerControllerProvider.notifier).tabletCmd({'cmd': 'get'});
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.platformDispatcher.onPointerDataPacket = _origPacketCb;
    _flushTimer?.cancel();
    _trailGen.dispose();
    _pressureUi.dispose();
    super.dispose();
  }

  // --------------------------------------------------------------------------
  // الالتقاط الخام — سلسلة فوق Callback الأصل
  // --------------------------------------------------------------------------

  void _onPacket(ui.PointerDataPacket packet) {
    _ingest(packet);
    _origPacketCb?.call(packet); // إطار العمل يعمل كما هو (سلسلة)
  }

  void _ingest(ui.PointerDataPacket packet) {
    final box = _surfaceKey.currentContext?.findRenderObject() as RenderBox?;
    if (box == null || !box.hasSize) return;
    final dpr = View.of(context).devicePixelRatio;
    final w = box.size.width;
    final h = box.size.height;
    if (w <= 0 || h <= 0 || dpr <= 0) return;

    outer:
    for (final d in packet.data) {
      if (d.synthesized) continue; // خام فقط — بلا أحداث مولّدة
      // الأداة (§20) — القلم/الممحاة دائمًا، والإصبع برفض راحة اليد فقط
      int tool;
      if (d.kind == ui.PointerDeviceKind.stylus) {
        tool = LiveChannel.penToolPen;
      } else if (d.kind == ui.PointerDeviceKind.invertedStylus) {
        tool = LiveChannel.penToolEraser;
      } else if (d.kind == ui.PointerDeviceKind.touch) {
        if (_palmRejection) continue;
        tool = LiveChannel.penToolFinger;
      } else {
        continue; // ماوس/تراكباد/مجهول — ليس قلمًا
      }
      // الطور — التلامس من buttons bit0 (kStylusContact) أو ضغط موجب
      final pRange = d.pressureMax > d.pressureMin;
      final contact = (d.buttons & 0x01) != 0 || (pRange && d.pressure > d.pressureMin);
      int phase;
      switch (d.change) {
        case ui.PointerChange.down:
          phase = 1;
        case ui.PointerChange.move:
          phase = contact ? 2 : 0;
        case ui.PointerChange.hover:
          phase = 0;
        case ui.PointerChange.up:
        case ui.PointerChange.cancel:
          phase = 3;
        default:
          continue outer; // add/remove/panZoom — ليست عينات قلم
      }
      // جهاز واحد نشط — راحة اليد الفيزيائية أيضًا (قلم ثانٍ مرفوض)
      if (phase == 1) {
        _activeDevice = d.device;
      } else if (phase == 3) {
        if (_activeDevice == d.device) _activeDevice = null;
      } else if (_activeDevice != null && _activeDevice != d.device) {
        continue;
      }
      // الفضاء: داخل سطح الرسم حصرًا — تصحيح حافة (خط متصل إن انزلق القلم)
      final local = box.globalToLocal(Offset(d.physicalX / dpr, d.physicalY / dpr));
      final nx = (local.dx / w).clamp(0.0, 1.0);
      final ny = (local.dy / h).clamp(0.0, 1.0);
      // الضغط مُطبّع (بعض الأجهزة ترفع min>0)
      final pr = pRange ? ((d.pressure - d.pressureMin) / (d.pressureMax - d.pressureMin)).clamp(0.0, 1.0) : (contact ? 1.0 : 0.0);
      // الميل: tilt 0..π/2 + orientation −π..π → مركّبتا ±60° (تعاقد §20)
      final tx = (60 * math.sin(d.tilt) * math.cos(d.orientation)).round().clamp(-60, 60);
      final ty = (60 * math.sin(d.tilt) * math.sin(d.orientation)).round().clamp(-60, 60);
      // الزر الخلفي (barrel) = kPrimaryStylusButton 0x02 → bit0 التعاقدي
      final buttons = (d.buttons & 0x02) != 0 ? 1 : 0;

      _sampler.add(PenSample(tool: tool, phase: phase, nx: nx, ny: ny, pressure: pr, tiltX: tx, tiltY: ty, buttons: buttons));
      _trailAdd(phase, local, pr, tool);
      if (phase != 0) {
        _lastTool = tool;
        _pressureUi.value = pr;
      }
    }
  }

  void _flush() {
    final samples = _sampler.drain();
    if (samples.isEmpty) return;
    final ctl = ref.read(controllerControllerProvider.notifier);
    for (final s in samples) {
      final sig = Object.hash(s.phase, s.tool, (s.nx * 65535).round(), (s.ny * 65535).round(), (s.pressure * 255).round(), s.tiltX, s.tiltY, s.buttons);
      if (s.phase == 2 && sig == _lastSig) continue; // مكرر مكمم
      _lastSig = sig;
      ctl.sendPen(
        s.nx,
        s.ny,
        s.pressure,
        tiltX: s.tiltX,
        tiltY: s.tiltY,
        phase: PenPhase.values[s.phase],
        buttons: s.buttons,
        tool: s.tool,
      );
    }
  }

  // --------------------------------------------------------------------------
  // المعاينة المحلية — فورية قبل الشبكة
  // --------------------------------------------------------------------------

  void _trailAdd(int phase, Offset local, double pr, int tool) {
    if (!_showPreview) return;
    if (phase == 1) {
      _strokes.add([]);
      if (_strokes.length > _maxStrokes) _strokes.removeAt(0);
    }
    if (phase != 0 && _strokes.isNotEmpty) {
      final list = _strokes.last;
      if (list.length < _maxPointsPerStroke) {
        list.add(_TrailPoint(local, 1.0 + pr * 7.0, tool == LiveChannel.penToolEraser));
      }
      final now = DateTime.now().millisecondsSinceEpoch;
      if (now - _lastPaintMs >= 12) {
        // سقف رسم 80fps — فوري بصريًا وبلا إغراق إطار العمل عند 240Hz
        _lastPaintMs = now;
        _trailGen.value++;
      }
    }
  }

  void _clearTrail() {
    _strokes.clear();
    _trailGen.value++;
  }

  // --------------------------------------------------------------------------
  // الإعدادات — ورقة الفرشاة (set → rc:tablet:cmd — الحالة من الكمبيوتر)
  // --------------------------------------------------------------------------

  Future<void> _openBrushSheet(BuildContext context, Map<String, dynamic> ts) async {
    final brush = (ts['brush'] as Map?)?.cast<String, dynamic>() ?? const {};
    final ctl = ref.read(controllerServiceProvider);
    String pressure = '${brush['pressure'] ?? 'keys'}';
    final decCtrl = TextEditingController(text: '${brush['decKey'] ?? '['}');
    final incCtrl = TextEditingController(text: '${brush['incKey'] ?? ']'}');
    double levels = ((brush['levels'] as num?) ?? 24).toDouble();
    String modifier = '${brush['modifier'] ?? 'none'}';
    await showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('tablet.brushTitle'.tr(), style: Theme.of(ctx).textTheme.titleMedium),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: pressure,
                decoration: InputDecoration(labelText: 'tablet.pressureMode'.tr(), border: const OutlineInputBorder()),
                items: [
                  DropdownMenuItem(value: 'off', child: Text('tablet.pressureOff'.tr())),
                  DropdownMenuItem(value: 'keys', child: Text('tablet.pressureKeys'.tr())),
                  DropdownMenuItem(value: 'scroll', child: Text('tablet.pressureScroll'.tr())),
                ],
                onChanged: (v) => setSheet(() => pressure = v ?? pressure),
              ),
              const SizedBox(height: 12),
              if (pressure == 'keys') ...[
                Row(children: [
                  Expanded(
                    child: TextField(
                      controller: decCtrl,
                      maxLength: 1,
                      decoration: InputDecoration(labelText: 'tablet.decKey'.tr(), border: const OutlineInputBorder()),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: TextField(
                      controller: incCtrl,
                      maxLength: 1,
                      decoration: InputDecoration(labelText: 'tablet.incKey'.tr(), border: const OutlineInputBorder()),
                    ),
                  ),
                ]),
                Text('tablet.keysHint'.tr(), style: TextStyle(fontSize: 10.5, color: Theme.of(ctx).hintColor)),
              ],
              if (pressure == 'scroll') ...[
                DropdownButtonFormField<String>(
                  value: modifier,
                  decoration: InputDecoration(labelText: 'tablet.modifier'.tr(), border: const OutlineInputBorder()),
                  items: [
                    DropdownMenuItem(value: 'none', child: Text('tablet.modNone'.tr())),
                    DropdownMenuItem(value: 'ctrl', child: Text('Ctrl')),
                    DropdownMenuItem(value: 'alt', child: Text('Alt')),
                    DropdownMenuItem(value: 'shift', child: Text('Shift')),
                  ],
                  onChanged: (v) => setSheet(() => modifier = v ?? modifier),
                ),
              ],
              const SizedBox(height: 8),
              Text('tablet.levels'.tr(namedArgs: {'n': '${levels.round()}'}), style: const TextStyle(fontSize: 12)),
              Slider(
                value: levels,
                min: 2,
                max: 64,
                divisions: 62,
                onChanged: (v) => setSheet(() => levels = v),
              ),
              FilledButton.icon(
                onPressed: () {
                  final payload = <String, dynamic>{'cmd': 'set', 'pressure': pressure, 'levels': levels.round()};
                  if (pressure == 'keys') {
                    payload['decKey'] = decCtrl.text.trim();
                    payload['incKey'] = incCtrl.text.trim();
                  }
                  if (pressure == 'scroll') payload['modifier'] = modifier;
                  ctl.tabletCmd(payload);
                  Navigator.pop(ctx);
                },
                icon: const Icon(Icons.check_rounded, size: 18),
                label: Text('tablet.save'.tr()),
              ),
              const SizedBox(height: 6),
              Text('tablet.cfgNote'.tr(), style: TextStyle(fontSize: 10.5, color: Theme.of(ctx).hintColor)),
            ],
          ),
        ),
      ),
    );
  }

  // --------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final st = ref.watch(controllerControllerProvider);
    final theme = Theme.of(context);
    final ts = st.tabletState ?? const {};
    final mode = '${ts['mode'] ?? 'mouse'}';
    final available = ts['available'] == true;
    final brush = (ts['brush'] as Map?)?.cast<String, dynamic>() ?? const {};
    final ready = st.sessionActive && st.liveReady;

    return Scaffold(
      appBar: AppBar(
        title: Text('tablet.title'.tr()),
        actions: [
          IconButton(
            tooltip: 'tablet.clear'.tr(),
            onPressed: _clearTrail,
            icon: const Icon(Icons.layers_clear_rounded),
          ),
          IconButton(
            tooltip: 'tablet.brushTitle'.tr(),
            onPressed: () => _openBrushSheet(context, ts),
            icon: const Icon(Icons.brush_rounded),
          ),
        ],
      ),
      body: Column(
        children: [
          // شريط الحالة — جلسة/قناة/زمن/وضع
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                _chip(
                  st.sessionActive ? 'tablet.sessionOn'.tr() : 'tablet.sessionOff'.tr(),
                  st.sessionActive ? Colors.green.shade700 : theme.colorScheme.error,
                ),
                _chip(
                  st.liveReady ? 'tablet.liveReady'.tr() : (st.liveOpening ? 'tablet.liveWait'.tr() : 'tablet.liveOff'.tr()),
                  st.liveReady ? Colors.green.shade700 : Colors.orange.shade800,
                ),
                _chip('tablet.rtt'.tr(namedArgs: {'n': '${st.liveRttMs}'}), theme.colorScheme.primary),
                _chip(
                  mode == 'tablet' ? 'tablet.modeTablet'.tr() : 'tablet.modeMouse'.tr(),
                  mode == 'tablet' && !available ? Colors.orange.shade800 : theme.colorScheme.primary,
                ),
              ],
            ),
          ),
          if (mode == 'tablet' && !available)
            Padding(
              padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
              child: Text(
                '${ts['note'] ?? ''}',
                style: TextStyle(fontSize: 10.5, color: theme.colorScheme.error),
              ),
            ),
          // الخيارات
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: Row(
              children: [
                Expanded(
                  child: SwitchListTile(
                    dense: true,
                    title: Text('tablet.palm'.tr(), style: const TextStyle(fontSize: 12.5)),
                    value: _palmRejection,
                    onChanged: (v) => setState(() => _palmRejection = v),
                  ),
                ),
                Expanded(
                  child: SwitchListTile(
                    dense: true,
                    title: Text('tablet.preview'.tr(), style: const TextStyle(fontSize: 12.5)),
                    value: _showPreview,
                    onChanged: (v) {
                      setState(() => _showPreview = v);
                      if (!v) _clearTrail();
                    },
                  ),
                ),
              ],
            ),
          ),
          // شريط الأداة والضغط الحالي
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 4),
            child: Row(
              children: [
                Text(
                  _lastTool == LiveChannel.penToolEraser
                      ? 'tablet.toolEraser'.tr()
                      : (_lastTool == LiveChannel.penToolFinger ? 'tablet.toolFinger'.tr() : 'tablet.toolPen'.tr()),
                  style: TextStyle(fontSize: 11.5, color: theme.colorScheme.primary),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ValueListenableBuilder<double>(
                    valueListenable: _pressureUi,
                    builder: (_, v, __) => LinearProgressIndicator(
                      value: v,
                      minHeight: 5,
                    ),
                  ),
                ),
              ],
            ),
          ),
          // سطح الرسم
          Expanded(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
              child: Stack(
                children: [
                  Positioned.fill(
                    child: RepaintBoundary(
                      key: _surfaceKey,
                      child: Container(
                        decoration: BoxDecoration(
                          color: theme.colorScheme.surface,
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(color: theme.dividerColor),
                        ),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(14),
                          child: _showPreview
                              ? CustomPaint(
                                  painter: _TrailPainter(_strokes, _trailGen, theme.colorScheme.primary, theme.colorScheme.onSurface),
                                )
                              : null,
                        ),
                      ),
                    ),
                  ),
                  if (!ready)
                    Positioned.fill(
                      child: Container(
                        alignment: Alignment.center,
                        padding: const EdgeInsets.all(24),
                        color: theme.colorScheme.surface.withOpacity(0.82),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text('tablet.hintNoLive'.tr(), textAlign: TextAlign.center, style: const TextStyle(fontSize: 13)),
                            const SizedBox(height: 12),
                            if (!st.sessionActive)
                              FilledButton.icon(
                                onPressed: () => ref.read(controllerControllerProvider.notifier).startSession(),
                                icon: const Icon(Icons.play_circle_rounded, size: 18),
                                label: Text('tablet.startSession'.tr()),
                              ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 0, 12, 10),
            child: Text('tablet.hint'.tr(), style: TextStyle(fontSize: 10.5, color: theme.hintColor)),
          ),
        ],
      ),
    );
  }

  Widget _chip(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(text, style: TextStyle(fontSize: 10.5, color: color, fontWeight: FontWeight.w600)),
    );
  }
}

/// رسّام الخط المحلي — سماكة كل مقطع = الضغط (تحقق بصري فوري)
class _TrailPainter extends CustomPainter {
  final List<List<_TrailPoint>> strokes;
  final ValueListenable<int> gen;
  final Color penColor;
  final Color bgColor;

  _TrailPainter(this.strokes, this.gen, this.penColor, this.bgColor) : super(repaint: gen);

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = bgColor);
    for (final stroke in strokes) {
      for (var i = 1; i < stroke.length; i++) {
        final a = stroke[i - 1];
        final b = stroke[i];
        final paint = Paint()
          ..color = a.eraser ? bgColor.withOpacity(0.9) : penColor.withOpacity(0.85)
          ..strokeWidth = b.w
          ..strokeCap = StrokeCap.round
          ..blendMode = a.eraser ? BlendMode.srcOver : BlendMode.srcOver;
        canvas.drawLine(a.p, b.p, paint);
      }
      if (stroke.length == 1) {
        final p = stroke.first;
        canvas.drawCircle(p.p, p.w / 2, Paint()..color = p.eraser ? bgColor : penColor.withOpacity(0.85));
      }
    }
  }

  @override
  bool shouldRepaint(covariant _TrailPainter oldDelegate) => false; // repaint عبر gen
}

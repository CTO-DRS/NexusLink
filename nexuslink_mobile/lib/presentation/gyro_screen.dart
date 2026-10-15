import 'dart:async';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:sensors_plus/sensors_plus.dart';

import '../data/live_channel.dart';
import '../state/controller_providers.dart';

// ============================================================================
// الجولة 4 مرحلة ③ (عقد §21) — ثلاثية التحكم المتقدم فوق NexusLive:
// · جيمباد بالحساسات: أزرار A·B·X·Y·L·R (flags bits0-5) + عصا التقليب
//   (زاوية الجاذبية → أسهم على الكمبيوتر بنافذة ميتة قابلة للضبط)
// · ماوس هوائي معاير: نقطة صفير (زر المعايرة) + بوابة الإمساك (bit6) +
//   حساسية قابلة للضبط — الحساب كله على الكمبيوتر (gyro.rs §21)
// · عارض العروض: إيماءة إمالة المعصم → تقليب الشريحة + أزرار العرض
//   (F5/Esc/الشاشة السوداء) + مؤشر ليزر (Ctrl+L في PowerPoint) + مؤقت
//   مرئي يهتز عند انتهاء الوقت (هاتف بالكامل — بلا شبكة)
// البث: حساسات 100Hz فوق حزم gyro التعاقدية (§18 حرفيًا) — الوضع النشط
// حصرًا (الوضع من الكمبيوتر مصدر الحقيقة rc:gyro:state).
// ============================================================================

/// أسماء الأوضاع التعاقدية (مرآة gyro_core.rs)
const String kModeOff = 'off';
const String kModeGamepad = 'gamepad';
const String kModeAirmouse = 'airmouse';
const String kModePresenter = 'presenter';

/// مجرى الحساسات — يدمج آخر تسارع مع كل نبضة جيروسكوب (~100Hz) ويمرر
/// flags الجيمباد/الإمساك (تعاقد §21.ب). بلا حالة شبكية — الإرسال callback.
class GyroStream {
  StreamSubscription<AccelerometerEvent>? _accSub;
  StreamSubscription<GyroscopeEvent>? _gyrSub;
  final List<double> _acc = [0, 0, -1]; // المرجع: الهاتف عموديًا
  final List<double> _gyr = [0, 0, 0];

  bool get running => _gyrSub != null;

  void start(void Function(List<double> acc, List<double> gyr, int flags) onSample, int Function() flagsFn) {
    stop();
    _accSub = accelerometerEventStream(samplingPeriod: const Duration(milliseconds: 10)).listen((e) {
      _acc[0] = e.x;
      _acc[1] = e.y;
      _acc[2] = e.z;
    });
    _gyrSub = gyroscopeEventStream(samplingPeriod: const Duration(milliseconds: 10)).listen((e) {
      _gyr[0] = e.x;
      _gyr[1] = e.y;
      _gyr[2] = e.z;
      onSample(List<double>.from(_acc), List<double>.from(_gyr), flagsFn());
    }, onError: (_) => stop());
  }

  void stop() {
    _accSub?.cancel();
    _accSub = null;
    _gyrSub?.cancel();
    _gyrSub = null;
  }
}

class GyroScreen extends ConsumerStatefulWidget {
  const GyroScreen({super.key});
  @override
  ConsumerState<GyroScreen> createState() => _GyroScreenState();
}

class _GyroScreenState extends ConsumerState<GyroScreen> {
  final GyroStream _stream = GyroStream();
  int _flags = 0; // bits0-5 أزرار · bit6 إمساك (تعاقد §21.ب)

  // المؤقت المرئي (هاتف بالكامل — بلا شبكة)
  Timer? _tick;
  int _timerTotal = 300;
  int _timerLeft = 300;
  bool _timerRunning = false;
  bool _timerDone = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(controllerControllerProvider.notifier).gyroCmd({'cmd': 'get'});
    });
  }

  @override
  void dispose() {
    // الخروج من الشاشة يطفئ الوضع على الكمبيوتر (لا مستهلك معلق)
    ref.read(controllerControllerProvider.notifier).gyroCmd({'cmd': 'set', 'mode': kModeOff});
    _stopStream();
    _tick?.cancel();
    super.dispose();
  }

  // --------------------------------------------------------------------------
  // بث الحساسات — الوضع النشط + الجلسة + القناة الحية حصرًا (عقد §21)
  // --------------------------------------------------------------------------

  void _syncStream() {
    final st = ref.read(controllerControllerProvider);
    final mode = '${(st.gyroState ?? const {})['mode'] ?? 'off'}';
    final shouldRun = st.sessionActive && st.liveReady && mode != kModeOff;
    if (shouldRun && !_stream.running) {
      _stream.start(
        (acc, gyr, flags) => ref.read(controllerControllerProvider.notifier).sendGyroRaw(acc, gyr, flags: flags),
        () => _flags,
      );
    } else if (!shouldRun && _stream.running) {
      _stopStream();
    }
  }

  void _stopStream() {
    _stream.stop();
    _flags = 0;
  }

  void _setMode(String m) {
    ref.read(controllerControllerProvider.notifier).gyroCmd({'cmd': 'set', 'mode': m});
    setState(() {});
  }

  void _setBtn(int bit, bool down) {
    setState(() {
      if (down) {
        _flags |= bit;
      } else {
        _flags &= ~bit;
      }
    });
  }

  // --------------------------------------------------------------------------
  // المؤقت المرئي — اهتزاز عند انتهاء الوقت (بلا أي اعتماد شبكي)
  // --------------------------------------------------------------------------

  void _timerToggle() {
    if (_timerRunning) {
      _tick?.cancel();
      _tick = null;
      setState(() => _timerRunning = false);
      return;
    }
    if (_timerLeft <= 0) _timerLeft = _timerTotal;
    setState(() {
      _timerRunning = true;
      _timerDone = false;
    });
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {
        _timerLeft--;
        if (_timerLeft <= 0) {
          _timerLeft = 0;
          _timerRunning = false;
          _timerDone = true;
          _tick?.cancel();
          _tick = null;
          _vibrateDone();
        }
      });
    });
  }

  void _timerReset() {
    _tick?.cancel();
    _tick = null;
    setState(() {
      _timerRunning = false;
      _timerDone = false;
      _timerLeft = _timerTotal;
    });
  }

  Future<void> _vibrateDone() async {
    // نمط انتهاء: ثلاث دفعات قوية متباعدة — مسموس بوضوح فوق الجيب
    for (var i = 0; i < 3; i++) {
      await HapticFeedback.heavyImpact();
      await Future<void>.delayed(const Duration(milliseconds: 350));
      if (!mounted) return;
    }
    await HapticFeedback.vibrate();
  }

  String _fmt(int s) {
    final m = s ~/ 60;
    final sec = s % 60;
    return '$m:${sec.toString().padLeft(2, '0')}';
  }

  // --------------------------------------------------------------------------
  // ورقة المفاتيح — تعيين مفتاح لكل زر (قابلة للتعيين لكل لعبة — §21.أ)
  // --------------------------------------------------------------------------

  Future<void> _openKeymapSheet(BuildContext context, Map<String, dynamic> gs) async {
    final map = (gs['map'] as Map?)?.cast<String, dynamic>() ?? const {};
    final ctls = {
      for (final b in ['A', 'B', 'X', 'Y', 'L', 'R']) b: TextEditingController(text: '${map[b] ?? ''}'),
    };
    await showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('gyro.keysTitle'.tr(), style: Theme.of(ctx).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text('gyro.keysHint'.tr(), style: TextStyle(fontSize: 10.5, color: Theme.of(ctx).hintColor)),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (final b in ['A', 'B', 'X', 'Y', 'L', 'R'])
                  SizedBox(
                    width: 96,
                    child: TextField(
                      controller: ctls[b],
                      textAlign: TextAlign.center,
                      maxLength: 8,
                      decoration: InputDecoration(labelText: b, counterText: '', border: const OutlineInputBorder()),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: () {
                final payload = <String, dynamic>{'cmd': 'set'};
                for (final e in ctls.entries) {
                  if (e.value.text.trim().isNotEmpty) payload['key${e.key}'] = e.value.text.trim();
                }
                ref.read(controllerControllerProvider.notifier).gyroCmd(payload);
                Navigator.pop(ctx);
              },
              icon: const Icon(Icons.check_rounded, size: 18),
              label: Text('gyro.save'.tr()),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openTuningSheet(BuildContext context, Map<String, dynamic> gs) async {
    double dead = ((gs['deadzoneDeg'] as num?) ?? 18).toDouble();
    double sens = ((gs['sens'] as num?) ?? 2.0).toDouble();
    double shake = ((gs['shakeDegS'] as num?) ?? 8.0).toDouble();
    double tilt = ((gs['tiltDeg'] as num?) ?? 28.0).toDouble();
    await showModalBottomSheet<void>(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheet) => Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('gyro.tuning'.tr(), style: Theme.of(ctx).textTheme.titleMedium),
              const SizedBox(height: 8),
              _slider(ctx, 'gyro.deadzone'.tr(), dead, 5, 45, (v) => setSheet(() => dead = v), '°'),
              _slider(ctx, 'gyro.sens'.tr(), sens, 0.5, 5.0, (v) => setSheet(() => sens = v), '×'),
              _slider(ctx, 'gyro.shake'.tr(), shake, 3, 30, (v) => setSheet(() => shake = v), '°/s'),
              _slider(ctx, 'gyro.tilt'.tr(), tilt, 10, 60, (v) => setSheet(() => tilt = v), '°'),
              const SizedBox(height: 8),
              FilledButton.icon(
                onPressed: () {
                  ref.read(controllerControllerProvider.notifier).gyroCmd({
                    'cmd': 'set',
                    'deadzoneDeg': dead.round(),
                    'sens': double.parse(sens.toStringAsFixed(1)),
                    'shakeDegS': shake.round(),
                    'tiltDeg': tilt.round(),
                  });
                  Navigator.pop(ctx);
                },
                icon: const Icon(Icons.check_rounded, size: 18),
                label: Text('gyro.save'.tr()),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _slider(BuildContext ctx, String label, double v, double min, double max, ValueChanged<double> on, String unit) {
    return Row(
      children: [
        SizedBox(width: 128, child: Text(label, style: const TextStyle(fontSize: 12))),
        Expanded(
          child: Slider(
            value: v.clamp(min, max),
            min: min,
            max: max,
            divisions: (max - min) >= 10 ? (max - min).round() : 45,
            onChanged: on,
          ),
        ),
        SizedBox(
          width: 58,
          child: Text('${v.toStringAsFixed(v < 10 ? 1 : 0)}$unit', style: const TextStyle(fontSize: 11.5, fontFeatures: [FontFeature.tabularFigures()])),
        ),
      ],
    );
  }

  // --------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final st = ref.watch(controllerControllerProvider);
    final theme = Theme.of(context);
    final gs = st.gyroState ?? const {};
    final mode = '${gs['mode'] ?? 'off'}';
    final map = (gs['map'] as Map?)?.cast<String, dynamic>() ?? const {};
    final calibrated = gs['calibrated'] == true;
    final calibrating = gs['calibrating'] == true;
    final template = '${gs['template'] ?? 'platformer'}';

    // مزامنة مجرى الحساسات مع الحالة (بناء = فرصة مزامنة رخيصة)
    WidgetsBinding.instance.addPostFrameCallback((_) => _syncStream());

    return Scaffold(
      appBar: AppBar(
        title: Text('gyro.title'.tr()),
        actions: [
          IconButton(
            tooltip: 'gyro.tuning'.tr(),
            onPressed: () => _openTuningSheet(context, gs),
            icon: const Icon(Icons.tune_rounded),
          ),
          if (mode == kModeGamepad)
            IconButton(
              tooltip: 'gyro.keysTitle'.tr(),
              onPressed: () => _openKeymapSheet(context, gs),
              icon: const Icon(Icons.keyboard_alt_outlined),
            ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 16),
        children: [
          // شريط الحالة — جلسة/قناة/زمن/معايرة
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _chip(
                st.sessionActive ? 'gyro.sessionOn'.tr() : 'gyro.sessionOff'.tr(),
                st.sessionActive ? Colors.green.shade700 : theme.colorScheme.error,
              ),
              _chip(
                st.liveReady ? 'gyro.liveReady'.tr() : (st.liveOpening ? 'gyro.liveWait'.tr() : 'gyro.liveOff'.tr()),
                st.liveReady ? Colors.green.shade700 : Colors.orange.shade800,
              ),
              _chip('gyro.rtt'.tr(namedArgs: {'n': '${st.liveRttMs}'}), theme.colorScheme.primary),
              if (mode == kModeAirmouse || mode == kModePresenter)
                _chip(
                  calibrating
                      ? 'gyro.calibrating'.tr()
                      : (calibrated ? 'gyro.calibrated'.tr() : 'gyro.notCalibrated'.tr()),
                  calibrating
                      ? Colors.orange.shade800
                      : (calibrated ? Colors.green.shade700 : theme.colorScheme.error),
                ),
            ],
          ),
          if (!st.sessionActive) ...[
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: () => ref.read(controllerControllerProvider.notifier).startSession(),
              icon: const Icon(Icons.play_circle_rounded, size: 18),
              label: Text('gyro.startSession'.tr()),
            ),
          ],
          const SizedBox(height: 10),
          // الوضع — مصدر الحقيقة الكمبيوتر (اختيار الهاتف يُرسل ثم يعود)
          Text('gyro.mode'.tr(), style: theme.textTheme.titleSmall),
          const SizedBox(height: 6),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              _modeChip(kModeOff, 'gyro.modeOff'.tr(), mode),
              _modeChip(kModeGamepad, 'gyro.modeGamepad'.tr(), mode),
              _modeChip(kModeAirmouse, 'gyro.modeAirmouse'.tr(), mode),
              _modeChip(kModePresenter, 'gyro.modePresenter'.tr(), mode),
            ],
          ),
          const SizedBox(height: 12),

          // ------------------------- جيمباد -------------------------
          if (mode == kModeGamepad) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text('gyro.flipHint'.tr(), style: TextStyle(fontSize: 11.5, color: theme.hintColor)),
                        ),
                        Text(
                          'gyro.deadzoneVal'.tr(namedArgs: {'n': '${((gs['deadzoneDeg'] as num?) ?? 18).round()}'}),
                          style: TextStyle(fontSize: 11.5, color: theme.colorScheme.primary, fontWeight: FontWeight.w600),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${'gyro.template'.tr()}: ${_tplName(template)}',
                      style: TextStyle(fontSize: 11.5, color: theme.colorScheme.primary),
                    ),
                    const SizedBox(height: 10),
                    // الأزرار الستة — ضغط مستمر حقيقي (flags bits0-5)
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        _padBtn('L', LiveChannel.gyroBtnL, '${map['L'] ?? 'L'}'),
                        _padBtn('A', LiveChannel.gyroBtnA, '${map['A'] ?? 'A'}'),
                        _padBtn('B', LiveChannel.gyroBtnB, '${map['B'] ?? 'B'}'),
                        _padBtn('R', LiveChannel.gyroBtnR, '${map['R'] ?? 'R'}'),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                      children: [
                        _padBtn('X', LiveChannel.gyroBtnX, '${map['X'] ?? 'X'}'),
                        _padBtn('Y', LiveChannel.gyroBtnY, '${map['Y'] ?? 'Y'}'),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                ActionChip(
                  avatar: const Icon(Icons.sports_esports_rounded, size: 16),
                  label: Text('gyro.tplPlatformer'.tr(), style: const TextStyle(fontSize: 11)),
                  onPressed: () => ref.read(controllerControllerProvider.notifier).gyroCmd({'cmd': 'set', 'template': 'platformer'}),
                ),
                ActionChip(
                  avatar: const Icon(Icons.sports_motorsports, size: 16),
                  label: Text('gyro.tplRacing'.tr(), style: const TextStyle(fontSize: 11)),
                  onPressed: () => ref.read(controllerControllerProvider.notifier).gyroCmd({'cmd': 'set', 'template': 'racing'}),
                ),
                ActionChip(
                  avatar: const Icon(Icons.sports_mma_rounded, size: 16),
                  label: Text('gyro.tplFighting'.tr(), style: const TextStyle(fontSize: 11)),
                  onPressed: () => ref.read(controllerControllerProvider.notifier).gyroCmd({'cmd': 'set', 'template': 'fighting'}),
                ),
              ],
            ),
          ],

          // ----------------------- ماوس هوائي -----------------------
          if (mode == kModeAirmouse) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('gyro.airHint'.tr(), style: TextStyle(fontSize: 11.5, color: theme.hintColor)),
                    const SizedBox(height: 10),
                    // زر الإمساك — بوابة الحركة (bit6): اضغط باستمرار وحرّك
                    Listener(
                      onPointerDown: (_) => _setBtn(LiveChannel.gyroGrab, true),
                      onPointerUp: (_) => _setBtn(LiveChannel.gyroGrab, false),
                      onPointerCancel: (_) => _setBtn(LiveChannel.gyroGrab, false),
                      child: Container(
                        height: 64,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: (_flags & LiveChannel.gyroGrab) != 0 ? theme.colorScheme.primary : theme.colorScheme.surfaceContainerHighest,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: Text(
                          (_flags & LiveChannel.gyroGrab) != 0 ? 'gyro.grabbing'.tr() : 'gyro.grabBtn'.tr(),
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: (_flags & LiveChannel.gyroGrab) != 0 ? theme.colorScheme.onPrimary : theme.colorScheme.onSurface,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: () {
                        ref.read(controllerControllerProvider.notifier).gyroCmd({'cmd': 'set', 'calibrate': true});
                        HapticFeedback.mediumImpact();
                      },
                      icon: const Icon(Icons.center_focus_strong_rounded, size: 18),
                      label: Text('gyro.calibrate'.tr()),
                    ),
                    const SizedBox(height: 4),
                    Text('gyro.calibrateHint'.tr(), style: TextStyle(fontSize: 10.5, color: theme.hintColor)),
                  ],
                ),
              ),
            ),
          ],

          // ----------------------- عارض العروض -----------------------
          if (mode == kModePresenter) ...[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('gyro.presentHint'.tr(), style: TextStyle(fontSize: 11.5, color: theme.hintColor)),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: FilledButton.tonalIcon(
                            onPressed: () => ref.read(controllerControllerProvider.notifier).presenter('start'),
                            icon: const Icon(Icons.slideshow_rounded, size: 18),
                            label: Text('gyro.f5'.tr(), style: const TextStyle(fontSize: 12)),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: FilledButton.tonalIcon(
                            onPressed: () => ref.read(controllerControllerProvider.notifier).presenter('stop'),
                            icon: const Icon(Icons.exit_to_app_rounded, size: 18),
                            label: Text('gyro.esc'.tr(), style: const TextStyle(fontSize: 12)),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: () => ref.read(controllerControllerProvider.notifier).presenter('prev'),
                            icon: const Icon(Icons.navigate_before_rounded),
                            label: Text('gyro.prev'.tr()),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: () => ref.read(controllerControllerProvider.notifier).presenter('next'),
                            icon: const Icon(Icons.navigate_next_rounded),
                            label: Text('gyro.next'.tr()),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () {
                              // المؤشر الليزر: Ctrl+L في عرض PowerPoint (§21.ج)
                              ref.read(controllerControllerProvider.notifier).keyCombo('l', ['ctrl']);
                              HapticFeedback.selectionClick();
                            },
                            icon: const Icon(Icons.highlight_alt_rounded, size: 18),
                            label: Text('gyro.laser'.tr(), style: const TextStyle(fontSize: 12)),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => ref.read(controllerControllerProvider.notifier).presenter('black'),
                            icon: const Icon(Icons.crop_square_rounded, size: 18),
                            label: Text('gyro.black'.tr(), style: const TextStyle(fontSize: 12)),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            // المؤقت المرئي — يهتز عند انتهاء الوقت (هاتف بالكامل)
            Card(
              color: _timerDone ? theme.colorScheme.errorContainer : null,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  children: [
                    Text(
                      _fmt(_timerLeft),
                      style: TextStyle(
                        fontSize: 46,
                        fontFeatures: const [FontFeature.tabularFigures()],
                        fontWeight: FontWeight.w700,
                        color: _timerDone ? theme.colorScheme.onErrorContainer : (_timerLeft <= 30 ? theme.colorScheme.error : theme.colorScheme.onSurface),
                      ),
                    ),
                    if (_timerDone)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 6),
                        child: Text('gyro.timerDone'.tr(), style: TextStyle(color: theme.colorScheme.onErrorContainer, fontWeight: FontWeight.w600)),
                      ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        IconButton(
                          onPressed: () => setState(() {
                            _timerTotal = (_timerTotal - 60).clamp(60, 3600);
                            if (!_timerRunning && !_timerDone) _timerLeft = _timerTotal;
                          }),
                          icon: const Icon(Icons.remove_circle_outline_rounded),
                        ),
                        Text('gyro.timerMin'.tr(namedArgs: {'n': '${_timerTotal ~/ 60}'}), style: const TextStyle(fontSize: 12)),
                        IconButton(
                          onPressed: () => setState(() {
                            _timerTotal = (_timerTotal + 60).clamp(60, 3600);
                            if (!_timerRunning && !_timerDone) _timerLeft = _timerTotal;
                          }),
                          icon: const Icon(Icons.add_circle_outline_rounded),
                        ),
                      ],
                    ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        FilledButton.icon(
                          onPressed: _timerToggle,
                          icon: Icon(_timerRunning ? Icons.pause_rounded : Icons.play_arrow_rounded, size: 18),
                          label: Text(_timerRunning ? 'gyro.timerPause'.tr() : 'gyro.timerStart'.tr()),
                        ),
                        const SizedBox(width: 8),
                        OutlinedButton(
                          onPressed: _timerReset,
                          child: Text('gyro.timerReset'.tr()),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],

          const SizedBox(height: 10),
          Text('gyro.hint'.tr(), style: TextStyle(fontSize: 10.5, color: theme.hintColor)),
        ],
      ),
    );
  }

  String _tplName(String t) => switch (t) {
        'racing' => 'gyro.tplRacing'.tr(),
        'fighting' => 'gyro.tplFighting'.tr(),
        'custom' => 'gyro.tplCustom'.tr(),
        _ => 'gyro.tplPlatformer'.tr(),
      };

  Widget _modeChip(String value, String label, String current) {
    final sel = value == current;
    return ChoiceChip(
      label: Text(label, style: TextStyle(fontSize: 11.5, fontWeight: sel ? FontWeight.w700 : FontWeight.w400)),
      selected: sel,
      onSelected: (_) => _setMode(value),
    );
  }

  /// زر جيمباد — ضغط/إفلات مستمران (GestureDetector لكل زر — بلا نقرات)
  Widget _padBtn(String label, int bit, String keyLabel) {
    final down = (_flags & bit) != 0;
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => _setBtn(bit, true),
      onTapCancel: () => _setBtn(bit, false),
      onTapUp: (_) => _setBtn(bit, false),
      child: Container(
        width: 64,
        height: 64,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: down ? Theme.of(context).colorScheme.primary : Theme.of(context).colorScheme.surfaceContainerHighest,
          border: Border.all(color: Theme.of(context).colorScheme.outlineVariant),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(label, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: down ? Theme.of(context).colorScheme.onPrimary : Theme.of(context).colorScheme.onSurface)),
            Text(keyLabel, style: TextStyle(fontSize: 9.5, color: down ? Theme.of(context).colorScheme.onPrimary.withOpacity(0.8) : Theme.of(context).hintColor)),
          ],
        ),
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

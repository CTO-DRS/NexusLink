import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

import '../data/media_service.dart'; // MediaPhase/MediaKindState
import '../state/controller_providers.dart';
import '../state/media_providers.dart';

/// شاشة «كمبيوترك على هاتفك» (FA-media — عقد §15):
/// بث شاشة الكمبيوتر عبر WebRTC (kind=screen — الكمبيوتر صاحب الوسائط)
/// + لمس على الشاشة المعروضة = مؤشر مطلق (rc:pointer خلال جلسة تحكم موثوقة §13)
/// + سحب/تمرير/قرص/نقر أيمن + إدخال نصي عربي كامل عبر rc:key.
class PcScreenView extends ConsumerStatefulWidget {
  const PcScreenView({super.key});

  @override
  ConsumerState<PcScreenView> createState() => _PcScreenViewState();
}

class _PcScreenViewState extends ConsumerState<PcScreenView> {
  final RTCVideoRenderer _renderer = RTCVideoRenderer();
  bool _rendererReady = false;
  MediaStream? _boundStream;
  final _kbdCtrl = TextEditingController();
  String _kbdPrev = '';
  ControllerController? _ctl;
  MediaController? _media;
  int _fps = 30;
  String _quality = 'high';
  // R4 ① (عقد §19) — هدف البث: نحفظه من secondscreen:state (شاشة افتراضية
  // نشطة) ليمر مع كل طلبات البث، وإلا نستخدم الهدف الافتراضي (بدون حقل)
  String _target = '';

  @override
  void initState() {
    super.initState();
    _ctl = ref.read(controllerControllerProvider.notifier);
    _media = ref.read(mediaControllerProvider.notifier);
    () async {
      await _renderer.initialize();
      if (mounted) setState(() => _rendererReady = true);
      // R4 ①: فتح العرض من بطاقة الشاشة الثانية النشطة = بث الشاشة الافتراضية
      final ss = ref.read(mediaControllerProvider).ssActive;
      _target = ss ? ref.read(mediaControllerProvider).ssTarget : '';
      // طلب البث + جلسة التحكم (اللمس يحتاج جلسة موثوقة — عقد §13/§15)
      // حارس التعارض: البث قد يكون بدأ بالفعل (مسار التمكين من بطاقة الشاشة
      // الثانية يبدأ البث تلقائيًا — §19) — الطلب الثاني يفشل على الكمبيوتر
      // ويمسح الحالة (screen:state on:false يهدم التدفق) — نطلب فقط إن كنا
      // غير أحياء/غير متصلين، وإلا نكتفي بفتح الجلسة على التدفق الجاري.
      final ph = ref.read(mediaControllerProvider).screen.phase;
      if (ph != MediaPhase.live && ph != MediaPhase.connecting) {
        _media!.requestScreen(fps: _fps, quality: _quality, target: _target.isEmpty ? null : _target);
      }
      _ctl!.startSession();
    }();
  }

  @override
  void dispose() {
    _kbdCtrl.dispose();
    _media?.stopScreen();
    // R4 ① (البند 8): إغلاق العرض وهو الشاشة الافتراضية → إطفاؤها على الكمبيوتر
    // (النوافذ تعود للشاشات الباقية سلوك النظام — لا نلمس ما لم نفعّله نحن)
    if (_target.isNotEmpty) {
      _media?.secondScreenCmd('disable');
      _target = '';
    }
    _ctl?.stopSession();
    _renderer.dispose();
    super.dispose();
  }

  // ربط التدفق الوارد بالعارض عند تغيّره
  void _bindStream(MediaStream? s) {
    if (identical(s, _boundStream)) return;
    _boundStream = s;
    _renderer.srcObject = s;
  }

  // تغيير الجودة أثناء البث (عقد §15 — G-37):
  //  · جلسة حية → screen:set — تبديل سلس: الكمبيوتر يبني الالتقاط/المشفّر
  //    بالقيم الجديدة ويبقي اتصال WebRTC حيًا (بلا stop→req).
  //  · لا جلسة → حفظ القيم فقط لتُطبَّق عند البدء التالي.
  Future<void> _restartWith({int? fps, String? quality}) async {
    final wasLive = ref.read(mediaControllerProvider).screen.phase == MediaPhase.live;
    setState(() {
      if (fps != null) _fps = fps;
      if (quality != null) _quality = quality;
    });
    if (wasLive) {
      _media!.setScreenQuality(fps: fps, quality: quality);
    }
  }

  // ---------------------------------------------------------------
  // اللمس — تحويل موضع اللمس إلى إحداثيات مُطبّعة على إطار الفيديو
  // (الفيديو يُعرض contain — نحسب المستطيل الفعلي داخل الودجت)
  // ---------------------------------------------------------------
  (double, double)? _normalized(Offset local, Size boxSize, int sw, int sh) {
    if (sw <= 0 || sh <= 0 || boxSize.isEmpty) return null;
    final boxAR = boxSize.width / boxSize.height;
    final vidAR = sw / sh;
    double rw, rh;
    if (vidAR > boxAR) {
      rw = boxSize.width;
      rh = rw / vidAR;
    } else {
      rh = boxSize.height;
      rw = rh * vidAR;
    }
    final dx = (boxSize.width - rw) / 2;
    final dy = (boxSize.height - rh) / 2;
    final x = local.dx - dx;
    final y = local.dy - dy;
    if (x < 0 || y < 0 || x > rw || y > rh) return null; // خارج الإطار
    return (x / rw, y / rh);
  }

  @override
  Widget build(BuildContext context) {
    final st = ref.watch(mediaControllerProvider);
    final rc = ref.watch(controllerControllerProvider);
    _bindStream(st.screenStream);
    final live = st.screen.phase == MediaPhase.live;
    final dims = (st.screenW > 0 && st.screenH > 0) ? (st.screenW, st.screenH) : (1920, 1080);

    return Scaffold(
      appBar: AppBar(
        title: Text('pcscreen.title'.tr()),
        actions: [
          // جودة البث — تبديل حي أثناء الجلسة (G-37: screen:set بلا إعادة بث)
          PopupMenuButton<String>(
            icon: const Icon(Icons.tune),
            tooltip: 'pcscreen.quality'.tr(),
            onSelected: (v) {
              if (v.startsWith('fps:')) {
                unawaitedSafe(_restartWith(fps: int.parse(v.substring(4))));
              } else {
                unawaitedSafe(_restartWith(quality: v));
              }
            },
            itemBuilder: (_) => [
              PopupMenuItem(value: 'fps:30', child: Text('30 fps ${_fps == 30 ? "✓" : ""}')),
              PopupMenuItem(value: 'fps:60', child: Text('60 fps ${_fps == 60 ? "✓" : ""}')),
              const PopupMenuDivider(),
              for (final q in const ['low', 'medium', 'high', 'ultra'])
                PopupMenuItem(value: q, child: Text('$q ${_quality == q ? "✓" : ""}')),
            ],
          ),
        ],
      ),
      body: Column(
        children: [
          // شريط حالة الجلسة (عقد §13) — اللمس يعمل خلال الجلسة فقط
          if (rc.sessionActive)
            Container(
              width: double.infinity,
              color: Colors.deepPurple.withOpacity(.16),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: Row(
                children: [
                  const Icon(Icons.touch_app, size: 14, color: Colors.deepPurple),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'pcscreen.session_on'.tr(),
                      style: const TextStyle(fontSize: 12, color: Colors.deepPurple),
                    ),
                  ),
                  TextButton(
                    onPressed: () => _ctl!.stopSession(),
                    child: Text('pcscreen.cut'.tr(), style: const TextStyle(color: Colors.red)),
                  ),
                ],
              ),
            )
          else
            Container(
              width: double.infinity,
              color: Theme.of(context).colorScheme.surfaceContainerHighest,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: Text(
                rc.sessionEndReason == null
                    ? 'pcscreen.session_off'.tr()
                    : '${'pcscreen.session_ended'.tr()} (${rc.sessionEndReason})',
                style: const TextStyle(fontSize: 12),
              ),
            ),
          Expanded(
            child: Container(
              margin: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Theme.of(context).dividerColor),
              ),
              clipBehavior: Clip.antiAlias,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  if (_rendererReady && st.screenStream != null)
                    LayoutBuilder(
                      builder: (context, cons) {
                        final box = cons.biggest;
                        return GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          // نقرة = نقر أيسر على الموضع
                          onTapUp: (d) {
                            final n = _normalized(d.localPosition, box, dims.$1, dims.$2);
                            if (n != null) _ctl!.sendPointer(n.$1, n.$2, action: 'click');
                          },
                          onDoubleTapDown: (d) {
                            final n = _normalized(d.localPosition, box, dims.$1, dims.$2);
                            if (n != null) _ctl!.sendPointer(n.$1, n.$2, action: 'dblclick');
                          },
                          // نقرة مطولة + تحريك = سحب (down → move → up)
                          onLongPressStart: (d) {
                            final n = _normalized(d.localPosition, box, dims.$1, dims.$2);
                            if (n != null) {
                              _ctl!.sendPointer(n.$1, n.$2, action: 'move');
                              _ctl!.sendPointer(n.$1, n.$2, action: 'down');
                            }
                          },
                          onLongPressMoveUpdate: (d) {
                            final n = _normalized(d.localPosition, box, dims.$1, dims.$2);
                            if (n != null) _ctl!.sendPointer(n.$1, n.$2, action: 'move');
                          },
                          onLongPressEnd: (d) {
                            final n = _normalized(d.localPosition, box, dims.$1, dims.$2);
                            _ctl!.sendPointer(n?.$1 ?? 1.0, n?.$2 ?? 1.0, action: 'up');
                          },
                          // إصبعان عمودي = تمرير · تفريق = قرص · نقر بإصبعين = أيمن
                          onScaleUpdate: (d) {
                            if (d.pointerCount >= 2) {
                              if (d.scale == 1.0) {
                                if (d.focalPointDelta.dy.abs() > 1) {
                                  _ctl!.scroll(d.focalPointDelta.dy);
                                }
                              } else {
                                _ctl!.pinch(d.scale);
                              }
                            }
                          },
                          onDoubleTap: () {},
                          onSecondaryTapUp: (d) {
                            final n = _normalized(d.localPosition, box, dims.$1, dims.$2);
                            if (n != null) _ctl!.sendPointer(n.$1, n.$2, action: 'rclick');
                          },
                          child: RTCVideoView(
                            _renderer,
                            objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitContain,
                          ),
                        );
                      },
                    )
                  else
                    Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (st.screen.phase == MediaPhase.connecting) ...[
                            const CircularProgressIndicator(),
                            const SizedBox(height: 12),
                            Text('pcscreen.connecting'.tr()),
                          ] else if (st.screen.phase == MediaPhase.error) ...[
                            const Icon(Icons.error_outline, size: 40, color: Colors.red),
                            const SizedBox(height: 8),
                            Text(st.screen.error ?? 'pcscreen.failed'.tr()),
                            const SizedBox(height: 12),
                            FilledButton.icon(
                              onPressed: () {
                                _media!.requestScreen(
                                  fps: _fps,
                                  quality: _quality,
                                  target: _target.isEmpty ? null : _target,
                                );
                              },
                              icon: const Icon(Icons.refresh),
                              label: Text('pcscreen.retry'.tr()),
                            ),
                          ] else ...[
                            const Icon(Icons.monitor, size: 40),
                            const SizedBox(height: 8),
                            Text('pcscreen.waiting'.tr()),
                          ],
                        ],
                      ),
                    ),
                  // مؤشر جلسة تحكم صغير أعلى اليمين
                  if (rc.sessionActive && live)
                    Positioned(
                      top: 8,
                      left: 8,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: Colors.deepPurple.withOpacity(.85),
                          borderRadius: BorderRadius.circular(99),
                        ),
                        child: Text(
                          'pcscreen.live_touch'.tr(),
                          style: const TextStyle(fontSize: 10, color: Colors.white),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          // إدخال نصي — فرق الحروف يمر rc:key حرفًا حرفًا (عربي كامل §13)
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _kbdCtrl,
                      keyboardType: TextInputType.text,
                      decoration: InputDecoration(
                        isDense: true,
                        hintText: 'pcscreen.type_hint'.tr(),
                        border: const OutlineInputBorder(),
                      ),
                      onChanged: (v) {
                        if (v.length > _kbdPrev.length && v.startsWith(_kbdPrev)) {
                          final added = v.substring(_kbdPrev.length);
                          for (final ch in added.runes.take(12)) {
                            _ctl!.key(String.fromCharCode(ch));
                          }
                        } else if (v.length < _kbdPrev.length) {
                          final removed = _kbdPrev.length - v.length;
                          for (var i = 0; i < removed && i < 12; i++) {
                            _ctl!.keySpecial('backspace');
                          }
                        }
                        _kbdPrev = v;
                      },
                      onSubmitted: (v) {
                        if (v.isNotEmpty) {
                          _ctl!.key(v);
                          _kbdCtrl.clear();
                          _kbdPrev = '';
                        }
                        _ctl!.keySpecial('enter');
                      },
                    ),
                  ),
                  IconButton(
                    tooltip: 'pcscreen.enter'.tr(),
                    onPressed: () => _ctl!.keySpecial('enter'),
                    icon: const Icon(Icons.keyboard_return),
                  ),
                  IconButton(
                    tooltip: 'pcscreen.backspace'.tr(),
                    onPressed: () => _ctl!.keySpecial('backspace'),
                    icon: const Icon(Icons.backspace_outlined),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  void unawaitedSafe(Future<void> f) {
    f.catchError((_) {});
  }
}

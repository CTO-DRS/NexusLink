import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:permission_handler/permission_handler.dart';

import '../data/media_service.dart';
import '../state/media_providers.dart';
import 'pc_screen_screen.dart';

/// شاشة الوسائط والكاميرا (FA-8) — بند البث من التطبيق:
/// كويب كام بمعاينة مصغرة + إشعار أثناء البث، مصراع بمؤقت وفلاش،
/// مراقبة بكشف حركة، مراقبة أطفال بشاشة مطفأة، ميكروفون، مستشعرات،
/// و«أين هاتفي» (تنفيذها في الخدمة الخلفية — يُطلق من ويب الحماية).
class MediaScreen extends ConsumerStatefulWidget {
  const MediaScreen({super.key});

  @override
  ConsumerState<MediaScreen> createState() => _MediaScreenState();
}

class _MediaScreenState extends ConsumerState<MediaScreen> {
  final RTCVideoRenderer _renderer = RTCVideoRenderer();
  bool _rendererReady = false;
  int _shutterTimer = 0;

  @override
  void initState() {
    super.initState();
    _ensurePermissions();
    () async {
      await _renderer.initialize();
      if (mounted) setState(() => _rendererReady = true);
    }();
  }

  Future<void> _ensurePermissions() async {
    final cam = await Permission.camera.status;
    final mic = await Permission.microphone.status;
    if (!cam.isGranted || !mic.isGranted) {
      await [Permission.camera, Permission.microphone].request();
    }
  }

  @override
  void dispose() {
    _renderer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final st = ref.watch(mediaControllerProvider);
    final ctl = ref.read(mediaControllerProvider.notifier);
    final theme = Theme.of(context);

    // ربط المعاينة المصغرة بالتيار الحي
    if (_rendererReady) {
      _renderer.srcObject = st.previewStream;
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _StatusHeader(bridgeOnline: st.bridgeOnline),
        const SizedBox(height: 12),

        // ================= شاشة الكمبيوتر (FA-media — عقد §15) =================
        _Card(
          title: 'pcscreen.card'.tr(),
          icon: Icons.monitor,
          trailing: _PhaseChip(phase: st.screen.phase),
          children: [
            Text(
              'pcscreen.card_desc'.tr(),
              style: const TextStyle(fontSize: 12, height: 1.6),
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const PcScreenView()),
              ),
              icon: const Icon(Icons.cast),
              label: Text('pcscreen.open'.tr()),
            ),
          ],
        ),
        const SizedBox(height: 12),

        // ============ الشاشة الثانية (R4 ① — عقد §19): الهاتف شاشة ممتدة ============
        _Card(
          title: 'seconds.card'.tr(),
          icon: Icons.smartphone_rounded,
          trailing: _SsChip(active: st.ssActive),
          children: [
            Text(
              'seconds.card_desc'.tr(),
              style: const TextStyle(fontSize: 12, height: 1.6),
            ),
            const SizedBox(height: 8),
            if (st.ssError != null && st.ssError!.isNotEmpty) ...[
              Text(
                st.ssError!,
                style: TextStyle(fontSize: 11, color: theme.colorScheme.error, height: 1.5),
              ),
              const SizedBox(height: 6),
            ],
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: st.ssActive
                        ? null
                        : () {
                            // افتراضي: 1080×2400 عمودي — التفاصيل في ورقة الإعدادات
                            showModalBottomSheet<void>(
                              context: context,
                              builder: (_) => _SsSettingsSheet(state: st),
                            );
                          },
                    icon: const Icon(Icons.picture_in_picture_alt_rounded),
                    label: Text('seconds.enable'.tr()),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton.icon(
                  onPressed: st.ssActive ? () => ctl.secondScreenCmd('disable') : null,
                  icon: const Icon(Icons.stop_rounded),
                  label: Text('seconds.disable'.tr()),
                ),
              ],
            ),
            if (st.ssActive)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  'seconds.active_desc'.tr(namedArgs: {
                    'res': st.ssW > 0 ? '${st.ssW}×${st.ssH}' : '—',
                  }),
                  style: const TextStyle(fontSize: 11, height: 1.5),
                ),
              ),
          ],
        ),
        const SizedBox(height: 12),

        // ====== الجولة 5 (عقد §24): مشاركة شاشتي مع هاتف آخر (kind=mirror) ======
        _Card(
          title: 'mirror.shareCard'.tr(),
          icon: Icons.screen_share_rounded,
          trailing: _PhaseChip(phase: st.mirror.phase),
          children: [
            Text(
              'mirror.shareCard_desc'.tr(),
              style: const TextStyle(fontSize: 12, height: 1.6),
            ),
            const SizedBox(height: 8),
            if (st.mirror.error != null && st.mirror.error!.isNotEmpty) ...[
              Text(
                st.mirror.error!,
                style: TextStyle(fontSize: 11, color: theme.colorScheme.error, height: 1.5),
              ),
              const SizedBox(height: 6),
            ],
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: st.mirror.phase == MediaPhase.idle || st.mirror.phase == MediaPhase.error
                        ? () => ctl.startScreenShare()
                        : null,
                    icon: const Icon(Icons.cast_rounded),
                    label: Text('mirror.startShare'.tr()),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton.icon(
                  onPressed: st.mirror.phase == MediaPhase.connecting || st.mirror.phase == MediaPhase.live
                      ? () => ctl.stopScreenShare()
                      : null,
                  icon: const Icon(Icons.stop_rounded),
                  label: Text('mirror.stopShare'.tr()),
                ),
              ],
            ),
            if (st.mirror.phase == MediaPhase.live)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  'mirror.liveHint'.tr(),
                  style: const TextStyle(fontSize: 11, height: 1.5),
                ),
              ),
          ],
        ),
        const SizedBox(height: 12),

        // ================= كويب كام =================
        _Card(
          title: 'media.cam.title'.tr(),
          icon: Icons.videocam_rounded,
          trailing: _PhaseChip(phase: st.cam.phase),
          children: [
            AspectRatio(
              aspectRatio: 16 / 9,
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.black,
                  borderRadius: BorderRadius.circular(12),
                ),
                clipBehavior: Clip.antiAlias,
                child: st.cam.phase == MediaPhase.live && st.previewStream != null
                    ? RTCVideoView(
                        _renderer,
                        mirror: st.facing == 'front',
                        objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
                      )
                    : Center(
                        child: Text(
                          st.cam.phase == MediaPhase.connecting
                              ? 'media.cam.connecting'.tr()
                              : 'media.cam.idle'.tr(),
                          style: const TextStyle(color: Colors.white54, fontSize: 12),
                          textAlign: TextAlign.center,
                        ),
                      ),
              ),
            ),
            if (st.cam.error != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(st.cam.error!, style: TextStyle(color: theme.colorScheme.error, fontSize: 11)),
              ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (st.cam.phase == MediaPhase.idle || st.cam.phase == MediaPhase.error) ...[
                  FilledButton.icon(
                    onPressed: () => ctl.startCam('back'),
                    icon: const Icon(Icons.photo_camera_rounded, size: 16),
                    label: Text('media.cam.back'.tr(), style: const TextStyle(fontSize: 12)),
                  ),
                  FilledButton.tonalIcon(
                    onPressed: () => ctl.startCam('front'),
                    icon: const Icon(Icons.flip_camera_android_rounded, size: 16),
                    label: Text('media.cam.front'.tr(), style: const TextStyle(fontSize: 12)),
                  ),
                ] else ...[
                  FilledButton.icon(
                    style: FilledButton.styleFrom(backgroundColor: theme.colorScheme.error),
                    onPressed: () => ctl.stopCam(),
                    icon: const Icon(Icons.stop_rounded, size: 16),
                    label: Text('common.stop'.tr(), style: const TextStyle(fontSize: 12)),
                  ),
                  OutlinedButton.icon(
                    onPressed: () => ctl.switchCamera(),
                    icon: const Icon(Icons.flip_camera_android_rounded, size: 16),
                    label: Text('media.cam.switch'.tr(), style: const TextStyle(fontSize: 12)),
                  ),
                  OutlinedButton.icon(
                    onPressed: st.facing == 'back' ? () => ctl.setTorch(!st.torch) : null,
                    icon: Icon(st.torch ? Icons.flashlight_on_rounded : Icons.flashlight_off_rounded, size: 16),
                    label: Text('media.cam.torch'.tr(), style: const TextStyle(fontSize: 12)),
                  ),
                ],
              ],
            ),
            Text(
              'media.cam.note'.tr(),
              style: theme.textTheme.bodySmall?.copyWith(fontSize: 10.5, color: theme.hintColor),
            ),
          ],
        ),
        const SizedBox(height: 12),

        // ================= مصراع (صورة كملف) =================
        _Card(
          title: 'media.shot.title'.tr(),
          icon: Icons.camera_alt_rounded,
          trailing: st.shutterBusy
              ? Chip(
                  label: st.shutterCountdown > 0 ? Text('${st.shutterCountdown}') : Text('media.shot.busy'.tr()),
                  visualDensity: VisualDensity.compact,
                )
              : null,
          children: [
            Row(
              children: [
                Text('media.shot.timer'.tr(), style: const TextStyle(fontSize: 12)),
                const SizedBox(width: 8),
                ...[0, 3, 5, 10].map((t) => Padding(
                      padding: const EdgeInsetsDirectional.only(end: 6),
                      child: ChoiceChip(
                        label: Text(t == 0 ? 'media.shot.now'.tr() : '$t${'media.sec'.tr()}'),
                        selected: _shutterTimer == t,
                        visualDensity: VisualDensity.compact,
                        onSelected: (_) => setState(() => _shutterTimer = t),
                      ),
                    )),
              ],
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                FilledButton.icon(
                  onPressed: st.shutterBusy ? null : () => ctl.capturePhoto(timerSec: _shutterTimer),
                  icon: const Icon(Icons.camera_rounded, size: 16),
                  label: Text('media.shot.capture'.tr(), style: const TextStyle(fontSize: 12)),
                ),
                FilledButton.tonalIcon(
                  onPressed: st.shutterBusy ? null : () => ctl.capturePhoto(timerSec: _shutterTimer, flash: true),
                  icon: const Icon(Icons.flash_on_rounded, size: 16),
                  label: Text('media.shot.flash'.tr(), style: const TextStyle(fontSize: 12)),
                ),
              ],
            ),
            if (st.lastShotName != null)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text(
                  'media.shot.sent'.tr(namedArgs: {'name': st.lastShotName!}),
                  style: const TextStyle(color: Color(0xFF10B981), fontSize: 11),
                ),
              ),
            Text(
              'media.shot.note'.tr(),
              style: theme.textTheme.bodySmall?.copyWith(fontSize: 10.5, color: theme.hintColor),
            ),
          ],
        ),
        const SizedBox(height: 12),

        // ================= وضع المراقبة =================
        _Card(
          title: 'media.watch.title'.tr(),
          icon: Icons.radar_rounded,
          trailing: st.watchOn
              ? Chip(
                  label: Text('media.watch.on'.tr()),
                  visualDensity: VisualDensity.compact,
                  backgroundColor: const Color(0x1A10B981),
                )
              : null,
          children: [
            if (st.watchOn)
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('media.watch.sensitivity'.tr(), style: const TextStyle(fontSize: 12)),
                      Text('${(st.sensitivity * 100).round()}%', style: const TextStyle(fontSize: 11)),
                    ],
                  ),
                  Slider(
                    value: st.sensitivity,
                    min: 0.05,
                    max: 1,
                    onChanged: (v) => ctl.setSensitivity(v),
                  ),
                  Text(
                    'media.watch.motion'.tr(namedArgs: {
                      'count': '${st.motionCount}',
                      'level': '${st.lastMotionLevel}',
                    }),
                    style: const TextStyle(fontSize: 11.5),
                  ),
                ],
              ),
            const SizedBox(height: 6),
            FilledButton.icon(
              style: st.watchOn ? FilledButton.styleFrom(backgroundColor: theme.colorScheme.error) : null,
              onPressed: st.watchOn ? () => ctl.stopWatch() : () => ctl.startWatch(),
              icon: Icon(st.watchOn ? Icons.stop_rounded : Icons.radar_rounded, size: 16),
              label: Text(st.watchOn ? 'media.watch.stop'.tr() : 'media.watch.start'.tr(),
                  style: const TextStyle(fontSize: 12)),
            ),
            Text(
              'media.watch.note'.tr(),
              style: theme.textTheme.bodySmall?.copyWith(fontSize: 10.5, color: theme.hintColor),
            ),
          ],
        ),
        const SizedBox(height: 12),

        // ================= مراقبة الأطفال =================
        _Card(
          title: 'media.baby.title'.tr(),
          icon: Icons.child_care_rounded,
          trailing: _PhaseChip(phase: st.baby.phase),
          children: [
            if (st.baby.phase != MediaPhase.idle && st.baby.phase != MediaPhase.error) ...[
              Row(
                children: [
                  Text('media.baby.level'.tr(), style: const TextStyle(fontSize: 12)),
                  const SizedBox(width: 8),
                  Expanded(
                    child: LinearProgressIndicator(
                      value: st.babyLevel / 100,
                      minHeight: 6,
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text('${st.babyLevel}%', style: const TextStyle(fontSize: 11)),
                ],
              ),
              if (st.babyAlerts > 0)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(
                    'media.baby.alerts'.tr(namedArgs: {'count': '${st.babyAlerts}'}),
                    style: const TextStyle(color: Color(0xFFEF4444), fontSize: 11.5),
                  ),
                ),
              const SizedBox(height: 8),
            ],
            FilledButton.icon(
              style: st.baby.phase == MediaPhase.live
                  ? FilledButton.styleFrom(backgroundColor: theme.colorScheme.error)
                  : null,
              onPressed: () =>
                  st.baby.phase == MediaPhase.live ? ctl.stopBaby() : ctl.startBaby(),
              icon: Icon(st.baby.phase == MediaPhase.live ? Icons.stop_rounded : Icons.child_care_rounded, size: 16),
              label: Text(
                st.baby.phase == MediaPhase.live ? 'media.baby.stop'.tr() : 'media.baby.start'.tr(),
                style: const TextStyle(fontSize: 12),
              ),
            ),
            Text(
              'media.baby.note'.tr(),
              style: theme.textTheme.bodySmall?.copyWith(fontSize: 10.5, color: theme.hintColor),
            ),
          ],
        ),
        const SizedBox(height: 12),

        // ================= ميكروفون السيرفر =================
        _Card(
          title: 'media.mic.title'.tr(),
          icon: Icons.mic_rounded,
          trailing: _PhaseChip(phase: st.mic.phase),
          children: [
            FilledButton.icon(
              style: st.mic.phase == MediaPhase.live
                  ? FilledButton.styleFrom(backgroundColor: theme.colorScheme.error)
                  : null,
              onPressed: () => st.mic.phase == MediaPhase.live ? ctl.stopMic() : ctl.startMic(),
              icon: Icon(st.mic.phase == MediaPhase.live ? Icons.mic_off_rounded : Icons.mic_rounded, size: 16),
              label: Text(st.mic.phase == MediaPhase.live ? 'media.mic.stop'.tr() : 'media.mic.start'.tr(),
                  style: const TextStyle(fontSize: 12)),
            ),
            Text(
              'media.mic.note'.tr(),
              style: theme.textTheme.bodySmall?.copyWith(fontSize: 10.5, color: theme.hintColor),
            ),
          ],
        ),
        const SizedBox(height: 12),

        // ================= المستشعرات =================
        _Card(
          title: 'media.sensors.title'.tr(),
          icon: Icons.sensors_rounded,
          trailing: Switch(
            value: st.sensorsOn,
            onChanged: (v) => v ? ctl.startSensors() : ctl.stopSensors(),
          ),
          children: [
            Row(
              children: [
                Expanded(
                  child: _SensorReadout(
                    label: 'media.sensors.acc'.tr(),
                    values: st.acc,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: _SensorReadout(
                    label: 'media.sensors.gyro'.tr(),
                    values: st.gyro,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              style: st.sensorsOn ? FilledButton.styleFrom(backgroundColor: theme.colorScheme.error) : null,
              onPressed: () => st.sensorsOn ? ctl.stopSensors() : ctl.startSensors(),
              icon: Icon(st.sensorsOn ? Icons.sensors_off_rounded : Icons.sensors_rounded, size: 16),
              label: Text(st.sensorsOn ? 'media.sensors.stop'.tr() : 'media.sensors.start'.tr(),
                  style: const TextStyle(fontSize: 12)),
            ),
            Text(
              'media.sensors.note'.tr(namedArgs: {'count': '${st.sensorMsgs}'}),
              style: theme.textTheme.bodySmall?.copyWith(fontSize: 10.5, color: theme.hintColor),
            ),
          ],
        ),
        const SizedBox(height: 12),

        // ================= أين هاتفي =================
        _Card(
          title: 'media.find.title'.tr(),
          icon: Icons.notifications_active_rounded,
          children: [
            Text(
              'media.find.note'.tr(),
              style: theme.textTheme.bodySmall?.copyWith(fontSize: 11.5, height: 1.5),
            ),
          ],
        ),

        if (st.lastError != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(
              st.lastError!,
              style: TextStyle(color: theme.colorScheme.error, fontSize: 11),
              textAlign: TextAlign.center,
            ),
          ),
        const SizedBox(height: 24),
      ],
    );
  }
}

// ---------------------------------------------------------------------------

class _StatusHeader extends StatelessWidget {
  final bool bridgeOnline;
  const _StatusHeader({required this.bridgeOnline});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Icon(Icons.surround_sound_rounded, size: 18, color: theme.colorScheme.primary),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            'media.header.title'.tr(),
            style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
          ),
        ),
        Chip(
          visualDensity: VisualDensity.compact,
          avatar: Icon(Icons.circle, size: 8, color: bridgeOnline ? const Color(0xFF10B981) : theme.hintColor),
          label: Text(
            bridgeOnline ? 'media.header.online'.tr() : 'media.header.offline'.tr(),
            style: const TextStyle(fontSize: 10.5),
          ),
        ),
      ],
    );
  }
}

class _Card extends StatelessWidget {
  final String title;
  final IconData icon;
  final Widget? trailing;
  final List<Widget> children;
  const _Card({required this.title, required this.icon, required this.children, this.trailing});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: theme.dividerColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(icon, size: 18, color: theme.colorScheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(title, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.bold)),
              ),
              if (trailing != null) trailing!,
            ],
          ),
          const SizedBox(height: 10),
          ...children,
        ],
      ),
    );
  }
}

class _PhaseChip extends StatelessWidget {
  final MediaPhase phase;
  const _PhaseChip({required this.phase});

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (phase) {
      MediaPhase.idle => ('media.phase.idle'.tr(), Colors.grey),
      MediaPhase.connecting => ('media.phase.connecting'.tr(), Colors.orange),
      MediaPhase.live => ('media.phase.live'.tr(), const Color(0xFF10B981)),
      MediaPhase.error => ('media.phase.error'.tr(), const Color(0xFFEF4444)),
    };
    return Chip(
      visualDensity: VisualDensity.compact,
      avatar: Icon(Icons.circle, size: 8, color: color),
      label: Text(label, style: const TextStyle(fontSize: 10)),
    );
  }
}

class _SensorReadout extends StatelessWidget {
  final String label;
  final List<double> values;
  const _SensorReadout({required this.label, required this.values});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withOpacity(0.4),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontSize: 10.5, fontWeight: FontWeight.bold)),
          const SizedBox(height: 4),
          ...List.generate(3, (i) {
            final v = i < values.length ? values[i] : 0.0;
            return Text(
              '${['x', 'y', 'z'][i]}: ${v.toStringAsFixed(2)}',
              style: const TextStyle(fontSize: 10.5, fontFeatures: [], height: 1.4),
            );
          }),
        ],
      ),
    );
  }
}

// ============================================================================
// R4 مرحلة ① (عقد §19) — الشاشة الثانية: رقاقة الحالة + ورقة الإعدادات
// ============================================================================
class _SsChip extends StatelessWidget {
  final bool active;
  const _SsChip({required this.active});

  @override
  Widget build(BuildContext context) {
    return Chip(
      visualDensity: VisualDensity.compact,
      avatar: Icon(
        Icons.circle,
        size: 8,
        color: active ? const Color(0xFF10B981) : Colors.grey,
      ),
      label: Text(
        active ? 'seconds.chip_on'.tr() : 'seconds.chip_off'.tr(),
        style: const TextStyle(fontSize: 10),
      ),
    );
  }
}

/// ورقة إعدادات الشاشة الثانية — الدقة/الاتجاه + معدل الإطارات + الجودة
/// (البند 7) — القوائم البيضاء نفسها التعاقدية (§15: fps 15..60، quality ×4)
class _SsSettingsSheet extends ConsumerStatefulWidget {
  final MediaUiState state;
  const _SsSettingsSheet({required this.state});

  @override
  ConsumerState<_SsSettingsSheet> createState() => _SsSettingsSheetState();
}

class _SsSettingsSheetState extends ConsumerState<_SsSettingsSheet> {
  // أوضاع التعاقد (§19): عمودي هاتفي / أفقي هاتفي / HD — أبعاد دقيقة
  static const List<(String, int, int)> _modes = [
    ('1080×2400', 1080, 2400), // عمودي — أبعاد الهاتف
    ('2400×1080', 2400, 1080), // أفقي — أبعاد الهاتف
    ('1080×1920', 1080, 1920), // عمودي شائع
    ('1920×1080', 1920, 1080), // HD
  ];
  int _modeIdx = 0;
  int _fps = 30;
  String _quality = 'high';

  @override
  void initState() {
    super.initState();
    // نبدأ من معدل الكمبيوتر المعروف (أو 30) — الجودة الافتراضية high
    if (widget.state.screenFps > 0) _fps = widget.state.screenFps;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('seconds.settings_title'.tr(), style: theme.textTheme.titleMedium),
            const SizedBox(height: 12),
            Text('seconds.resolution'.tr(), style: const TextStyle(fontSize: 12)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              children: [
                for (var i = 0; i < _modes.length; i++)
                  ChoiceChip(
                    label: Text(_modes[i].$1, style: const TextStyle(fontSize: 11)),
                    selected: _modeIdx == i,
                    onSelected: (_) => setState(() => _modeIdx = i),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            Text('pcscreen.quality'.tr(), style: const TextStyle(fontSize: 12)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              children: [
                for (final f in const [15, 24, 30, 45, 60])
                  ChoiceChip(
                    label: Text('$f fps', style: const TextStyle(fontSize: 11)),
                    selected: _fps == f,
                    onSelected: (_) => setState(() => _fps = f),
                  ),
                for (final q in const ['low', 'medium', 'high', 'ultra'])
                  ChoiceChip(
                    label: Text(q, style: const TextStyle(fontSize: 11)),
                    selected: _quality == q,
                    onSelected: (_) => setState(() => _quality = q),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: () {
                final (_, w, h) = _modes[_modeIdx];
                Navigator.of(context).pop();
                // تمكين + بث تلقائي — الحالة من secondscreen:state (مصدر الحقيقة)
                final ctl = ref.read(mediaControllerProvider.notifier);
                ctl.secondScreenCmd('enable', w: w, h: h, fps: _fps, quality: _quality);
              },
              icon: const Icon(Icons.picture_in_picture_alt_rounded),
              label: Text('seconds.enable_start'.tr()),
            ),
            const SizedBox(height: 4),
            Text(
              'seconds.hint_mac'.tr(),
              style: TextStyle(fontSize: 10, color: theme.colorScheme.onSurfaceVariant, height: 1.5),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

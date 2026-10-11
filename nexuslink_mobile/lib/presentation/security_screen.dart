
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

import '../core/protocol.dart' show SecEvents;
import '../state/providers.dart' show agentChannelProvider;
import '../state/security_providers.dart';

/// شاشة الأمان (FA-10) — تبويب ثامن:
///  · قفل التطبيق: PIN/بصمة + قفل تلقائي عند الخلفية (البند 2)
///  · جلسة 3009: مصافحة X25519 + بصمة SAS للتحقق البصري (البند 1)
///  · لوحة الأذونات: 10 ميزات بمفاتيح + صلاحيات النظام بطلب زر (البند 3)
///  · وضع الفقدان: حالة + إلغاء بالمالك (البند 4)
///  · المسح الآمن: ملفات Download/NexusLink بتمريرات (البند 5)
///  · الإقلاع والبطارية: تشغيل تلقائي + طلب تجاهل التحسين (البند 6)
class SecurityScreen extends ConsumerStatefulWidget {
  const SecurityScreen({super.key});

  @override
  ConsumerState<SecurityScreen> createState() => _SecurityScreenState();
}

class _SecurityScreenState extends ConsumerState<SecurityScreen> {
  List<Map<String, dynamic>> _files = const [];
  int _passes = 3;

  @override
  void initState() {
    super.initState();
    _refreshFiles();
  }

  Future<void> _refreshFiles() async {
    final files = await ref.read(agentChannelProvider).secListFiles();
    if (mounted) setState(() => _files = files);
  }

  Future<void> _bioToggle(bool current) async {
    final controller = ref.read(appLockProvider.notifier);
    if (current) {
      await controller.setBiometricEnabled(false);
      return;
    }
    final can = await controller.canBiometric();
    if (!can) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('sec.noBiometric'.tr())));
      }
      return;
    }
    final ok = await controller.verifyBiometric();
    if (ok) await controller.setBiometricEnabled(true);
  }

  Future<void> _setPin() async {
    final controller = ref.read(appLockProvider.notifier);
    final pin = await showDialog<String>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => const _SetPinDialog(),
    );
    if (pin != null && pin.isNotEmpty) {
      final ok = await controller.setPin(pin);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(ok ? 'sec.pinSaved'.tr() : 'sec.pinFailed'.tr())),
        );
      }
    }
  }

  Future<void> _wipe() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('sec.wipeConfirmTitle'.tr()),
        content: Text('sec.wipeConfirmBody'.tr(args: ['$_passes', '${_files.length}'])),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text('common.cancel'.tr())),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text('sec.wipeRun'.tr()),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      HapticFeedback.heavyImpact();
      await ref.read(wipeProvider.notifier).run(_passes);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cfg = ref.watch(lockConfigProvider);
    final locked = ref.watch(appLockProvider);
    final sec = ref.watch(secStateProvider);
    final lost = ref.watch(lostProvider);
    final wipe = ref.watch(wipeProvider);
    final features = ref.watch(secFeaturesProvider);
    final autoStart = ref.watch(autoStartProvider);

    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 26),
      children: [
        // ===================== 1) جلسة التشفير 3009 =====================
        _Section(
          icon: Icons.enhanced_encryption_rounded,
          title: 'sec.sessionTitle'.tr(),
          subtitle: 'sec.sessionSub'.tr(),
          trailing: Chip(
            avatar: Icon(sec.online ? Icons.check_circle_rounded : Icons.cancel_rounded,
                size: 14, color: sec.online ? Colors.green : Colors.red),
            label: Text(
              sec.kexDone ? 'sec.sessionSecured'.tr() : (sec.online ? 'sec.sessionWaiting'.tr() : 'sec.sessionOffline'.tr()),
              style: const TextStyle(fontSize: 11),
            ),
            visualDensity: VisualDensity.compact,
          ),
          children: [
            Row(
              children: [
                Text('sec.sasLabel'.tr(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    sec.kexDone ? '${sec.sasEmoji}  ·  ${sec.sasHex}' : '—',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700, letterSpacing: .5),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Text('sec.fpLabel'.tr(), style: const TextStyle(fontSize: 11, color: Colors.grey)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    sec.fingerprint.isEmpty ? '—' : sec.fingerprint,
                    style: const TextStyle(fontSize: 11.5, fontFeatures: [FontFeature.tabularFigures()]),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Text('sec.peerLabel'.tr(), style: const TextStyle(fontSize: 11, color: Colors.grey)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    sec.kexDone ? '${sec.peerName} (${sec.peerId}) · e${sec.epoch}' : '—',
                    style: const TextStyle(fontSize: 11.5),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'sec.verifyHint'.tr(),
              style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor, height: 1.5),
            ),
          ],
        ),

        // ===================== 2) قفل التطبيق =====================
        _Section(
          icon: Icons.lock_rounded,
          title: 'sec.lockTitle'.tr(),
          subtitle: 'sec.lockSub'.tr(),
          children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: Text('sec.lockEnable'.tr(), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
              value: cfg.enabled,
              onChanged: (v) async {
                final c = ref.read(lockConfigProvider.notifier);
                if (v && !cfg.hasPin) {
                  await _setPin();
                  final now = ref.read(lockConfigProvider);
                  if (now.hasPin) await c.save(now.copyWith(enabled: true));
                } else {
                  await c.save(cfg.copyWith(enabled: v));
                }
              },
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              leading: const Icon(Icons.password_rounded, size: 20),
              title: Text('sec.lockPin'.tr(), style: const TextStyle(fontSize: 13.5)),
              subtitle: Text(cfg.hasPin ? 'sec.pinSet'.tr() : 'sec.pinMissing'.tr(), style: const TextStyle(fontSize: 11.5)),
              trailing: TextButton(onPressed: _setPin, child: Text(cfg.hasPin ? 'sec.changePin'.tr() : 'sec.setPin'.tr())),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              leading: const Icon(Icons.fingerprint_rounded, size: 22),
              title: Text('sec.lockBio'.tr(), style: const TextStyle(fontSize: 13.5)),
              subtitle: Text('sec.lockBioSub'.tr(), style: const TextStyle(fontSize: 11.5)),
              trailing: Switch(value: cfg.hasBiometric, onChanged: _bioToggle),
            ),
            ListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              leading: const Icon(Icons.timer_rounded, size: 20),
              title: Text('sec.lockAuto'.tr(), style: const TextStyle(fontSize: 13.5)),
              subtitle: Text(
                cfg.autoLockSec == 0 ? 'sec.autoImmediate'.tr() : 'sec.autoAfter'.tr(args: ['${cfg.autoLockSec}']),
                style: const TextStyle(fontSize: 11.5),
              ),
              trailing: SegmentedButton<int>(
                showSelectedIcon: false,
                style: const ButtonStyle(visualDensity: VisualDensity.compact),
                segments: const [
                  ButtonSegment(value: 0, label: Text('0s')),
                  ButtonSegment(value: 30, label: Text('30s')),
                  ButtonSegment(value: 60, label: Text('60s')),
                  ButtonSegment(value: 300, label: Text('5m')),
                ],
                selected: {cfg.autoLockSec},
                onSelectionChanged: (s) => ref
                    .read(lockConfigProvider.notifier)
                    .save(cfg.copyWith(autoLockSec: s.first)),
              ),
            ),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: cfg.enabled
                        ? () async {
                            await ref.read(appLockProvider.notifier).lockNow();
                            if (mounted) setState(() {});
                          }
                        : null,
                    icon: const Icon(Icons.lock_outline_rounded, size: 17),
                    label: Text('sec.lockNow'.tr()),
                  ),
                ),
                if (locked) ...[
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: () => ref.read(appLockProvider.notifier).verifyBiometric(),
                      icon: const Icon(Icons.lock_open_rounded, size: 17),
                      label: Text('sec.currentlyLocked'.tr()),
                    ),
                  ),
                ],
              ],
            ),
          ],
        ),

        // ===================== 3) لوحة الأذونات =====================
        _Section(
          icon: Icons.tune_rounded,
          title: 'sec.permsTitle'.tr(),
          subtitle: 'sec.permsSub'.tr(),
          children: [
            Text('sec.featuresLabel'.tr(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            for (final f in SecEvents.features)
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: Text('sec.feat_$f'.tr(), style: const TextStyle(fontSize: 13)),
                subtitle: Text(f, style: TextStyle(fontSize: 10, color: Theme.of(context).hintColor, fontFamily: 'monospace')),
                value: features[f] ?? true,
                onChanged: (v) => ref.read(secFeaturesProvider.notifier).set(f, v),
              ),
            const Divider(height: 22),
            Text('sec.systemLabel'.tr(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700)),
            const SizedBox(height: 4),
            const _SystemPermRow(permission: Permission.camera, icon: Icons.camera_alt_rounded, labelKey: 'sec.sysCamera'),
            const _SystemPermRow(permission: Permission.microphone, icon: Icons.mic_rounded, labelKey: 'sec.sysMic'),
            const _SystemPermRow(permission: Permission.locationWhenInUse, icon: Icons.location_on_rounded, labelKey: 'sec.sysLocation'),
            const _SystemPermRow(permission: Permission.notification, icon: Icons.notifications_rounded, labelKey: 'sec.sysNotif'),
            const _SystemPermRow(permission: Permission.photos, icon: Icons.photo_rounded, labelKey: 'sec.sysPhotos'),
            const _OverlayPermRow(),
            const _BatteryPermRow(),
          ],
        ),

        // ===================== 4) وضع الفقدان =====================
        _Section(
          icon: Icons.sos_rounded,
          title: 'sec.lostTitle'.tr(),
          subtitle: 'sec.lostSub'.tr(),
          trailing: lost.active
              ? Chip(
                  avatar: const Icon(Icons.warning_rounded, size: 14, color: Colors.red),
                  label: Text('sec.lostActive'.tr(), style: const TextStyle(fontSize: 10, color: Colors.red)),
                  backgroundColor: Colors.red.withOpacity(.12),
                  visualDensity: VisualDensity.compact,
                )
              : null,
          children: [
            Text(
              lost.active
                  ? 'sec.lostActiveBody'.tr(args: [lost.message.isEmpty ? '—' : lost.message])
                  : 'sec.lostIdleBody'.tr(),
              style: TextStyle(fontSize: 12.5, height: 1.6, color: lost.active ? Colors.red.shade700 : Theme.of(context).hintColor),
            ),
            const SizedBox(height: 8),
            Text(
              'sec.lostHow'.tr(),
              style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor, height: 1.5),
            ),
            if (lost.active) ...[
              const SizedBox(height: 10),
              FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: Colors.red.shade700),
                onPressed: () => ref.read(lostProvider.notifier).stop(),
                icon: const Icon(Icons.verified_user_rounded, size: 18),
                label: Text('lost.imOwner'.tr()),
              ),
            ],
          ],
        ),

        // ===================== 5) المسح الآمن =====================
        _Section(
          icon: Icons.delete_sweep_rounded,
          title: 'sec.wipeTitle'.tr(),
          subtitle: 'sec.wipeSub'.tr(),
          children: [
            Row(
              children: [
                Text('sec.wipeFiles'.tr(args: ['${_files.length}']), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
                const Spacer(),
                TextButton.icon(
                  onPressed: _refreshFiles,
                  icon: const Icon(Icons.refresh_rounded, size: 16),
                  label: Text('common.refresh'.tr()),
                ),
              ],
            ),
            if (_files.isEmpty)
              Text('sec.wipeEmpty'.tr(), style: TextStyle(fontSize: 11.5, color: Theme.of(context).hintColor))
            else
              ..._files.take(6).map((f) => Padding(
                    padding: const EdgeInsets.only(bottom: 3),
                    child: Row(
                      children: [
                        const Icon(Icons.insert_drive_file_rounded, size: 14, color: Colors.grey),
                        const SizedBox(width: 6),
                        Expanded(child: Text('${f['name']}', style: const TextStyle(fontSize: 11.5), overflow: TextOverflow.ellipsis)),
                        Text(_fmtSize((f['size'] as int?) ?? 0), style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor)),
                      ],
                    ),
                  )),
            if (_files.length > 6)
              Text('sec.wipeMore'.tr(args: ['${_files.length - 6}']), style: TextStyle(fontSize: 10.5, color: Theme.of(context).hintColor)),
            const SizedBox(height: 8),
            Row(
              children: [
                Text('sec.wipePasses'.tr(), style: const TextStyle(fontSize: 12.5)),
                const Spacer(),
                SegmentedButton<int>(
                  showSelectedIcon: false,
                  style: const ButtonStyle(visualDensity: VisualDensity.compact),
                  segments: const [
                    ButtonSegment(value: 3, label: Text('3')),
                    ButtonSegment(value: 7, label: Text('7')),
                  ],
                  selected: {_passes},
                  onSelectionChanged: (s) => setState(() => _passes = s.first),
                ),
              ],
            ),
            if (wipe.running) ...[
              const SizedBox(height: 8),
              LinearProgressIndicator(value: wipe.total > 0 ? wipe.done / wipe.total : null),
              const SizedBox(height: 4),
              Text('sec.wipeProgress'.tr(args: [wipe.file, '${wipe.done}', '${wipe.total}']),
                  style: const TextStyle(fontSize: 11)),
            ],
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(backgroundColor: Theme.of(context).colorScheme.error),
                onPressed: (wipe.running || _files.isEmpty) ? null : _wipe,
                icon: const Icon(Icons.local_fire_department_rounded, size: 18),
                label: Text('sec.wipeRun'.tr()),
              ),
            ),
            if (wipe.ok != null && !wipe.running) ...[
              const SizedBox(height: 6),
              Text(
                wipe.ok == true
                    ? 'sec.wipeDone'.tr(args: ['${wipe.count}', _fmtSize(wipe.bytes)])
                    : 'sec.wipeFailed'.tr(args: [wipe.error]),
                style: TextStyle(fontSize: 11.5, color: wipe.ok == true ? Colors.green : Colors.red),
              ),
            ],
          ],
        ),

        // ===================== 6) الإقلاع والبطارية =====================
        _Section(
          icon: Icons.battery_saver_rounded,
          title: 'sec.bootTitle'.tr(),
          subtitle: 'sec.bootSub'.tr(),
          children: [
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              dense: true,
              title: Text('sec.autoStart'.tr(), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
              subtitle: Text('sec.autoStartSub'.tr(), style: const TextStyle(fontSize: 11.5)),
              value: autoStart,
              onChanged: (v) => ref.read(autoStartProvider.notifier).set(v),
            ),
            const _BatteryPermRow(),
            Text(
              'sec.batteryPolicy'.tr(),
              style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor, height: 1.55),
            ),
            const SizedBox(height: 6),
            Text(
              'sec.workers'.tr(),
              style: TextStyle(fontSize: 11, color: Theme.of(context).hintColor, height: 1.55),
            ),
          ],
        ),
      ],
    );
  }

  String _fmtSize(int b) {
    if (b >= 1024 * 1024) return '${(b / 1024 / 1024).toStringAsFixed(1)}MB';
    if (b >= 1024) return '${(b / 1024).toStringAsFixed(1)}KB';
    return '${b}B';
  }
}

// ---------------------------------------------------------------------------
// أقسام مساعدة
// ---------------------------------------------------------------------------

class _Section extends StatelessWidget {
  const _Section({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.children,
    this.trailing,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final List<Widget> children;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Theme.of(context).dividerColor.withOpacity(.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 20, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
              ),
              if (trailing != null) trailing!,
            ],
          ),
          const SizedBox(height: 3),
          Text(subtitle, style: TextStyle(fontSize: 11.5, color: Theme.of(context).hintColor)),
          const SizedBox(height: 10),
          ...children,
        ],
      ),
    );
  }
}

/// صف صلاحية نظام: حالة حية + زر طلب/فتح الإعدادات.
class _SystemPermRow extends ConsumerStatefulWidget {
  const _SystemPermRow({required this.permission, required this.icon, required this.labelKey});

  final Permission permission;
  final IconData icon;
  final String labelKey;

  @override
  ConsumerState<_SystemPermRow> createState() => _SystemPermRowState();
}

class _SystemPermRowState extends ConsumerState<_SystemPermRow> {
  PermissionStatus _status = PermissionStatus.denied;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    try {
      final s = await widget.permission.status;
      if (mounted) setState(() => _status = s);
    } catch (_) {}
  }

  Future<void> _request() async {
    try {
      if (_status.isPermanentlyDenied) {
        await openAppSettings();
      } else {
        await widget.permission.request();
      }
      await _check();
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final granted = _status.isGranted;
    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      leading: Icon(widget.icon, size: 19, color: granted ? Colors.green : Theme.of(context).hintColor),
      title: Text(widget.labelKey.tr(), style: const TextStyle(fontSize: 13)),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: granted ? Colors.green.withOpacity(.12) : Colors.orange.withOpacity(.12),
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              granted ? 'sec.permGranted'.tr() : 'sec.permMissing'.tr(),
              style: TextStyle(fontSize: 10, color: granted ? Colors.green.shade700 : Colors.orange.shade800, fontWeight: FontWeight.w700),
            ),
          ),
          const SizedBox(width: 6),
          TextButton(onPressed: _request, child: Text('sec.request'.tr())),
        ],
      ),
      onTap: _request,
    );
  }
}

/// إذن الرسم فوق التطبيقات (SYSTEM_ALERT_WINDOW) — يرفع موثوقية شاشة الفقدان.
class _OverlayPermRow extends ConsumerStatefulWidget {
  const _OverlayPermRow();

  @override
  ConsumerState<_OverlayPermRow> createState() => _OverlayPermRowState();
}

class _OverlayPermRowState extends ConsumerState<_OverlayPermRow> {
  bool _granted = false;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    try {
      final s = await Permission.systemAlertWindow.status;
      if (mounted) setState(() => _granted = s.isGranted);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      leading: Icon(Icons.picture_in_picture_rounded, size: 19, color: _granted ? Colors.green : Theme.of(context).hintColor),
      title: Text('sec.sysOverlay'.tr(), style: const TextStyle(fontSize: 13)),
      subtitle: Text('sec.sysOverlaySub'.tr(), style: const TextStyle(fontSize: 10.5, color: Colors.grey)),
      trailing: TextButton(
        onPressed: () async {
          await Permission.systemAlertWindow.request();
          await _check();
        },
        child: Text('sec.request'.tr()),
      ),
      onTap: () async {
        await Permission.systemAlertWindow.request();
        await _check();
      },
    );
  }
}

/// تحسين البطارية — طلب تجاهل التحسين ليبقى الوكيل حيًا 24 ساعة.
class _BatteryPermRow extends ConsumerStatefulWidget {
  const _BatteryPermRow();

  @override
  ConsumerState<_BatteryPermRow> createState() => _BatteryPermRowState();
}

class _BatteryPermRowState extends ConsumerState<_BatteryPermRow> {
  bool _ignored = false;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    try {
      final s = await Permission.ignoreBatteryOptimizations.status;
      if (mounted) setState(() => _ignored = s.isGranted);
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      leading: Icon(Icons.bolt_rounded, size: 19, color: _ignored ? Colors.green : Theme.of(context).hintColor),
      title: Text('sec.sysBattery'.tr(), style: const TextStyle(fontSize: 13)),
      subtitle: Text('sec.sysBatterySub'.tr(), style: const TextStyle(fontSize: 10.5, color: Colors.grey)),
      trailing: TextButton(
        onPressed: () async {
          await Permission.ignoreBatteryOptimizations.request();
          await _check();
        },
        child: Text(_ignored ? 'sec.permGranted'.tr() : 'sec.request'.tr()),
      ),
      onTap: () async {
        await Permission.ignoreBatteryOptimizations.request();
        await _check();
      },
    );
  }
}

/// حوار إدخال PIN جديد (تأكيد مزدوج) — يُخزَّن PBKDF2 عبر Kotlin.
class _SetPinDialog extends ConsumerStatefulWidget {
  const _SetPinDialog();

  @override
  ConsumerState<_SetPinDialog> createState() => _SetPinDialogState();
}

class _SetPinDialogState extends ConsumerState<_SetPinDialog> {
  final _c1 = TextEditingController();
  final _c2 = TextEditingController();
  String? _error;

  void _submit() {
    if (_c1.text.length < 4) {
      setState(() => _error = 'sec.pinShort'.tr());
      return;
    }
    if (_c1.text != _c2.text) {
      setState(() => _error = 'sec.pinMismatch'.tr());
      return;
    }
    Navigator.of(context).pop(_c1.text);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text('sec.setPin'.tr()),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _c1,
            obscureText: true,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            maxLength: 8,
            decoration: InputDecoration(labelText: 'sec.pinNew'.tr(), counterText: '', errorText: _error),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _c2,
            obscureText: true,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            maxLength: 8,
            decoration: InputDecoration(labelText: 'sec.pinConfirm'.tr(), counterText: ''),
            onSubmitted: (_) => _submit(),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text('common.cancel'.tr())),
        FilledButton(onPressed: _submit, child: Text('common.save'.tr())),
      ],
    );
  }
}

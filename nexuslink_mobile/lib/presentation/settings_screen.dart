import 'dart:ui' as ui;

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/protocol.dart';
import '../domain/models.dart';
import '../state/control_providers.dart';
import '../state/providers.dart';
import '../state/transfer_providers.dart';
import 'control_screen.dart';
import 'phone_remote_screen.dart';
import 'unblock_center_screen.dart';
import 'language_chips.dart';

/// الإعدادات: المظهر (داكن/فاتح/نظام)، اللغة (ar/en)، معلومات الهوية، حالة الخدمة.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModePrefsProvider);
    final identity = ref.watch(deviceIdentityProvider);
    final conn = ref.watch(connectionProvider).value;
    final agentState = ref.watch(agentStateProvider);
    final tx = ref.watch(txSettingsProvider);
    final cs = Theme.of(context).colorScheme;
    final lastScanLabel = tx.photoLastSyncSec <= 0
        ? '—'
        : DateTime.fromMillisecondsSinceEpoch(tx.photoLastSyncSec * 1000)
            .toIso8601String()
            .substring(0, 16)
            .replaceFirst('T', ' ');

    return Scaffold(
      appBar: AppBar(title: Text('settings.title'.tr())),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          // ==== المظهر ====
          _Header('settings.appearance'.tr()),
          Card(
            child: Column(children: [
              RadioListTile<ThemeMode>(
                value: ThemeMode.system,
                groupValue: themeMode,
                onChanged: (m) => ref.read(themeModePrefsProvider.notifier).set(m!),
                title: Text('settings.themeSystem'.tr()),
              ),
              RadioListTile<ThemeMode>(
                value: ThemeMode.light,
                groupValue: themeMode,
                onChanged: (m) => ref.read(themeModePrefsProvider.notifier).set(m!),
                title: Text('settings.themeLight'.tr()),
              ),
              RadioListTile<ThemeMode>(
                value: ThemeMode.dark,
                groupValue: themeMode,
                onChanged: (m) => ref.read(themeModePrefsProvider.notifier).set(m!),
                title: Text('settings.themeDark'.tr()),
              ),
            ]),
          ),
          const SizedBox(height: 14),

          // ==== اللغة ====
          _Header('settings.language'.tr()),
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    const Icon(Icons.translate_rounded, size: 20),
                    const SizedBox(width: 10),
                    // M1.4 (عقد §31.ب.5): اللغات الست بأسمائها الأصلية
                    Text(LanguageChips.nativeName(context.locale.languageCode), style: const TextStyle(fontWeight: FontWeight.w600)),
                  ]),
                  const SizedBox(height: 10),
                  LanguageChips(
                    current: context.locale,
                    onSelect: (l) async => await context.setLocale(l),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),

          // ==== نقل الملفات (إعدادات المرحلة الجديدة) ====
          _Header('settings.transfers'.tr()),
          Card(
            child: Column(children: [
              SwitchListTile(
                secondary: const Icon(Icons.verified_user_rounded),
                title: Text('tx.autoAcceptTitle'.tr()),
                subtitle: Text('tx.autoAcceptSubtitle'.tr(), style: const TextStyle(fontSize: 12)),
                value: tx.autoAcceptTrusted,
                onChanged: (v) => ref
                    .read(txSettingsProvider.notifier)
                    .update(tx.copyWith(autoAcceptTrusted: v)),
              ),
              SwitchListTile(
                secondary: const Icon(Icons.content_copy_rounded),
                title: Text('tx.autoCopyTitle'.tr()),
                subtitle: Text('tx.autoCopySubtitle'.tr(), style: const TextStyle(fontSize: 12)),
                value: tx.autoCopyText,
                onChanged: (v) =>
                    ref.read(txSettingsProvider.notifier).update(tx.copyWith(autoCopyText: v)),
              ),
              SwitchListTile(
                secondary: const Icon(Icons.photo_camera_back_rounded),
                title: Text('tx.photoSyncTitle'.tr()),
                subtitle: Text('tx.photoSyncSubtitle'.tr(), style: const TextStyle(fontSize: 12)),
                value: tx.photoSyncEnabled,
                onChanged: (v) async {
                  await ref
                      .read(txSettingsProvider.notifier)
                      .update(tx.copyWith(photoSyncEnabled: v));
                  if (v) {
                    // امسح فورًا عند التفعيل (إلا فلا يُمسح إلا عند الاتصال التالي)
                    ref.read(photoSyncControllerProvider.notifier).scanNow();
                  }
                },
              ),
              ListTile(
                dense: true,
                leading: const Icon(Icons.schedule_rounded),
                title: Text('tx.photoLastScan'.tr()),
                subtitle: Text(lastScanLabel, style: const TextStyle(fontSize: 12)),
                trailing: TextButton(
                  onPressed: tx.photoSyncEnabled
                      ? () => ref.read(photoSyncControllerProvider.notifier).scanNow()
                      : null,
                  child: Text('tx.scanNow'.tr()),
                ),
              ),
            ]),
          ),
          const SizedBox(height: 14),

          // ==== التحكم عن بعد (FA-7) ====
          _Header('settings.remote'.tr()),
          Builder(builder: (context) {
            final ctl = ref.watch(controlControllerProvider);
            return Card(
              child: Column(children: [
                ListTile(
                  leading: Icon(
                    Icons.touch_app_rounded,
                    color: ctl.isActive ? cs.error : cs.primary,
                  ),
                  title: Text(
                    ctl.isActive
                        ? 'ctl.activeFrom'.tr(args: [ctl.session.name.isEmpty ? 'PC' : ctl.session.name])
                        : 'settings.remoteEntry'.tr(),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  subtitle: Text(
                    ctl.isActive ? 'settings.remoteActiveHint'.tr() : 'settings.remoteHint'.tr(),
                    style: const TextStyle(fontSize: 12),
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const ControlScreen()),
                  ),
                ),
                // الجولة 5 (عقد §24): التحكم بهاتف من هاتف آخر
                const Divider(height: 1),
                ListTile(
                  leading: Icon(Icons.phonelink_rounded, color: cs.primary),
                  title: Text(
                    'settings.p2pEntry'.tr(),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  subtitle: Text(
                    'settings.p2pHint'.tr(),
                    style: const TextStyle(fontSize: 12),
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const PhoneRemoteScreen()),
                  ),
                ),
                // الجولة 5 (عقد §25): مركز رفع القيود
                const Divider(height: 1),
                ListTile(
                  leading: Icon(Icons.lock_open_rounded, color: cs.tertiary),
                  title: Text(
                    'unblock.title'.tr(),
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  subtitle: Text(
                    'unblock.entryHint'.tr(),
                    style: const TextStyle(fontSize: 12),
                  ),
                  trailing: const Icon(Icons.chevron_right_rounded),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(builder: (_) => const UnblockCenterScreen()),
                  ),
                ),
              ]),
            );
          }),
          const SizedBox(height: 14),

          // ==== حالة الخدمة الخلفية ====
          _Header('status.service'.tr()),
          Card(
            child: ListTile(
              leading: Icon(
                agentState == AgentLinkState.online ? Icons.cloud_done_rounded : Icons.cloud_off_rounded,
                color: agentState == AgentLinkState.online ? cs.primary : cs.onSurface.withOpacity(.5),
              ),
              title: Text(agentState == AgentLinkState.online
                  ? 'settings.serviceRunning'.tr()
                  : 'settings.serviceStopped'.tr()),
              subtitle: Text(
                conn?.endpoint != null
                    ? '${conn!.serverName} · ${conn.endpoint!.key} · جسر ${NexusPorts.guard}'
                    : '—',
              ),
            ),
          ),
          const SizedBox(height: 14),

          // ==== هوية الجهاز ====
          _Header('settings.deviceInfo'.tr()),
          Card(
            child: identity.when(
              loading: () => const Padding(
                padding: EdgeInsets.all(16),
                child: LinearProgressIndicator(),
              ),
              error: (e, _) => ListTile(leading: const Icon(Icons.error_outline), title: Text('$e')),
              data: (id) => Column(children: [
                ListTile(
                  leading: const Icon(Icons.badge_rounded),
                  title: Text('settings.deviceName'.tr()),
                  subtitle: Text(id.name, textDirection: ui.TextDirection.ltr),
                ),
                ListTile(
                  leading: const Icon(Icons.fingerprint_rounded),
                  title: Text('settings.deviceId'.tr()),
                  subtitle: Text(id.stableId.isEmpty ? '—' : id.stableId, textDirection: ui.TextDirection.ltr),
                ),
                ListTile(
                  leading: const Icon(Icons.android_rounded),
                  title: const Text('OS'),
                  subtitle: Text(id.os, textDirection: ui.TextDirection.ltr),
                ),
              ]),
            ),
          ),
          const SizedBox(height: 14),

          // ==== حول ====
          _Header('settings.about'.tr()),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Text(
                'settings.aboutBody'.tr(),
                style: TextStyle(fontSize: 13, color: cs.onSurface.withOpacity(.75), height: 1.6),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Header extends StatelessWidget {
  final String text;
  const _Header(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(text, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
    );
  }
}

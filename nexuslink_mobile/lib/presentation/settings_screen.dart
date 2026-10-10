import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/protocol.dart';
import '../domain/models.dart';
import '../state/providers.dart';

/// الإعدادات: المظهر (داكن/فاتح/نظام)، اللغة (ar/en)، معلومات الهوية، حالة الخدمة.
class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final themeMode = ref.watch(themeModePrefsProvider);
    final identity = ref.watch(deviceIdentityProvider);
    final conn = ref.watch(connectionProvider).value;
    final agentState = ref.watch(agentStateProvider);
    final cs = Theme.of(context).colorScheme;

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
            child: ListTile(
              leading: const Icon(Icons.translate_rounded),
              title: Text(context.locale.languageCode == 'ar' ? 'العربية' : 'English'),
              trailing: SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'ar', label: Text('AR')),
                  ButtonSegment(value: 'en', label: Text('EN')),
                ],
                selected: {context.locale.languageCode == 'ar' ? 'ar' : 'en'},
                onSelectionChanged: (sel) async {
                  await context.setLocale(Locale(sel.first));
                },
              ),
            ),
          ),
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
                  subtitle: Text(id.name, textDirection: TextDirection.ltr),
                ),
                ListTile(
                  leading: const Icon(Icons.fingerprint_rounded),
                  title: Text('settings.deviceId'.tr()),
                  subtitle: Text(id.stableId.isEmpty ? '—' : id.stableId, textDirection: TextDirection.ltr),
                ),
                ListTile(
                  leading: const Icon(Icons.android_rounded),
                  title: const Text('OS'),
                  subtitle: Text(id.os, textDirection: TextDirection.ltr),
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

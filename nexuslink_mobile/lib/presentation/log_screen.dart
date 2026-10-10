import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../state/providers.dart';

/// سجل النشاط الحي: خطوات الاتصال + أحداث الخدمة الخلفية.
class LogScreen extends ConsumerWidget {
  const LogScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final entries = ref.watch(activityLogProvider);
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text('log.title'.tr()),
        actions: [
          if (entries.isNotEmpty)
            IconButton(
              tooltip: 'log.clear'.tr(),
              onPressed: () => ref.read(activityLogProvider.notifier).clear(),
              icon: const Icon(Icons.delete_sweep_rounded),
            ),
        ],
      ),
      body: entries.isEmpty
          ? Center(
              child: Text('log.empty'.tr(),
                  style: TextStyle(color: cs.onSurface.withOpacity(.5))),
            )
          : ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
              itemCount: entries.length,
              separatorBuilder: (_, __) => const SizedBox(height: 6),
              itemBuilder: (context, i) {
                final e = entries[i];
                final (icon, color) = switch (e.kind) {
                  'ok' => (Icons.check_circle_outline_rounded, cs.primary),
                  'warn' => (Icons.warning_amber_rounded, Colors.orange.shade700),
                  'error' => (Icons.error_outline_rounded, cs.error),
                  _ => (Icons.info_outline_rounded, cs.onSurface.withOpacity(.6)),
                };
                final hh = e.at.hour.toString().padLeft(2, '0');
                final mm = e.at.minute.toString().padLeft(2, '0');
                final ss = e.at.second.toString().padLeft(2, '0');
                return Card(
                  child: ListTile(
                    dense: true,
                    leading: Icon(icon, color: color, size: 20),
                    title: Text(e.text, style: const TextStyle(fontSize: 13.5)),
                    subtitle: Text('$hh:$mm:$ss', style: const TextStyle(fontSize: 11)),
                  ),
                );
              },
            ),
    );
  }
}

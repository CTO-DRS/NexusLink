import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/models.dart';
import '../state/providers.dart';

/// شاشة الأجهزة: قائمة حية من GET /api/devices (بولينغ كل بضع ثوانٍ).
class DevicesScreen extends ConsumerWidget {
  const DevicesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final conn = ref.watch(connectionProvider).value;
    final devices = ref.watch(devicesProvider);
    final meId = conn?.me?.id;
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text('devices.title'.tr()),
        actions: [
          IconButton(
            onPressed: () => ref.invalidate(devicesProvider),
            tooltip: 'devices.refresh'.tr(),
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: (conn?.endpoint == null)
          ? _Empty(hint: 'connect.title'.tr())
          : devices.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (e, _) => _Empty(hint: '$e'),
              data: (list) {
                if (list.isEmpty) return const _Empty(hint: null);
                return RefreshIndicator(
                  onRefresh: () async {
                    ref.invalidate(devicesProvider);
                    ref.invalidate(pairMetricsProvider); // §30: نبض قياس الاقتران مع السحب
                  },
                  child: ListView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                    itemCount: list.length + 1, // §30: بطاقة سرعة الاقتران أولًا
                    itemBuilder: (context, i) => i == 0
                        ? const _PairSpeedCard()
                        : _DeviceCard(
                            d: list[i - 1],
                            isMe: list[i - 1].id == meId,
                            cs: cs,
                          ),
                  ),
                );
              },
            ),
    );
  }
}

class _Empty extends StatelessWidget {
  final String? hint;
  const _Empty({required this.hint});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.devices_other_rounded, size: 42, color: Theme.of(context).colorScheme.onSurface.withOpacity(.35)),
            const SizedBox(height: 12),
            Text('devices.empty'.tr(), textAlign: TextAlign.center,
                style: TextStyle(color: Theme.of(context).colorScheme.onSurface.withOpacity(.6))),
            if (hint != null) ...[
              const SizedBox(height: 6),
              Text(hint!, style: const TextStyle(fontSize: 12)),
            ],
          ],
        ),
      ),
    );
  }
}

class _DeviceCard extends StatelessWidget {
  final NexusDevice d;
  final bool isMe;
  final ColorScheme cs;

  const _DeviceCard({required this.d, required this.isMe, required this.cs});

  @override
  Widget build(BuildContext context) {
    final online = d.state == 'connected';
    final icon = switch (d.kind) {
      'desktop' => Icons.computer_rounded,
      'tablet' => Icons.tablet_mac_rounded,
      'tv' => Icons.tv_rounded,
      _ => Icons.smartphone_rounded,
    };
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: Badge(
          isLabelVisible: isMe,
          label: Text('devices.thisDevice'.tr(), style: const TextStyle(fontSize: 8)),
          child: Icon(icon, size: 30, color: online ? cs.primary : cs.onSurface.withOpacity(.4)),
        ),
        title: Text(
          d.name,
          style: TextStyle(fontWeight: FontWeight.w800, color: online ? null : cs.onSurface.withOpacity(.55)),
        ),
        subtitle: Text(
          '${'devices.mode.${d.mode}'.tr()} · ${d.ip} · ${'devices.rtt'.tr()} ${d.rttMs}ms · ${d.humanStorage()}',
          maxLines: 1, overflow: TextOverflow.ellipsis,
        ),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: online ? cs.primary.withOpacity(.15) : cs.onSurface.withOpacity(.08),
                borderRadius: BorderRadius.circular(999),
              ),
              child: Text(
                'devices.state.${d.state}'.tr(),
                style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700,
                    color: online ? cs.primary : cs.onSurface.withOpacity(.6)),
              ),
            ),
            const SizedBox(height: 4),
            Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(
                d.battery > 80 ? Icons.battery_full_rounded
                    : d.battery > 40 ? Icons.battery_4_bar_rounded
                    : d.battery > 15 ? Icons.battery_2_bar_rounded
                    : Icons.battery_alert_rounded,
                size: 15,
              ),
              Text('${d.battery}%', style: const TextStyle(fontSize: 11)),
            ]),
          ],
        ),
      ),
    );
  }
}

/// §30 (M1.1): بطاقة سرعة الاقتران الفوري — إجمالي آخر اقتران مكتمل
/// (من إصدار QR إلى أول قيمة) بلون العتبة التعاقدية 30 ثانية.
class _PairSpeedCard extends ConsumerWidget {
  const _PairSpeedCard();

  String _fmtMs(double? v) {
    if (v == null) return '—';
    if (v >= 1000) return '${(v / 1000).toStringAsFixed(1)}s';
    return '${v.round()}ms';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final st = ref.watch(pairMetricsProvider).value ?? const PairMetricsStats();
    final cs = Theme.of(context).colorScheme;
    final pass = st.lastTotalMs != null && st.lastTotalMs! < PairTarget.ms;
    final color = st.lastTotalMs == null
        ? cs.onSurface.withOpacity(.55)
        : pass
            ? Colors.green.shade400
            : Colors.orange.shade400;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.bolt_rounded, size: 16, color: color),
                const SizedBox(width: 6),
                Text('pair.speed.title'.tr(),
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: cs.onSurface)),
                const Spacer(),
                Text(
                  st.lastTotalMs != null
                      ? 'pair.speed.last'.tr(namedArgs: {'v': _fmtMs(st.lastTotalMs)})
                      : 'pair.speed.wait'.tr(),
                  style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: color),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Text(
              'pair.speed.detail'.tr(namedArgs: {
                'n': '${st.completed}',
                'p95': _fmtMs(st.p95Ms),
                'max': _fmtMs(st.maxMs),
                'rate': st.passRate != null ? '${(st.passRate! * 100).round()}%' : '—',
              }),
              style: TextStyle(fontSize: 10.5, color: cs.onSurface.withOpacity(.6)),
            ),
          ],
        ),
      ),
    );
  }
}

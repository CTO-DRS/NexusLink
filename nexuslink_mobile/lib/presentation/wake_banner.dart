import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/models.dart' show AgentLinkState;
import '../state/controller_providers.dart';
import '../state/providers.dart';

/// FA-power (عقد §12) — شاشة «الكمبيوتر نائم — إيقاظ؟» بضغطة واحدة.
///
/// تظهر بارزة أعلى الهيكل عندما: القناة الخلفية/الاتصال غير متاح
/// AND عنوان MAC للكمبيوتر معلن سابقًا (يُعلن عند كل اتصال عبر rc:hello
/// ويُخزَّن محليًا). زر «إيقاظ» واحد يرسل الحزمة السحرية مباشرة عبر
/// UDP broadcast (255.255.255.255:9 + broadcast الشبكة الفرعية) ثم يعيد
/// محاولة الاتصال تلقائيًا — «يستيقظ ويتصل تلقائيًا».
class WakeBanner extends ConsumerStatefulWidget {
  const WakeBanner({super.key});

  @override
  ConsumerState<WakeBanner> createState() => _WakeBannerState();
}

class _WakeBannerState extends ConsumerState<WakeBanner> {
  bool _sending = false;
  bool _waiting = false;

  Future<void> _wake() async {
    if (_sending) return;
    setState(() {
      _sending = true;
      _waiting = false;
    });
    final conn = ref.read(connectionProvider).value;
    final host = conn?.endpoint?.host;
    try {
      final sent = await ref.read(controllerControllerProvider.notifier).wakeDirect(serverHost: host);
      if (!mounted) return;
      if (sent > 0) {
        setState(() {
          _sending = false;
          _waiting = true;
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('wake.sent'.tr()), duration: const Duration(seconds: 4)),
        );
        // «يستيقظ ويتصل تلقائيًا» — نمنح الكمبيوتر فرصة للإقلاع ثم نعيد المحاولة
        await Future<void>.delayed(const Duration(seconds: 6));
        if (!mounted) return;
        final ok = await ref.read(connectionProvider.notifier).reconnect();
        if (!mounted) return;
        setState(() => _waiting = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(ok ? 'wake.awake'.tr() : 'wake.still'.tr()),
            duration: const Duration(seconds: 5),
          ),
        );
      } else {
        setState(() => _sending = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('wake.fail'.tr()), duration: const Duration(seconds: 4)),
        );
      }
    } catch (_) {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // تفاعلية كاملة: إعادة البناء مع كل تغيّر في حالة القناة/الاتصال/MAC المحفوظ
    final AgentLinkState link = ref.watch(agentStateProvider);
    final conn = ref.watch(connectionProvider).value;
    final mac = ref.watch(storedDesktopMacProvider).valueOrNull ?? '';
    final linkDown = link == AgentLinkState.offline || link == AgentLinkState.reconnecting;
    final noServer = conn?.isOnline != true;
    final offline = (linkDown || noServer) && conn?.endpoint != null;
    final show = offline && mac.isNotEmpty;
    if (!show) return const SizedBox.shrink();
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
      child: Card(
        color: cs.tertiaryContainer,
        elevation: 2,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(children: [
                Icon(Icons.nightlight_round, color: cs.onTertiaryContainer),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'wake.title'.tr(),
                        style: TextStyle(
                          fontWeight: FontWeight.w900,
                          fontSize: 15,
                          color: cs.onTertiaryContainer,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        'wake.subtitle'.tr(),
                        style: TextStyle(fontSize: 12, color: cs.onTertiaryContainer.withOpacity(.85)),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        '${'wake.mac'.tr()}: $mac',
                        style: const TextStyle(fontSize: 11, fontFamily: 'monospace'),
                      ),
                    ],
                  ),
                ),
              ]),
              const SizedBox(height: 12),
              FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: cs.tertiary,
                  foregroundColor: cs.onTertiary,
                ),
                onPressed: _sending ? null : _wake,
                icon: _sending || _waiting
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.bolt_rounded),
                label: Text(
                  _sending
                      ? 'wake.sending'.tr()
                      : _waiting
                          ? 'wake.sent'.tr()
                          : 'wake.action'.tr(),
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../state/control_providers.dart';
import '../state/transfer_providers.dart' show nativeBridgeProvider;

/// شاشة التحكم عن بعد (FA-7 — بديل AirMirror) في تطبيق الهاتف:
///  · البند 5: إرشاد تفعيل خدمة الإتاحة بخطوات عربية + فتح الإعدادات مباشرة
///  · البند 6: مؤشر حالة «التحكم مفعّل من: [جهاز]» + زر قطع فوري
///  · البند 7: إعداد طلب تأكيد عند بدء كل جلسة
class ControlScreen extends ConsumerStatefulWidget {
  const ControlScreen({super.key});

  @override
  ConsumerState<ControlScreen> createState() => _ControlScreenState();
}

class _ControlScreenState extends ConsumerState<ControlScreen> {
  @override
  void initState() {
    super.initState();
    // مزامنة حالة الإتاحة عند فتح الشاشة (قد فعّلها المستخدم للتو من الإعدادات)
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(accessibilityProvider.notifier).refresh();
    });
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final ctl = ref.watch(controlControllerProvider);
    final acc = ref.watch(accessibilityProvider);

    return Scaffold(
      appBar: AppBar(title: Text('ctl.title'.tr())),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          // ==== مؤشر حالة الجلسة (البند 6) ====
          if (ctl.isActive) ...[
            Card(
              color: cs.errorContainer,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.touch_app_rounded, color: cs.onErrorContainer),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            'ctl.activeFrom'.tr(args: [ctl.session.name.isEmpty ? 'PC' : ctl.session.name]),
                            style: TextStyle(fontWeight: FontWeight.w800, color: cs.onErrorContainer),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: cs.error,
                        foregroundColor: cs.onError,
                      ),
                      onPressed: () => ref.read(controlControllerProvider.notifier).stopNow(),
                      icon: const Icon(Icons.link_off_rounded),
                      label: Text('ctl.cutNow'.tr()),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
          ],

          // ==== طلب تحكم ينتظر القرار (البند 7) ====
          if (ctl.pending != null) ...[
            Card(
              color: cs.secondaryContainer,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(children: [
                      Icon(Icons.screen_share_rounded, color: cs.onSecondaryContainer),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'ctl.requestFrom'.tr(args: [ctl.pending!.name]),
                          style: TextStyle(fontWeight: FontWeight.w800, color: cs.onSecondaryContainer),
                        ),
                      ),
                    ]),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Expanded(
                          child: FilledButton.icon(
                            onPressed: () => ref.read(controlControllerProvider.notifier).decide(true),
                            icon: const Icon(Icons.check_rounded),
                            label: Text('ctl.allow'.tr()),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => ref.read(controlControllerProvider.notifier).decide(false),
                            icon: const Icon(Icons.close_rounded),
                            label: Text('ctl.deny'.tr()),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
          ],

          // ==== خدمة الإتاحة (البند 5: الإرشاد) ====
          _Header('ctl.accessibilityTitle'.tr()),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: acc.when(
                loading: () => const Padding(
                  padding: EdgeInsets.all(12),
                  child: LinearProgressIndicator(),
                ),
                error: (e, _) => ListTile(leading: const Icon(Icons.error_outline), title: Text('$e')),
                data: (a) {
                  final ready = a.enabled || a.ready;
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Icon(
                            ready ? Icons.verified_rounded : Icons.info_outline_rounded,
                            color: ready ? Colors.green : cs.tertiary,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              ready ? 'ctl.accEnabled'.tr() : 'ctl.accDisabled'.tr(),
                              style: const TextStyle(fontWeight: FontWeight.w800),
                            ),
                          ),
                        ],
                      ),
                      if (!ready) ...[
                        const SizedBox(height: 10),
                        Text('ctl.accSteps'.tr(), style: const TextStyle(fontSize: 13, height: 1.7)),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: () {
                            ref.read(nativeBridgeProvider).openAccessibilitySettings();
                            // تحقّق بعد عودة المستخدم من الإعدادات الخارجية
                            Future.delayed(const Duration(seconds: 3), () {
                              if (!mounted) return;
                              ref.read(accessibilityProvider.notifier).refresh();
                            });
                          },
                          icon: const Icon(Icons.settings_rounded),
                          label: Text('ctl.openAccSettings'.tr()),
                        ),
                      ],
                    ],
                  );
                },
              ),
            ),
          ),
          const SizedBox(height: 14),

          // ==== إعدادات الأمان (البند 7) ====
          _Header('ctl.securityTitle'.tr()),
          Card(
            child: Column(children: [
              SwitchListTile(
                secondary: const Icon(Icons.verified_user_rounded),
                title: Text('ctl.confirmTitle'.tr()),
                subtitle: Text(
                  'ctl.confirmSubtitle'.tr(),
                  style: const TextStyle(fontSize: 12),
                ),
                value: ctl.session.requireConfirm,
                onChanged: (v) =>
                    ref.read(controlControllerProvider.notifier).setRequireConfirm(v),
              ),
              ListTile(
                leading: const Icon(Icons.shield_rounded),
                title: Text('ctl.trustedTitle'.tr()),
                subtitle: Text(
                  'ctl.trustedSubtitle'.tr(),
                  style: const TextStyle(fontSize: 12),
                ),
              ),
            ]),
          ),
          const SizedBox(height: 14),

          // ==== كيف يعمل؟ ====
          _Header('ctl.howTitle'.tr()),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Text(
                'ctl.howBody'.tr(),
                style: TextStyle(fontSize: 13, height: 1.7, color: cs.onSurface.withOpacity(.78)),
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

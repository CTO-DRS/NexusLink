import 'dart:async';

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/native_bridge.dart';
import '../state/transfer_providers.dart' show nativeBridgeProvider;

/// الجولة 5 (عقد §25) — «مركز رفع القيود».
///
/// أندرويد 13+ (Tiramisu) يمنع تفعيل خدمة الإتاحة للتطبيقات المثبتة من خارج
/// متجر (APK) افتراضيًا — قيد «الإعدادات المقيّدة» (AppOps
/// android:access_restricted_settings — تحقق حرفي من AOSP AppOpsManager +
/// RestrictedPreferenceHelper: MODE_ERRORED = مقيّد). مسار الفك الرسمي:
/// صفحة التطبيق (App Info) ← قائمة ⋮ ← «السماح بالإعدادات المقيّدة».
/// لا يوجد Intent عام يفتح قائمة ⋮ نفسها — فالواجهة تقود المستخدم خطوة
/// خطوة، مع زر يفتح صفحة التطبيق مباشرة (ACTION_APPLICATION_DETAILS_SETTINGS)
/// وزر يفتح إعدادات الإتاحة بعد الفك (ACTION_ACCESSIBILITY_SETTINGS).
class UnblockCenterScreen extends ConsumerStatefulWidget {
  const UnblockCenterScreen({super.key});

  @override
  ConsumerState<UnblockCenterScreen> createState() => _UnblockCenterScreenState();
}

class _UnblockCenterScreenState extends ConsumerState<UnblockCenterScreen> {
  Timer? _poll;
  CtlAccessibility _acc = const CtlAccessibility();
  ({bool restricted, bool checked}) _restricted = (restricted: false, checked: false);

  @override
  void initState() {
    super.initState();
    _refresh();
    // فحص دوري خفيف: المستخدم ربما فك القيد وفعّل الإتاحة الآن
    _poll = Timer.periodic(const Duration(seconds: 2), (_) => _refresh());
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    final native = ref.read(nativeBridgeProvider);
    final acc = await native.accessibilityStatus();
    final restricted = await native.restrictedSettingsStatus();
    if (!mounted) return;
    setState(() {
      _acc = acc;
      _restricted = restricted;
    });
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final native = ref.read(nativeBridgeProvider);
    final ready = _acc.enabled || _acc.ready;

    return Scaffold(
      appBar: AppBar(title: Text('unblock.title'.tr())),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          // ==== الحالة الحية ====
          Card(
            color: ready ? Colors.green.withOpacity(.10) : cs.errorContainer,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(children: [
                Icon(
                  ready ? Icons.verified_rounded : Icons.gpp_maybe_rounded,
                  size: 30,
                  color: ready ? Colors.green : cs.onErrorContainer,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        ready ? 'unblock.statusFree'.tr() : 'unblock.statusBlocked'.tr(),
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          color: ready ? null : cs.onErrorContainer,
                        ),
                      ),
                      if (!ready && _restricted.checked && _restricted.restricted) ...[
                        const SizedBox(height: 3),
                        Text(
                          'unblock.restrictedDetected'.tr(),
                          style: TextStyle(fontSize: 12, color: cs.onErrorContainer.withOpacity(.85)),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                const SizedBox(
                  width: 16, height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ]),
            ),
          ),
          const SizedBox(height: 14),

          // ==== الشرح ====
          Text('unblock.explainTitle'.tr(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 6),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Text(
                'unblock.explainBody'.tr(),
                style: TextStyle(fontSize: 13, height: 1.75, color: cs.onSurface.withOpacity(.8)),
              ),
            ),
          ),
          const SizedBox(height: 14),

          // ==== الخطوات الأربع ====
          Text('unblock.stepsTitle'.tr(), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
          const SizedBox(height: 6),
          _step(
            cs,
            n: 1,
            title: 'unblock.step1'.tr(),
            body: 'unblock.step1Body'.tr(),
            button: FilledButton.icon(
              onPressed: () {
                native.openAppDetails();
                HapticFeedback.selectionClick();
              },
              icon: const Icon(Icons.settings_applications_rounded),
              label: Text('unblock.openAppInfo'.tr()),
            ),
          ),
          _step(
            cs,
            n: 2,
            title: 'unblock.step2'.tr(),
            body: 'unblock.step2Body'.tr(),
          ),
          _step(
            cs,
            n: 3,
            title: 'unblock.step3'.tr(),
            body: 'unblock.step3Body'.tr(),
          ),
          _step(
            cs,
            n: 4,
            title: 'unblock.step4'.tr(),
            body: 'unblock.step4Body'.tr(),
            button: OutlinedButton.icon(
              onPressed: () {
                native.openAccessibilitySettings();
                HapticFeedback.selectionClick();
              },
              icon: const Icon(Icons.accessibility_new_rounded),
              label: Text('ctl.openAccSettings'.tr()),
            ),
          ),
          const SizedBox(height: 14),

          // ==== ملاحظة صادقة عن حدود الفحص الآلي ====
          if (!_restricted.checked)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Icon(Icons.info_outline_rounded, size: 18, color: cs.tertiary),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'unblock.detectLimitation'.tr(),
                      style: TextStyle(fontSize: 11.5, height: 1.6, color: cs.onSurface.withOpacity(.65)),
                    ),
                  ),
                ]),
              ),
            ),
        ],
      ),
    );
  }

  Widget _step(
    ColorScheme cs, {
    required int n,
    required String title,
    required String body,
    Widget? button,
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              CircleAvatar(
                radius: 12,
                backgroundColor: cs.primary,
                child: Text(
                  '$n',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w900, color: Colors.white),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(title, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 13.5)),
              ),
            ]),
            const SizedBox(height: 8),
            Text(body, style: TextStyle(fontSize: 12.5, height: 1.7, color: cs.onSurface.withOpacity(.75))),
            if (button != null) ...[
              const SizedBox(height: 10),
              button,
            ],
          ],
        ),
      ),
    );
  }
}

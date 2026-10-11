import 'dart:ui' as ui;

import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'core/theme.dart';
import 'presentation/lock_screen.dart';
import 'presentation/onboarding_screen.dart';
import 'presentation/shell.dart';
import 'state/providers.dart';
import 'state/security_providers.dart';
import 'state/transfer_providers.dart';

/// جذر التطبيق: الثيمان (داكن/فاتح) بنفس ألوان نسخة الويب + RTL كامل من اليوم الأول.
/// يدير أيضًا دورة حياة الواجهة: الخدمة الخلفية تعرف أن الواجهة حية (setUiAlive)
/// لتبث أحداث النصوص/الروابط بدل الإشعارات، وتسحب المشاركات المعلقة عند العودة.
///
/// FA-10: بوابة الأمان — Onboarding أول تشغيل ← وضع الفقدان ← قفل التطبيق ← Shell.
class NexusApp extends ConsumerStatefulWidget {
  const NexusApp({super.key});
  @override
  ConsumerState<NexusApp> createState() => _NexusAppState();
}

class _NexusAppState extends ConsumerState<NexusApp> with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final native = ref.read(nativeBridgeProvider);
    switch (state) {
      case AppLifecycleState.resumed:
        native.setUiAlive(true);
        // اسحب أي مشاركات/صور تراكمت أثناء الغياب
        ref.read(shareIntakeProvider.notifier).drain();
        ref.read(photoSyncControllerProvider.notifier).scanNow();
        // FA-10: قفل تلقائي عند العودة إن تجاوزت مهلة الخلفية
        ref.read(appLockProvider.notifier).markResumed();
      case AppLifecycleState.paused:
      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
        native.setUiAlive(false);
        // FA-10: ابدأ عدّ مهلة القفل التلقائي (0 = قفل فوري)
        ref.read(appLockProvider.notifier).markPaused();
      case AppLifecycleState.inactive:
        break;
    }
  }

  @override
  Widget build(BuildContext context) {
    final themeMode = ref.watch(themeModePrefsProvider);
    return MaterialApp(
      title: 'NexusLink',
      debugShowCheckedModeBanner: false,
      theme: NexusTheme.light(),
      darkTheme: NexusTheme.dark(),
      themeMode: themeMode,

      // easy_localization: مفاتيح الترجمة + اللغة الحالية
      locale: context.locale,
      supportedLocales: context.supportedLocales,
      localizationsDelegates: context.localizationDelegates,

      // فرض الاتجاه صراحة: عربي = RTL، إنجليزي = LTR (مطابق لسلوك الويب)
      builder: (context, child) {
        final rtl = context.locale.languageCode == 'ar';
        return Directionality(
          textDirection: rtl ? ui.TextDirection.rtl : ui.TextDirection.ltr,
          child: child ?? const SizedBox.shrink(),
        );
      },

      // FA-10: بوابة الأمان — Onboarding أول تشغيل ← وضع الفقدان ← قفل التطبيق ← Shell
      home: const AnimatedSwitcher(
        duration: Duration(milliseconds: 220),
        child: _SecurityGate(key: ValueKey('gate')),
      ),
    );
  }
}

/// البوابة: أولوية Onboarding ← وضع الفقدان ← القفل ← الواجهة الكاملة.
class _SecurityGate extends ConsumerWidget {
  const _SecurityGate({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final onboardingDone = ref.watch(onboardingDoneProvider);
    if (!onboardingDone) return const OnboardingScreen();

    final lost = ref.watch(lostProvider);
    if (lost.active) {
      return LostGate(message: lost.message);
    }

    final locked = ref.watch(appLockProvider);
    if (locked) return const LockScreen();

    return const NexusShell();
  }
}

/// قراءة علم Onboarding من prefs — تُستدعى من main() قبل runApp.
Future<bool> readOnboardingDone() async {
  try {
    final p = await SharedPreferences.getInstance();
    return p.getBool('nexus.onboarding.done') ?? false;
  } catch (_) {
    return false;
  }
}

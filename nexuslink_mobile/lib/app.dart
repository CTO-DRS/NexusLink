import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme.dart';
import 'presentation/shell.dart';
import 'state/providers.dart';

/// جذر التطبيق: الثيمان (داكن/فاتح) بنفس ألوان نسخة الويب + RTL كامل من اليوم الأول.
class NexusApp extends ConsumerWidget {
  const NexusApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
          textDirection: rtl ? TextDirection.rtl : TextDirection.ltr,
          child: child ?? const SizedBox.shrink(),
        );
      },

      home: const NexusShell(),
    );
  }
}

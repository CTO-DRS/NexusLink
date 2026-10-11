import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'state/security_providers.dart' show onboardingDoneProvider;

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // easy_localization: العربية افتراضيًا مع RTL كامل من اليوم الأول
  await EasyLocalization.ensureInitialized();

  // FA-10: علم Onboarding قبل أول إطار (تفادي الوميض)
  final onboardingDone = await readOnboardingDone();

  // شريط الحالة بنمط الحواف الكاملة
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);

  runApp(
    EasyLocalization(
      supportedLocales: const [Locale('ar'), Locale('en')],
      path: 'assets/translations',
      fallbackLocale: const Locale('ar'),
      startLocale: const Locale('ar'),
      saveLocale: true,
      child: ProviderScope(
        overrides: [
          onboardingDoneProvider.overrideWith((ref) => onboardingDone),
        ],
        child: const NexusApp(),
      ),
    ),
  );
}

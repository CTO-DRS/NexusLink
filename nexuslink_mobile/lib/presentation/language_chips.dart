import 'package:flutter/material.dart';
import 'package:easy_localization/easy_localization.dart';

/// M1.4 (عقد §31.ب.5): منتقي اللغات الست المشترك — رقائق اختيار بأسماء أصلية.
class LanguageChips extends StatelessWidget {
  final Locale current;
  final ValueChanged<Locale> onSelect;

  const LanguageChips({super.key, required this.current, required this.onSelect});

  static const Map<String, String> _langs = <String, String>{
    'ar': 'العربية',
    'en': 'English',
    'fr': 'Français',
    'es': 'Español',
    'de': 'Deutsch',
    'ru': 'Русский',
  };

  /// الاسم الأصلي للغة بالرمز (افتراضي: الرمز نفسه).
  static String nativeName(String code) => _langs[code] ?? code;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: _langs.entries.map((e) {
        final sel = current.languageCode == e.key;
        return ChoiceChip(
          label: Text(e.value),
          selected: sel,
          onSelected: (_) => onSelect(Locale(e.key)),
        );
      }).toList(),
    );
  }
}

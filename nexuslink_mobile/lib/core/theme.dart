import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// نظام تصميم NexusLink المطابق لنسخة الويب حرفيًا.
/// الألوان محوَّلة من متغيرات oklch في src/app/globals.css
/// (scripts/oklch-to-hex.mjs) — لا تغيير بديهي.
class NexusColors {
  NexusColors._();

  // ---- Light (من :root في globals.css) ----
  static const Color lightBackground = Color(0xFFF4FAF8);
  static const Color lightForeground = Color(0xFF0F1D1E);
  static const Color lightCard = Color(0xFFFFFFFF);
  static const Color lightPrimary = Color(0xFF009B8F);
  static const Color lightPrimaryFg = Color(0xFFFCFCFC);
  static const Color lightSecondary = Color(0xFFE8F3F0);
  static const Color lightSecondaryFg = Color(0xFF1B3234);
  static const Color lightMuted = Color(0xFFE8F3F0);
  static const Color lightMutedFg = Color(0xFF566768);
  static const Color lightAccent = Color(0xFFD7F2EC);
  static const Color lightAccentFg = Color(0xFF144340);
  static const Color lightDestructive = Color(0xFFDC252F);
  static const Color lightBorder = Color(0xFFD6E1DE);
  static const Color lightInput = Color(0xFFD6E1DE);
  static const Color lightRing = Color(0xFF009B8F);

  // ---- Dark (من .dark في globals.css) ----
  static const Color darkBackground = Color(0xFF081114);
  static const Color darkForeground = Color(0xFFE9F0EF);
  static const Color darkCard = Color(0xFF101C1F);
  static const Color darkPopover = Color(0xFF121E21);
  static const Color darkPrimary = Color(0xFF2EB5A4);
  static const Color darkPrimaryFg = Color(0xFF040F13);
  static const Color darkSecondary = Color(0xFF1B292D);
  static const Color darkSecondaryFg = Color(0xFFE9F0EF);
  static const Color darkMuted = Color(0xFF1B292D);
  static const Color darkMutedFg = Color(0xFF8E9B9C);
  static const Color darkAccent = Color(0xFF1B3234);
  static const Color darkAccentFg = Color(0xFFE9F0EF);
  static const Color darkDestructive = Color(0xFFED5350);
  static const Color darkBorder = Color(0x1AFFFFFF); // 10% white
  static const Color darkInput = Color(0x24FFFFFF); // 14% white
  static const Color darkRing = Color(0xFF2EB5A4);
}

/// نصف القطر الموحد: --radius: 0.75rem → 12px (المكوّنات الكبيرة).
const double kRadius = 12;

class NexusTheme {
  NexusTheme._();

  static TextTheme _textTheme(ColorScheme cs) => GoogleFonts.ibmPlexSansArabicTextTheme(
        ThemeData(brightness: cs.brightness).textTheme,
      );

  static ThemeData light() {
    const cs = ColorScheme.light(
      primary: NexusColors.lightPrimary,
      onPrimary: NexusColors.lightPrimaryFg,
      secondary: NexusColors.lightSecondary,
      onSecondary: NexusColors.lightSecondaryFg,
      surface: NexusColors.lightCard,
      onSurface: NexusColors.lightForeground,
      error: NexusColors.lightDestructive,
      outline: NexusColors.lightBorder,
    );
    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      colorScheme: cs,
      scaffoldBackgroundColor: NexusColors.lightBackground,
    );
    return base.copyWith(
      textTheme: _textTheme(cs),
      appBarTheme: AppBarTheme(
        backgroundColor: NexusColors.lightBackground,
        foregroundColor: NexusColors.lightForeground,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: GoogleFonts.ibmPlexSansArabic(
          fontSize: 18, fontWeight: FontWeight.w700, color: NexusColors.lightForeground,
        ),
      ),
      cardTheme: CardTheme(
        color: NexusColors.lightCard,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(kRadius),
          side: const BorderSide(color: NexusColors.lightBorder),
        ),
        margin: EdgeInsets.zero,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: NexusColors.lightCard,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(kRadius),
          borderSide: const BorderSide(color: NexusColors.lightInput),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(kRadius),
          borderSide: const BorderSide(color: NexusColors.lightInput),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(kRadius),
          borderSide: const BorderSide(color: NexusColors.lightRing, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: NexusColors.lightPrimary,
          foregroundColor: NexusColors.lightPrimaryFg,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadius)),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          textStyle: GoogleFonts.ibmPlexSansArabic(fontWeight: FontWeight.w700, fontSize: 14),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: NexusColors.lightSecondaryFg,
          side: const BorderSide(color: NexusColors.lightBorder),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadius)),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        ),
      ),
      chipTheme: base.chipTheme.copyWith(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      dividerTheme: const DividerThemeData(color: NexusColors.lightBorder, thickness: 1),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: NexusColors.lightForeground,
        contentTextStyle: GoogleFonts.ibmPlexSansArabic(color: NexusColors.lightBackground),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: NexusColors.lightCard,
        selectedItemColor: NexusColors.lightPrimary,
        unselectedItemColor: NexusColors.lightMutedFg,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
    );
  }

  static ThemeData dark() {
    const cs = ColorScheme.dark(
      primary: NexusColors.darkPrimary,
      onPrimary: NexusColors.darkPrimaryFg,
      secondary: NexusColors.darkSecondary,
      onSecondary: NexusColors.darkSecondaryFg,
      surface: NexusColors.darkCard,
      onSurface: NexusColors.darkForeground,
      error: NexusColors.darkDestructive,
      outline: NexusColors.darkBorder,
    );
    final base = ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: cs,
      scaffoldBackgroundColor: NexusColors.darkBackground,
    );
    return base.copyWith(
      textTheme: _textTheme(cs),
      appBarTheme: AppBarTheme(
        backgroundColor: NexusColors.darkBackground,
        foregroundColor: NexusColors.darkForeground,
        elevation: 0,
        centerTitle: false,
        titleTextStyle: GoogleFonts.ibmPlexSansArabic(
          fontSize: 18, fontWeight: FontWeight.w700, color: NexusColors.darkForeground,
        ),
      ),
      cardTheme: CardTheme(
        color: NexusColors.darkCard,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(kRadius),
          side: const BorderSide(color: NexusColors.darkBorder),
        ),
        margin: EdgeInsets.zero,
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: NexusColors.darkPopover,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(kRadius),
          borderSide: const BorderSide(color: NexusColors.darkBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(kRadius),
          borderSide: const BorderSide(color: NexusColors.darkBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(kRadius),
          borderSide: const BorderSide(color: NexusColors.darkRing, width: 2),
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: NexusColors.darkPrimary,
          foregroundColor: NexusColors.darkPrimaryFg,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadius)),
          padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 12),
          textStyle: GoogleFonts.ibmPlexSansArabic(fontWeight: FontWeight.w700, fontSize: 14),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: NexusColors.darkSecondaryFg,
          side: const BorderSide(color: NexusColors.darkBorder),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(kRadius)),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        ),
      ),
      chipTheme: base.chipTheme.copyWith(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      ),
      dividerTheme: const DividerThemeData(color: NexusColors.darkBorder, thickness: 1),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: NexusColors.darkPopover,
        contentTextStyle: GoogleFonts.ibmPlexSansArabic(color: NexusColors.darkForeground),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: NexusColors.darkCard,
        selectedItemColor: NexusColors.darkPrimary,
        unselectedItemColor: NexusColors.darkMutedFg,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'tokens.dart';

/// Light / dark / follow-the-device, persisted. Settings shows the switch; a
/// module never needs to touch it (read colours through `context.colors`).
class ThemeController extends ChangeNotifier {
  ThemeController(this._prefs) {
    final stored = _prefs.getString(_key);
    _mode = switch (stored) {
      'light' => ThemeMode.light,
      'dark' => ThemeMode.dark,
      _ => ThemeMode.system,
    };
  }

  static const _key = 'box.theme';
  final SharedPreferences _prefs;
  late ThemeMode _mode;

  ThemeMode get mode => _mode;

  void setMode(ThemeMode mode) {
    _mode = mode;
    _prefs.setString(_key, switch (mode) {
      ThemeMode.light => 'light',
      ThemeMode.dark => 'dark',
      ThemeMode.system => 'system',
    });
    notifyListeners();
  }
}

/// Test seam: widget tests set this false so the theme uses the default font
/// instead of fetching Inter over the network.
@visibleForTesting
bool debugBoxUseGoogleFonts = true;

TextTheme _textTheme(BoxColors c) {
  // interTextTheme() with no argument is built on the LIGHT Typography, so
  // every style it carries is near-black. Only the styles copyWith'd below get
  // a colour, which left the rest invisible on our near-black dark bg - most
  // visibly bodyLarge, the style TextField uses for the text you type.
  final fonts = debugBoxUseGoogleFonts;
  final base = (fonts ? GoogleFonts.interTextTheme() : Typography.material2021().black).apply(
    bodyColor: c.fg1,
    displayColor: c.fg1,
  );
  TextStyle t(
    double size,
    double height, {
    FontWeight weight = FontWeight.w400,
    double spacing = 0,
    Color? color,
  }) {
    final style = TextStyle(
      fontSize: size,
      height: height / size,
      fontWeight: weight,
      letterSpacing: spacing,
      color: color ?? c.fg1,
    );
    return fonts ? GoogleFonts.inter(textStyle: style) : style;
  }
  return base.copyWith(
    // display-md 24/32 -0.02em: the page h1.
    headlineMedium: t(24, 32, weight: FontWeight.w600, spacing: -0.48),
    // display-sm 20/28
    headlineSmall: t(20, 28, weight: FontWeight.w600, spacing: -0.4),
    // heading-3 16/24
    titleMedium: t(16, 24, weight: FontWeight.w600),
    // body 15/24 (the app default)
    bodyMedium: t(15, 24),
    // body-sm 13/20
    bodySmall: t(13, 20, color: c.fg2),
    // label 12/16 +0.02em
    labelSmall: t(12, 16, weight: FontWeight.w500, spacing: 0.24, color: c.fg3),
    labelMedium: t(12, 16, weight: FontWeight.w500, spacing: 0.24),
  );
}

/// The app theme for [brightness]. [accent] is the Box's `brand.themeColor`
/// (null keeps the Box indigo).
ThemeData boxTheme(Brightness brightness, {Color? accent}) {
  final c = (brightness == Brightness.dark ? BoxColors.dark : BoxColors.light)
      .withAccent(accent, brightness);
  final text = _textTheme(c);
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    scaffoldBackgroundColor: c.bg,
    canvasColor: c.bg,
    splashFactory: InkSparkle.splashFactory,
    colorScheme: ColorScheme(
      brightness: brightness,
      primary: c.accent,
      onPrimary: c.accentFg,
      secondary: c.accentDim,
      onSecondary: c.accentFg,
      error: c.danger,
      onError: Colors.white,
      surface: c.bg,
      onSurface: c.fg1,
      surfaceContainerHighest: c.surface,
      outline: c.border,
      outlineVariant: c.borderLight,
    ),
    textTheme: text,
    extensions: [c],
    appBarTheme: AppBarTheme(
      backgroundColor: c.bg,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: text.headlineSmall,
      iconTheme: IconThemeData(color: c.fg2, size: 20),
      systemOverlayStyle: brightness == Brightness.dark
          ? SystemUiOverlayStyle.light
          : SystemUiOverlayStyle.dark,
      shape: Border(bottom: BorderSide(color: c.border)),
    ),
    dividerTheme: DividerThemeData(color: c.border, thickness: 1, space: 1),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: c.accent,
        foregroundColor: c.accentFg,
        minimumSize: const Size(64, 36),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BoxRadius.md),
        ),
        textStyle: text.bodySmall?.copyWith(fontWeight: FontWeight.w500),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: c.accent,
        minimumSize: const Size(48, 32),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(BoxRadius.md),
        ),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.bg,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      hintStyle: text.bodyMedium?.copyWith(color: c.fg4),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BoxRadius.lg),
        borderSide: BorderSide(color: c.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(BoxRadius.lg),
        borderSide: BorderSide(color: c.accent),
      ),
    ),
    listTileTheme: ListTileThemeData(iconColor: c.fg3, textColor: c.fg1),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: c.surface,
      contentTextStyle: text.bodySmall?.copyWith(color: c.fg1),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BoxRadius.md),
        side: BorderSide(color: c.border),
      ),
      behavior: SnackBarBehavior.floating,
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: c.accent),
  );
}

extension BoxThemeContext on BuildContext {
  /// The Box colour tokens for the current brightness: `context.colors.fg3`.
  BoxColors get colors => Theme.of(this).extension<BoxColors>()!;

  /// The text theme: `context.text.bodySmall`.
  TextTheme get text => Theme.of(this).textTheme;

  bool get isDark => Theme.of(this).brightness == Brightness.dark;
}

/// Glass tuning for the floating chrome (the bottom tab bar, and the toolbar
/// clusters that follow the same language).
///
/// The package default is `glassColor: 0x3DFFFFFF` - 24% white - which reads as
/// a flat light-grey capsule on our near-black background, i.e. the chrome ends
/// up louder than the content it floats over. iOS 26 glass is mostly *blur* and
/// a bright edge, not a white fill, so in dark mode we cut the tint hard and
/// spend the difference on back-blur. Light mode keeps a whiter, more opaque
/// fill, because there the glass has to separate itself from a bright page.
LiquidGlassSettings boxGlassSettings(Brightness brightness) =>
    brightness == Brightness.dark
    ? const LiquidGlassSettings(
        glassColor: Color(0x0FFFFFFF), // ~6% white: edge definition only
        thickness: 22,
        blur: 12,
        lightIntensity: 1.1,
        saturation: 1.25,
        glowIntensity: 0.35,
        refractiveIndex: 1.18,
      )
    : const LiquidGlassSettings(
        glassColor: Color(0x66FFFFFF), // 40% white over a light page
        thickness: 18,
        blur: 14,
        lightIntensity: 0.7,
        saturation: 1.1,
        glowIntensity: 0.25,
        refractiveIndex: 1.15,
      );

/// The selected-tab pill. Kept a touch brighter than the bar it sits in so the
/// selection reads as raised glass rather than a grey blob behind the label.
LiquidGlassSettings boxGlassIndicatorSettings(Brightness brightness) =>
    brightness == Brightness.dark
    ? const LiquidGlassSettings(
        glassColor: Color(0x1FFFFFFF),
        thickness: 16,
        blur: 6,
        lightIntensity: 1.4,
        glowIntensity: 0.5,
      )
    : const LiquidGlassSettings(
        glassColor: Color(0x8CFFFFFF),
        thickness: 14,
        blur: 8,
        lightIntensity: 0.9,
        glowIntensity: 0.3,
      );

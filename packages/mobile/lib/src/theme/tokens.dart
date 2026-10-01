import 'package:flutter/material.dart';

/// Box design tokens, ported 1:1 from `packages/ui/src/styles/tokens.css`
/// (light == `:root`, dark == `[data-theme='dark']`). Do not invent a colour:
/// if one is missing, port it from that file.
///
/// The accent defaults to the Box indigo. A Box that sets its own
/// `brand.themeColor` passes it through [BoxAppConfig.accent], and
/// [BoxColors.withAccent] derives the accent family from it.
class BoxColors extends ThemeExtension<BoxColors> {
  const BoxColors({
    required this.bg,
    required this.sidebar,
    required this.surface,
    required this.surfaceHover,
    required this.codeBg,
    required this.border,
    required this.borderLight,
    required this.borderStrong,
    required this.shine,
    required this.fg1,
    required this.fg2,
    required this.fg3,
    required this.fg4,
    required this.fgDisabled,
    required this.accent,
    required this.accentHover,
    required this.accentDim,
    required this.accentBg,
    required this.accentRing,
    required this.accentFg,
    required this.success,
    required this.successBg,
    required this.warning,
    required this.warningBg,
    required this.danger,
    required this.dangerBg,
    required this.info,
    required this.infoBg,
  });

  final Color bg;
  final Color sidebar;
  final Color surface;
  final Color surfaceHover;
  final Color codeBg;
  final Color border;
  final Color borderLight;
  final Color borderStrong;
  final Color shine;
  final Color fg1;
  final Color fg2;
  final Color fg3;
  final Color fg4;
  final Color fgDisabled;
  final Color accent;
  final Color accentHover;
  final Color accentDim;
  final Color accentBg;
  final Color accentRing;
  final Color accentFg;
  final Color success;
  final Color successBg;
  final Color warning;
  final Color warningBg;
  final Color danger;
  final Color dangerBg;
  final Color info;
  final Color infoBg;

  static const light = BoxColors(
    bg: Color(0xFFFFFFFF),
    sidebar: Color(0xFFF5F5F8),
    surface: Color(0xFFFAFAFA),
    surfaceHover: Color(0xFFF3F3F5),
    codeBg: Color(0xFFF7F7F9),
    border: Color(0xFFE8E8EC),
    borderLight: Color(0xFFD8D8DE),
    borderStrong: Color(0xFFB8B8C0),
    shine: Color(0xFFE0E0E6),
    fg1: Color(0xFF0E0E16),
    fg2: Color(0xFF41414F),
    fg3: Color(0xFF6B6B7A),
    fg4: Color(0xFF8C8C98),
    fgDisabled: Color(0xFFC4C4CC),
    accent: Color(0xFF5558E6),
    accentHover: Color(0xFF4346D4),
    accentDim: Color(0xFF7B7EF5),
    accentBg: Color(0xFFEEF0FE),
    accentRing: Color(0x335558E6),
    accentFg: Color(0xFFFFFFFF),
    success: Color(0xFF16A34A),
    successBg: Color(0xFFECFDF3),
    warning: Color(0xFFB45309),
    warningBg: Color(0xFFFFF7ED),
    danger: Color(0xFFDC2626),
    dangerBg: Color(0xFFFEF2F2),
    info: Color(0xFF0284C7),
    infoBg: Color(0xFFEFF8FF),
  );

  static const dark = BoxColors(
    bg: Color(0xFF0A0A0F),
    sidebar: Color(0xFF16161F),
    surface: Color(0xFF12121A),
    surfaceHover: Color(0xFF1A1A26),
    codeBg: Color(0xFF0D0D16),
    border: Color(0xFF1E1E2E),
    borderLight: Color(0xFF2A2A3E),
    borderStrong: Color(0xFF3A3A52),
    shine: Color(0xFF32333E),
    fg1: Color(0xFFE4E4EF),
    fg2: Color(0xFFB8B8CC),
    fg3: Color(0xFF8888A0),
    fg4: Color(0xFF7E7E94),
    fgDisabled: Color(0xFF4A4A5E),
    accent: Color(0xFF7B7EF5),
    accentHover: Color(0xFF9BA0F8),
    accentDim: Color(0xFF5558E6),
    accentBg: Color(0xFF1E1B4B),
    accentRing: Color(0x407B7EF5),
    accentFg: Color(0xFFFFFFFF),
    success: Color(0xFF22C55E),
    successBg: Color(0xFF022C1A),
    warning: Color(0xFFF59E0B),
    warningBg: Color(0xFF2A1F04),
    danger: Color(0xFFEF4444),
    dangerBg: Color(0xFF2A0D10),
    info: Color(0xFF38BDF8),
    infoBg: Color(0xFF082F3F),
  );

  /// Replace the accent family with one derived from [accent] (a Box's
  /// `brand.themeColor`). Hover, dim, tint and ring follow the same recipe the
  /// web tokens use: darker for hover in light mode, lighter in dark mode.
  BoxColors withAccent(Color? accent, Brightness brightness) {
    if (accent == null) return this;
    final dark = brightness == Brightness.dark;
    final hsl = HSLColor.fromColor(accent);
    Color shift(double d) =>
        hsl.withLightness((hsl.lightness + d).clamp(0.0, 1.0)).toColor();
    return copyWith(
      accent: accent,
      accentHover: dark ? shift(0.08) : shift(-0.07),
      accentDim: dark ? shift(-0.12) : shift(0.12),
      accentBg: dark
          ? Color.alphaBlend(accent.withValues(alpha: 0.22), bg)
          : Color.alphaBlend(accent.withValues(alpha: 0.09), bg),
      accentRing: accent.withValues(alpha: dark ? 0.25 : 0.2),
    );
  }

  @override
  BoxColors copyWith({
    Color? accent,
    Color? accentHover,
    Color? accentDim,
    Color? accentBg,
    Color? accentRing,
  }) => BoxColors(
    bg: bg,
    sidebar: sidebar,
    surface: surface,
    surfaceHover: surfaceHover,
    codeBg: codeBg,
    border: border,
    borderLight: borderLight,
    borderStrong: borderStrong,
    shine: shine,
    fg1: fg1,
    fg2: fg2,
    fg3: fg3,
    fg4: fg4,
    fgDisabled: fgDisabled,
    accent: accent ?? this.accent,
    accentHover: accentHover ?? this.accentHover,
    accentDim: accentDim ?? this.accentDim,
    accentBg: accentBg ?? this.accentBg,
    accentRing: accentRing ?? this.accentRing,
    accentFg: accentFg,
    success: success,
    successBg: successBg,
    warning: warning,
    warningBg: warningBg,
    danger: danger,
    dangerBg: dangerBg,
    info: info,
    infoBg: infoBg,
  );

  @override
  BoxColors lerp(BoxColors? other, double t) {
    if (other == null) return this;
    Color l(Color a, Color b) => Color.lerp(a, b, t)!;
    return BoxColors(
      bg: l(bg, other.bg),
      sidebar: l(sidebar, other.sidebar),
      surface: l(surface, other.surface),
      surfaceHover: l(surfaceHover, other.surfaceHover),
      codeBg: l(codeBg, other.codeBg),
      border: l(border, other.border),
      borderLight: l(borderLight, other.borderLight),
      borderStrong: l(borderStrong, other.borderStrong),
      shine: l(shine, other.shine),
      fg1: l(fg1, other.fg1),
      fg2: l(fg2, other.fg2),
      fg3: l(fg3, other.fg3),
      fg4: l(fg4, other.fg4),
      fgDisabled: l(fgDisabled, other.fgDisabled),
      accent: l(accent, other.accent),
      accentHover: l(accentHover, other.accentHover),
      accentDim: l(accentDim, other.accentDim),
      accentBg: l(accentBg, other.accentBg),
      accentRing: l(accentRing, other.accentRing),
      accentFg: l(accentFg, other.accentFg),
      success: l(success, other.success),
      successBg: l(successBg, other.successBg),
      warning: l(warning, other.warning),
      warningBg: l(warningBg, other.warningBg),
      danger: l(danger, other.danger),
      dangerBg: l(dangerBg, other.dangerBg),
      info: l(info, other.info),
      infoBg: l(infoBg, other.infoBg),
    );
  }
}

/// The Box "silk" brand gradient (theme-independent). Used sparingly: brand
/// flourishes, at most once per surface.
const boxBrandGradient = LinearGradient(
  begin: Alignment.topLeft,
  end: Alignment.bottomRight,
  // --silk-magenta, --silk-purple, --silk-violet, --silk-indigo, --silk-cyan
  colors: [
    Color(0xFFC550C7),
    Color(0xFF7932B7),
    Color(0xFF3F2EB7),
    Color(0xFF134FB4),
    Color(0xFF37C9D9),
  ],
);

/// Radii from the web `@theme` tokens.
class BoxRadius {
  static const sm = 6.0;
  static const md = 8.0; // the default --radius
  static const lg = 12.0;
  static const full = 9999.0;
}

/// Motion tokens.
class BoxMotion {
  static const fast = Duration(milliseconds: 120);
  static const base = Duration(milliseconds: 150);
  static const slow = Duration(milliseconds: 220);
  static const easeStandard = Cubic(0.2, 0, 0, 1);
  static const easeEmphasized = Cubic(0.3, 0, 0, 1);
}

/// Categorical swatches (web `lib/swatches.ts`), fixed order, `[light, dark]`.
/// Use [boxSwatch] to pick one deterministically for an id.
const boxSwatches = <List<Color>>[
  [Color(0xFF3F51B5), Color(0xFF7986CB)], // indigo
  [Color(0xFF0097A7), Color(0xFF0097A7)], // cyan
  [Color(0xFFFF6F00), Color(0xFFE65100)], // amber
  [Color(0xFFD81B60), Color(0xFFEC407A)], // pink
  [Color(0xFF009688), Color(0xFF26A69A)], // teal
  [Color(0xFF673AB7), Color(0xFF9575CD)], // purple
  [Color(0xFFE65100), Color(0xFFD84315)], // orange
  [Color(0xFF388E3C), Color(0xFF43A047)], // green
];

/// A stable swatch for [id] (a user id, a room slug, a record id), so the same
/// thing is the same colour on every screen and every client.
Color boxSwatch(String id, Brightness brightness) {
  var hash = 0;
  for (final u in id.codeUnits) {
    hash = (hash * 31 + u) & 0x7fffffff;
  }
  final pair = boxSwatches[hash % boxSwatches.length];
  return brightness == Brightness.dark ? pair[1] : pair[0];
}

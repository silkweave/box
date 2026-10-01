import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../app/box_scope.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import 'badge.dart';

/// The canonical surface: rounded, bordered, padded. Tappable when [onTap] is
/// set. [tint] mixes the surface slightly toward a colour (a swatch, a tone).
class BoxCard extends StatelessWidget {
  const BoxCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.onTap,
    this.onLongPress,
    this.tint,
    this.margin = EdgeInsets.zero,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry margin;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final Color? tint;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final dark = context.isDark;
    final bg = tint == null
        ? c.surface
        : Color.lerp(c.surface, tint, dark ? 0.10 : 0.06)!;
    final border = tint == null ? c.border : Color.lerp(c.border, tint, 0.28)!;
    final radius = BorderRadius.circular(BoxRadius.lg);
    return Padding(
      padding: margin,
      child: Material(
        color: bg,
        shape: RoundedRectangleBorder(
          borderRadius: radius,
          side: BorderSide(color: border),
        ),
        shadowColor: const Color(0x140F0F1E),
        elevation: dark ? 0 : 0.5,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          onLongPress: onLongPress,
          child: Padding(padding: padding, child: child),
        ),
      ),
    );
  }
}

/// A card that navigates: title, optional subtitle, leading visual, meta line
/// and a chevron. Tapping pushes [page] (or runs [onTap], or opens [link]).
///
/// ```dart
/// BoxPushCard(
///   leading: const Icon(LucideIcons.flag),
///   title: initiative.title,
///   subtitle: initiative.summary,
///   badge: BoxBadge(initiative.status, tone: BoxTone.accent),
///   page: () => InitiativeScreen(id: initiative.id),
/// )
/// ```
class BoxPushCard extends StatelessWidget {
  const BoxPushCard({
    super.key,
    required this.title,
    this.subtitle,
    this.leading,
    this.badge,
    this.meta,
    this.page,
    this.link,
    this.onTap,
    this.tint,
    this.margin = const EdgeInsets.only(bottom: 12),
    this.subtitleLines = 2,
  });

  final String title;
  final String? subtitle;
  final Widget? leading;

  /// A status pill at the top right (a `BoxBadge`).
  final Widget? badge;

  /// A muted line under the subtitle ("Updated 3h ago - 4 tasks").
  final String? meta;

  /// Builds the page to push.
  final Widget Function()? page;

  /// Or an in-app link to open.
  final Object? link;

  /// Or any action.
  final VoidCallback? onTap;
  final Color? tint;
  final EdgeInsetsGeometry margin;
  final int subtitleLines;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final text = context.text;
    VoidCallback? tap = onTap;
    if (tap == null && page != null) tap = () => context.pushPage(page!());
    if (tap == null && link != null) tap = () => context.openLink(link!);
    return BoxCard(
      margin: margin,
      tint: tint,
      onTap: tap,
      padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (leading != null) ...[
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: IconTheme.merge(
                data: IconThemeData(color: c.fg3, size: 20),
                child: leading!,
              ),
            ),
            const SizedBox(width: 12),
          ],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        title,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: text.titleMedium,
                      ),
                    ),
                    if (badge != null) ...[const SizedBox(width: 8), badge!],
                  ],
                ),
                if (subtitle != null && subtitle!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    maxLines: subtitleLines,
                    overflow: TextOverflow.ellipsis,
                    style: text.bodySmall,
                  ),
                ],
                if (meta != null) ...[
                  const SizedBox(height: 6),
                  Text(meta!, style: text.labelSmall?.copyWith(color: c.fg4)),
                ],
              ],
            ),
          ),
          if (tap != null) ...[
            const SizedBox(width: 4),
            Padding(
              padding: const EdgeInsets.only(top: 2),
              child: Icon(LucideIcons.chevronRight, size: 18, color: c.fg4),
            ),
          ],
        ],
      ),
    );
  }
}

/// A key figure: label, big value, optional delta line. Pairs with `BoxGrid`
/// for a dashboard.
class BoxStatCard extends StatelessWidget {
  const BoxStatCard({
    super.key,
    required this.label,
    required this.value,
    this.icon,
    this.caption,
    this.tone = BoxTone.neutral,
    this.onTap,
  });

  final String label;
  final String value;
  final IconData? icon;

  /// Small print under the value ("+12% this week").
  final String? caption;

  /// Colours the icon and caption.
  final BoxTone tone;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final text = context.text;
    final (fg, _) = tone == BoxTone.neutral ? (c.fg3, c.surface) : tone.resolve(c);
    return BoxCard(
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 16, color: fg),
                const SizedBox(width: 6),
              ],
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: text.labelSmall,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(value, style: text.headlineMedium),
          if (caption != null) ...[
            const SizedBox(height: 2),
            Text(caption!, style: text.labelSmall?.copyWith(color: fg)),
          ],
        ],
      ),
    );
  }
}

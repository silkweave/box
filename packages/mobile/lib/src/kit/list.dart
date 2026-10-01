import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import 'badge.dart';

/// An uppercase label above a group of content.
class BoxSectionHeader extends StatelessWidget {
  const BoxSectionHeader(this.label, {super.key, this.trailing});

  final String label;

  /// A small action at the right edge ("See all", a count).
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label.toUpperCase(),
              style: context.text.labelSmall?.copyWith(
                color: c.fg4,
                letterSpacing: 0.6,
              ),
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// A grouped list: rows in one rounded surface, separated by hairlines, with
/// an optional [header] and [footer]. The building block of settings pages,
/// detail pages and most module lists.
///
/// ```dart
/// BoxListSection(
///   header: 'Rooms',
///   children: [
///     for (final r in rooms)
///       BoxListTile(
///         icon: LucideIcons.hash,
///         title: r.name,
///         subtitle: r.topic,
///         count: r.unread,
///         onTap: () => context.openLink('chat/room/${r.slug}'),
///       ),
///   ],
/// )
/// ```
class BoxListSection extends StatelessWidget {
  const BoxListSection({
    super.key,
    required this.children,
    this.header,
    this.headerTrailing,
    this.footer,
    this.margin = const EdgeInsets.only(bottom: 24),
    this.empty,
  });

  final List<Widget> children;
  final String? header;
  final Widget? headerTrailing;

  /// Small print under the group.
  final String? footer;
  final EdgeInsets margin;

  /// Shown inside the group when [children] is empty (else the group hides).
  final Widget? empty;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    if (children.isEmpty && empty == null) return const SizedBox.shrink();
    final rows = children.isEmpty ? [empty!] : children;
    return Padding(
      padding: margin,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (header != null) BoxSectionHeader(header!, trailing: headerTrailing),
          DecoratedBox(
            decoration: BoxDecoration(
              color: c.surface,
              borderRadius: BorderRadius.circular(BoxRadius.lg),
              border: Border.all(color: c.border),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(BoxRadius.lg),
              child: Material(
                type: MaterialType.transparency,
                child: Column(
                  children: [
                    for (var i = 0; i < rows.length; i++) ...[
                      if (i > 0) Divider(height: 1, indent: 16, color: c.border),
                      rows[i],
                    ],
                  ],
                ),
              ),
            ),
          ),
          if (footer != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 8, 4, 0),
              child: Text(
                footer!,
                style: context.text.labelSmall?.copyWith(color: c.fg4),
              ),
            ),
        ],
      ),
    );
  }
}

/// One row. Everything but [title] is optional:
///
/// * [icon] or [leading] (an avatar) on the left,
/// * [subtitle] under the title,
/// * [value] (muted text), [count] (a badge) or [trailing] on the right,
/// * a chevron when [onTap] is set, unless [chevron] is false,
/// * [destructive] paints the title in the danger colour ("Sign out").
///
/// Works inside a [BoxListSection] or on its own.
class BoxListTile extends StatelessWidget {
  const BoxListTile({
    super.key,
    required this.title,
    this.subtitle,
    this.icon,
    this.leading,
    this.trailing,
    this.value,
    this.count,
    this.onTap,
    this.onLongPress,
    this.chevron,
    this.destructive = false,
    this.bold = false,
    this.subtitleLines = 1,
  });

  final String title;
  final String? subtitle;
  final IconData? icon;
  final Widget? leading;
  final Widget? trailing;
  final String? value;
  final int? count;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final bool? chevron;
  final bool destructive;

  /// Emphasise the title (an unread row).
  final bool bold;
  final int subtitleLines;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final text = context.text;
    final showChevron = chevron ?? (onTap != null && !destructive);
    final lead =
        leading ??
        (icon == null
            ? null
            : Icon(icon, size: 20, color: destructive ? c.danger : c.fg3));
    return InkWell(
      onTap: onTap,
      onLongPress: onLongPress,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 48),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: [
              if (lead != null) ...[lead, const SizedBox(width: 12)],
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: text.bodyMedium?.copyWith(
                        color: destructive ? c.danger : c.fg1,
                        fontWeight: bold ? FontWeight.w600 : FontWeight.w500,
                      ),
                    ),
                    if (subtitle != null && subtitle!.isNotEmpty)
                      Text(
                        subtitle!,
                        maxLines: subtitleLines,
                        overflow: TextOverflow.ellipsis,
                        style: text.bodySmall?.copyWith(color: c.fg3),
                      ),
                  ],
                ),
              ),
              if (value != null) ...[
                const SizedBox(width: 8),
                Text(value!, style: text.bodySmall?.copyWith(color: c.fg3)),
              ],
              if (count != null && count! > 0) ...[
                const SizedBox(width: 8),
                BoxCount(count!),
              ],
              if (trailing != null) ...[const SizedBox(width: 8), trailing!],
              if (showChevron) ...[
                const SizedBox(width: 4),
                Icon(LucideIcons.chevronRight, size: 18, color: c.fg4),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// A row with a switch, for settings.
class BoxSwitchTile extends StatelessWidget {
  const BoxSwitchTile({
    super.key,
    required this.title,
    required this.value,
    required this.onChanged,
    this.subtitle,
    this.icon,
  });

  final String title;
  final String? subtitle;
  final IconData? icon;
  final bool value;
  final ValueChanged<bool>? onChanged;

  @override
  Widget build(BuildContext context) => BoxListTile(
    title: title,
    subtitle: subtitle,
    icon: icon,
    onTap: onChanged == null ? null : () => onChanged!(!value),
    chevron: false,
    trailing: Switch.adaptive(value: value, onChanged: onChanged),
  );
}

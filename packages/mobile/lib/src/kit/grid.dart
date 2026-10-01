import 'package:flutter/material.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import 'badge.dart';

/// A responsive grid that fits as many columns as [minTileWidth] allows and
/// sizes each row to its tallest tile. It does not scroll by itself, so it
/// drops into a `BoxPage(children: [...])` next to other blocks.
///
/// ```dart
/// BoxGrid(children: [
///   BoxGridTile(icon: LucideIcons.users, title: 'Contacts', value: '128',
///       onTap: () => context.openLink('crm/contacts')),
///   BoxStatCard(label: 'Open deals', value: '14'),
/// ])
/// ```
class BoxGrid extends StatelessWidget {
  const BoxGrid({
    super.key,
    required this.children,
    this.minTileWidth = 150,
    this.spacing = 12,
    this.maxColumns = 4,
    this.margin = const EdgeInsets.only(bottom: 24),
  });

  final List<Widget> children;
  final double minTileWidth;
  final double spacing;
  final int maxColumns;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: margin,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final fit = ((constraints.maxWidth + spacing) / (minTileWidth + spacing))
              .floor();
          final columns = fit.clamp(1, maxColumns);
          final rows = <Widget>[];
          for (var i = 0; i < children.length; i += columns) {
            final cells = <Widget>[];
            for (var j = 0; j < columns; j++) {
              if (j > 0) cells.add(SizedBox(width: spacing));
              final index = i + j;
              cells.add(
                Expanded(
                  child: index < children.length
                      ? children[index]
                      : const SizedBox.shrink(),
                ),
              );
            }
            if (rows.isNotEmpty) rows.add(SizedBox(height: spacing));
            rows.add(
              IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: cells,
                ),
              ),
            );
          }
          return Column(children: rows);
        },
      ),
    );
  }
}

/// A launcher-style tile: tinted icon, title, optional subtitle or value, and
/// a count badge. For grids of destinations, collections or shortcuts.
class BoxGridTile extends StatelessWidget {
  const BoxGridTile({
    super.key,
    required this.title,
    this.icon,
    this.subtitle,
    this.value,
    this.count,
    this.color,
    this.onTap,
  });

  final String title;
  final IconData? icon;
  final String? subtitle;

  /// A prominent figure under the title.
  final String? value;

  /// A badge in the corner (hidden at 0).
  final int? count;

  /// The icon tint. Defaults to the accent; `boxSwatch(id, brightness)` gives
  /// every item its own stable colour.
  final Color? color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final text = context.text;
    final tint = color ?? c.accent;
    return Material(
      color: c.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BoxRadius.lg),
        side: BorderSide(color: c.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  if (icon != null)
                    Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: tint.withValues(alpha: context.isDark ? 0.2 : 0.12),
                        borderRadius: BorderRadius.circular(BoxRadius.md),
                      ),
                      child: Icon(icon, size: 18, color: tint),
                    ),
                  const Spacer(),
                  if (count != null) BoxCount(count!),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                title,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
              ),
              if (subtitle != null)
                Text(
                  subtitle!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: text.labelSmall,
                ),
              if (value != null) ...[
                const SizedBox(height: 4),
                Text(value!, style: text.headlineSmall),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

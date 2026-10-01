import 'package:flutter/material.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';

/// The semantic colour families. Used by badges, cards and states.
enum BoxTone { neutral, accent, success, warning, danger, info }

extension BoxToneColors on BoxTone {
  /// `(foreground, background)` for this tone.
  (Color, Color) resolve(BoxColors c) => switch (this) {
    BoxTone.neutral => (c.fg3, c.surface),
    BoxTone.accent => (c.accent, c.accentBg),
    BoxTone.success => (c.success, c.successBg),
    BoxTone.warning => (c.warning, c.warningBg),
    BoxTone.danger => (c.danger, c.dangerBg),
    BoxTone.info => (c.info, c.infoBg),
  };
}

/// A status pill: rounded, tinted by [tone], with an optional leading dot.
/// `BoxBadge('Active', tone: BoxTone.success, dot: true)`.
class BoxBadge extends StatelessWidget {
  const BoxBadge(
    this.label, {
    super.key,
    this.tone = BoxTone.neutral,
    this.dot = false,
  });

  final String label;
  final BoxTone tone;
  final bool dot;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final (fg, bg) = tone.resolve(c);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(BoxRadius.full),
        border: Border.all(color: fg.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot) ...[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(color: fg, shape: BoxShape.circle),
            ),
            const SizedBox(width: 5),
          ],
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: fg,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}

/// A small solid count bubble (unread, pending). Renders nothing at 0.
class BoxCount extends StatelessWidget {
  const BoxCount(this.count, {super.key, this.max = 99});

  final int count;
  final int max;

  @override
  Widget build(BuildContext context) {
    if (count <= 0) return const SizedBox.shrink();
    final c = context.colors;
    return Container(
      constraints: const BoxConstraints(minWidth: 20),
      height: 20,
      padding: const EdgeInsets.symmetric(horizontal: 6),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: c.accent,
        borderRadius: BorderRadius.circular(BoxRadius.full),
      ),
      child: Text(
        count > max ? '$max+' : '$count',
        style: TextStyle(
          color: c.accentFg,
          fontSize: 11,
          fontWeight: FontWeight.w600,
          height: 1,
        ),
      ),
    );
  }
}

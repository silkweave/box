import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';

/// Show [builder]'s content in a floating panel anchored to the widget that
/// owns [anchor] (pass the `BuildContext` of the button that was tapped). The
/// panel opens below the anchor, or above it when there is no room, and
/// closes on a tap outside. Returns what the panel pops with.
///
/// ```dart
/// IconButton(
///   icon: const Icon(LucideIcons.info),
///   onPressed: () => showBoxPopover(
///     anchor: context,
///     builder: (context) => const Padding(
///       padding: EdgeInsets.all(12),
///       child: Text('Synced 2 minutes ago'),
///     ),
///   ),
/// )
/// ```
Future<T?> showBoxPopover<T>({
  required BuildContext anchor,
  required WidgetBuilder builder,
  double width = 240,
}) {
  final box = anchor.findRenderObject() as RenderBox?;
  final overlay =
      Navigator.of(anchor, rootNavigator: true).overlay!.context.findRenderObject()
          as RenderBox;
  final rect = box == null
      ? Rect.fromCenter(center: overlay.size.center(Offset.zero), width: 0, height: 0)
      : box.localToGlobal(Offset.zero, ancestor: overlay) & box.size;
  return Navigator.of(anchor, rootNavigator: true).push<T>(
    _PopoverRoute<T>(
      anchor: rect,
      width: width,
      builder: builder,
      barrierLabel: MaterialLocalizations.of(anchor).modalBarrierDismissLabel,
    ),
  );
}

/// One entry of a [showBoxMenu] / [BoxMenuButton].
class BoxMenuItem<T> {
  const BoxMenuItem({
    required this.value,
    required this.label,
    this.icon,
    this.destructive = false,
    this.enabled = true,
  });

  final T value;
  final String label;
  final IconData? icon;
  final bool destructive;
  final bool enabled;
}

/// An anchored action menu. Resolves to the chosen item's value, or null when
/// dismissed.
Future<T?> showBoxMenu<T>({
  required BuildContext anchor,
  required List<BoxMenuItem<T>> items,
  double width = 220,
}) => showBoxPopover<T>(
  anchor: anchor,
  width: width,
  builder: (context) {
    final c = context.colors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final item in items)
            InkWell(
              onTap: item.enabled
                  ? () => Navigator.of(context).pop(item.value)
                  : null,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                child: Row(
                  children: [
                    if (item.icon != null) ...[
                      Icon(
                        item.icon,
                        size: 18,
                        color: !item.enabled
                            ? c.fgDisabled
                            : item.destructive
                            ? c.danger
                            : c.fg2,
                      ),
                      const SizedBox(width: 10),
                    ],
                    Expanded(
                      child: Text(
                        item.label,
                        style: context.text.bodyMedium?.copyWith(
                          color: !item.enabled
                              ? c.fgDisabled
                              : item.destructive
                              ? c.danger
                              : c.fg1,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  },
);

/// An icon button that opens an anchored [showBoxMenu] and reports the choice.
///
/// ```dart
/// BoxMenuButton<String>(
///   items: const [
///     BoxMenuItem(value: 'edit', label: 'Edit', icon: LucideIcons.pencil),
///     BoxMenuItem(value: 'delete', label: 'Delete',
///         icon: LucideIcons.trash2, destructive: true),
///   ],
///   onSelected: (v) => v == 'edit' ? edit() : delete(),
/// )
/// ```
class BoxMenuButton<T> extends StatelessWidget {
  const BoxMenuButton({
    super.key,
    required this.items,
    required this.onSelected,
    this.icon = Icons.more_horiz,
    this.tooltip,
  });

  final List<BoxMenuItem<T>> items;
  final ValueChanged<T> onSelected;
  final IconData icon;
  final String? tooltip;

  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: tooltip,
    icon: Icon(icon),
    onPressed: () async {
      final v = await showBoxMenu<T>(anchor: context, items: items);
      if (v != null) onSelected(v);
    },
  );
}

class _PopoverRoute<T> extends PopupRoute<T> {
  _PopoverRoute({
    required this.anchor,
    required this.width,
    required this.builder,
    required this.barrierLabel,
  });

  final Rect anchor;
  final double width;
  final WidgetBuilder builder;

  @override
  final String barrierLabel;

  @override
  Color? get barrierColor => Colors.transparent;

  @override
  bool get barrierDismissible => true;

  @override
  Duration get transitionDuration => BoxMotion.base;

  @override
  Widget buildPage(
    BuildContext context,
    Animation<double> animation,
    Animation<double> secondaryAnimation,
  ) {
    final c = context.colors;
    final padding = MediaQuery.paddingOf(context);
    return CustomSingleChildLayout(
      delegate: _PopoverLayout(anchor: anchor, width: width, padding: padding),
      child: FadeTransition(
        opacity: CurvedAnimation(parent: animation, curve: BoxMotion.easeStandard),
        child: ScaleTransition(
          scale: Tween(begin: 0.96, end: 1.0).animate(
            CurvedAnimation(parent: animation, curve: BoxMotion.easeEmphasized),
          ),
          child: Material(
            color: c.bg,
            elevation: 8,
            shadowColor: Colors.black.withValues(alpha: 0.25),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(BoxRadius.lg),
              side: BorderSide(color: c.borderLight),
            ),
            clipBehavior: Clip.antiAlias,
            child: SingleChildScrollView(child: builder(context)),
          ),
        ),
      ),
    );
  }
}

class _PopoverLayout extends SingleChildLayoutDelegate {
  _PopoverLayout({
    required this.anchor,
    required this.width,
    required this.padding,
  });

  final Rect anchor;
  final double width;
  final EdgeInsets padding;
  static const _gap = 6.0;
  static const _margin = 8.0;

  @override
  BoxConstraints getConstraintsForChild(BoxConstraints constraints) {
    final below = constraints.maxHeight - anchor.bottom - padding.bottom - _gap - _margin;
    final above = anchor.top - padding.top - _gap - _margin;
    return BoxConstraints(
      maxWidth: math.min(width, constraints.maxWidth - 2 * _margin),
      maxHeight: math.max(math.max(below, above), 80),
    );
  }

  @override
  Offset getPositionForChild(Size size, Size child) {
    // Align the panel's right edge with the anchor's when the anchor sits on
    // the right half (a toolbar button), else its left edge.
    final rightAligned = anchor.center.dx > size.width / 2;
    var x = rightAligned ? anchor.right - child.width : anchor.left;
    x = x.clamp(_margin, size.width - child.width - _margin);
    final fitsBelow =
        anchor.bottom + _gap + child.height <= size.height - padding.bottom - _margin;
    final y = fitsBelow
        ? anchor.bottom + _gap
        : math.max(padding.top + _margin, anchor.top - _gap - child.height);
    return Offset(x, y);
  }

  @override
  bool shouldRelayout(_PopoverLayout old) =>
      old.anchor != anchor || old.width != width || old.padding != padding;
}

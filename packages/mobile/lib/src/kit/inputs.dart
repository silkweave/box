import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../theme/theme.dart';
import '../theme/tokens.dart';
import 'badge.dart';

/// A rounded search field with a clear button.
class BoxSearchField extends StatefulWidget {
  const BoxSearchField({
    super.key,
    this.controller,
    this.hint = 'Search',
    this.onChanged,
    this.autofocus = false,
  });

  final TextEditingController? controller;
  final String hint;
  final ValueChanged<String>? onChanged;
  final bool autofocus;

  @override
  State<BoxSearchField> createState() => _BoxSearchFieldState();
}

class _BoxSearchFieldState extends State<BoxSearchField> {
  late final TextEditingController _controller =
      widget.controller ?? TextEditingController();

  @override
  void dispose() {
    if (widget.controller == null) _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return TextField(
      controller: _controller,
      autofocus: widget.autofocus,
      autocorrect: false,
      textInputAction: TextInputAction.search,
      onChanged: (v) {
        setState(() {});
        widget.onChanged?.call(v);
      },
      decoration: InputDecoration(
        hintText: widget.hint,
        fillColor: c.surface,
        prefixIcon: Icon(LucideIcons.search, size: 18, color: c.fg4),
        prefixIconConstraints: const BoxConstraints(minWidth: 40),
        suffixIcon: _controller.text.isEmpty
            ? null
            : IconButton(
                icon: Icon(LucideIcons.x, size: 16, color: c.fg4),
                onPressed: () {
                  _controller.clear();
                  setState(() {});
                  widget.onChanged?.call('');
                },
              ),
      ),
    );
  }
}

/// One option of a [BoxSegmented].
class BoxSegment<T> {
  const BoxSegment({required this.value, required this.label, this.count, this.icon});

  final T value;
  final String label;

  /// A badge after the label (unread in that pane).
  final int? count;
  final IconData? icon;
}

/// Pill switcher between a few panes ("Channels / Direct", "Open / Done").
class BoxSegmented<T> extends StatelessWidget {
  const BoxSegmented({
    super.key,
    required this.segments,
    required this.value,
    required this.onChanged,
    this.padding = const EdgeInsets.fromLTRB(16, 8, 16, 8),
  });

  final List<BoxSegment<T>> segments;
  final T value;
  final ValueChanged<T> onChanged;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Padding(
      padding: padding,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            for (final s in segments) ...[
              _pill(context, c, s),
              const SizedBox(width: 8),
            ],
          ],
        ),
      ),
    );
  }

  Widget _pill(BuildContext context, BoxColors c, BoxSegment<T> s) {
    final selected = s.value == value;
    return Material(
      color: selected ? c.accentBg : c.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(BoxRadius.full),
        side: BorderSide(color: selected ? c.accentRing : c.border),
      ),
      child: InkWell(
        customBorder: const StadiumBorder(),
        onTap: () => onChanged(s.value),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (s.icon != null) ...[
                Icon(s.icon, size: 15, color: selected ? c.accent : c.fg3),
                const SizedBox(width: 6),
              ],
              Text(
                s.label,
                style: context.text.labelMedium?.copyWith(
                  color: selected ? c.accent : c.fg2,
                ),
              ),
              if ((s.count ?? 0) > 0) ...[
                const SizedBox(width: 6),
                BoxCount(s.count!),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// A labelled form field block: label above, the field, help or error below.
class BoxField extends StatelessWidget {
  const BoxField({
    super.key,
    required this.label,
    required this.child,
    this.help,
    this.error,
  });

  final String label;
  final Widget child;
  final String? help;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(label, style: context.text.labelMedium),
          const SizedBox(height: 6),
          child,
          if (error != null || help != null) ...[
            const SizedBox(height: 6),
            Text(
              error ?? help!,
              style: context.text.labelSmall?.copyWith(
                color: error != null ? c.danger : c.fg4,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

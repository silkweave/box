import 'package:flutter/material.dart';

/// The standard page: app bar, body, optional pull-to-refresh. Use it for tab
/// roots and pushed pages alike so every screen has the same chrome.
///
/// Give it [children] for the common case (a padded, scrolling column of kit
/// widgets), or a [body] when the page owns its own scrolling.
///
/// ```dart
/// BoxPage(
///   title: 'Deals',
///   actions: [IconButton(icon: const Icon(LucideIcons.plus), onPressed: add)],
///   onRefresh: store.refresh,
///   children: [
///     BoxListSection(children: [for (final d in deals) BoxListTile(...)]),
///   ],
/// )
/// ```
///
/// Tab roots sit under the floating tab bar; the shell adds the bar's height
/// to the bottom safe-area padding, and [children] mode honours it. A custom
/// [body] should use `MediaQuery.paddingOf(context).bottom` for its last item.
class BoxPage extends StatelessWidget {
  const BoxPage({
    super.key,
    this.title,
    this.titleWidget,
    this.actions,
    this.leading,
    this.bottom,
    this.body,
    this.children,
    this.onRefresh,
    this.floatingActionButton,
    this.padding = const EdgeInsets.fromLTRB(16, 12, 16, 24),
    this.showAppBar = true,
  }) : assert(
         (body == null) != (children == null),
         'Give BoxPage either a body or children',
       );

  final String? title;

  /// Replaces [title] with any widget (a search field, a wordmark).
  final Widget? titleWidget;
  final List<Widget>? actions;
  final Widget? leading;

  /// Under the app bar: a `BoxSegmented`, a search field, tabs.
  final PreferredSizeWidget? bottom;

  final Widget? body;
  final List<Widget>? children;

  /// Pull-to-refresh. In [body] mode the body must be scrollable.
  final Future<void> Function()? onRefresh;

  final Widget? floatingActionButton;

  /// Padding around [children].
  final EdgeInsets padding;

  final bool showAppBar;

  @override
  Widget build(BuildContext context) {
    Widget content;
    if (children != null) {
      final inset = MediaQuery.paddingOf(context).bottom;
      content = ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: padding.copyWith(bottom: padding.bottom + inset),
        children: children!,
      );
    } else {
      content = body!;
    }
    if (onRefresh != null) {
      content = RefreshIndicator(onRefresh: onRefresh!, child: content);
    }
    return Scaffold(
      appBar: showAppBar
          ? AppBar(
              title: titleWidget ?? (title == null ? null : Text(title!)),
              actions: actions == null ? null : [...actions!, const SizedBox(width: 4)],
              leading: leading,
              bottom: bottom,
            )
          : null,
      body: content,
      floatingActionButton: floatingActionButton,
    );
  }
}

/// Vertical gap between kit blocks: `const BoxGap()` (16) or `BoxGap(8)`.
class BoxGap extends StatelessWidget {
  const BoxGap([this.size = 16, Key? key]) : super(key: key);
  final double size;

  @override
  Widget build(BuildContext context) => SizedBox(height: size, width: size);
}

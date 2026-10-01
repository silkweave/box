import 'package:flutter/material.dart';

import '../theme/theme.dart';

/// A bottom sheet with a drag handle, an optional title row and scrolling
/// content that stays above the keyboard. Forms, pickers and detail peeks
/// belong here. Pop it with a result: `Navigator.pop(context, value)`.
///
/// Keep sheet content scrollable: a tall form on a short phone with the
/// keyboard up otherwise pushes its submit button out of reach.
Future<T?> showBoxSheet<T>({
  required BuildContext context,
  required WidgetBuilder builder,
  String? title,
  List<Widget>? actions,
}) {
  return showModalBottomSheet<T>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    backgroundColor: context.colors.bg,
    builder: (context) {
      final text = context.text;
      return Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (title != null || actions != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 16),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(title ?? '', style: text.headlineSmall),
                      ),
                      ...?actions,
                    ],
                  ),
                ),
              builder(context),
            ],
          ),
        ),
      );
    },
  );
}

/// Ask a yes/no question. Resolves true only when confirmed.
///
/// ```dart
/// if (await showBoxConfirm(context,
///     title: 'Delete deal?',
///     message: 'This cannot be undone.',
///     confirmLabel: 'Delete',
///     destructive: true)) { ... }
/// ```
Future<bool> showBoxConfirm(
  BuildContext context, {
  required String title,
  String? message,
  String confirmLabel = 'Confirm',
  String cancelLabel = 'Cancel',
  bool destructive = false,
}) async {
  final c = context.colors;
  final ok = await showDialog<bool>(
    context: context,
    useRootNavigator: true,
    builder: (context) => AlertDialog(
      backgroundColor: c.bg,
      title: Text(title),
      content: message == null ? null : Text(message),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(cancelLabel, style: TextStyle(color: c.fg2)),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(
            confirmLabel,
            style: TextStyle(color: destructive ? c.danger : c.accent),
          ),
        ),
      ],
    ),
  );
  return ok ?? false;
}

/// Ask for one line of text. Resolves to the trimmed text, or null when
/// cancelled.
Future<String?> showBoxPrompt(
  BuildContext context, {
  required String title,
  String? initial,
  String? hint,
  String confirmLabel = 'Save',
  TextInputType? keyboardType,
}) {
  final controller = TextEditingController(text: initial);
  final c = context.colors;
  return showDialog<String>(
    context: context,
    useRootNavigator: true,
    builder: (context) => AlertDialog(
      backgroundColor: c.bg,
      title: Text(title),
      content: TextField(
        controller: controller,
        autofocus: true,
        keyboardType: keyboardType,
        decoration: InputDecoration(hintText: hint),
        onSubmitted: (v) => Navigator.of(context).pop(v.trim()),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text('Cancel', style: TextStyle(color: c.fg2)),
        ),
        TextButton(
          onPressed: () => Navigator.of(context).pop(controller.text.trim()),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  // The controller is not disposed here: the dialog's exit animation still
  // reads it after the future completes. It is garbage once the route is gone.
}

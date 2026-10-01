import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../app/box_scope.dart';
import '../theme/theme.dart';

/// Nothing here yet: an icon, a sentence and an optional action. Centred in
/// whatever space it gets.
class BoxEmptyState extends StatelessWidget {
  const BoxEmptyState({
    super.key,
    required this.title,
    this.message,
    this.icon = LucideIcons.inbox,
    this.action,
  });

  final String title;
  final String? message;
  final IconData icon;

  /// Usually a `FilledButton` ("Create the first one").
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(color: c.surfaceHover, shape: BoxShape.circle),
              child: Icon(icon, size: 24, color: c.fg3),
            ),
            const SizedBox(height: 16),
            Text(title, textAlign: TextAlign.center, style: context.text.titleMedium),
            if (message != null) ...[
              const SizedBox(height: 6),
              Text(
                message!,
                textAlign: TextAlign.center,
                style: context.text.bodySmall?.copyWith(color: c.fg3),
              ),
            ],
            if (action != null) ...[const SizedBox(height: 20), action!],
          ],
        ),
      ),
    );
  }
}

/// A failed load, with the reason and a retry button.
class BoxErrorState extends StatelessWidget {
  const BoxErrorState({super.key, required this.error, this.onRetry});

  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(color: c.dangerBg, shape: BoxShape.circle),
              child: Icon(LucideIcons.triangleAlert, size: 24, color: c.danger),
            ),
            const SizedBox(height: 16),
            Text(
              'Could not load this',
              textAlign: TextAlign.center,
              style: context.text.titleMedium,
            ),
            const SizedBox(height: 6),
            Text(
              describeError(error),
              textAlign: TextAlign.center,
              style: context.text.bodySmall?.copyWith(color: c.fg3),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 20),
              FilledButton(onPressed: onRetry, child: const Text('Retry')),
            ],
          ],
        ),
      ),
    );
  }
}

/// A centred spinner, optionally with a caption.
class BoxLoading extends StatelessWidget {
  const BoxLoading({super.key, this.message});

  final String? message;

  @override
  Widget build(BuildContext context) => Center(
    child: Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(
          width: 22,
          height: 22,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
        if (message != null) ...[
          const SizedBox(height: 12),
          Text(message!, style: context.text.labelSmall),
        ],
      ],
    ),
  );
}

/// A small inline spinner for buttons: `FilledButton(child: busy ? const
/// BoxSpinner() : const Text('Save'))`.
class BoxSpinner extends StatelessWidget {
  const BoxSpinner({super.key, this.size = 16});
  final double size;

  @override
  Widget build(BuildContext context) => SizedBox(
    width: size,
    height: size,
    child: const CircularProgressIndicator(strokeWidth: 2),
  );
}

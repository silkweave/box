import 'package:flutter/material.dart';

import '../app/box_scope.dart';
import '../theme/theme.dart';

/// The Box's logo from `BoxAppConfig.logoAsset`, or a tinted initial when the
/// Box has none.
class BoxBrandMark extends StatelessWidget {
  const BoxBrandMark({super.key, this.size = 24});

  final double size;

  @override
  Widget build(BuildContext context) {
    final config = BoxScope.of(context).app.config;
    final asset = config.logoAsset;
    if (asset != null) {
      return Image.asset(
        asset,
        width: size,
        height: size,
        filterQuality: FilterQuality.medium,
      );
    }
    final c = context.colors;
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: c.accent, shape: BoxShape.circle),
      child: Text(
        config.name.isEmpty ? '?' : config.name.substring(0, 1).toUpperCase(),
        style: TextStyle(
          color: c.accentFg,
          fontSize: size * 0.5,
          fontWeight: FontWeight.w700,
          height: 1,
        ),
      ),
    );
  }
}

/// Mark + wordmark + muted suffix (`brand.wordmark`, `brand.suffix`), falling
/// back to the Box name. A [markSize] of 0 drops the mark.
class BoxWordmark extends StatelessWidget {
  const BoxWordmark({super.key, this.markSize = 24});

  final double markSize;

  @override
  Widget build(BuildContext context) {
    final config = BoxScope.of(context).app.config;
    final text = context.text;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (markSize > 0) ...[
          BoxBrandMark(size: markSize),
          const SizedBox(width: 8),
        ],
        Text(
          config.wordmark ?? config.name,
          style: text.titleMedium?.copyWith(letterSpacing: -0.3),
        ),
        if (config.suffix != null) ...[
          const SizedBox(width: 4),
          Text(
            config.suffix!,
            style: text.titleMedium?.copyWith(
              fontWeight: FontWeight.w400,
              color: context.colors.fg3,
            ),
          ),
        ],
      ],
    );
  }
}

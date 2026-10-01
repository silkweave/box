import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:liquid_glass_widgets/liquid_glass_widgets.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../kit/brand.dart';
import '../kit/list.dart';
import '../kit/page.dart';
import '../module/box_link.dart';
import '../module/box_module.dart';
import '../session/box_session.dart';
import '../theme/theme.dart';
import 'box_app_controller.dart';
import 'box_scope.dart';
import 'settings_screen.dart';

/// The most tabs the bar shows before the rest move into "More".
const kMaxBarTabs = 4;

/// Height reserved under tab roots for the floating glass bar.
const kTabBarInset = 72.0;

/// The signed-in app: one bottom bar built from every module's tabs (sorted by
/// order), Settings last, and link routing.
///
/// Navigation is deliberately flat: tabs are the top-level destinations and
/// everything else is pushed full screen over them (`context.pushPage`,
/// `context.openLink`). With no modules registered the shell is a single home
/// page with Settings in its app bar.
class BoxShell extends StatefulWidget {
  const BoxShell({
    super.key,
    required this.app,
    required this.themeController,
  });

  final BoxAppController app;
  final ThemeController themeController;

  @override
  State<BoxShell> createState() => _BoxShellState();
}

/// One entry in the bar: a module tab, "More", or Settings.
class _Destination {
  const _Destination({
    required this.id,
    required this.label,
    required this.icon,
    required this.builder,
    this.badge,
  });

  final String id;
  final String label;
  final IconData icon;
  final WidgetBuilder builder;
  final ValueListenable<int>? badge;
}

class _BoxShellState extends State<BoxShell> {
  late final BoxSession session = widget.app.session!;
  late final List<({BoxModule module, BoxTab tab})> _tabs;
  late final List<_Destination> _bar;
  int _index = 0;

  static const _settingsId = '_settings';
  static const _moreId = '_more';

  @override
  void initState() {
    super.initState();
    _tabs = [
      for (final m in widget.app.modules)
        for (final t in m.tabs) (module: m, tab: t),
    ]..sort((a, b) => a.tab.order.compareTo(b.tab.order));

    final settings = _Destination(
      id: _settingsId,
      label: 'Settings',
      icon: LucideIcons.settings,
      builder: (_) => BoxSettingsScreen(
        app: widget.app,
        themeController: widget.themeController,
      ),
    );
    final overflow = _tabs.length > kMaxBarTabs;
    final onBar = overflow ? _tabs.take(kMaxBarTabs - 1).toList() : _tabs;
    final inMore = overflow ? _tabs.skip(kMaxBarTabs - 1).toList() : const [];
    _bar = [
      for (final t in onBar) _destination(t.tab),
      if (overflow)
        _Destination(
          id: _moreId,
          label: 'More',
          icon: LucideIcons.ellipsis,
          builder: (_) => _MorePage(
            tabs: [for (final t in inMore) t.tab],
            settings: settings,
          ),
        )
      else
        settings,
    ];

    widget.app.pendingLink.addListener(_openPending);
    WidgetsBinding.instance.addPostFrameCallback((_) => _openPending());
  }

  _Destination _destination(BoxTab t) => _Destination(
    id: t.id,
    label: t.label,
    icon: t.icon,
    builder: t.builder,
    badge: t.badge?.call(session),
  );

  @override
  void dispose() {
    widget.app.pendingLink.removeListener(_openPending);
    super.dispose();
  }

  void _openPending() {
    final link = widget.app.pendingLink.value;
    if (link == null || !mounted) return;
    widget.app.pendingLink.value = null;
    _route(link);
  }

  /// Resolve [link] to a module route, select its tab, push the page.
  void _route(BoxLink link) {
    final module = widget.app.modules
        .where((m) => m.id == link.module)
        .firstOrNull;
    if (module == null) {
      debugPrint('box: no module "${link.module}" for link $link');
      return;
    }
    for (final route in module.routes) {
      final params = route.match(link.path);
      if (params == null) continue;
      _selectTab(route.tab ?? module.tabs.firstOrNull?.id);
      final resolved = link.withParams(params);
      Navigator.of(context, rootNavigator: true).push(
        MaterialPageRoute(
          settings: RouteSettings(name: resolved.toString()),
          builder: (context) => route.builder(context, resolved),
        ),
      );
      return;
    }
    // A bare module link (`chat`) selects the module's tab.
    if (link.path.isEmpty && module.tabs.isNotEmpty) {
      _selectTab(module.tabs.first.id);
      Navigator.of(context, rootNavigator: true).popUntil((r) => r.isFirst);
      return;
    }
    debugPrint('box: module "${module.id}" has no route for $link');
  }

  void _selectTab(String? tabId) {
    if (tabId == null) return;
    final i = _bar.indexWhere((d) => d.id == tabId);
    if (i >= 0) {
      if (i != _index) setState(() => _index = i);
      return;
    }
    // The tab lives under More.
    final more = _bar.indexWhere((d) => d.id == _moreId);
    if (more >= 0 && more != _index) setState(() => _index = more);
  }

  @override
  Widget build(BuildContext context) {
    if (_tabs.isEmpty) {
      return _EmptyHome(app: widget.app, themeController: widget.themeController);
    }
    final c = context.colors;
    final brightness = Theme.of(context).brightness;
    final media = MediaQuery.of(context);
    return Scaffold(
      extendBody: true, // content flows under the floating glass bar
      body: MediaQuery(
        // Tab roots see the bar as part of the bottom safe area, so lists pad
        // their last row above it without knowing it exists.
        data: media.copyWith(
          padding: media.padding.copyWith(
            bottom: media.padding.bottom + kTabBarInset,
          ),
        ),
        child: IndexedStack(
          index: _index,
          children: [for (final d in _bar) Builder(builder: d.builder)],
        ),
      ),
      bottomNavigationBar: GlassTabBar.bottom(
        selectedIndex: _index,
        onTabSelected: (i) => setState(() => _index = i),
        settings: boxGlassSettings(brightness),
        indicatorSettings: boxGlassIndicatorSettings(brightness),
        selectedIconColor: c.accent,
        selectedLabelColor: c.accent,
        unselectedIconColor: c.fg3,
        unselectedLabelColor: c.fg3,
        tabs: [
          for (final d in _bar)
            GlassTab(
              icon: d.badge == null
                  ? Icon(d.icon)
                  : ValueListenableBuilder<int>(
                      valueListenable: d.badge!,
                      builder: (context, n, child) => Badge(
                        isLabelVisible: n > 0,
                        label: Text(n > 99 ? '99+' : '$n'),
                        backgroundColor: c.accent,
                        child: child,
                      ),
                      child: Icon(d.icon),
                    ),
              label: d.label,
            ),
        ],
      ),
    );
  }
}

/// Overflow destinations plus Settings, when modules add more tabs than fit.
class _MorePage extends StatelessWidget {
  const _MorePage({required this.tabs, required this.settings});

  final List<BoxTab> tabs;
  final _Destination settings;

  @override
  Widget build(BuildContext context) {
    final session = context.session;
    return BoxPage(
      title: 'More',
      children: [
        BoxListSection(
          children: [
            for (final t in tabs)
              _badged(
                t.badge?.call(session),
                (count) => BoxListTile(
                  icon: t.icon,
                  title: t.label,
                  count: count,
                  onTap: () => context.pushPage(
                    Builder(builder: t.builder),
                  ),
                ),
              ),
          ],
        ),
        BoxListSection(
          children: [
            BoxListTile(
              icon: settings.icon,
              title: settings.label,
              onTap: () => context.pushPage(Builder(builder: settings.builder)),
            ),
          ],
        ),
      ],
    );
  }

  Widget _badged(ValueListenable<int>? badge, Widget Function(int?) build) =>
      badge == null
      ? build(null)
      : ValueListenableBuilder<int>(
          valueListenable: badge,
          builder: (context, n, _) => build(n),
        );
}

/// The shell of a Box with no mobile modules yet.
class _EmptyHome extends StatelessWidget {
  const _EmptyHome({required this.app, required this.themeController});

  final BoxAppController app;
  final ThemeController themeController;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return BoxPage(
      titleWidget: const BoxWordmark(markSize: 22),
      actions: [
        IconButton(
          tooltip: 'Settings',
          icon: const Icon(LucideIcons.settings),
          onPressed: () => context.pushPage(
            BoxSettingsScreen(app: app, themeController: themeController),
          ),
        ),
      ],
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const BoxBrandMark(size: 64),
              const SizedBox(height: 20),
              ListenableBuilder(
                listenable: context.session.directory,
                builder: (context, _) {
                  final session = context.session;
                  // The directory carries the full name; the principal's
                  // display may be the bare id.
                  final name = session.directory[session.principal.id]?.display ??
                      session.principal.display;
                  return Text(
                    'Welcome, $name',
                    textAlign: TextAlign.center,
                    style: context.text.headlineSmall,
                  );
                },
              ),
              const SizedBox(height: 8),
              Text(
                'You are signed in to ${app.config.name}. This app shows what '
                'your Box has added to it, and nothing has been added yet.',
                textAlign: TextAlign.center,
                style: context.text.bodySmall?.copyWith(color: c.fg3),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

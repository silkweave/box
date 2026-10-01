# box_mobile

The Silkweave Box mobile framework: app shell, module contract, session, API client, theme, UI
kit and test helpers. The app (`apps/mobile`) and every feature module
(`features/<id>/mobile`) depend on it. The guide is [docs/MOBILE.md](../../docs/MOBILE.md); this
file is the tour of the API.

```dart
import 'package:box_mobile/box_mobile.dart';
```

## Source map

| Path | Contents |
| --- | --- |
| `lib/src/module/` | `BoxModule`, `BoxModuleState`, `BoxTab`, `BoxRoute`, `BoxSettingsSection`, `BoxNotificationChannel`, `BoxLink` |
| `lib/src/app/` | `runBoxApp`, `BoxApp`, `BoxAppConfig`, `BoxAppController` (phases), `BoxShell` (tabs, More, links), sign-in and phase screens, Settings, `BoxScope` and the `BoxContext` extension |
| `lib/src/session/` | `BoxSession`, `BoxDirectory`, `BoxChanges`, `BoxStorage` |
| `lib/src/api/` | `BoxApi`, `BoxApiException`, `BoxUnreachableException`, `listOf`, `parseTime`, core models |
| `lib/src/notify/` | `BoxNotifier` (local notifications that open links) |
| `lib/src/theme/` | `BoxColors` (ported from `packages/ui` tokens), `boxTheme`, `ThemeController`, glass settings |
| `lib/src/kit/` | The UI kit |
| `lib/src/util/` | Formatting helpers |
| `lib/testing.dart` | `FakeServer`, `pumpBoxApp`, `testSession`, `boxTestApp` |

## Context helpers

```dart
context.session                 // BoxSession: api, principal, agent, directory, changes, storage(id)
context.api                     // the session's BoxApi
context.state<ChatStore>()      // a module's running state
context.openLink('chat/room/general')
context.pushPage(DetailScreen(id: id))
context.toast('Saved');  context.toastError(error)
context.openUrl('https://example.com')
context.colors.fg3;  context.text.bodySmall;  context.isDark
```

## A module with state

```dart
class DealsStore extends BoxModuleState {
  DealsStore(super.session);

  late final deals = BoxResource(() async =>
      listOf((await session.api.getJson('/api/crm/deals'))['deals'], Deal.fromJson));

  BoxChangeListener? _changes;

  @override
  Future<void> start() {
    // Reload when the server says the table changed (web edits, agents).
    _changes = session.changes.listen(['table:crm_deals'], () => deals.refresh());
    return deals.load();
  }

  @override
  Future<void> stop() async => _changes?.cancel();

  @override
  Future<void> resume() => deals.refresh();

  Future<void> close(String id) async {
    await session.api.postJson('/api/crm/deal-close', {'id': id});
    await deals.refresh();
  }

  @override
  void dispose() {
    deals.dispose();
    super.dispose();
  }
}

final crmModule = BoxModule(
  id: 'crm',
  title: 'CRM',
  createState: DealsStore.new,
  tabs: [
    BoxTab(
      id: 'crm',
      label: 'Deals',
      icon: LucideIcons.handshake,
      order: 30,
      builder: (context) => const DealsScreen(),
    ),
  ],
  routes: [BoxRoute('deal/:id', (context, link) => DealScreen(id: link.param('id')))],
);

class DealsScreen extends StatelessWidget {
  const DealsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final store = context.state<DealsStore>();
    return BoxPage(
      title: 'Deals',
      onRefresh: store.deals.refresh,
      body: BoxResourceView<List<Deal>>(
        resource: store.deals,
        isEmpty: (d) => d.isEmpty,
        empty: const BoxEmptyState(title: 'No open deals'),
        builder: (context, deals) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            BoxGrid(children: [
              BoxStatCard(label: 'Open', value: '${deals.length}', icon: LucideIcons.briefcase),
              BoxStatCard(label: 'Won this month', value: '3', tone: BoxTone.success),
            ]),
            BoxListSection(
              header: 'Pipeline',
              children: [
                for (final d in deals)
                  BoxListTile(
                    title: d.name,
                    subtitle: d.company,
                    value: formatRelative(d.updatedAt),
                    onTap: () => context.openLink('crm/deal/${d.id}'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
```

## Kit reference

- `BoxPage` - app bar plus `children` (padded, scrolling, clears the tab bar) or `body`;
  `onRefresh` adds pull-to-refresh; `bottom` takes a `BoxSegmented` or search field.
- `BoxListSection` / `BoxListTile` / `BoxSwitchTile` / `BoxSectionHeader` - grouped rows. A tile
  has `icon` or `leading`, `subtitle`, `value`, `count`, `trailing`, `onTap` (adds a chevron),
  `destructive`, `bold`.
- `BoxGrid` / `BoxGridTile` / `BoxStatCard` - responsive columns by `minTileWidth`, rows sized to
  the tallest tile; drops into a `children` page.
- `BoxCard` / `BoxPushCard` - a surface, and a card that navigates to `page`, `link` or `onTap`,
  with `badge` and `meta`.
- `showBoxPopover(anchor: context, builder:)`, `showBoxMenu`, `BoxMenuButton` - anchored panels
  that open below the anchor or above it when there is no room.
- `showBoxSheet`, `showBoxConfirm`, `showBoxPrompt` - bottom sheet (scrolls, clears the keyboard),
  yes/no, one line of text.
- `BoxLoader` / `BoxResource` / `BoxResourceView` - loading, error with retry, empty and data
  states; a refresh keeps old data on screen.
- `BoxEmptyState`, `BoxErrorState`, `BoxLoading`, `BoxSpinner`.
- `BoxSearchField`, `BoxSegmented`, `BoxField`.
- `BoxAvatar` (URL, data URI or initials), `BoxBadge` + `BoxTone`, `BoxCount`.
- `BoxBrandMark`, `BoxWordmark` from `BoxAppConfig`.
- `formatRelative`, `formatClock`, `formatDate`, `formatDateTime`, `formatCompact`, `plural`.

## Checks

```bash
flutter pub get && flutter analyze && flutter test
```

`bun run test:mobile` at the repository root runs the same for the framework, every module and
the app; `box verify` includes it.

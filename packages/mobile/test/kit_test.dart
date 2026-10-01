import 'package:box_mobile/box_mobile.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:box_mobile/testing.dart';

void main() {
  testWidgets('lists, grids and cards render their content', (tester) async {
    await tester.pumpWidget(await boxTestApp(ListView(children: [
      BoxListSection(header: 'People', children: [
        BoxListTile(title: 'Ada', subtitle: 'admin', count: 2, onTap: () {}),
        const BoxListTile(title: 'Dan', value: 'member'),
      ]),
      const BoxListSection(empty: BoxListTile(title: 'Nobody yet'), children: []),
      const BoxGrid(children: [
        BoxGridTile(title: 'Contacts', value: '128', icon: LucideIcons.users),
        BoxStatCard(label: 'Open', value: '14'),
        BoxGridTile(title: 'Deals', count: 3),
      ]),
      BoxPushCard(title: 'Launch', subtitle: 'Q4', badge: const BoxBadge('Active', tone: BoxTone.success), onTap: () {}),
    ])));
    expect(find.text('PEOPLE'), findsOneWidget);
    expect(find.text('Ada'), findsOneWidget);
    expect(find.text('2'), findsOneWidget);
    expect(find.text('Nobody yet'), findsOneWidget);
    expect(find.text('128'), findsOneWidget);
    expect(find.text('Active'), findsOneWidget);
  });

  testWidgets('a menu resolves to the chosen value', (tester) async {
    String? chosen;
    await tester.pumpWidget(await boxTestApp(Center(
      child: BoxMenuButton<String>(
        items: const [
          BoxMenuItem(value: 'edit', label: 'Edit'),
          BoxMenuItem(value: 'delete', label: 'Delete', destructive: true),
        ],
        onSelected: (v) => chosen = v,
      ),
    )));
    await tester.tap(find.byType(IconButton));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();
    expect(chosen, 'delete');
    expect(find.text('Edit'), findsNothing);
  });

  testWidgets('a resource shows loading, then data, and keeps data on a failed refresh', (tester) async {
    var fail = false;
    var n = 0;
    final r = BoxResource<int>(() async {
      if (fail) throw StateError('boom');
      return ++n;
    });
    await tester.pumpWidget(await boxTestApp(BoxResourceView<int>(
      resource: r,
      builder: (context, v) => Text('value $v'),
    )));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await r.load();
    await tester.pump();
    expect(find.text('value 1'), findsOneWidget);
    fail = true;
    await r.refresh();
    await tester.pump();
    expect(find.text('value 1'), findsOneWidget);
    expect(r.error, isA<StateError>());
  });

  testWidgets('confirm resolves true only on confirm', (tester) async {
    late BuildContext ctx;
    await tester.pumpWidget(await boxTestApp(Builder(builder: (c) {
      ctx = c;
      return const SizedBox();
    })));
    final result = showBoxConfirm(ctx, title: 'Delete?', confirmLabel: 'Delete');
    await tester.pumpAndSettle();
    await tester.tap(find.text('Delete'));
    await tester.pumpAndSettle();
    expect(await result, isTrue);
  });
}

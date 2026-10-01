import 'package:box_mobile/box_mobile.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('links parse module, path and query', () {
    final l = BoxLink.parse('chat/room/general?focus=m1');
    expect(l.module, 'chat');
    expect(l.path, ['room', 'general']);
    expect(l.query, {'focus': 'm1'});
    expect(l.toString(), 'chat/room/general?focus=m1');
    expect(BoxLink.parse('box:/chat'), const BoxLink('chat'));
    expect(BoxLink.tryParse(''), isNull);
  });

  test('routes capture parameters and reject other shapes', () {
    final r = BoxRoute('room/:slug', (_, _) => throw UnimplementedError());
    expect(r.match(['room', 'general']), {'slug': 'general'});
    expect(r.match(['room']), isNull);
    expect(r.match(['thread', 'x']), isNull);
    final link = BoxLink.parse('chat/room/general').withParams({'slug': 'general'});
    expect(link.param('slug'), 'general');
    expect(() => link.param('nope'), throwsArgumentError);
  });

  test('formatRelative buckets', () {
    final now = DateTime(2026, 9, 29, 12);
    expect(formatRelative(now.subtract(const Duration(seconds: 10)), now: now), 'now');
    expect(formatRelative(now.subtract(const Duration(minutes: 5)), now: now), '5m');
    expect(formatRelative(now.subtract(const Duration(hours: 3)), now: now), '3h');
    expect(formatRelative(DateTime(2026, 9, 28, 9), now: now), 'Yesterday');
    expect(formatRelative(DateTime(2026, 3, 12), now: now), '12 Mar');
    expect(formatRelative(DateTime(2025, 3, 12), now: now), '12 Mar 2025');
    expect(plural(1, 'task'), '1 task');
    expect(plural(3, 'task'), '3 tasks');
  });
}

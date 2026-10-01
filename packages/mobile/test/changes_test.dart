import 'dart:async';
import 'dart:convert';

import 'package:box_mobile/box_mobile.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// A server whose `changesFeed` stays open and emits what the test pushes.
class _Feed {
  final _out = StreamController<List<int>>();
  int connects = 0;
  int status = 200;

  BoxApi api() => BoxApi(
    baseUrl: 'https://box.test',
    token: 't',
    client: MockClient.streaming((req, _) async {
      expect(req.url.path, '/trpc/changesFeed');
      connects++;
      if (status != 200) {
        return http.StreamedResponse(
          Stream.value(utf8.encode('{"message":"no"}')),
          status,
        );
      }
      return http.StreamedResponse(_out.stream, 200);
    }),
  );

  void emit(String scope) => _out.add(
    utf8.encode(
      'data: ${jsonEncode({
        'result': {
          'data': {'seq': 1, 'ts': '', 'scope': scope, 'detail': null},
        },
      })}\n\n',
    ),
  );
}

void main() {
  test('scope matching: exact, and warehouse invalidates every table', () {
    expect(BoxChanges.matches('table:tasks', 'table:tasks'), isTrue);
    expect(BoxChanges.matches('table:tasks', 'table:initiatives'), isFalse);
    expect(BoxChanges.matches('table:tasks', 'warehouse'), isTrue);
    expect(BoxChanges.matches('docs:initiatives', 'warehouse'), isFalse);
  });

  test('a matching event calls the listener once per debounce window', () async {
    final feed = _Feed();
    final changes = BoxChanges(feed.api(), debounce: const Duration(milliseconds: 10));
    var tasks = 0, docs = 0;
    changes.listen(['table:tasks'], () => tasks++);
    changes.listen(['docs:initiatives'], () => docs++);
    expect(feed.connects, 0, reason: 'connects lazily');
    await pumpEventQueue();
    expect(feed.connects, 1, reason: 'one connection for every listener');
    feed
      ..emit('hello')
      ..emit('table:tasks')
      ..emit('table:tasks')
      ..emit('ping');
    await Future<void>.delayed(const Duration(milliseconds: 40));
    expect(tasks, 1);
    expect(docs, 0);
    feed.emit('docs:initiatives');
    await Future<void>.delayed(const Duration(milliseconds: 40));
    expect(docs, 1);
    changes.close();
  });

  test('a second hello (a reconnect) fires every listener', () async {
    final feed = _Feed();
    final changes = BoxChanges(feed.api(), debounce: const Duration(milliseconds: 5));
    var n = 0;
    changes.listen(['table:tasks'], () => n++);
    await pumpEventQueue();
    feed.emit('hello');
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(n, 0);
    feed.emit('hello');
    await Future<void>.delayed(const Duration(milliseconds: 20));
    expect(n, 1);
    changes.close();
  });

  test('a server without the feed is not retried', () async {
    final feed = _Feed()..status = 404;
    final changes = BoxChanges(
      feed.api(),
      retryDelay: const Duration(milliseconds: 5),
    );
    changes.listen(['table:tasks'], () {});
    await Future<void>.delayed(const Duration(milliseconds: 30));
    expect(feed.connects, 1);
    expect(changes.connected, isFalse);
    changes.close();
  });

  test('the last cancel closes the connection', () async {
    final feed = _Feed();
    final changes = BoxChanges(feed.api());
    final a = changes.listen(['table:tasks'], () {});
    final b = changes.listen(['table:tasks'], () {});
    await pumpEventQueue();
    a.cancel();
    expect(changes.connected, isTrue);
    b.cancel();
    expect(changes.connected, isFalse);
  });
}

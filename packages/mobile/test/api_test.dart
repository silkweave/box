import 'package:box_mobile/box_mobile.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

void main() {
  test('base URLs are normalised', () {
    expect(BoxApi.normalizeBaseUrl(' box.example.com/ '), 'https://box.example.com');
    expect(BoxApi.normalizeBaseUrl('http://127.0.0.1:8190//'), 'http://127.0.0.1:8190');
    expect(BoxApi.normalizeBaseUrl(''), '');
  });

  test('requests carry the bearer and errors carry the server message', () async {
    late http.Request seen;
    final api = BoxApi(
      baseUrl: 'https://box.test',
      token: 't0k',
      client: MockClient((req) async {
        seen = req;
        if (req.url.path == '/api/bad') {
          return http.Response('{"message":["name must be set","slug is bad"]}', 400);
        }
        return http.Response('{"ok":true}', 200);
      }),
    );
    expect(await api.postJson('/api/good', {'a': 1}), {'ok': true});
    expect(seen.headers['authorization'], 'Bearer t0k');
    expect(seen.body, '{"a":1}');
    await expectLater(
      api.get('/api/bad'),
      throwsA(isA<BoxApiException>()
          .having((e) => e.status, 'status', 400)
          .having((e) => e.message, 'message', 'name must be set, slug is bad')),
    );
  });

  test('a network failure is BoxUnreachableException', () async {
    final api = BoxApi(
      baseUrl: 'https://box.test',
      client: MockClient((_) async => throw http.ClientException('refused')),
    );
    await expectLater(api.get('/api/x'), throwsA(isA<BoxUnreachableException>()));
  });

  test('tRPC frames are unwrapped in every historical shape', () {
    expect(BoxApi.unwrapTrpcFrame('{"id":"1","data":{"type":"a"}}'), {'type': 'a'});
    expect(BoxApi.unwrapTrpcFrame('{"result":{"data":{"type":"b"}}}'), {'type': 'b'});
    expect(BoxApi.unwrapTrpcFrame('{"type":"c"}'), {'type': 'c'});
    expect(BoxApi.unwrapTrpcFrame('not json'), isNull);
  });

  test('sse joins data lines per event', () async {
    final api = BoxApi(
      baseUrl: 'https://box.test',
      client: MockClient.streaming((req, _) async => http.StreamedResponse(
        Stream.value('data: {"id":"1","data":{"type":"hello"}}\n\n: ping\n\ndata: {"type":"x"}\n\n'.codeUnits),
        200,
      )),
    );
    final frames = await api.subscribe('chatFeed').toList();
    expect(frames, [
      {'type': 'hello'},
      {'type': 'x'},
    ]);
  });

  test('users parse the directory shape', () {
    final u = BoxUser.fromJson({'id': 'dan', 'first_name': 'Dan', 'last_name': 'M', 'nickname': 'danny'});
    expect(u.display, 'Dan M');
    expect(u.shortLabel, 'danny');
    final me = BoxMe.fromJson({'principal': null, 'agent': {'id': 'nova', 'name': 'Nova', 'role': 'admin'}});
    expect(me.principal, isNull);
    expect(me.agent!.id, 'nova');
  });
}

import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart' show MediaType;

/// The server answered with an HTTP error. [message] is the server's own text
/// (Nest's `message`, joined when it is a validation list), so it is usually
/// fit to show verbatim.
class BoxApiException implements Exception {
  BoxApiException(this.status, this.message);
  final int status;
  final String message;

  bool get isUnauthorized => status == 401;
  bool get isNotFound => status == 404;

  @override
  String toString() => 'BoxApiException($status): $message';
}

/// The server could not be reached at all: offline, VPN down, wrong address,
/// timeout. The shell shows its full-screen "can't reach" state on this during
/// boot; inside a module it is an ordinary error to render with retry.
class BoxUnreachableException implements Exception {
  BoxUnreachableException(this.cause);
  final Object cause;

  @override
  String toString() => 'BoxUnreachableException: $cause';
}

/// The one HTTP client for a Box server.
///
/// Every tRPC procedure on the Box has a REST mirror under `/api` (see
/// docs/SERVER.md), and that plain-REST surface is what the app speaks. Auth is
/// a bearer access token on every request, which is CSRF-exempt by
/// construction. The one tRPC-framed call shape is a subscription
/// ([subscribe]), which the server only exposes over SSE.
///
/// A module adds its own typed calls as an extension or a thin wrapper class
/// over this client, never a second client:
///
/// ```dart
/// extension PlanningApi on BoxApi {
///   Future<List<Initiative>> initiatives() async {
///     final j = await getJson('/api/planning/initiatives');
///     return listOf(j['initiatives'], Initiative.fromJson);
///   }
/// }
/// ```
class BoxApi {
  BoxApi({required String baseUrl, this.token, http.Client? client})
    : _baseUrl = normalizeBaseUrl(baseUrl),
      _client = client ?? http.Client();

  String _baseUrl;
  String? token;
  final http.Client _client;

  /// The server origin, e.g. `https://box.example.com`, never with a trailing
  /// slash.
  String get baseUrl => _baseUrl;
  set baseUrl(String value) => _baseUrl = normalizeBaseUrl(value);

  static const getTimeout = Duration(seconds: 10);
  static const postTimeout = Duration(seconds: 15);
  static const uploadTimeout = Duration(minutes: 2);

  /// Trim whitespace and trailing slashes, and assume https when no scheme was
  /// typed.
  static String normalizeBaseUrl(String value) {
    var v = value.trim().replaceAll(RegExp(r'/+$'), '');
    if (v.isNotEmpty && !v.contains('://')) v = 'https://$v';
    return v;
  }

  /// `Authorization` only. Use it for anything the app fetches outside this
  /// client (an `Image.network` of an authenticated blob, a WebSocket
  /// handshake): the server re-authorizes every request, so a URL alone is not
  /// a capability.
  Map<String, String> get authHeaders => {
    if (token != null) 'authorization': 'Bearer $token',
  };

  Map<String, String> get _jsonHeaders => {
    'content-type': 'application/json',
    ...authHeaders,
  };

  /// An absolute URL on this server. [path] starts with `/`.
  Uri url(String path, [Map<String, String>? query]) {
    final u = Uri.parse('$_baseUrl$path');
    return query == null || query.isEmpty
        ? u
        : u.replace(queryParameters: {...u.queryParameters, ...query});
  }

  /// The same URL with a `ws`/`wss` scheme, for a socket the server hosts.
  Uri wsUrl(String path) {
    final u = url(path);
    return u.replace(scheme: u.scheme == 'https' ? 'wss' : 'ws');
  }

  // ---- JSON requests -------------------------------------------------------

  /// GET [path] and return the decoded JSON body (null for an empty body).
  Future<dynamic> get(String path, {Map<String, String>? query}) =>
      _request('GET', url(path, query));

  /// POST [body] as JSON to [path] and return the decoded JSON body. The Box
  /// uses POST for reads that take structured input too.
  Future<dynamic> post(String path, [Object? body]) =>
      _request('POST', url(path), body: body ?? const <String, Object?>{});

  /// [get], asserting an object body.
  Future<Map<String, dynamic>> getJson(
    String path, {
    Map<String, String>? query,
  }) async => _asMap(await get(path, query: query), path);

  /// [post], asserting an object body.
  Future<Map<String, dynamic>> postJson(String path, [Object? body]) async =>
      _asMap(await post(path, body), path);

  static Map<String, dynamic> _asMap(Object? j, String path) {
    if (j is Map<String, dynamic>) return j;
    throw FormatException('Expected a JSON object from $path, got $j');
  }

  Future<dynamic> _request(String method, Uri uri, {Object? body}) async {
    http.Response res;
    try {
      res = await _send(method, uri, body);
    } on TimeoutException catch (e) {
      throw BoxUnreachableException(e);
    } on http.ClientException catch (e) {
      // A pooled keep-alive connection the server already closed fails exactly
      // here, as "Connection closed before full header was received": the
      // request never reached the app. One retry gets a fresh socket. GET ONLY:
      // replaying a POST could double-post, which is worse than a failure.
      final racedPooledConnection = e.message.contains(
        'Connection closed before full header',
      );
      if (method != 'GET' || !racedPooledConnection) {
        throw BoxUnreachableException(e);
      }
      try {
        res = await _send(method, uri, body);
      } on TimeoutException catch (e2) {
        throw BoxUnreachableException(e2);
      } on http.ClientException catch (e2) {
        throw BoxUnreachableException(e2);
      }
    }
    if (res.statusCode >= 400) {
      throw BoxApiException(res.statusCode, errorMessage(res.body));
    }
    if (res.bodyBytes.isEmpty) return null;
    return jsonDecode(utf8.decode(res.bodyBytes));
  }

  Future<http.Response> _send(String method, Uri uri, Object? body) =>
      method == 'GET'
      ? _client.get(uri, headers: _jsonHeaders).timeout(getTimeout)
      : _client
            .post(uri, headers: _jsonHeaders, body: jsonEncode(body))
            .timeout(postTimeout);

  /// The human-readable half of an error body: Nest's `message` (a validation
  /// list is joined), else `error`, else the raw text. A refusal is never
  /// swallowed into "something went wrong".
  static String errorMessage(String body) {
    try {
      final j = jsonDecode(body);
      if (j is Map) {
        final m = j['message'] ?? j['error'];
        if (m is List) return m.join(', ');
        if (m != null) return m.toString();
      }
    } catch (_) {}
    return body.isEmpty ? 'request failed' : body;
  }

  // ---- uploads -------------------------------------------------------------

  /// Multipart upload of [bytes] as form field [field]. Returns the decoded
  /// JSON body. The server's size and MIME refusals come back verbatim as a
  /// [BoxApiException].
  Future<dynamic> upload(
    String path, {
    required List<int> bytes,
    required String filename,
    required String mime,
    String field = 'file',
    Map<String, String> fields = const {},
  }) async {
    final req = http.MultipartRequest('POST', url(path))
      ..headers.addAll(authHeaders)
      ..fields.addAll(fields)
      ..files.add(
        http.MultipartFile.fromBytes(
          field,
          bytes,
          filename: filename,
          contentType: MediaType.parse(mime),
        ),
      );
    http.Response res;
    try {
      res = await http.Response.fromStream(
        await _client.send(req).timeout(uploadTimeout),
      );
    } catch (e) {
      throw BoxUnreachableException(e);
    }
    if (res.statusCode >= 400) {
      throw BoxApiException(res.statusCode, errorMessage(res.body));
    }
    if (res.bodyBytes.isEmpty) return null;
    return jsonDecode(utf8.decode(res.bodyBytes));
  }

  // ---- live streams --------------------------------------------------------

  /// A server-sent-event stream from [path]: yields each event's joined `data:`
  /// payload. Completes when the server closes the stream and errors on a
  /// network failure, so the CALLER owns reconnects and cursors.
  Stream<String> sse(String path, {Map<String, String>? query}) async* {
    final req = http.Request('GET', url(path, query));
    req.headers.addAll({
      ...authHeaders,
      'accept': 'text/event-stream',
      'cache-control': 'no-cache',
    });
    final res = await _client.send(req);
    if (res.statusCode >= 400) {
      final body = await res.stream.bytesToString();
      throw BoxApiException(res.statusCode, errorMessage(body));
    }
    var data = StringBuffer();
    await for (final line
        in res.stream.transform(utf8.decoder).transform(const LineSplitter())) {
      if (line.isEmpty) {
        final raw = data.toString();
        data = StringBuffer();
        if (raw.isNotEmpty) yield raw;
        continue;
      }
      if (line.startsWith('data:')) data.write(line.substring(5).trimLeft());
    }
  }

  /// A tRPC subscription (the server's `@Trpc` subscriptions are only reachable
  /// over SSE at `/trpc/<procedure>`). Yields each frame's payload object with
  /// the tRPC envelope removed. Payloads that are not JSON objects are skipped;
  /// control frames (the `connected` marker) still arrive, so check the shape
  /// you expect (a chat frame carries a string `type`).
  Stream<Map<String, dynamic>> subscribe(
    String procedure, {
    Object? input,
  }) async* {
    final query = {'input': jsonEncode(input ?? const <String, Object?>{})};
    await for (final raw in sse('/trpc/$procedure', query: query)) {
      final frame = unwrapTrpcFrame(raw);
      if (frame != null) yield frame;
    }
  }

  /// Strip the tRPC envelope from one SSE payload. Tolerates the shapes the
  /// server has sent over time: `{id, data: {...}}`, the frame itself, and the
  /// v11 `{result: {data: {...}}}`.
  static Map<String, dynamic>? unwrapTrpcFrame(String raw) {
    Object? j;
    try {
      j = jsonDecode(raw);
    } catch (_) {
      return null;
    }
    if (j is! Map<String, dynamic>) return null;
    final result = j['result'];
    if (result is Map<String, dynamic> &&
        result['data'] is Map<String, dynamic>) {
      return result['data'] as Map<String, dynamic>;
    }
    final data = j['data'];
    if (data is Map<String, dynamic>) return data;
    return j;
  }

  void close() => _client.close();
}

/// Parse a JSON list with [fromJson], treating a missing list as empty.
List<T> listOf<T>(Object? json, T Function(Map<String, dynamic>) fromJson) => [
  for (final item in (json as List?) ?? const [])
    fromJson(item as Map<String, dynamic>),
];

/// Read an epoch-millisecond or ISO-8601 timestamp, or null.
DateTime? parseTime(Object? v) => switch (v) {
  final num n => DateTime.fromMillisecondsSinceEpoch(n.toInt()),
  final String s => DateTime.tryParse(s)?.toLocal(),
  _ => null,
};

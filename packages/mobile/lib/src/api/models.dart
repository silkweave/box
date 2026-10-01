/// Core wire models: who is signed in, the Box's agent, and the people
/// directory. Hand-written mirrors of the server DTOs (`/api/auth/me` in
/// apps/server/src/auth/auth.controller.ts, `/api/users/list` in
/// apps/server/src/users). Parsing is additive-tolerant: an unknown key is
/// ignored and an optional one may be missing, because an installed build
/// keeps talking to a server that moves without it (docs/MOBILE.md,
/// "Version skew").
library;

enum BoxRole { admin, member }

BoxRole _role(Object? v) => v == 'admin' ? BoxRole.admin : BoxRole.member;

/// The signed-in person, from `/api/auth/me`.
class BoxPrincipal {
  const BoxPrincipal({
    required this.id,
    required this.display,
    this.role = BoxRole.member,
  });

  final String id;
  final String display;
  final BoxRole role;

  bool get isAdmin => role == BoxRole.admin;

  factory BoxPrincipal.fromJson(Map<String, dynamic> j) => BoxPrincipal(
    id: j['id'] as String,
    display: (j['display'] ?? j['id']) as String,
    role: _role(j['role']),
  );
}

/// The Box's machine principal (`box.json` `agent`), as `/api/auth/me` reports
/// it. Modules use it to recognise the agent's messages and mentions instead of
/// hard-coding one Box's choice of id.
class BoxAgentIdentity {
  const BoxAgentIdentity({
    required this.id,
    required this.name,
    this.role = BoxRole.admin,
  });

  final String id;
  final String name;
  final BoxRole role;

  factory BoxAgentIdentity.fromJson(Map<String, dynamic> j) => BoxAgentIdentity(
    id: j['id'] as String,
    name: (j['name'] ?? j['id']) as String,
    role: _role(j['role']),
  );
}

/// One person (or the agent) in the Box's user directory.
class BoxUser {
  const BoxUser({
    required this.id,
    required this.display,
    this.nickname,
    this.firstName,
    this.avatarUrl,
  });

  final String id;

  /// Full name, falling back to nickname, then id (the web's `userName`).
  final String display;
  final String? nickname;
  final String? firstName;

  /// `users.image`: null, an http(s) URL, or a `data:` URI. `BoxAvatar`
  /// renders all three.
  final String? avatarUrl;

  /// What a person is CALLED in conversation: nickname, then first name, then
  /// id (the web's `mentionLabel`).
  String get shortLabel => nickname ?? firstName ?? id;

  factory BoxUser.fromJson(Map<String, dynamic> j) {
    // The directory sends first_name / last_name / nickname and no `display`
    // field, so the display name is built here with the web's ladder.
    String? clean(Object? v) {
      final s = (v as String?)?.trim();
      return s == null || s.isEmpty ? null : s;
    }

    final first = clean(j['first_name'] ?? j['firstName']);
    final last = clean(j['last_name'] ?? j['lastName']);
    final nickname = clean(j['nickname']);
    final full = [first, last].whereType<String>().join(' ');
    return BoxUser(
      id: j['id'] as String,
      display:
          clean(j['display']) ??
          (full.isNotEmpty ? full : null) ??
          nickname ??
          j['id'] as String,
      nickname: nickname,
      firstName: first,
      avatarUrl: (j['image'] ?? j['avatar_url'] ?? j['avatarUrl']) as String?,
    );
  }
}

/// `/api/auth/me` in one value.
class BoxMe {
  const BoxMe({this.principal, this.agent});
  final BoxPrincipal? principal;
  final BoxAgentIdentity? agent;

  factory BoxMe.fromJson(Map<String, dynamic> j) {
    final p = j['principal'];
    final a = j['agent'];
    return BoxMe(
      principal: p is Map<String, dynamic> ? BoxPrincipal.fromJson(p) : null,
      agent: a is Map<String, dynamic> && a['id'] is String
          ? BoxAgentIdentity.fromJson(a)
          : null,
    );
  }
}

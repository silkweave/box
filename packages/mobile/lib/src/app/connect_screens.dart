import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../kit/brand.dart';
import '../kit/inputs.dart';
import '../kit/states.dart';
import '../theme/theme.dart';
import '../theme/tokens.dart';
import 'box_app_controller.dart';

/// Sign in with the server address and a personal access token (the same
/// bearer MCP clients use; an admin issues it with
/// `box auth token <id> --quiet`). See docs/AUTH.md. A build with a fixed
/// server ([BoxAppController.fixedServer]) shows only the token field.
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key, required this.app});
  final BoxAppController app;

  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _token = TextEditingController();
  late final _server = TextEditingController(text: widget.app.serverUrl);
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _token.dispose();
    _server.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final error = await widget.app.signIn(
      serverUrl: widget.app.fixedServer ? '' : _server.text,
      token: _token.text,
    );
    if (!mounted) return;
    setState(() {
      _busy = false;
      _error = error;
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(32),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Center(child: BoxBrandMark(size: 56)),
                  const SizedBox(height: 16),
                  const Center(child: BoxWordmark(markSize: 0)),
                  const SizedBox(height: 32),
                  if (!widget.app.fixedServer)
                    BoxField(
                      label: 'Server',
                      help:
                          'The address of your Box, e.g. https://box.example.com',
                      child: TextField(
                        key: const ValueKey('signin-server'),
                        controller: _server,
                        autocorrect: false,
                        keyboardType: TextInputType.url,
                        decoration: const InputDecoration(
                          hintText: 'https://box.example.com',
                        ),
                      ),
                    ),
                  BoxField(
                    label: 'Access token',
                    help:
                        'Your personal token - ask an admin if you do not have one.',
                    child: TextField(
                      key: const ValueKey('signin-token'),
                      controller: _token,
                      obscureText: true,
                      autocorrect: false,
                      enableSuggestions: false,
                      decoration: const InputDecoration(
                        hintText: 'Paste your token',
                      ),
                      onSubmitted: (_) => _submit(),
                    ),
                  ),
                  if (_error != null)
                    Container(
                      margin: const EdgeInsets.only(bottom: 16),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: c.dangerBg,
                        borderRadius: BorderRadius.circular(BoxRadius.md),
                        border: Border.all(
                          color: c.danger.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Text(
                        _error!,
                        style: context.text.bodySmall?.copyWith(
                          color: c.danger,
                        ),
                      ),
                    ),
                  const SizedBox(height: 8),
                  FilledButton(
                    key: const ValueKey('signin-submit'),
                    onPressed: _busy ? null : _submit,
                    child: _busy ? const BoxSpinner() : const Text('Sign in'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Full-screen "can't reach the server". Distinct from [BootFailedScreen]:
/// here nothing answered at all.
class UnreachableScreen extends StatelessWidget {
  const UnreachableScreen({super.key, required this.app});
  final BoxAppController app;

  @override
  Widget build(BuildContext context) => _PhaseScreen(
    app: app,
    icon: LucideIcons.wifiOff,
    title: 'Can’t reach ${app.config.name}',
    message: [
      'Check this device’s connection, then retry.',
      ?app.config.unreachableHint,
    ].join(' '),
    detail: app.serverUrl,
  );
}

/// The catch-all boot failure. The server ANSWERED, so this is not a network
/// problem: the likely cause is a response this build is too old to read,
/// which the copy says, with the error on screen rather than only in a log.
class BootFailedScreen extends StatelessWidget {
  const BootFailedScreen({super.key, required this.app});
  final BoxAppController app;

  @override
  Widget build(BuildContext context) => _PhaseScreen(
    app: app,
    icon: LucideIcons.triangleAlert,
    title: 'Something went wrong starting up',
    message:
        'The server answered but this app could not read the reply, which '
        'usually means this build is older than the server. Installing the '
        'latest build should fix it.',
    detail: '${app.lastError}',
    showSignOut: true,
  );
}

class _PhaseScreen extends StatefulWidget {
  const _PhaseScreen({
    required this.app,
    required this.icon,
    required this.title,
    required this.message,
    required this.detail,
    this.showSignOut = false,
  });

  final BoxAppController app;
  final IconData icon;
  final String title;
  final String message;
  final String detail;
  final bool showSignOut;

  @override
  State<_PhaseScreen> createState() => _PhaseScreenState();
}

class _PhaseScreenState extends State<_PhaseScreen> {
  bool _retrying = false;

  Future<void> _retry() async {
    setState(() => _retrying = true);
    await widget.app.boot();
    if (mounted) setState(() => _retrying = false);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final text = context.text;
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    color: c.dangerBg,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(widget.icon, size: 32, color: c.danger),
                ),
              ),
              const SizedBox(height: 24),
              Text(
                widget.title,
                textAlign: TextAlign.center,
                style: text.headlineSmall,
              ),
              const SizedBox(height: 8),
              Text(
                widget.message,
                textAlign: TextAlign.center,
                style: text.bodySmall?.copyWith(color: c.fg3),
              ),
              const SizedBox(height: 8),
              Text(
                widget.detail,
                textAlign: TextAlign.center,
                style: text.labelSmall?.copyWith(color: c.fg4),
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _retrying ? null : _retry,
                child: _retrying ? const BoxSpinner() : const Text('Retry'),
              ),
              const SizedBox(height: 8),
              TextButton(
                onPressed: _retrying ? null : widget.app.signOut,
                child: Text(widget.showSignOut ? 'Sign out' : 'Change server'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

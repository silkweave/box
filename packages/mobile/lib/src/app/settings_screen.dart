import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../kit/avatar.dart';
import '../kit/brand.dart';
import '../kit/list.dart';
import '../kit/page.dart';
import '../kit/sheets.dart';
import '../theme/theme.dart';
import 'box_app_controller.dart';
import 'box_scope.dart';

/// Core settings: who you are, appearance, every module's sections, the
/// server, and sign out.
class BoxSettingsScreen extends StatelessWidget {
  const BoxSettingsScreen({
    super.key,
    required this.app,
    required this.themeController,
  });

  final BoxAppController app;
  final ThemeController themeController;

  @override
  Widget build(BuildContext context) {
    final session = context.session;
    final p = session.principal;
    final sections = [
      for (final m in app.modules) ...m.settings,
    ]..sort((a, b) => a.order.compareTo(b.order));
    return BoxPage(
      title: 'Settings',
      children: [
        BoxListSection(
          children: [
            ListenableBuilder(
              listenable: session.directory,
              builder: (context, _) => BoxListTile(
                leading: BoxAvatar(
                  id: p.id,
                  name: p.display,
                  imageUrl: session.directory[p.id]?.avatarUrl,
                  size: 40,
                ),
                title: session.directory[p.id]?.display ?? p.display,
                subtitle: '@${p.id}${p.isAdmin ? ' - admin' : ''}',
              ),
            ),
          ],
        ),
        BoxSectionHeader('Appearance'),
        Padding(
          padding: const EdgeInsets.only(bottom: 24),
          child: ListenableBuilder(
            listenable: themeController,
            builder: (context, _) => SegmentedButton<ThemeMode>(
              segments: const [
                ButtonSegment(
                  value: ThemeMode.system,
                  label: Text('Auto'),
                  icon: Icon(LucideIcons.monitor, size: 16),
                ),
                ButtonSegment(
                  value: ThemeMode.light,
                  label: Text('Light'),
                  icon: Icon(LucideIcons.sun, size: 16),
                ),
                ButtonSegment(
                  value: ThemeMode.dark,
                  label: Text('Dark'),
                  icon: Icon(LucideIcons.moon, size: 16),
                ),
              ],
              selected: {themeController.mode},
              onSelectionChanged: (s) => themeController.setMode(s.first),
            ),
          ),
        ),
        for (final s in sections) Builder(builder: s.builder),
        BoxListSection(
          header: 'Server',
          children: [
            BoxListTile(
              icon: LucideIcons.server,
              title: app.serverUrl,
              chevron: false,
            ),
          ],
        ),
        BoxListSection(
          children: [
            BoxListTile(
              icon: LucideIcons.logOut,
              title: 'Sign out',
              destructive: true,
              onTap: () async {
                final ok = await showBoxConfirm(
                  context,
                  title: 'Sign out?',
                  message: 'You will need your access token to sign in again.',
                  confirmLabel: 'Sign out',
                  destructive: true,
                );
                if (!ok) return;
                if (context.mounted) {
                  Navigator.of(context, rootNavigator: true)
                      .popUntil((r) => r.isFirst);
                }
                await app.signOut();
              },
            ),
          ],
        ),
        const SizedBox(height: 16),
        const Center(child: BoxWordmark(markSize: 20)),
        const SizedBox(height: 4),
        Center(
          child: Text(
            'mobile',
            style: context.text.labelSmall?.copyWith(color: context.colors.fg4),
          ),
        ),
      ],
    );
  }
}

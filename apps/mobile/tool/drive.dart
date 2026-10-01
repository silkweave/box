// Host-side driver harness: lets an agent operate a running dev session over
// the VM service (no host mouse/keyboard/screen control). Requires the app to
// run the `lib/main_dev.dart` entrypoint, which installs the driver extension.
//
//   dart run tool/drive.dart shot [out.png]      # PNG of the Flutter surface
//   dart run tool/drive.dart tap <text>          # tap the widget with that text
//   dart run tool/drive.dart tapkey <valueKey>   # tap by ValueKey
//   dart run tool/drive.dart taptip <tooltip>    # tap an icon button by tooltip
//   dart run tool/drive.dart back                # the app bar's back button
//   dart run tool/drive.dart rect <Type>         # render box of a widget type
//   dart run tool/drive.dart type <text>         # enter text into focused field
//   dart run tool/drive.dart typefile <path>     # same, but read from a file so
//                                                # secrets never hit argv/logs
//   dart run tool/drive.dart wait <text>         # wait until text is present
//
// The VM service URI is read from /tmp/box-mobile-<target>.vmservice (written
// by scripts/dev.sh); override with --target=phone or --uri=.
import 'dart:io';

import 'package:flutter_driver/flutter_driver.dart';

Future<String> _resolveUri(List<String> args) async {
  final explicit = args.firstWhere(
    (a) => a.startsWith('--uri='),
    orElse: () => '',
  );
  if (explicit.isNotEmpty) return explicit.substring(6);
  final target = args
      .firstWhere(
        (a) => a.startsWith('--target='),
        orElse: () => '--target=sim',
      )
      .substring(9);
  final file = File('/tmp/box-mobile-$target.vmservice');
  if (!file.existsSync()) {
    stderr.writeln('No vmservice file for "$target". Is the session running?');
    exit(2);
  }
  // The file holds a ws:// URI; FlutterDriver wants http:// on the same path.
  final ws = (await file.readAsString()).trim();
  return ws.replaceFirst('ws://', 'http://').replaceFirst(RegExp(r'ws/?$'), '');
}

Future<void> main(List<String> args) async {
  final positional = args.where((a) => !a.startsWith('--')).toList();
  if (positional.isEmpty) {
    stderr.writeln(
      'usage: drive.dart <shot|tap|tapkey|taptype|rect|type|typefile|wait> [arg]',
    );
    exit(64);
  }
  final cmd = positional.first;
  final arg = positional.length > 1 ? positional[1] : null;
  final uri = await _resolveUri(args);

  final driver = await FlutterDriver.connect(dartVmServiceUrl: uri);
  // enableFlutterDriverExtension() defaults enableTextEntryEmulation to true,
  // which registers a MOCK text input in place of the platform one. That is
  // what driver.enterText() writes into - and while it is registered, focusing
  // a TextField never asks iOS for a keyboard, so the on-screen keyboard never
  // appears for the human holding the phone. Only lib/main_dev.dart is
  // affected; real builds use lib/main.dart and have no extension at all.
  //
  // So: keep the real keyboard by default, and register the mock only for the
  // two commands that actually need it, unregistering again straight after.
  final needsTextEntry = cmd == 'type' || cmd == 'typefile';
  await driver.setTextEntryEmulation(enabled: needsTextEntry);
  try {
    switch (cmd) {
      case 'shot':
        final bytes = await driver.screenshot();
        final out = File(arg ?? '/tmp/box-mobile-shot.png');
        await out.writeAsBytes(bytes);
        stdout.writeln('wrote ${out.path} (${bytes.length} bytes)');
      case 'tap':
        await driver.tap(find.text(arg!));
        stdout.writeln('tapped text: $arg');
      case 'taptip':
        // Tap an icon button by its tooltip ("Settings", "Back").
        await driver.tap(find.byTooltip(arg!));
        stdout.writeln('tapped tooltip: $arg');
      case 'back':
        await driver.tap(find.pageBack());
        stdout.writeln('tapped back');
      case 'tapkey':
        await driver.tap(find.byValueKey(arg!));
        stdout.writeln('tapped key: $arg');
      case 'taptype':
        // Tap the first widget of a runtime type, e.g. TextField. Needed to
        // focus an input: tapping its hint text does not reliably focus it.
        await driver.tap(find.byType(arg!));
        stdout.writeln('tapped type: $arg');
      case 'rect':
        // Numeric layout probe, in logical pixels. Eyeballing a 3x screenshot
        // is how two attempts at the composer centring went wrong; this reads
        // the render box straight off the tree instead.
        final tl = await driver.getTopLeft(find.byType(arg!));
        final br = await driver.getBottomRight(find.byType(arg));
        stdout.writeln(
          '$arg: left=${tl.dx} top=${tl.dy} right=${br.dx} bottom=${br.dy} '
          'w=${br.dx - tl.dx} h=${br.dy - tl.dy}',
        );
      case 'type':
        await driver.enterText(arg!);
        stdout.writeln('entered ${arg.length} chars');
      case 'typefile':
        // Read the value from disk so it never appears in argv, shell history,
        // or this process's command line.
        final value = (await File(arg!).readAsString()).trim();
        await driver.enterText(value);
        stdout.writeln('entered ${value.length} chars from file');
      case 'wait':
        await driver.waitFor(
          find.text(arg!),
          timeout: const Duration(seconds: 20),
        );
        stdout.writeln('found: $arg');
      default:
        stderr.writeln('unknown command: $cmd');
        exit(64);
    }
  } finally {
    // Never leave the mock registered - it would silently kill the keyboard
    // for the next person to pick up the phone.
    if (needsTextEntry) {
      await driver.setTextEntryEmulation(enabled: false);
    }
    await driver.close();
  }
  exit(0);
}

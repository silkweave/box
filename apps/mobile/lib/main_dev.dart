// Dev-only entrypoint: the normal app plus the flutter_driver extension, so an
// agent can tap, type, scroll and screenshot the running app over the VM
// service (tool/drive.dart). NEVER ship this target.
//
//   scripts/dev.sh sim     (runs this file)
// ignore: depend_on_referenced_packages
import 'package:flutter_driver/driver_extension.dart';

import 'main.dart' as app;

Future<void> main() async {
  // Text entry emulation defaults to on, which replaces the platform text
  // input for the whole session: a human holding the device could then type
  // nothing. tool/drive.dart turns it on only while it types.
  enableFlutterDriverExtension(enableTextEntryEmulation: false);
  await app.main();
}

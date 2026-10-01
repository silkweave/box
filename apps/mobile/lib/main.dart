// The app entry point. Everything the app does comes from the framework
// (packages/mobile, `box_mobile`) and the feature modules registered in
// lib/generated/modules.dart. Box identity lives in lib/app_config.dart.
import 'package:box_mobile/box_mobile.dart';

import 'app_config.dart';
import 'generated/modules.dart';

Future<void> main() => runBoxApp(config: appConfig, modules: mobileModules);

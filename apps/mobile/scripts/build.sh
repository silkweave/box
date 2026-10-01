#!/usr/bin/env bash
# Release build with this Box's address compiled in, so sign-in only asks for the access token.
#
#   scripts/build.sh ios     [--server <url>] [--install <device id>] [-- <flutter args>]
#   scripts/build.sh android [--server <url>] [--install <adb serial>] [-- <flutter args>]
#
# The address defaults to `server.dashboardUrl` (box.local.json, then box.json): the address people
# use for this Box, for example https://box.example.ts.net from `tailscale serve`. It becomes
# BOX_SERVER_URL and is fixed for the build: sign-in shows no Server field, only the token. With no
# address the app asks for one. --install puts the build on a USB-connected device and
# opens it (`xcrun devicectl list devices` or `adb devices` lists ids).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/box-settings.sh

target="${1:-}"
[[ "$target" == ios || "$target" == android ]] || { sed -n '4,5p' "$0" >&2; exit 2; }
shift
server=""
device=""
extra=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --server) server="$2"; shift 2 ;;
    --install) device="$2"; shift 2 ;;
    --) shift; extra=("$@"); break ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

server="${server:-$(box_setting dashboardUrl)}"
server="${server%/}"
if [[ -z "$server" ]]; then
  echo "==> no server.dashboardUrl and no --server: the app will ask for the address"
elif curl -sf -o /dev/null --max-time 5 "${server}/api/auth/me"; then
  echo "==> building for ${server}"
else
  echo "==> building for ${server} (not answering from here right now)"
fi

args=(--release --dart-define=BOX_SERVER_URL="$server")

if [[ "$target" == ios ]]; then
  mkdir -p build/ios/SourcePackages
  flutter build ios "${args[@]}" ${extra[@]+"${extra[@]}"}
  if [[ -n "$device" ]]; then
    app_id="$(sed -n 's/.*PRODUCT_BUNDLE_IDENTIFIER = \([^;.]*\.[^;]*\);/\1/p' ios/Runner.xcodeproj/project.pbxproj | grep -v Tests | head -1)"
    xcrun devicectl device install app --device "$device" build/ios/iphoneos/Runner.app
    xcrun devicectl device process launch --device "$device" "$app_id"
  fi
else
  flutter build apk "${args[@]}" ${extra[@]+"${extra[@]}"}
  if [[ -n "$device" ]]; then
    app_id="$(sed -n 's/.*applicationId = "\(.*\)".*/\1/p' android/app/build.gradle.kts | head -1)"
    adb -s "$device" install -r build/app/outputs/flutter-apk/app-release.apk
    adb -s "$device" shell monkey -p "$app_id" -c android.intent.category.LAUNCHER 1 >/dev/null
  fi
fi

#!/usr/bin/env bash
# Development session with hot reload and the flutter_driver extension
# (lib/main_dev.dart), so an agent can drive it with tool/drive.dart.
#
#   scripts/dev.sh sim   [--device <udid>] [--server <url>] [-- <flutter args>]
#   scripts/dev.sh phone  --device <udid> [--server <url>] [-- <flutter args>]
#
# The server defaults to the Box in this checkout (`box dev`, port from
# box.local.json or box.json `server.port`). A physical phone cannot reach this
# Mac's 127.0.0.1, so `phone` defaults to `server.dashboardUrl` (the address
# people use, e.g. from `tailscale serve`), then to this Mac's Tailscale IP;
# otherwise pass --server http://<lan-ip>:<port>.
#
# A test user's token can prefill sign-in: put {"BOX_DEV_TOKEN": "..."} in the
# gitignored apps/mobile/dev-defines.json (mint it with
# `box auth token <id> --quiet`; never echo it into a transcript).
#
# Reload without touching the terminal: scripts/reload.sh <sim|phone> [--restart]
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/box-settings.sh

target="${1:-}"
[[ "$target" == sim || "$target" == phone ]] || { sed -n '5,8p' "$0" >&2; exit 2; }
shift
device=""
server=""
extra=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --device) device="$2"; shift 2 ;;
    --server) server="$2"; shift 2 ;;
    --) shift; extra=("$@"); break ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

port="$(box_setting port)"
port="${port:-8190}"

if [[ -z "$server" ]]; then
  if [[ "$target" == sim ]]; then
    server="http://127.0.0.1:${port}"
  elif [[ -n "$(box_setting dashboardUrl)" ]]; then
    server="$(box_setting dashboardUrl)"
    server="${server%/}"
  else
    ip="$(tailscale ip -4 2>/dev/null | head -1 || true)"
    [[ -n "$ip" ]] || { echo "phone needs --server http://<reachable-ip>:${port} (no Tailscale IP found)" >&2; exit 1; }
    server="http://${ip}:${port}"
  fi
fi
if ! curl -sf -o /dev/null --max-time 5 "${server}/api/auth/me"; then
  echo "No Box answering at ${server} - start one with 'box dev' at the repo root." >&2
  exit 1
fi
echo "==> pointing the app at ${server}"

args=(-t lib/main_dev.dart
  --dart-define=BOX_SERVER_URL="$server"
  --pid-file "/tmp/box-mobile-${target}.pid"
  --vmservice-out-file "/tmp/box-mobile-${target}.vmservice")
[[ -f dev-defines.json ]] && args+=(--dart-define-from-file=dev-defines.json)
if [[ -n "$device" ]]; then
  args+=(-d "$device")
elif [[ "$target" == sim ]]; then
  open -g -a Simulator
  args+=(-d iPhone)
else
  echo "phone needs --device <udid> (flutter devices lists them)" >&2; exit 2
fi
exec flutter run "${args[@]}" ${extra[@]+"${extra[@]}"}

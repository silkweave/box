#!/usr/bin/env bash
# Hot-reload (or hot-restart) a running scripts/dev.sh session without touching
# its terminal.   usage: scripts/reload.sh [sim|phone] [--restart]
set -euo pipefail
target="${1:-sim}"
sig=USR1
[ "${2:-}" = "--restart" ] && sig=USR2
kill -"$sig" "$(cat "/tmp/box-mobile-$target.pid")"
echo "sent SIG$sig to box-mobile-$target"

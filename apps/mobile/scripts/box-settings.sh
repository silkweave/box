# Sourced by the mobile scripts: read this Box's `server` settings without a second config file.
#
#   box_setting port           -> 8190
#   box_setting dashboardUrl   -> https://box.example.ts.net (empty when unset)
#
# box.local.json wins over box.json, as on the server. Run from apps/mobile.
box_setting() {
  python3 - "$1" <<'PY' 2>/dev/null || true
import json, sys
for name in ("../../box.local.json", "../../box.json"):
    try:
        value = (json.load(open(name)).get("server") or {}).get(sys.argv[1])
    except (OSError, ValueError):
        continue
    if value:
        print(value)
        break
PY
}

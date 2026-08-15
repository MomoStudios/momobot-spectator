#!/usr/bin/env bash
set -euo pipefail

PUBLIC_URL=${PUBLIC_URL:-https://momobot.runtimeexception.net}
RS_SDK_ROOT=${RS_SDK_ROOT:-/home/moltbot/clawd/rs-sdk}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SOURCE_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
STATE_FILE=$(mktemp)
BOUNDARY_HEADERS=$(mktemp)
trap 'rm -f "$STATE_FILE" "$BOUNDARY_HEADERS"' EXIT

log() { printf '[momobot-verify] %s\n' "$*"; }
retry() {
    local description=$1
    shift
    for _ in $(seq 1 45); do
        if "$@"; then return 0; fi
        sleep 1
    done
    printf '[momobot-verify] ERROR: timed out waiting for %s\n' "$description" >&2
    return 1
}
CURL=(curl -fsS --connect-timeout 3 --max-time 8)
json_ok() { "${CURL[@]}" "$1" | python3 -c 'import json,sys; raise SystemExit(0 if json.load(sys.stdin) == {"ok": True} else 1)'; }
stream_ready() { "${CURL[@]}" "$1" | python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("browserConnected") and d.get("gameReady") and d.get("frameAgeMs", 999999) < 5000 else 1)'; }

log 'checking deployed source drift'
command -v rsync >/dev/null
DASHBOARD_DRIFT=$(rsync -ain --omit-dir-times --delete --exclude worldmap.jag "$SOURCE_ROOT/spectator/" "$RS_SDK_ROOT/spectator/")
STREAM_DRIFT=$(rsync -ain --omit-dir-times --delete "$SOURCE_ROOT/full-client-stream/" "$RS_SDK_ROOT/spikes/001-full-client-stream/")
if [[ -n "$DASHBOARD_DRIFT" || -n "$STREAM_DRIFT" ]]; then
    printf '[momobot-verify] ERROR: deployed overlay differs from canonical source\n%s\n%s\n' "$DASHBOARD_DRIFT" "$STREAM_DRIFT" >&2
    exit 1
fi

log 'checking legacy Funnel has no routes'
if command -v tailscale >/dev/null; then
    FUNNEL_STATUS=$(tailscale funnel status --json 2>/dev/null) || {
        printf '[momobot-verify] ERROR: unable to inspect Tailscale Funnel routes\n' >&2
        exit 1
    }
    python3 -c 'import json,sys; raise SystemExit(1 if json.load(sys.stdin) else 0)' <<<"$FUNNEL_STATUS"
fi

log 'checking services'
systemctl --user is-active --quiet momobot-spectator.service
systemctl --user is-active --quiet momobot-full-client-stream.service
sudo systemctl is-active --quiet cloudflared-momobot.service

log 'checking loopback origins'
retry 'local dashboard' json_ok http://127.0.0.1:3210/healthz
retry 'local rendered client' stream_ready http://127.0.0.1:3211/healthz
[[ $(curl -sS --connect-timeout 3 --max-time 8 -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:3210/api/state) == 405 ]]

log 'checking public routes'
retry 'public dashboard' json_ok "$PUBLIC_URL/healthz"
retry 'public rendered client' stream_ready "$PUBLIC_URL/client/healthz"
[[ $(curl -sS --connect-timeout 3 --max-time 8 -o /dev/null -w '%{http_code}' -X POST "$PUBLIC_URL/api/state") == 405 ]]
"${CURL[@]}" "$PUBLIC_URL/api/state" -o "$STATE_FILE"
curl -sS --connect-timeout 3 --max-time 8 -D "$BOUNDARY_HEADERS" -o /dev/null "$PUBLIC_URL/clientevil"
python3 - "$BOUNDARY_HEADERS" <<'PY'
import sys
headers = open(sys.argv[1]).read().lower()
if "frame-src 'self'" not in headers:
    raise SystemExit('overbroad /client tunnel route is still authoritative')
if "connect-src 'self' ws: wss:" in headers:
    raise SystemExit('boundary probe reached stream service')
PY

python3 - "$STATE_FILE" <<'PY'
import json
import re
import sys

payload = json.load(open(sys.argv[1]))
state = payload.get('state') or {}
fields = set()
def walk(value):
    if isinstance(value, dict):
        for key, child in value.items():
            fields.add(key)
            walk(child)
    elif isinstance(value, list):
        for child in value:
            walk(child)
walk(payload)
for field in fields:
    if re.search(r'password|api.?key|authorization|credential|gateway.?url|session.?id|secret|token', field, re.I):
        raise SystemExit(f'private field exposed: {field}')
for key, allowed in (('gameMessages', {0}), ('chatMessages', {1, 2})):
    for message in state.get(key, []):
        if message.get('type') not in allowed:
            raise SystemExit(f'private message type exposed: {key}={message.get("type")}')
PY

log 'checking tunnel metrics'
metric() {
    local name=$1
    "${CURL[@]}" http://127.0.0.1:20241/metrics | python3 -c "import re,sys; s=sys.stdin.read(); m=re.search(r'^${name} (\\d+)$', s, re.M); print(m.group(1) if m else 0)"
}
ha_ready() { (( $(metric cloudflared_tunnel_ha_connections) >= 2 )); }
retry 'at least two Cloudflare HA connections' ha_ready
HA=$(metric cloudflared_tunnel_ha_connections)
ERRORS=$(metric cloudflared_tunnel_request_errors)

log "verified public deployment (HA connections: $HA, cumulative tunnel request errors: $ERRORS)"

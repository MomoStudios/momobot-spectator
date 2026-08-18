#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DEFAULT_SOURCE=$(cd "$SCRIPT_DIR/.." && pwd)
SOURCE_REPO=${SOURCE_REPO:-$DEFAULT_SOURCE}
RS_SDK_ROOT=${RS_SDK_ROOT:-/home/moltbot/clawd/rs-sdk}
SYSTEMD_USER_DIR=${SYSTEMD_USER_DIR:-$HOME/.config/systemd/user}
SYSTEMD_SYSTEM_DIR=${SYSTEMD_SYSTEM_DIR:-/etc/systemd/system}
CLOUDFLARED_CONFIG_DIR=${CLOUDFLARED_CONFIG_DIR:-/etc/cloudflared}
DEPLOY_STATE_DIR=${DEPLOY_STATE_DIR:-$HOME/.local/state/momobot-spectator}
PUBLIC_URL=${PUBLIC_URL:-https://momobot.runtimeexception.net}
CHECK_ONLY=0
SKIP_TESTS=${SKIP_TESTS:-0}
SKIP_MANIFEST_VALIDATION=${SKIP_MANIFEST_VALIDATION:-0}
SKIP_SERVICE_ACTIONS=${SKIP_SERVICE_ACTIONS:-0}

usage() {
    cat <<'EOF'
Usage: deploy/install.sh [--check]

  --check  Validate the committed source, runtime, manifests, and staged tests
           without installing files or restarting services.
EOF
}

log() { printf '[momobot-deploy] %s\n' "$*"; }
die() { printf '[momobot-deploy] ERROR: %s\n' "$*" >&2; exit 1; }
validate_boolean() {
    local name=$1 value=$2
    case "$value" in
        0|1) ;;
        *) die "$name must be 0 or 1" ;;
    esac
}
validate_boolean SKIP_TESTS "$SKIP_TESTS"
validate_boolean SKIP_MANIFEST_VALIDATION "$SKIP_MANIFEST_VALIDATION"
validate_boolean SKIP_SERVICE_ACTIONS "$SKIP_SERVICE_ACTIONS"

for arg in "$@"; do
    case "$arg" in
        --check) CHECK_ONLY=1 ;;
        --help|-h) usage; exit 0 ;;
        *) usage >&2; die "unknown argument: $arg" ;;
    esac
done

for command in git tar install mv cp curl python3 flock; do
    command -v "$command" >/dev/null || die "required command not found: $command"
done
if (( ! SKIP_SERVICE_ACTIONS )); then
    command -v systemctl >/dev/null || die "required command not found: systemctl"
    command -v sudo >/dev/null || die "required command not found: sudo"
    if command -v tailscale >/dev/null; then
        FUNNEL_STATUS=$(tailscale funnel status --json 2>/dev/null) || die "unable to inspect Tailscale Funnel routes"
        FUNNEL_STATE=$(python3 -c 'import json,sys; data=json.load(sys.stdin); print("active" if data else "empty")' <<<"$FUNNEL_STATUS") || \
            die "unable to parse Tailscale Funnel routes"
        [[ "$FUNNEL_STATE" == empty ]] || die "legacy Tailscale Funnel routes are still active"
    fi
fi

[[ -d "$SOURCE_REPO/.git" ]] || die "source is not a Git checkout: $SOURCE_REPO"
[[ -d "$RS_SDK_ROOT/sdk" && -d "$RS_SDK_ROOT/spikes" ]] || \
    die "rs-sdk runtime is missing or incomplete: $RS_SDK_ROOT"
[[ -f "$RS_SDK_ROOT/spectator/public/worldmap.jag" && ! -L "$RS_SDK_ROOT/spectator/public/worldmap.jag" ]] || \
    die "required local asset is missing or not a regular file: $RS_SDK_ROOT/spectator/public/worldmap.jag"
BOT_ENV="$RS_SDK_ROOT/bots/momobot/bot.env"
[[ -f "$BOT_ENV" && ! -L "$BOT_ENV" ]] || die "required bot.env is missing or not a regular file: $BOT_ENV"
[[ $(stat -c '%u' "$BOT_ENV") == "$(id -u)" ]] || die "bot.env must be owned by the deployment user"
[[ $(stat -c '%a' "$BOT_ENV") == 600 ]] || die "bot.env must have mode 0600"

DIRTY=$(git -C "$SOURCE_REPO" status --porcelain --untracked-files=normal)
[[ -z "$DIRTY" ]] || die "source checkout is dirty; commit or clean it before deployment"

DEPLOY_SHA=$(git -C "$SOURCE_REPO" rev-parse HEAD)
SHORT_SHA=${DEPLOY_SHA:0:12}
for tracked in \
    spectator/server.ts \
    full-client-stream/stream-server.mjs \
    deploy/cloudflared/momobot.yml \
    deploy/systemd/momobot-spectator.service \
    deploy/systemd/momobot-full-client-stream.service \
    deploy/systemd/cloudflared-momobot.service; do
    git -C "$SOURCE_REPO" cat-file -e "$DEPLOY_SHA:$tracked" 2>/dev/null || \
        die "required tracked file is missing from $DEPLOY_SHA: $tracked"
done

TMP_DIR=$(mktemp -d)
NEXT_SPECTATOR="$RS_SDK_ROOT/spectator.__next_${SHORT_SHA}_$$"
NEXT_STREAM="$RS_SDK_ROOT/spikes/001-full-client-stream.__next_${SHORT_SHA}_$$"
BACKUP_DIR="$DEPLOY_STATE_DIR/backups/$(date +%Y%m%d_%H%M%S)-$SHORT_SHA-$$"
SPECTATOR_BACKED_UP=0
STREAM_BACKED_UP=0
SPECTATOR_ACTIVATED=0
STREAM_ACTIVATED=0
MANIFESTS_INSTALLED=0
CREDENTIAL_METADATA_CHANGED=0
STATE_FILE_CHANGED=0
PRODUCTION_MUTATED=0
DEPLOY_SUCCEEDED=0

cleanup_stage() {
    if [[ -d "$NEXT_SPECTATOR" ]]; then mv "$NEXT_SPECTATOR" "$TMP_DIR/abandoned-spectator" 2>/dev/null || true; fi
    if [[ -d "$NEXT_STREAM" ]]; then mv "$NEXT_STREAM" "$TMP_DIR/abandoned-stream" 2>/dev/null || true; fi
    rm -rf "$TMP_DIR"
}

backup_file() {
    local installed=$1 backup=$2 privileged=${3:-0}
    [[ -e "$installed" || -L "$installed" ]] || return 0
    if (( privileged )); then
        sudo cat "$installed" > "$backup"
        sudo stat -c '%a %u %g' "$installed" > "$backup.meta"
    else
        cp -a "$installed" "$backup"
        stat -c '%a %u %g' "$installed" > "$backup.meta"
    fi
}

restore_file() {
    local installed=$1 backup=$2 privileged=${3:-0}
    if [[ -f "$backup" ]]; then
        local mode uid gid
        read -r mode uid gid < "$backup.meta"
        if (( privileged )); then
            sudo install -m "$mode" -o "$uid" -g "$gid" "$backup" "$installed"
        else
            install -m "$mode" "$backup" "$installed"
            chgrp "$gid" "$installed"
            [[ $(stat -c '%u %g' "$installed") == "$uid $gid" ]] || {
                log "could not restore ownership metadata for $installed"
                return 1
            }
        fi
    elif [[ -e "$installed" || -L "$installed" ]]; then
        mkdir -p "$BACKUP_DIR/failed-manifests"
        if (( privileged )); then sudo mv "$installed" "$BACKUP_DIR/failed-manifests/"; else mv "$installed" "$BACKUP_DIR/failed-manifests/"; fi
    fi
}

local_origins_ready() {
    curl -fsS --connect-timeout 3 --max-time 8 http://127.0.0.1:3210/healthz >/dev/null 2>&1 &&
    curl -fsS --connect-timeout 3 --max-time 8 http://127.0.0.1:3211/healthz |
        python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("browserConnected") and d.get("gameReady") and d.get("frameAgeMs", 999999) < 5000 else 1)' >/dev/null 2>&1
}

wait_for_local_origins() {
    local attempt
    for (( attempt=1; attempt<=90; attempt++ )); do
        local_origins_ready && return 0
        sleep 1
    done
    return 1
}

rollback() {
    local status=$1 rollback_failed=0
    trap - ERR INT TERM HUP
    set +e
    (( DEPLOY_SUCCEEDED )) && exit 0
    if (( ! PRODUCTION_MUTATED )); then
        cleanup_stage
        exit "$status"
    fi
    rollback_attempt() {
        local description=$1
        shift
        if ! "$@"; then
            log "rollback step failed: $description"
            rollback_failed=1
        fi
    }
    log "deployment failed; restoring previous state"
    rollback_attempt 'create rollback holding directory' mkdir -p "$BACKUP_DIR/failed-overlay"
    if (( SPECTATOR_ACTIVATED )) && [[ -d "$RS_SDK_ROOT/spectator" ]]; then
        rollback_attempt 'quarantine failed dashboard overlay' mv "$RS_SDK_ROOT/spectator" "$BACKUP_DIR/failed-overlay/spectator"
    fi
    if (( STREAM_ACTIVATED )) && [[ -d "$RS_SDK_ROOT/spikes/001-full-client-stream" ]]; then
        rollback_attempt 'quarantine failed stream overlay' mv "$RS_SDK_ROOT/spikes/001-full-client-stream" "$BACKUP_DIR/failed-overlay/full-client-stream"
    fi
    if (( SPECTATOR_BACKED_UP )) && [[ -d "$BACKUP_DIR/runtime/spectator" ]]; then
        rollback_attempt 'restore dashboard overlay' mv "$BACKUP_DIR/runtime/spectator" "$RS_SDK_ROOT/spectator"
    fi
    if (( STREAM_BACKED_UP )) && [[ -d "$BACKUP_DIR/runtime/full-client-stream" ]]; then
        rollback_attempt 'restore stream overlay' mv "$BACKUP_DIR/runtime/full-client-stream" "$RS_SDK_ROOT/spikes/001-full-client-stream"
    fi
    if (( MANIFESTS_INSTALLED )); then
        rollback_attempt 'restore dashboard unit' restore_file "$SYSTEMD_USER_DIR/momobot-spectator.service" "$BACKUP_DIR/manifests/momobot-spectator.service"
        rollback_attempt 'restore stream unit' restore_file "$SYSTEMD_USER_DIR/momobot-full-client-stream.service" "$BACKUP_DIR/manifests/momobot-full-client-stream.service"
        rollback_attempt 'restore cloudflared unit' restore_file "$SYSTEMD_SYSTEM_DIR/cloudflared-momobot.service" "$BACKUP_DIR/manifests/cloudflared-momobot.service" 1
        rollback_attempt 'restore cloudflared config' restore_file "$CLOUDFLARED_CONFIG_DIR/momobot.yml" "$BACKUP_DIR/manifests/momobot.yml" 1
    fi
    if (( CREDENTIAL_METADATA_CHANGED )) && [[ -f "$BACKUP_DIR/manifests/cloudflared-credential.meta" ]]; then
        local credential_mode credential_uid credential_gid
        read -r credential_mode credential_uid credential_gid < "$BACKUP_DIR/manifests/cloudflared-credential.meta"
        rollback_attempt 'restore cloudflared credential owner' sudo chown "$credential_uid:$credential_gid" "$CREDENTIAL_FILE"
        rollback_attempt 'restore cloudflared credential mode' sudo chmod "$credential_mode" "$CREDENTIAL_FILE"
    fi
    if (( STATE_FILE_CHANGED )); then
        rollback_attempt 'restore deployment state' restore_file "$DEPLOY_STATE_DIR/deployment-state.json" "$BACKUP_DIR/deployment-state.json"
    fi
    if (( ! SKIP_SERVICE_ACTIONS )); then
        rollback_attempt 'reload user systemd' systemctl --user daemon-reload
        rollback_attempt 'restart restored origins' systemctl --user restart momobot-spectator.service momobot-full-client-stream.service
        rollback_attempt 'reload system systemd' sudo systemctl daemon-reload
        if wait_for_local_origins; then
            rollback_attempt 'restart restored tunnel' sudo systemctl restart cloudflared-momobot.service
        else
            log "restored origins did not become healthy; stopping tunnel for safe failure"
            rollback_attempt 'stop tunnel after unhealthy rollback' sudo systemctl stop cloudflared-momobot.service
            rollback_failed=1
        fi
    fi
    cleanup_stage
    if (( rollback_failed )); then
        log "CRITICAL: rollback incomplete; inspect $BACKUP_DIR"
        exit 125
    fi
    exit "$status"
}
trap 'rollback $?' ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM
trap 'rollback 129' HUP
trap cleanup_stage EXIT

log "exporting committed source $DEPLOY_SHA"
git -C "$SOURCE_REPO" archive --format=tar "$DEPLOY_SHA" spectator full-client-stream deploy | tar -xpf - -C "$TMP_DIR"

if (( ! SKIP_MANIFEST_VALIDATION )); then
    command -v cloudflared >/dev/null || die "cloudflared is required for ingress validation"
    command -v systemd-analyze >/dev/null || die "systemd-analyze is required for unit validation"
    cloudflared tunnel --config "$TMP_DIR/deploy/cloudflared/momobot.yml" ingress validate
    systemd-analyze verify "$TMP_DIR"/deploy/systemd/*.service
fi

cp -a "$TMP_DIR/spectator" "$NEXT_SPECTATOR"
cp -a "$TMP_DIR/full-client-stream" "$NEXT_STREAM"
mkdir -p "$NEXT_SPECTATOR/public"
install -m 0644 "$RS_SDK_ROOT/spectator/public/worldmap.jag" "$NEXT_SPECTATOR/public/worldmap.jag"

if (( ! SKIP_TESTS )); then
    command -v bun >/dev/null || die "bun is required for staged tests"
    log "running staged dashboard tests"
    (trap - ERR INT TERM HUP; cd "$RS_SDK_ROOT" && bun test "$(basename "$NEXT_SPECTATOR")")
    log "running staged stream tests"
    (trap - ERR INT TERM HUP; cd "$RS_SDK_ROOT" && bun test "spikes/$(basename "$NEXT_STREAM")")
    log "running TypeScript validation"
    (trap - ERR INT TERM HUP; cd "$RS_SDK_ROOT" && bunx tsc --noEmit)
    log "running strict spectator TypeScript validation"
    (trap - ERR INT TERM HUP; cd "$RS_SDK_ROOT" && bunx tsc \
        --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --types bun --skipLibCheck \
        "$NEXT_SPECTATOR/server.ts" \
        "$NEXT_SPECTATOR/state.ts" \
        "$NEXT_SPECTATOR/mission.ts" \
        "$NEXT_SPECTATOR/controller-status.ts" \
        "$NEXT_SPECTATOR/observer-watchdog.ts" \
        "$NEXT_SPECTATOR/set-public-mission.ts")
fi

if (( CHECK_ONLY )); then
    log "check mode: source, runtime, asset, manifests, and staged tests are valid"
    exit 0
fi

mkdir -p "$DEPLOY_STATE_DIR"
exec 9>"$DEPLOY_STATE_DIR/deploy.lock"
flock -n 9 || die "another deployment is already in progress"

PRIVILEGED_INSTALL=0
CREDENTIAL_FILE=
if [[ "$SYSTEMD_SYSTEM_DIR" == /etc/* || "$CLOUDFLARED_CONFIG_DIR" == /etc/* ]]; then
    PRIVILEGED_INSTALL=1
    CREDENTIAL_FILE=$(python3 -c 'import sys; print(next(line.split(":", 1)[1].strip() for line in open(sys.argv[1]) if line.startswith("credentials-file:")))' "$TMP_DIR/deploy/cloudflared/momobot.yml")
    [[ "$CREDENTIAL_FILE" == /etc/cloudflared/*.json ]] || die "configured Cloudflare credential path is outside /etc/cloudflared"
    sudo test -f "$CREDENTIAL_FILE" || die "configured Cloudflare credential file is missing"
    sudo test ! -L "$CREDENTIAL_FILE" || die "configured Cloudflare credential file must not be a symlink"
    read -r CREDENTIAL_UID CREDENTIAL_MODE < <(sudo stat -c '%u %a' "$CREDENTIAL_FILE")
    [[ "$CREDENTIAL_UID" == 0 ]] || die "Cloudflare credential file must be owned by root"
    [[ "$CREDENTIAL_MODE" == 600 || "$CREDENTIAL_MODE" == 640 ]] || die "Cloudflare credential file must have mode 0600 or 0640"
fi

mkdir -p "$BACKUP_DIR/runtime" "$BACKUP_DIR/manifests" "$SYSTEMD_USER_DIR"
backup_file "$DEPLOY_STATE_DIR/deployment-state.json" "$BACKUP_DIR/deployment-state.json"
backup_file "$SYSTEMD_USER_DIR/momobot-spectator.service" "$BACKUP_DIR/manifests/momobot-spectator.service"
backup_file "$SYSTEMD_USER_DIR/momobot-full-client-stream.service" "$BACKUP_DIR/manifests/momobot-full-client-stream.service"
if (( PRIVILEGED_INSTALL )); then
    backup_file "$SYSTEMD_SYSTEM_DIR/cloudflared-momobot.service" "$BACKUP_DIR/manifests/cloudflared-momobot.service" 1
    backup_file "$CLOUDFLARED_CONFIG_DIR/momobot.yml" "$BACKUP_DIR/manifests/momobot.yml" 1
    sudo stat -c '%a %u %g' "$CREDENTIAL_FILE" > "$BACKUP_DIR/manifests/cloudflared-credential.meta"
fi
PRODUCTION_MUTATED=1
MANIFESTS_INSTALLED=1

install -m 0644 "$TMP_DIR/deploy/systemd/momobot-spectator.service" "$SYSTEMD_USER_DIR/momobot-spectator.service"
install -m 0644 "$TMP_DIR/deploy/systemd/momobot-full-client-stream.service" "$SYSTEMD_USER_DIR/momobot-full-client-stream.service"

if (( PRIVILEGED_INSTALL )); then
    if ! getent group cloudflared >/dev/null 2>&1; then
        sudo groupadd --system cloudflared
    fi
    if ! id cloudflared >/dev/null 2>&1; then
        sudo useradd --system --gid cloudflared --home-dir /nonexistent --shell /usr/sbin/nologin cloudflared
    fi
    sudo install -d -m 0750 -o root -g cloudflared "$CLOUDFLARED_CONFIG_DIR"
    sudo install -m 0644 -o root -g root "$TMP_DIR/deploy/systemd/cloudflared-momobot.service" "$SYSTEMD_SYSTEM_DIR/cloudflared-momobot.service"
    sudo install -m 0640 -o root -g cloudflared "$TMP_DIR/deploy/cloudflared/momobot.yml" "$CLOUDFLARED_CONFIG_DIR/momobot.yml"
    CREDENTIAL_METADATA_CHANGED=1
    sudo chown root:cloudflared "$CREDENTIAL_FILE"
    sudo chmod 0640 "$CREDENTIAL_FILE"
else
    mkdir -p "$SYSTEMD_SYSTEM_DIR" "$CLOUDFLARED_CONFIG_DIR"
    install -m 0644 "$TMP_DIR/deploy/systemd/cloudflared-momobot.service" "$SYSTEMD_SYSTEM_DIR/cloudflared-momobot.service"
    install -m 0644 "$TMP_DIR/deploy/cloudflared/momobot.yml" "$CLOUDFLARED_CONFIG_DIR/momobot.yml"
fi

SPECTATOR_BACKED_UP=1
mv "$RS_SDK_ROOT/spectator" "$BACKUP_DIR/runtime/spectator"
STREAM_BACKED_UP=1
mv "$RS_SDK_ROOT/spikes/001-full-client-stream" "$BACKUP_DIR/runtime/full-client-stream"
SPECTATOR_ACTIVATED=1
mv "$NEXT_SPECTATOR" "$RS_SDK_ROOT/spectator"
STREAM_ACTIVATED=1
mv "$NEXT_STREAM" "$RS_SDK_ROOT/spikes/001-full-client-stream"

if (( ! SKIP_SERVICE_ACTIONS )); then
    log "restarting loopback origins"
    systemctl --user daemon-reload
    systemctl --user restart momobot-spectator.service momobot-full-client-stream.service
    wait_for_local_origins || {
        log "loopback origins did not become healthy after restart"
        false
    }

    log "restarting Cloudflare tunnel"
    sudo systemctl daemon-reload
    sudo systemctl restart cloudflared-momobot.service
    PUBLIC_URL="$PUBLIC_URL" "$TMP_DIR/deploy/verify.sh"
fi

RUNTIME_REVISION=$(git -C "$RS_SDK_ROOT" rev-parse HEAD 2>/dev/null || printf 'unknown')
STATE_TMP=$(mktemp "$DEPLOY_STATE_DIR/.deployment-state.XXXXXX")
python3 - "$DEPLOY_SHA" "$RUNTIME_REVISION" > "$STATE_TMP" <<'PY'
import json
import sys
json.dump({"deployedRevision": sys.argv[1], "runtimeRevision": sys.argv[2]}, sys.stdout, sort_keys=True)
sys.stdout.write("\n")
PY
STATE_FILE_CHANGED=1
mv "$STATE_TMP" "$DEPLOY_STATE_DIR/deployment-state.json"
DEPLOY_SUCCEEDED=1
trap - ERR INT TERM HUP
log "deployed $DEPLOY_SHA"
log "rollback backup: $BACKUP_DIR"

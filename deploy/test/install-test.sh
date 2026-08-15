#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
DEPLOY_SCRIPT="$PROJECT_ROOT/deploy/install.sh"
PASS=0
FAIL=0

pass() { printf 'ok - %s\n' "$1"; PASS=$((PASS + 1)); }
fail() { printf 'not ok - %s\n' "$1" >&2; FAIL=$((FAIL + 1)); }
assert_file() { if [[ ! -f "$1" ]]; then fail "$2 (missing $1)"; fi; }
assert_no_file() { if [[ -e "$1" ]]; then fail "$2 (unexpected $1)"; fi; }
assert_contains() { if ! grep -Fq "$2" "$1"; then fail "$3"; fi; }

make_fixture() {
    FIXTURE=$(mktemp -d)
    SOURCE="$FIXTURE/source"
    RUNTIME="$FIXTURE/runtime"
    OUTPUT="$FIXTURE/output"
    mkdir -p "$SOURCE/spectator/public" "$SOURCE/full-client-stream" \
        "$SOURCE/deploy/cloudflared" "$SOURCE/deploy/systemd" \
        "$RUNTIME/sdk" "$RUNTIME/spectator/public" "$RUNTIME/bots/momobot" \
        "$RUNTIME/spikes/001-full-client-stream" "$OUTPUT"

    printf 'export const sdk = true;\n' > "$RUNTIME/sdk/index.ts"
    printf 'old\n' > "$RUNTIME/spectator/stale.txt"
    printf 'old-stream\n' > "$RUNTIME/spikes/001-full-client-stream/stale.txt"
    printf 'licensed-map-data\n' > "$RUNTIME/spectator/public/worldmap.jag"
    printf 'PASSWORD=fixture-only\n' > "$RUNTIME/bots/momobot/bot.env"
    chmod 0600 "$RUNTIME/bots/momobot/bot.env"

    printf 'new-dashboard\n' > "$SOURCE/spectator/server.ts"
    printf 'new-stream\n' > "$SOURCE/full-client-stream/stream-server.mjs"
    printf 'do-not-deploy\n' > "$SOURCE/spectator/secret.env"
    printf '*.env\n' > "$SOURCE/.gitignore"
    printf 'tunnel: test-tunnel\ningress:\n  - service: http_status:404\n' > "$SOURCE/deploy/cloudflared/momobot.yml"
    printf '[Unit]\nDescription=dashboard\n' > "$SOURCE/deploy/systemd/momobot-spectator.service"
    printf '[Unit]\nDescription=stream\n' > "$SOURCE/deploy/systemd/momobot-full-client-stream.service"
    printf '[Unit]\nDescription=tunnel\n' > "$SOURCE/deploy/systemd/cloudflared-momobot.service"

    git -C "$SOURCE" init -q
    git -C "$SOURCE" config user.name test
    git -C "$SOURCE" config user.email test@example.invalid
    git -C "$SOURCE" add .gitignore spectator/server.ts full-client-stream/stream-server.mjs deploy
    git -C "$SOURCE" commit -qm fixture
}

run_deploy() {
    SOURCE_REPO="$SOURCE" \
    RS_SDK_ROOT="$RUNTIME" \
    SYSTEMD_USER_DIR="$OUTPUT/user-systemd" \
    SYSTEMD_SYSTEM_DIR="$OUTPUT/system-systemd" \
    CLOUDFLARED_CONFIG_DIR="$OUTPUT/cloudflared" \
    DEPLOY_STATE_DIR="$OUTPUT/state" \
    SKIP_TESTS=1 \
    SKIP_MANIFEST_VALIDATION=1 \
    SKIP_SERVICE_ACTIONS=1 \
    "$DEPLOY_SCRIPT" "$@"
}

# Tracked-only atomic deployment preserves the deliberately untracked map asset.
make_fixture
if run_deploy >"$FIXTURE/deploy.log" 2>&1; then
    assert_file "$RUNTIME/spectator/server.ts" 'dashboard file deployed'
    assert_file "$RUNTIME/spikes/001-full-client-stream/stream-server.mjs" 'stream file deployed'
    assert_contains "$RUNTIME/spectator/public/worldmap.jag" 'licensed-map-data' 'worldmap.jag preserved'
    assert_no_file "$RUNTIME/spectator/stale.txt" 'stale dashboard file removed'
    assert_no_file "$RUNTIME/spikes/001-full-client-stream/stale.txt" 'stale stream file removed'
    assert_no_file "$RUNTIME/spectator/secret.env" 'untracked secret excluded'
    assert_file "$OUTPUT/user-systemd/momobot-spectator.service" 'dashboard unit installed'
    assert_file "$OUTPUT/user-systemd/momobot-full-client-stream.service" 'stream unit installed'
    assert_file "$OUTPUT/system-systemd/cloudflared-momobot.service" 'tunnel unit installed'
    assert_file "$OUTPUT/cloudflared/momobot.yml" 'tunnel config installed'
    expected=$(git -C "$SOURCE" rev-parse HEAD)
    if [[ -f "$OUTPUT/state/deployment-state.json" ]]; then
        actual=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["deployedRevision"])' "$OUTPUT/state/deployment-state.json")
        [[ "$actual" == "$expected" ]] || fail 'deployed revision recorded atomically'
    else
        fail 'atomic deployment state recorded'
    fi
    pass 'tracked-only atomic deployment'
else
    fail 'tracked-only atomic deployment command failed'
    cat "$FIXTURE/deploy.log" >&2
fi

# Missing runtime must fail before mutation.
make_fixture
missing="$FIXTURE/missing-runtime"
if SOURCE_REPO="$SOURCE" RS_SDK_ROOT="$missing" SKIP_TESTS=1 SKIP_SERVICE_ACTIONS=1 \
    "$DEPLOY_SCRIPT" >"$FIXTURE/missing.log" 2>&1; then
    fail 'missing runtime rejected'
else
    assert_contains "$FIXTURE/missing.log" 'rs-sdk runtime' 'missing runtime gives actionable error'
    pass 'missing runtime rejected'
fi

# Group/world-readable bot credentials must be refused without reading their contents.
make_fixture
chmod 0664 "$RUNTIME/bots/momobot/bot.env"
if run_deploy >"$FIXTURE/bot-mode.log" 2>&1; then
    fail 'permissive bot.env rejected'
else
    assert_contains "$FIXTURE/bot-mode.log" 'mode 0600' 'permissive bot.env gives actionable error'
    pass 'permissive bot.env rejected'
fi

# Dirty canonical source must be refused.
make_fixture
printf 'dirty\n' >> "$SOURCE/spectator/server.ts"
if run_deploy >"$FIXTURE/dirty.log" 2>&1; then
    fail 'dirty source rejected'
else
    assert_contains "$FIXTURE/dirty.log" 'dirty' 'dirty source gives actionable error'
    pass 'dirty source rejected'
fi

# Check mode validates without changing runtime or writing revision state.
make_fixture
before=$(sha256sum "$RUNTIME/spectator/stale.txt" | cut -d' ' -f1)
if run_deploy --check >"$FIXTURE/check.log" 2>&1; then
    after=$(sha256sum "$RUNTIME/spectator/stale.txt" | cut -d' ' -f1)
    [[ "$before" == "$after" ]] || fail 'check mode left runtime unchanged'
    assert_no_file "$OUTPUT/state/deployment-state.json" 'check mode did not record deployment'
    pass 'check mode is non-mutating'
else
    fail 'check mode command failed'
    cat "$FIXTURE/check.log" >&2
fi

# A failed check-mode test must not restart production before any mutation.
make_fixture
mkdir -p "$FIXTURE/bin"
printf '%s\n' '#!/usr/bin/env bash' 'exit 42' > "$FIXTURE/bin/bun"
printf '%s\n' '#!/usr/bin/env bash' 'printf "%s\n" "$*" >> "$CALL_LOG"' 'if [[ ${1:-} == is-active || ${1:-} == --user ]]; then exit 3; fi' 'exit 0' > "$FIXTURE/bin/systemctl"
printf '%s\n' '#!/usr/bin/env bash' 'printf "sudo %s\n" "$*" >> "$CALL_LOG"' 'exit 0' > "$FIXTURE/bin/sudo"
chmod 0755 "$FIXTURE/bin/bun" "$FIXTURE/bin/systemctl" "$FIXTURE/bin/sudo"
set +e
PATH="$FIXTURE/bin:$PATH" CALL_LOG="$FIXTURE/service-calls.log" \
    SOURCE_REPO="$SOURCE" RS_SDK_ROOT="$RUNTIME" \
    SYSTEMD_USER_DIR="$OUTPUT/user-systemd" SYSTEMD_SYSTEM_DIR="$OUTPUT/system-systemd" \
    CLOUDFLARED_CONFIG_DIR="$OUTPUT/cloudflared" DEPLOY_STATE_DIR="$OUTPUT/state" \
    SKIP_TESTS=0 SKIP_MANIFEST_VALIDATION=1 SKIP_SERVICE_ACTIONS=0 \
    "$DEPLOY_SCRIPT" --check >"$FIXTURE/check-failure.log" 2>&1
check_failure_status=$?
set -e
[[ $check_failure_status != 0 ]] || fail 'failed check mode returned nonzero'
if [[ -f "$FIXTURE/service-calls.log" ]] && grep -Eq 'restart|daemon-reload| stop ' "$FIXTURE/service-calls.log"; then
    fail 'failed check mode did not restart services'
else
    pass 'failed check mode leaves production untouched'
fi

# Arithmetic-control environment variables must reject command-substitution payloads.
make_fixture
marker="$FIXTURE/arithmetic-injection"
malicious='x[$(touch '"$marker"')]'
if SOURCE_REPO="$SOURCE" RS_SDK_ROOT="$RUNTIME" SKIP_TESTS="$malicious" \
    SKIP_MANIFEST_VALIDATION=1 SKIP_SERVICE_ACTIONS=1 "$DEPLOY_SCRIPT" --check \
    >"$FIXTURE/boolean.log" 2>&1; then
    fail 'malicious boolean rejected'
else
    assert_no_file "$marker" 'malicious boolean did not execute command substitution'
    assert_contains "$FIXTURE/boolean.log" 'must be 0 or 1' 'malicious boolean gives actionable error'
    pass 'malicious boolean rejected without execution'
fi

# A failure after the first manifest install must restore that manifest.
make_fixture
mkdir -p "$OUTPUT/user-systemd"
printf 'old-dashboard-unit\n' > "$OUTPUT/user-systemd/momobot-spectator.service"
chmod 0660 "$OUTPUT/user-systemd/momobot-spectator.service"
git -C "$SOURCE" rm -q deploy/systemd/momobot-full-client-stream.service
ln -s missing-unit "$SOURCE/deploy/systemd/momobot-full-client-stream.service"
git -C "$SOURCE" add deploy/systemd/momobot-full-client-stream.service
git -C "$SOURCE" commit -qm broken-second-manifest
if run_deploy >"$FIXTURE/manifest.log" 2>&1; then
    fail 'partial manifest failure rejected'
else
    assert_contains "$OUTPUT/user-systemd/momobot-spectator.service" 'old-dashboard-unit' 'partial manifest failure restored first manifest'
    [[ $(stat -c '%a' "$OUTPUT/user-systemd/momobot-spectator.service") == 660 ]] || fail 'partial manifest failure restored original mode'
    pass 'partial manifest rollback restores prior manifest and metadata'
fi

# A second deployment must fail while the deployment lock is held.
make_fixture
mkdir -p "$OUTPUT/state"
exec 8>"$OUTPUT/state/deploy.lock"
flock -n 8
if run_deploy >"$FIXTURE/lock.log" 2>&1; then
    fail 'concurrent deployment rejected'
else
    assert_contains "$FIXTURE/lock.log" 'another deployment' 'concurrent deployment gives actionable error'
    pass 'concurrent deployment rejected'
fi
flock -u 8
exec 8>&-

# A failure between the two old-directory moves must restore the first directory.
make_fixture
mv "$RUNTIME/spikes/001-full-client-stream" "$FIXTURE/held-stream"
if run_deploy >"$FIXTURE/partial.log" 2>&1; then
    fail 'partial swap failure rejected'
else
    assert_file "$RUNTIME/spectator/stale.txt" 'partial swap restored dashboard'
    assert_contains "$RUNTIME/spectator/stale.txt" 'old' 'partial swap restored original dashboard contents'
    pass 'partial swap rollback restores prior dashboard'
fi

# TERM during the swap must restore any directory already moved.
make_fixture
mkdir -p "$FIXTURE/bin"
printf '%s\n' '#!/usr/bin/env bash' '/usr/bin/mv "$@"' 'if [[ ${1:-} == "$SIGNAL_SOURCE" ]]; then kill -TERM "$PPID"; sleep 1; fi' > "$FIXTURE/bin/mv"
chmod 0755 "$FIXTURE/bin/mv"
if PATH="$FIXTURE/bin:$PATH" SIGNAL_SOURCE="$RUNTIME/spectator" \
    SOURCE_REPO="$SOURCE" RS_SDK_ROOT="$RUNTIME" \
    SYSTEMD_USER_DIR="$OUTPUT/user-systemd" SYSTEMD_SYSTEM_DIR="$OUTPUT/system-systemd" \
    CLOUDFLARED_CONFIG_DIR="$OUTPUT/cloudflared" DEPLOY_STATE_DIR="$OUTPUT/state" \
    SKIP_TESTS=1 SKIP_MANIFEST_VALIDATION=1 SKIP_SERVICE_ACTIONS=1 \
    "$DEPLOY_SCRIPT" >"$FIXTURE/signal.log" 2>&1; then
    fail 'TERM interrupted deployment'
else
    assert_file "$RUNTIME/spectator/stale.txt" 'TERM rollback restored dashboard'
    assert_contains "$RUNTIME/spectator/stale.txt" 'old' 'TERM rollback restored original contents'
    pass 'TERM rollback restores prior dashboard'
fi

# TERM immediately after state commit must restore runtime and prior deployment state.
make_fixture
mkdir -p "$OUTPUT/state" "$FIXTURE/bin"
printf '%s\n' '{"deployedRevision":"old-deploy","runtimeRevision":"old-runtime"}' > "$OUTPUT/state/deployment-state.json"
printf '%s\n' '#!/usr/bin/env bash' '/usr/bin/mv "$@"' 'if [[ ${1:-} == */.deployment-state.* && ${2:-} == */deployment-state.json ]]; then kill -TERM "$PPID"; sleep 1; fi' > "$FIXTURE/bin/mv"
chmod 0755 "$FIXTURE/bin/mv"
if PATH="$FIXTURE/bin:$PATH" \
    SOURCE_REPO="$SOURCE" RS_SDK_ROOT="$RUNTIME" \
    SYSTEMD_USER_DIR="$OUTPUT/user-systemd" SYSTEMD_SYSTEM_DIR="$OUTPUT/system-systemd" \
    CLOUDFLARED_CONFIG_DIR="$OUTPUT/cloudflared" DEPLOY_STATE_DIR="$OUTPUT/state" \
    SKIP_TESTS=1 SKIP_MANIFEST_VALIDATION=1 SKIP_SERVICE_ACTIONS=1 \
    "$DEPLOY_SCRIPT" >"$FIXTURE/state-signal.log" 2>&1; then
    fail 'TERM after state commit interrupted deployment'
else
    assert_file "$RUNTIME/spectator/stale.txt" 'state-commit TERM restored dashboard'
    restored_state=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["deployedRevision"])' "$OUTPUT/state/deployment-state.json")
    [[ $restored_state == old-deploy ]] || fail 'state-commit TERM restored prior deployment state'
    pass 'TERM after state commit restores runtime and state'
fi

# A failed rollback step must be surfaced distinctly instead of silently ignored.
make_fixture
mv "$RUNTIME/spikes/001-full-client-stream" "$FIXTURE/held-stream"
mkdir -p "$FIXTURE/bin"
printf '%s\n' '#!/usr/bin/env bash' 'if [[ ${1:-} == */runtime/spectator && ${2:-} == "$RUNTIME_TARGET/spectator" ]]; then exit 99; fi' '/usr/bin/mv "$@"' > "$FIXTURE/bin/mv"
chmod 0755 "$FIXTURE/bin/mv"
set +e
PATH="$FIXTURE/bin:$PATH" RUNTIME_TARGET="$RUNTIME" \
    SOURCE_REPO="$SOURCE" RS_SDK_ROOT="$RUNTIME" \
    SYSTEMD_USER_DIR="$OUTPUT/user-systemd" SYSTEMD_SYSTEM_DIR="$OUTPUT/system-systemd" \
    CLOUDFLARED_CONFIG_DIR="$OUTPUT/cloudflared" DEPLOY_STATE_DIR="$OUTPUT/state" \
    SKIP_TESTS=1 SKIP_MANIFEST_VALIDATION=1 SKIP_SERVICE_ACTIONS=1 \
    "$DEPLOY_SCRIPT" >"$FIXTURE/rollback-failure.log" 2>&1
rollback_status=$?
set -e
[[ $rollback_status == 125 ]] || fail 'incomplete rollback returned status 125'
assert_contains "$FIXTURE/rollback-failure.log" 'CRITICAL: rollback incomplete' 'incomplete rollback is loudly reported'
pass 'incomplete rollback is reported distinctly'

printf '%d passed, %d failed\n' "$PASS" "$FAIL"
(( FAIL == 0 ))

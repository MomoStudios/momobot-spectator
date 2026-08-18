# momobot-spectator

Read-only spectator dashboard for **Momobot**, a bot playing on the
[Lost City](https://lostcity.rs) 2004-era RuneScape preservation server via
[rs-sdk](https://github.com/MaxBittker/rs-sdk).

Live: <https://momobot.runtimeexception.net>

---

## What this is

Two independent read-only services that let people watch the bot play without
being able to influence it in any way.

| Service | Port | Route | What it does |
| --- | --- | --- | --- |
| `spectator/` | 3210 | `/` | JSON state dashboard — skills, inventory, nearby entities, event feed |
| `full-client-stream/` | 3211 | `/client` | Streams rendered canvas frames from a headless browser client over WebSocket |

Both are fronted by a Cloudflare Tunnel, so neither port is exposed to the
internet directly.

### `spectator/` — the state dashboard

Opens a **second SDK connection** as the same account in `connectionMode: 'observe'`.
This is a read-only login that rides alongside the bot's own controller, which is
why spectating cannot interfere with playing.

The loop:

1. The SDK emits `onStateUpdate` with a raw `BotWorldState`.
2. `deriveEvents(previous, next)` diffs consecutive states into a feed
   (level-ups, XP gains, inventory changes, combat, death). Last 100 kept.
3. `sanitizeState()` maps the raw state to a `PublicSnapshot` — this is the
   privacy boundary (see below).
4. `loadPublicMission()` reads `bots/<botname>/public-mission.json` as a separate,
   explicit public-intent channel. The schema allowlists a title, objective,
   timestamp, at most six `done`/`active`/`pending` tasks, and an optional bounded
   `nowChecking` operational status with its own timestamp.
5. The browser polls `/api/state`.

Endpoints: `/api/state`, `/healthz` (503 unless connected *and* state exists).

### `full-client-stream/` — the visual client

Drives a real headless browser client with Puppeteer, captures the game canvas,
and pushes frames to viewers over WebSocket. Capture rate adapts: 125 ms with
viewers connected, 1000 ms when idle.

Cost is mostly **fixed, not per-viewer**. The expensive part — running the
headless client and capturing the canvas — is paid continuously whether or not
anyone is watching, and is shared across all viewers. Connecting the *first*
viewer raises capture rate 8x (1000 ms -> 125 ms); each additional viewer only
adds a WebSocket send of the already-captured frame. In practice the scaling
limit here is egress bandwidth, not CPU.

By contrast the JSON dashboard costs essentially nothing either way: the SDK
connection runs regardless, and serving `/api/state` just serializes an object
that already exists. No rendering is involved.

---

## Security model

This is public-internet exposed, and is built accordingly.

**Read-only by construction.** Any method other than `GET`/`HEAD` returns 405.
There is no code path from the web to a bot action.

**Sanitization is allowlist-based, not blocklist-based:**

- Chat is filtered by message *type* — `GAME_MESSAGE_TYPES = {0}` and
  `PUBLIC_CHAT_TYPES = {1, 2}`. Private messages structurally cannot leak.
- Internal `Stat\d+` skill entries are stripped.
- Credentials are read server-side; `PublicSnapshot` has no field to carry them.

**Bot name is regex-validated** (`^[a-zA-Z0-9_-]{1,32}$`) before path
interpolation, blocking traversal into arbitrary env files.

**Headers:** strict CSP, `frame-ancestors 'none'`, `X-Frame-Options: DENY`,
`nosniff`, `no-referrer`, and a permissions-policy disabling camera/mic/geo.
The `/native-map` route relaxes to `SAMEORIGIN` + `worker-src blob:` because it
needs an iframe and a worker.

**Password scrubbing:** the stream server strips `env.PASSWORD` from page errors
and console output before logging.

**Public mission boundary:** the dashboard never derives intent from controller
transcripts, process arguments, or private planning. It accepts only the bounded
`PublicMission` schema from `bots/<botname>/public-mission.json`; malformed files
fail closed to an empty mission card and unknown fields are discarded. The
`nowChecking` field is a deliberately authored, viewer-safe operational summary—not
raw chain-of-thought—and disappears from the UI when older than two minutes or when
the observer is not provably connected.

Tests assert these properties — see `spectator/state.test.ts`, which checks that
a private message and a password fixture never appear in serialized output.

---

## Running it

Requires [Bun](https://bun.sh), Node, and a checkout of
[rs-sdk](https://github.com/MaxBittker/rs-sdk).

These directories are **modules of rs-sdk**, not a standalone app —
`spectator/server.ts` imports `../sdk/index` and the stream server imports
`../../sdk/runner`. Drop them into an rs-sdk checkout:

```
rs-sdk/
  spectator/                     <- this repo's spectator/
  spikes/001-full-client-stream/ <- this repo's full-client-stream/
```

Then:

```sh
# state dashboard
bun spectator/server.ts --bot=<botname> --port=3210 --host=127.0.0.1

# visual client stream
node spikes/001-full-client-stream/stream-server.mjs
```

Credentials come from `bots/<botname>/bot.env`, which is **never** committed.

### Publishing the short-term mission

The mission file is local runtime state, not repository content. Update it with the
included atomic writer from inside the rs-sdk checkout:

```sh
bun spectator/set-public-mission.ts \
  --bot=momobot \
  --title="Complete Family Crest" \
  --objective="Recover the remaining crest pieces and return the completed crest." \
  --task="done:Complete Caleb's branch" \
  --task="active:Complete Avan's branch" \
  --task="pending:Defeat Chronozon"
```

Repeat `--task` up to six times. Valid statuses are `done`, `active`, and `pending`.
After the controller has **observed evidence** that the active task is complete, advance
it atomically and activate the next pending task with:

```sh
bun spectator/set-public-mission.ts --bot=momobot --advance
```

Publish the controller's immediate viewer-safe working theory separately without
changing the mission or checklist timestamp:

```sh
bun spectator/set-public-mission.ts \
  --bot=momobot \
  --now-checking="Delivery likely succeeded; checking live combat and the proof page before continuing."

bun spectator/set-public-mission.ts --bot=momobot --clear-now-checking
```

`--now-checking` is limited to 180 characters and serialized through the same lock
as mission replacement and advancement. Update it before each meaningful micro-step,
replace it immediately after observing the result, and clear it on pause or handoff.
Publish only a concise operational hypothesis and next proof gate. Never publish raw
reasoning, prompts, transcripts, credentials, private chat, or unverified success.

A milestone update is part of the controller's completion boundary: publish the new
mission before the first action of a new objective, advance immediately after each
verified milestone, and replace the mission when the plan changes or hands off to the
next quest. Never advance merely because an action packet was sent or intended.

The writer replaces `bots/<botname>/public-mission.json` atomically with mode `0644`;
the spectator reloads it within one second without a service restart. Publish only
viewer-safe outcomes and steps—never controller reasoning, credentials, or private
messages.

### Production deployment

The versioned deployment under [`deploy/`](deploy/) installs the systemd units and
Cloudflare Tunnel ingress used by the live site. The GitHub checkout is the canonical
overlay source; `rs-sdk` remains the pinned runtime dependency because both modules
import SDK internals by relative path.

```sh
./deploy/install.sh --check  # no mutation
./deploy/install.sh          # tested atomic overlay + controlled restart
./deploy/verify.sh           # repeatable public verification
```

Deployment exports committed files with `git archive`, preserves the local
`worldmap.jag`, never copies credentials, retains rollback directories, and records
the deployed Git revision. GitHub Actions performs CI only; production credentials
are not stored in GitHub and deployment remains an explicit local action.

### Missing asset: `worldmap.jag`

The native map tab needs `spectator/public/worldmap.jag`. It is **deliberately
excluded** from this repository — it is Jagex cache data, not ours to
redistribute. Upstream rs-sdk ships a unpacking tool
(`server/engine/tools/unpack/worldmap/`) but likewise does not ship the data.

Supply your own copy to enable that tab. Everything else works without it.

---

## Attribution

Derived from [rs-sdk](https://github.com/MaxBittker/rs-sdk) and
[Lost City](https://lostcity.rs), both MIT licensed. See [NOTICE](NOTICE).

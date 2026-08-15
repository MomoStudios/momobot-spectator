# Deployment

This repository is the canonical source for Momobot's spectator dashboard and rendered-client stream. It is an overlay for an `rs-sdk` checkout, not a standalone application.

## Boundaries

- Canonical source checkout: `/home/moltbot/services/momobot-spectator`
- Runtime dependency: `/home/moltbot/clawd/rs-sdk`
- Public origin: `https://momobot.runtimeexception.net`
- Dashboard: `127.0.0.1:3210`
- Rendered client: `127.0.0.1:3211`
- Cloudflare credentials remain under `/etc/cloudflared` and are never committed.
- Bot credentials remain in `rs-sdk/bots/momobot/bot.env`, must be owned by the deploy user with mode `0600`, and are never read or copied by deployment.
- The verifier compares both deployed overlay trees to the canonical source on every run; a parent-workspace checkout that rewrites them fails closed.
- `spectator/public/worldmap.jag` is local licensed cache data. Deployment requires and preserves it but never exports it from Git.

## Commands

```sh
# Validate source, runtime, manifests, and tests without changing production
./deploy/install.sh --check

# Deploy the committed HEAD, restart services in dependency order, and verify
./deploy/install.sh

# Repeat read-only production verification
./deploy/verify.sh
```

The deployer exports committed files with `git archive`; dirty working trees are refused. It stages and tests sibling overlay directories, swaps them atomically, keeps rollback copies under `~/.local/state/momobot-spectator/backups/`, and records the deployed/runtime revisions atomically in `~/.local/state/momobot-spectator/deployment-state.json`.

## Cloudflare

The committed config owns ingress:

- `/client*` → `http://127.0.0.1:3211`
- everything else on `momobot.runtimeexception.net` → `http://127.0.0.1:3210`
- fallback → `404`

The tunnel UUID and routes are not secrets. The credentials JSON is secret and stays outside Git. Validate with:

```sh
cloudflared tunnel --config deploy/cloudflared/momobot.yml ingress validate
```

## Rollback

A failed deployment automatically restores the previous overlay and manifests when possible. Manual rollback copies are retained under the state directory. Never delete the Cloudflare credentials JSON or `worldmap.jag` during rollback.

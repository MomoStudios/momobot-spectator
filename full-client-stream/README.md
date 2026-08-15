# 001: Full-client spectator stream

## Questions

1. Can the existing browser client log in headlessly and remain controllable through the SDK?
2. Can its real game canvas be captured repeatedly without modifying the game engine?
3. Can those frames be delivered publicly without exposing credentials or controls?

## Migration history

The spike was validated on spare character `clawdscape`, then deliberately promoted to Momobot after the rendered client, SDK control, and public transport passed verification.

## Verdict: VALIDATED

The repository's existing full browser client runs correctly in headless Chromium, remains compatible with SDK control, and can feed a public read-only spectator page at usable live-video rates.

### Measured evidence

- Native rendered canvas: **765 × 503**.
- Public stream: **8.0 FPS** measured over 12 seconds through the original Tailscale Funnel deployment; the current production origin uses Cloudflare Tunnel.
- 97 frames delivered; average JPEG frame **78,268 bytes**.
- Bandwidth: **5.06 Mbps per active viewer** at JPEG quality 0.72.
- Browser E2E: no console/page errors, live canvas non-black ratio >96%, no form/input/button controls.
- SDK control probe moved Clawdscape from `(3222,3222)` to `(3223,3222)` while the full client and stream were active.
- Public write probe returns **405**.

### What worked

- The existing `/bot` browser client auto-logged in from server-side credentials.
- The original software-rendered game canvas works in headless Chromium.
- `canvas.toDataURL('image/jpeg')` is much faster than Chrome element screenshots and sustains the target frame rate.
- Same-origin WebSocket delivery works through the `/client` path; production now uses Cloudflare Tunnel.
- Idle capture drops to 1 FPS; active viewers raise it to 8 FPS.
- Credentials remain in the server-side browser process; spectators receive JPEG bytes only.
- A persistent systemd user service keeps the client and stream alive.

### What did not become production-grade yet

- This is JPEG-over-WebSocket, not WebRTC. It is simple and low latency, but bandwidth scales linearly per viewer.
- The in-memory stream has no recording, replay, audio, or multi-node fan-out.
- Full Chromium uses materially more memory than the lite client (roughly 500 MB for the service during verification).

### Recommendation for the real build

For a few friends, the current 8 FPS WebSocket stream is viable. For broader use, replace JPEG frames with `canvas.captureStream()` plus WebRTC to reduce bandwidth and improve smoothness.

The Momobot handoff stopped only the lite game client, left the existing SDK controller alive, and started the full-client service. The controller reattached under its original gateway ID and advanced Prayer from 48 to 49 during handoff verification. Private chat is forced Off after each browser login so ordinary private messages are not rendered into the public pixel stream.

## Live prototype

- Viewer: `https://momobot.runtimeexception.net/client/`
- Character: `Momobot`
- Service: `momobot-full-client-stream.service`

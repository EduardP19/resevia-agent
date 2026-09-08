# Temporarily disabled routes

## `bridge/` — `/api/voice/bridge`

Moved out of `app/` on 8th September 2026 to isolate a deployment failure:
commit 9e24a00 built cleanly on Vercel (`✓ Compiled successfully`, all 35 pages,
`Build Completed`) but died at `Deploying outputs...` with no error, and
production stayed on the previous deployment.

The WebSocket bridge is the only genuinely new *kind* of function in that
deploy, and Vercel gates WebSockets behind a separate entitlement
(`Permissions Required: WebSockets`) on top of Fluid compute, which is already
enabled here.

If the deploy succeeds without this file, the entitlement is the cause and no
code change fixes it — the options are requesting WebSocket access from Vercel,
or hosting the bridge somewhere that allows plain WebSocket servers and pointing
the `<Stream>` URL at that host.

Restore with:

    git mv .disabled-routes/bridge app/api/voice/bridge

Note that `voice_mode = 'agent'` emits TwiML pointing at this URL, so while it is
disabled that mode connects the caller to nothing. Leave tenants on `reject` or
`forward` until it is back.

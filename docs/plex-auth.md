# Plex sign-in and access

Use **Sign in with Plex** in Library or the room's Media section. Sparkle opens
Plex's hosted sign-in window; passwords stay with Plex. The same account button
offers **Sign out of Plex**. A Raw room presents sign-in and leave actions until
the account is authorized. Leaving this prompt does not change the shared room.

Anonymous visitors can browse, play and share existing **Encoded** titles from
`OUTPUT`. Any member of the configured Plex server can access **every configured
Raw library**, including libraries not individually shared with that member in
Plex. This is intentionally server membership authorization, not replication of
Plex's per-library, rating, label or item restrictions. Do not enable this policy
for a server whose members should have different access within Sparkle.

Original files, Raw metadata, hierarchy, artwork, embedded tracks and on-demand
NVENC derivatives all require membership. Selecting Encoded AV1/HEVC for a Plex
video does not make it public. Public Encoded titles may retain conservatively
matched Plex descriptions and covers; a signed, artwork-only URL permits those
covers without granting arbitrary Plex access. Raw room HTTP requests and
WebSocket connections enforce membership too, including later media changes.
Public share/oEmbed previews for Raw titles use generic metadata.

## Configuration

Keep the existing backend `PLEX_URL`, `PLEX_TOKEN`, mappings and library IDs.
There is no browser Plex token, client secret or redirect callback to configure.

```dotenv
PLEX_AUTH_ORIGINS=https://watch.example.com
PLEX_AUTH_COOKIE_SECURE=true
PLEX_AUTH_COOKIE_SAMESITE=lax
```

`PLEX_AUTH_ORIGINS` is a comma-separated list of exact **frontend origins**,
including scheme and non-default port, without paths or wildcards. It controls
credentialed CORS, WebSocket origins and sign-in mutation checks. Defaults are
`http://localhost:3001,http://127.0.0.1:3001`. The Compose example defaults to port
3000; set the actual HTTPS origin before exposing it. Keep only trusted origins.

Prefer `SERVER_BE=/be` through the frontend proxy. It forwards cookies and
Set-Cookie headers and avoids cross-site cookie restrictions. Absolute API URLs
also work when cookies are permitted; use the same hostname consistently during
development (`localhost` and `127.0.0.1` are different cookie sites). Every private
backend fetch and libmedia range/HLS loader must include credentials.

Secure cookies are enabled by default. Use HTTPS for deployed instances. For
local development only, `PLEX_AUTH_COOKIE_SECURE=false` is accepted when every
configured origin is loopback. Do not use that setting for a LAN/public host.

Discord Activities or other cross-site embedding may need
`PLEX_AUTH_COOKIE_SAMESITE=none`, which requires Secure and sets Partitioned.
Add the exact Activity origin to the allowlist. Embedded browser cookie/popup
policies vary; a session may be scoped to the embedding site. This combination
still requires device testing; standalone sign-in does not guarantee an embedded
session. No global isolation headers are added.

Restart the backend after changing these settings.

## Session handling

The backend uses Plex's [strong-PIN hosted authentication flow](https://forums.plex.tv/t/authenticating-with-plex/609370).
A short-lived HttpOnly pending cookie binds the PIN to the browser that started
it. Only the backend polls Plex and receives the account token. The backend reads
the Plex account and its [server resources](https://support.plex.tv/articles/206721658-using-plex-tv-resources-information-to-troubleshoot-app-connections/),
requiring an exact match to the configured server's machine identifier and a
server access token. It never trusts a browser-provided account token or server ID.

The browser receives a random 256-bit, host-only HttpOnly session cookie. Plex
tokens stay in backend memory, never localStorage, browser responses or logs.
The cookie survives browser restarts for up to 14 days; **backend restarts sign
everyone out**, because session credentials are deliberately not persisted to
disk. The stable client-identifier cookie is not an access credential.

Membership is rechecked after five minutes on subsequent requests and active
Raw-room socket checks. Plex verification failures fail closed. Sign-out revokes
the session, cancels its in-flight private requests and removes its cookie.
Room sockets check access before reading/writing messages and on their heartbeat.
Already received or buffered bytes cannot be recalled. The frontend also refreshes
session state on focus and once per minute while visible, covering other tabs.

Sign-in mutations require an allowed Origin and a custom request header. PINs,
sessions, rate-limit entries, upstream response sizes and request timeouts are
bounded. Upstream redirects are refused. Account authentication only creates
Plex sign-in PINs and reads identity/resources; catalog access stays read-only.

## Verification

`go test ./...` includes mocked Plex flows, non-members, forged and expired
cookies, CSRF/origin rejection, access revocation, private route guards and
two-client WebSocket room changes. `go test -race ./...` checks concurrency.

With the frontend and backend running:

```powershell
$env:SPARKLE_TEST_URL='http://localhost:3001'
npx playwright test tests/e2e/plex-auth.spec.ts tests/e2e/library.spec.ts tests/e2e/room-layout.spec.ts
```

The browser auth suite mocks Plex authorization; it checks guest browsing,
sign-in/out, cookie visibility, mobile layouts, membership denial and resuming
the original Raw room. A real Plex account must still complete its hosted sign-in
to verify that account's membership. Never insert the owner's configured Plex
token into a browser test to bypass the member flow.

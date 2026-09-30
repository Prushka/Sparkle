# Plex sign-in and access

Use **Sign in with Plex** in Library or the room's Media section. Sparkle opens
Plex's hosted sign-in window; passwords stay with Plex. Once sign-in succeeds,
the open Sparkle account popup updates with the verified Plex name and profile
picture, and offers **Sign out of Plex**. A Raw room presents sign-in and leave
actions until the account is authorized. Leaving this prompt does not change the
shared room.

While signed in, room badges, chat and other participants use the verified Plex
name and profile picture. Clicking your room badge opens **Plex account** instead
of the guest profile editor. Change the name/picture in Plex; room messages cannot
override that account identity. Signing out restores the saved guest profile.
Discord Activity voice behavior remains unchanged; a signed-in Plex profile takes
precedence over its display name/avatar.

Anonymous visitors can browse, play and share existing **Encoded** titles from
`OUTPUT`. Signed-in accounts can browse and play only the intersection of
**configured Raw libraries** (`PLEX_LIBRARY_IDS`) and **libraries shared with
their Plex account**. An empty `PLEX_LIBRARY_IDS` permits all supported video
libraries on the server, still limited by the user's own access. Server owners
retain access to their configured libraries. Accounts with no matching libraries
remain signed in but cannot use Raw media.

Sparkle reads `/library/sections` on the configured `PLEX_URL` using the account's
server-specific resource token from Plex. This authorization request is separate
from the owner's cached metadata requests, never follows redirects, and never
uses server URLs advertised by account resources. Failed checks deny access;
there is no owner-token fallback. The scope is library-level: Plex rating, label
and individual-item restrictions within a shared library are not replicated.

Original files, Raw library browsing/hierarchy, embedded track bytes and on-demand
NVENC derivatives require access to that media's library. Selecting Encoded AV1/HEVC for a Plex video
does not make playback public. Raw room participation, HTTP mutations and WebSocket
connections enforce library access too, including later media changes. Guessed
IDs, alternate versions, byte ranges, saved page cursors and shared encode caches
do not bypass the check. A member with access to other libraries receives a 403
`plex_library_access_denied` response for an unshared library; the UI explains
that the library must be shared with their account.

Shared links intentionally expose complete sanitized single-title metadata and
poster/backdrop images without a session. `GET/HEAD /media/{id}` and
`GET/HEAD /media/{id}/artwork/{poster|backdrop}` power Open Graph, Twitter and oEmbed
previews. This includes titles, descriptions, episode information, technical metadata
and artwork for configured libraries only; credentials and filesystem paths stay
private. Referenced file/encode URLs still require authorization. `/share/rooms/{room}`
provides only room ID, current media ID and its update timestamp for room-only links;
it cannot join, create or change a room, or expose chat/participants/playback state.
Opening a missing room in the app creates it through `POST /rooms`; media links
still require access to the requested library. Repeated creation returns the existing
authorized room without replacing its media. GET requests and previews never create rooms.
Preview requests do not forward viewer cookies and never enumerate the Plex library.
Public Encoded titles continue to reuse conservatively matched Plex descriptions
and signed artwork URLs.

## Shared link formats

Room links use `/<room>` and `/<room>/media/<media>`. The room path selects the room;
query parameters cannot override it. Root `/?mediaId=<media>` entry links create a
room for a title, and Discord Activity launches retain `channel_id` at the root.
Library filter query parameters remain supported.

Previews use `/json/<room>` and `/json/<media>?room=<room>` for oEmbed.
Unused aliases `/rooms/new`, `/rooms/<room>/media/<media>`, `/<room>/library`,
and `/<media>?room=<room>` are no longer supported. The unused frontend `/api/cm`
mutation endpoint is removed; room mutations use the authenticated backend API.

## Configuration

Keep the existing backend `PLEX_URL`, `PLEX_TOKEN`, mappings and library IDs.
There is no client secret or redirect callback to configure. Optional direct artwork
uses the signed-in viewer's token as described below.

```dotenv
PLEX_AUTH_ORIGINS=https://watch.example.com
PLEX_AUTH_COOKIE_SECURE=true
PLEX_AUTH_COOKIE_SAMESITE=lax
PLEX_AUTH_SESSION_DIR=./data/plex-auth
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

For local development, use `SERVER_BE=/be` and `SERVER_STATIC=/static`; keep the
backend's address in `SERVER_INTERNAL_BE` and `SERVER_INTERNAL_STATIC`. A frontend
on `localhost` with an absolute LAN-address API is cross-site: browsers can reject
the Lax sign-in cookie even though Plex itself reports success. Sparkle checks the
pending cookie before opening Plex authorization and reports missing cookies
separately from an expired PIN. If this happens, correct the public proxy bases,
reload the frontend configuration, then reload the page and start a new sign-in.

Secure cookies are enabled by default. Use HTTPS for deployed instances. For
local development only, `PLEX_AUTH_COOKIE_SECURE=false` is accepted when every
configured origin is loopback. Do not use that setting for a LAN/public host.
An HTTP LAN address cannot carry Secure cookies, even with the same-origin
`/be` proxy and an allowed origin. Sparkle explains this before opening a popup
or starting a PIN. Open the site's HTTPS URL instead, or use
`http://localhost:3001` on the computer running Sparkle. Allowing cookies in the
browser does not make Secure cookies work over LAN HTTP.

Discord Activities or other cross-site embedding may need
`PLEX_AUTH_COOKIE_SAMESITE=none`, which requires Secure and sets Partitioned.
Add the exact Activity origin to the allowlist. Embedded browser cookie/popup
policies vary; a session may be scoped to the embedding site. This combination
still requires device testing; standalone sign-in does not guarantee an embedded
session. No global isolation headers are added.

Restart the backend after changing these settings.

## Direct artwork

Set backend `PLEX_PUBLIC_URL` to a publicly reachable HTTPS base URL of the **same
Plex server** as `PLEX_URL`, optionally with a path prefix. Do not include credentials,
query parameters or a fragment. The browser must trust its certificate and reach it;
Sparkle does not discover a public address automatically. Leave it empty to use the
existing proxy for every cover. Restart the backend after changing it.

The existing session refresh uses `POST /auth/plex/session` with the exact allowed
Origin and `X-Sparkle-Auth: 1`. When direct artwork is enabled and the viewer has a
valid library grant, its private, `Cache-Control: no-store` response includes
`artwork: { baseUrl, token, expiresAt }`. The token is the viewer's server resource
token. Its frontend expiry is bounded by the five-minute grant check and the
session's original expiry; it does not set the Plex token's lifetime. Public
`GET /auth/plex/session` and PIN poll responses remain token-free. The configured
`PLEX_TOKEN` and sign-in account token are never selected for these responses.
Plex may issue a server token with broad account privileges, especially for the
server owner; it is **not an artwork-only token**.

Catalog and title responses include token-free `plexArtwork` paths only when the
viewer has access to that library, including conservatively matched Encoded titles.
Paths come from the metadata already requested. The browser combines them with the
private base URL and resource token in `X-Plex-Token`; there are no per-cover URL
requests or extra Plex metadata requests to resolve direct artwork. The former
`/artwork/.../direct` endpoints are removed.

Only image elements use these private URLs. Catalog data, shared room messages,
Vidstack/media-session metadata, casting and public previews retain proxy URLs.
Sparkle does not fetch or cache direct artwork bytes. Missing credentials or paths,
an unshared library, a broken direct image or an eight-second image timeout falls
back to the existing proxy. Anonymous covers and public GET/HEAD routes stay proxied.
Direct images use `no-referrer` and do not require Plex CORS headers.

Credentials live only in frontend session memory and use the existing minute/focus
refresh, with an eight-second request timeout. Expiry clears them and triggers
revalidation. Failed images are remembered in session memory for four minutes,
bounded to 128 entries. Auth/profile/library or credential changes clear that memory;
sign-out and expiry remove private image URLs, and stale session responses are ignored.
Neither localStorage nor sessionStorage stores these URLs, and Sparkle's service
worker bypasses token-bearing requests. This is not a promise of no browser disk
persistence: the browser's ordinary HTTP image cache follows Plex's headers and may
retain the URL. DevTools, browser extensions, and Plex/reverse-proxy access logs can
also expose it. Configure infrastructure query logging appropriately. Signing out
revokes the Sparkle session, not a Plex token already received by the browser.

## Session handling

The backend uses Plex's [strong-PIN hosted authentication flow](https://forums.plex.tv/t/authenticating-with-plex/609370).
A short-lived HttpOnly pending cookie binds the PIN to the browser that started
it. Only the backend polls Plex and receives the account token. The backend reads
the Plex account and its [server resources](https://support.plex.tv/articles/206721658-using-plex-tv-resources-information-to-troubleshoot-app-connections/),
requiring an exact match to the configured server's machine identifier and a
server access token. It never trusts a browser-provided account token or server ID.

The browser receives a random 256-bit, host-only HttpOnly session cookie. Plex
account tokens stay server-side. The only token-bearing response is optional
[direct artwork](#direct-artwork), using the viewer's server resource token.
Resource tokens are held only in backend memory and reacquired during verification
after restart; account token persistence is unchanged. Sparkle never logs tokens. Sessions
survive browser and backend restarts until their original 14-day expiry; restarting
does not extend it. The stable client-identifier cookie is not an access credential.

`PLEX_AUTH_SESSION_DIR` defaults to `./data/plex-auth`. Startup scripts resolve it
against the repository root; direct API execution uses the working directory.
Its `sessions.db` stores account tokens, client identifiers, verified profiles and
expiry under hashes of the random cookie IDs. Raw cookie IDs and cached membership/library
decisions are not persisted. Each restored session rechecks the account and the
currently configured server before private media access, even if the previous
process had just checked access. Pending PIN flows remain temporary.

This directory contains credentials: keep it on persistent local storage outside
`OUTPUT`, `PFP_DIR`, and mapped Plex media roots. Unix permissions are 0700 for the
directory and 0600 for the database; Windows uses a protected ACL granting only the
backend account and Local System access. Tokens are not encrypted within the database;
protect its backups as credentials. The Compose example mounts `./data/plex-auth`
separately so container recreation preserves sign-ins. A single backend owns the
store; a second process sharing it is rejected. An inaccessible or corrupt store
fails startup instead of silently dropping sessions. Stop the backend and remove
the database to deliberately reset all sign-ins.

Sign-in, session replacement and sign-out commit synchronously using the local
transactional database, including before an abrupt process exit. A storage failure
returns an error instead of acknowledging a login or logout that would be lost on
restart. Expired records are pruned. On upgrade from memory-only sessions, users
must sign in once with the new backend; subsequent restarts retain their sessions.

Plex avatar URLs and tokens remain server-side. A hashed profile identifier uses
the existing room-avatar route, so other participants can see the picture without
receiving account credentials. Avatar requests are limited to Plex's public avatar
endpoint and its HTTPS `assets.plex.tv/avatars/` redirects, reject other redirects
and non-image/oversized responses, and use a memory
cache capped at 64 images of 512 KiB each. No avatar is written to mapped media.

Membership and shared library IDs are rechecked after five minutes on subsequent
requests and active Raw-room socket checks. Library grants are held only in memory
and revalidated after restart. Losing even one library cancels the session's
existing private requests; requests for retained libraries can restart under the
new grant. Plex verification failures fail closed and cancel private
requests, while keeping the saved login available for a later successful check.
Sign-out durably revokes the session, cancels its in-flight private requests and
removes its cookie. Failed sign-out storage writes still stop current access and
report an error; retry sign-out to commit the removal.
Room sockets check access before reading/writing messages and on their heartbeat.
Already received or buffered bytes cannot be recalled. The frontend also refreshes
session state on focus and once per minute while visible, covering other tabs.
The session response includes only that account's permitted library IDs, allowing
the catalog to refresh when sharing changes even if Raw access remains available.
Sharing changes can take up to the five-minute authorization cache interval to be
observed by an active client.

Sign-in mutations require an allowed Origin and a custom request header. PINs,
sessions, rate-limit entries, upstream response sizes and request timeouts are
bounded. Upstream redirects are refused. Account authentication only creates
Plex sign-in PINs and reads identity/resources and shared library sections;
catalog access stays read-only.

## Verification

The access boundaries are:

| Surface                                                                            | Enforcement                                                                                                                       |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Library sources, search, paging and totals                                         | Include only configured sections in the user's verified grant; apply it again on every page, including reused cursors.            |
| Show/season children, originals and alternate versions                             | Resolve the media ID's actual Plex section server-side before serving the request; client library parameters cannot grant access. |
| Encoded manifests, playlists, segments, audio, captions, fonts and AI HDR          | Check the same library permission before entering the encoder or reading its shared cache.                                        |
| Room creation, reads, replacement and WebSocket messages                           | Check current and requested media; disconnect participants who cannot access the selected library.                                |
| Single-title metadata, covers, share previews and existing processed Encoded media | Retain the public exceptions described above; they grant no original-file or derivative access.                                   |

`go test ./...` includes mocked Plex flows, non-members, forged and expired
cookies, CSRF/origin rejection, library intersection, isolated permission caches,
copied pagination cursors, alternate versions/parts, GET/HEAD/range requests,
encoded resources (including AI HDR), access revocation and two-client WebSocket
room changes. The authorization route tests use synthetic encoded bytes; they
do not qualify GPU encoding or device playback. Persistence tests cover restarts, abrupt process
exit, expiry, concurrent login/logout, replacement, membership/token revocation,
storage failures and private filesystem permissions. `go test -race ./...` checks concurrency.

With the frontend and backend running:

```powershell
$env:SPARKLE_TEST_URL='http://localhost:3001'
npx playwright test tests/e2e/plex-auth.spec.ts tests/e2e/plex-artwork.spec.ts tests/e2e/library.spec.ts tests/e2e/room-layout.spec.ts
```

The browser auth suite mocks Plex authorization; it checks guest browsing,
sign-in/out, cookie visibility, mobile layouts, membership/library denial, catalog
refresh after partial revocation and resuming the original Raw room. A real Plex
account must still complete its hosted sign-in to verify its actual library shares.
Never insert the owner's configured Plex
token into a browser test to bypass the member flow.

Run `tests/e2e/metadata.spec.ts` with `SPARKLE_RAW_TEST_ID` set to a configured Raw
media ID to verify anonymous crawler HTML, oEmbed, artwork and playback denial.
Optionally set `SPARKLE_RAW_TEST_ROOM` to an existing room playing that media to
also verify room-only links. These checks need no account/session cookies.

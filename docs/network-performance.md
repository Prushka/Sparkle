# Network behavior

Sparkle shares redundant work while preserving authorization, immediate room
controls, reconnect recovery and source-specific playback behavior.

## Requests and conditional responses

| Path                          | Behavior                                                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime configuration         | Auth, Library, player and Discord share one pending/resolved runtime configuration request per page. Failed loads can retry.                                                                                                |
| Plex session                  | Simultaneous refresh triggers share one request within the current auth generation. Login/logout invalidate older results; credentials remain private and no-store.                                                         |
| Library                       | Sources wait for session resolution, then refresh when session grants change. Items remain paged and searches debounced; no full-library enumeration.                                                                       |
| Plex metadata upstream        | Concurrent misses for the same endpoint and query share one request. The existing one-minute, 256-entry / 32 MiB cache and eight-request upstream limit remain; at most 256 distinct lookups wait. Errors are not cached.   |
| Title metadata in the browser | `fetchJob` uses `no-cache`, so every lookup revalidates with the backend and unchanged private responses can reuse their body through ETags. Initial provider setup still reuses the loaded title; recovery revalidates it. |
| Guest avatars                 | Initial rendering waits for a revision URL. Private conditional GET/HEAD requests can return `304`; uploads retain revision invalidation.                                                                                   |

Cancelling a metadata waiter does not cancel another viewer's request. If the
request that owns an upstream fetch is cancelled, remaining callers may start a
replacement. Owner metadata sharing does not apply to viewer library grants or
Plex resource-token verification.

Direct artwork still uses token-free paths from authorized metadata plus private
session credentials, without per-cover API lookups. It follows Plex's HTTP cache
headers. Proxy fallback and public previews keep the existing bounded artwork
cache and five-minute private browser freshness window.

## Room connections and synchronization

Library and an unjoined player use a media watcher. Once the playback socket
connects, it also owns media changes and the watcher closes. A disconnected player
restores its watcher; returning to Library does the same. Failed watcher connection
attempts back off from one to thirty seconds.

Current clients request `?roomSnapshot=1` on room and watcher sockets. The backend
sends the current media identity and revision after connection, replacing the
immediate HTTP room lookup. A 250 ms compatibility timer performs that lookup if
an older backend sends no snapshot. Stale media revisions remain rejected. The
snapshot does not change playback, and the explicit join still verifies room state.

YouTube, Chess, Wordle and Cottage retain independent channels because their shared
tabs must be discoverable by other viewers and survive media changes. Initial
subscription sends only the corresponding game state. These channels omit unused
playback, chat and presence snapshots and periodic presence heartbeats. WebSocket
ping/pong, authorization checks and incoming game synchronization remain active.
Cottage profile changes send a new player snapshot over the existing channel;
only room/player/account changes or connection recovery replace that socket.

Playback presence changes still send a complete roster. Status updates include
only players whose status changed; unchanged players remain in the client roster.
The three-second playback heartbeat, changed-second timeline reports, immediate
pause/seek messages and foreground/reconnect recovery remain unchanged. Media
generations and remote-event suppression continue to protect the shared timeline.

## Checks and request budgets

`tests/e2e/network-performance.spec.ts` exercises both current and legacy backend
protocols with deterministic fixtures. For an existing room, initial load plus
explicit join makes two room GETs with socket snapshots; the legacy fallback path
makes four. Joined playback retains one main connection and no media watcher.
Return-to-Library and reconnect tests verify the watcher is restored when needed.
Two-client game checks use real backend sockets to verify remote tab discovery,
no unused idle traffic, and channel retention across profile and media changes.

`backend/internal/plex/coalesce_test.go` verifies that 32 concurrent identical
cold metadata reads make one Plex request, cancellation remains independent and
errors can retry. Realtime tests verify changed-player deltas and no unused tab
heartbeat traffic. Artwork/auth and profile tests cover pending refresh bursts,
stale auth responses, revision URLs and conditional avatar invalidation.

Run against an already running frontend/backend:

```powershell
go -C backend test ./...
go -C backend vet ./...
go -C backend test -race ./...
npm run check
npm run test:player
$env:SPARKLE_TEST_URL='http://127.0.0.1:3001'
npx playwright test tests/e2e/network-performance.spec.ts tests/e2e/plex-artwork.spec.ts tests/e2e/profile-limits.spec.ts tests/e2e/media-switch.spec.ts tests/e2e/library-return.spec.ts
```

The media-switch and track-selection suites also exercise real Go room sockets
with disposable media fixtures: two-client controls, delayed readiness, local
tracks, rapid source changes and recovery. These are automated browser checks,
not physical-device HDR qualification. See [playback validation](raw-media-validation.md)
for fixture preparation and codec/device limits.

## Existing boundaries

Original media keeps ranged streaming, cancellation and confined read-only access.
Encoded segments share bounded server jobs and caches; preview frames and subtitle
chunks keep their existing bounded on-demand fetching. This policy does not reduce
media quality, change encoding profiles or prefetch whole originals. HTTP compression
continues to bypass media ranges and already compressed artwork/static bodies.

Production [asset caching](frontend-caching.md) remains manifest/revision based and
on demand. Development uses the cleanup worker and network requests; development
asset/favicon traffic is not representative of the production cache. Room HTML,
APIs, session credentials and media remain outside the service-worker asset cache.

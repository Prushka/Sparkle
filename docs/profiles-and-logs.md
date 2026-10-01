# Profiles and room logs

## Profile limits

Set these backend variables in the root `.env`, then restart the backend:

```dotenv
MAX_PFP_BYTES=12000000
MAX_USERNAME_LENGTH=32
```

`MAX_PFP_BYTES` limits the avatar file itself, in bytes. The default is 12 MB
(12,000,000 bytes). A file exactly at the limit is allowed. Multipart overhead
has a separate bounded allowance. Oversized files, including streamed requests,
return HTTP 413 and leave the existing avatar unchanged. Multipart temporary
files are removed after handling the request.

`MAX_USERNAME_LENGTH` defaults to 32 and accepts values from 1 through 4096.
It applies to editable guest names after surrounding whitespace is trimmed.
Both implementations count Unicode code points: a non-BMP emoji counts as one,
while a combined emoji or combining-character sequence can contain several.
Over-limit edits are rejected without changing the profile. The socket returns
a `profileError` message with the configured limit. Plex names continue to come
from the verified server account, and Discord names keep their existing identity
policy; the guest limit does not shorten either.

The frontend reads both active values from the public, no-store
`GET /profile/limits` endpoint. It waits for that response before enabling guest
profile edits, shows an inline error for oversized files or names, and provides
a retry when limits cannot be loaded. The backend checks independently of the
browser. No public environment-variable copy is needed; reload open clients
after restarting the backend with new values.

Next.js also reads `MAX_PFP_BYTES` from its environment to set its request-body
buffer to that value plus the backend's 1 MiB multipart allowance. Its original
10 MiB buffer is smaller than Sparkle's default avatar limit. When raising the
avatar limit, use the same value in the frontend environment and restart the
frontend; rebuild standalone/Docker frontends whose Next configuration is baked
into the build. Reducing the limit or changing the guest-name limit only needs
a backend restart and client reload. Reverse proxies must also allow the full
file plus multipart overhead.

Legacy saved guest names that exceed the active limit are bounded for room
presence without overwriting the local preference. Opening Profile Settings
shows the original draft and its error so the user can choose a valid replacement.
Plex profile pictures continue to be managed by Plex. New guest uploads stay in
`PFP_DIR`; existing `OUTPUT/pfp` avatars remain readable.

Guest avatars use `Cache-Control: private, no-cache` with size/modification-time
ETags. Each reuse revalidates; unchanged GET/HEAD requests can return `304` without
the image body. Uploads and explicit avatar updates retain revision URLs, and the
frontend waits for the initial revision instead of downloading an unversioned copy
first. Plex avatar caching keeps its separate policy.

## Room logs

Connection, disconnection, profile identification and connection errors include:

- `user`: display name, including the verified Plex name for signed-in accounts.
- `identity`: `guest`, `plex` or `discord`.
- `media` and `media_id`: title and stable media identity.
- `sync`: `playback`, `media watcher`, `youtube`, `chess`, `wordle` or `cottage`.
- `event` and `type`: the connection or sync action and protocol message type.
- `room` and `player`: room and socket identifiers for correlation.

Accepted play/pause changes, shared seeks and socket media changes include the
same context. Periodic timeline updates and duplicate pause messages do not add
log entries. Tab sockets use the main room's media context and may reuse its
guest or Discord profile. Plex identity always comes from the connecting socket's
verified session, including in logs; a matching public player ID cannot confer
or replace it. Media watchers can identify their profile without joining room
presence or changing the shared timeline.

For example, a pause event includes:

```text
room="room123" user="Dan" identity=plex media="A Show - S01E02 - Next" media_id="plex-server-title-version" sync="playback" event="pause" type="pause" player="client123" detail="position=123.000s"
```

Titles reuse requested media details in a bounded 256-entry cache, with at most
300 code points per title. Logging does not contact Plex, scan the library or
read media files. Episode titles include the series and episode marker. If no
details were requested or the entry was evicted, the log uses `Title unavailable`
and keeps the media ID; empty library rooms use `No media`. An anonymous socket
uses `Guest` until its profile message arrives, then records its display name.

User-controlled log fields are quoted and bounded so embedded line breaks do
not create extra entries. Logs do not include chat text, full sync payloads,
SDP, ICE, tokens, TURN credentials or local media paths. The Windows tray adds its
existing timestamp and stdout/stderr stream label; `[err]` identifies stderr,
where Go's standard logger writes, rather than the severity of every message.

## Verification

```powershell
go -C backend test ./...
go -C backend vet ./...
go -C backend test -race ./...
npm run check
node scripts/tests/profile-upload-config.mjs
$env:SPARKLE_TEST_URL='http://127.0.0.1:3001'
npx playwright test tests/e2e/profile-limits.spec.ts tests/e2e/room-layout.spec.ts
```

The browser checks use mocked routes and uploads in installed Chrome, including
Unicode name boundaries, exact-size avatars, inline backend errors and limit-load
retry. Backend checks use temporary profile storage and cover chunked uploads,
unchanged profiles after rejection, account identities, log context and bounds.

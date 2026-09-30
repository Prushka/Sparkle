# Sparkle agent guide

Sparkle is a self-hosted watch-party app: a Next.js/React frontend and a Go HTTP/WebSocket
backend. It serves existing processed media and reads Plex catalogs and mapped original
files. Optional on-demand NVENC encoding serves cached derivatives of Plex media.

## Working in this repository

- These instructions apply throughout the repository. Read any closer `AGENTS.md` before
  editing its subtree; explicit task instructions take precedence over repository guidance.
- Always ask the user whenever you have any questions or uncertainties. Clarify them before
  proceeding with work that depends on the answer.
- Treat current code, configuration, and tests as the source of truth. Inspect the relevant
  implementation before changing behavior; preserve unrelated working-tree changes.
- Keep this guide, [README.md](README.md), and the relevant `docs/` reference consistent when
  durable contracts, setup commands, or limitations change. Replace stale facts instead of
  appending session history, process IDs, logs, or temporary validation URLs.
- Keep changes focused. Follow neighboring patterns and existing formatter configuration;
  avoid repository-wide formatting as part of a feature or fix.
- Report the behavior changed, checks actually run, and remaining limitations. Distinguish
  automated playback evidence from physical-device HDR qualification.

## Where to work

| Path                                                            | Responsibility                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `app/`, `proxy.ts`, `lib/server/`                               | Next routes, SSR/share metadata, runtime configuration, backend/static proxy             |
| `components/catalog-browser.tsx`, `lib/library.ts`              | Shared paged Library/picker and normalized catalog models                                |
| `components/player/`, `lib/player/`, `lib/suptitles/`           | Vidstack UI, raw provider, subtitles, synchronization, room features                     |
| `backend/cmd/api/`, `backend/internal/config/`                  | Go entry point, HTTP routing/middleware, environment configuration                       |
| `backend/internal/catalog/`, `backend/internal/plex/`           | Catalog normalization, read-only Plex access, confined streaming and artwork             |
| `backend/internal/encode/`                                      | Optional shared NVENC segments, confined inputs, bounded cache and GPU concurrency       |
| `backend/internal/plexauth/`, `components/plex-auth.tsx`        | Plex PIN sign-in, secure sessions, membership checks and account/room UI                 |
| `backend/internal/jobs/`, `backend/internal/realtime/`          | Existing processed jobs; room/WebSocket state, profiles, chat, games and voice signaling |
| `windows/`, `backend/internal/lifecycle/`, root Windows scripts | Native tray host, compiled-backend installation and graceful shutdown                    |
| `scripts/libmedia/`, `vendor/libmedia/`                         | Reproducible player patches, pinned binaries, manifest and notices                       |
| `tests/e2e/`, `scripts/tests/`, `docs/`                         | Browser/codec checks, setup reference and qualification evidence                         |

## Setup and verification

Use npm with `package-lock.json`; the Go module lives in `backend/` and requires Go 1.25+.
Follow the [local setup](README.md#local-development) for `.env` and separate frontend/backend
terminals. Do not overwrite an existing `.env`. Startup scripts load the root `.env` and
resolve output/cache/profile paths relative to the repository; direct `go run` does neither.
Windows can use the [tray backend](docs/windows-backend.md) instead of a terminal.

| Command                                                   | Directory / purpose                                                              |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `npm ci`                                                  | Root; install locked frontend dependencies                                       |
| `npm run dev`                                             | Root; webpack dev server on port 3001, prepares player assets first              |
| `./start-backend.ps1` or `bash ./start-backend.sh`        | Root; API on port 1323 by default                                                |
| `./install-backend-startup.ps1 -Start`                    | Windows; build/install current-user login and Start Menu shortcuts, start tray   |
| `./windows/test-tray.ps1` / `./windows/test-launcher.ps1` | Windows; isolated native UI/process tests and compiled API lifecycle integration |
| `npm run check`                                           | Root; TypeScript check for frontend changes                                      |
| `npm run test:player`                                     | Root; focused subtitle parser/bitmap checks                                      |
| `npm run build`                                           | Root; production webpack/Next build and service-worker generation                |
| `go test ./...`                                           | `backend/`; backend tests, using temporary files and mock Plex servers           |
| `go vet ./...` / `go test -race ./...`                    | `backend/`; static/concurrency checks when backend behavior changes              |
| `npm run test:e2e`                                        | Root; Playwright against an already running app                                  |

- Start with focused checks, then run the relevant checks above. Add regression coverage
  for changed contracts and bug fixes; documentation-only edits need link/command review,
  formatting checks, and `git diff --check`, not playback suites.
- On Windows, Go race tests need CGO and a supported C compiler. Report unavailable checks
  rather than recording a pass.
- Playwright does not start services. Its default URL is `http://127.0.0.1:3002` and channel
  is installed Chrome. Set `SPARKLE_TEST_URL` to the running frontend (usually port 3001)
  and `SPARKLE_TEST_CHANNEL` when needed. Real-media cases skip without fixture IDs;
  see [reproduction settings](docs/raw-media-validation.md#reproduce).
- Playback/sync changes need two-client checks for pause/play, seek, delayed readiness,
  reconnect, local tracks, and rapid processed/raw transitions. Check responsive layout and
  Vidstack menus for UI changes. Use [qualification records](docs/raw-media-validation.md)
  for codec/device-specific coverage; do not imply skipped combinations were tested.
- Use `gofmt` for changed Go files and `npx prettier --check <changed-authored-files>` for
  supported text files. `npm run lint` runs repository-wide Prettier and ESLint; do not
  resolve unrelated findings by reformatting generated or vendored assets.

## Contracts to preserve

- Plex sign-in uses server-held account tokens and opaque HttpOnly cookies. Raw browsing,
  files, NVENC derivatives and rooms require access to the media's Plex library.
  Intersect configured library IDs with sections returned by the configured server
  using the user's server resource token; never reuse owner metadata caches for grants.
  Anonymous users get existing Encoded
  media only. Keep exact-origin CORS/CSRF checks and credentialed backend/player fetches.
  See [authentication](docs/plex-auth.md); never bypass it using the owner token in a browser.
  Signed-in room profiles use the server-verified Plex name and proxied avatar. Reserve
  the Plex profile namespace and preserve guest preferences on sign-out. Single-title
  metadata and poster/backdrop GET/HEAD requests are public for full link previews;
  `/share/rooms/{room}` exposes only the current media identity. Keep files, derivatives,
  hierarchy, room mutations and WebSockets protected; never forward sessions into previews.
  Persist sessions in private `PLEX_AUTH_SESSION_DIR` storage before acknowledging login
  or logout. Restarts preserve the original expiry and must reverify membership and
  library access before use; temporary upstream failures deny access but allow later
  revalidation. Recheck grants after five minutes, cancel private requests when grants
  shrink, and refresh the catalog when session library IDs change. Library authorization
  does not replicate Plex rating, label or individual-item restrictions.
  Require HTTPS for LAN/public sign-in and explain HTTP network addresses before
  opening a popup or allocating a PIN; preserve loopback development support.
- Plex access is read-only and endpoint-allowlisted. Do not add watched-state updates,
  scans, Plex transcoding, media modifications, or whole-original-file caching.
  Server decoding is confined to the optional encoded mode; Compatible playback remains client-side.
- Resolve the longest matching mapping prefix and use root-confined file access. Retain
  traversal, symlink/junction, alternate-stream, and allowed-section protections. Keep
  `PFP_DIR`, `MEDIA_CACHE_DIR`, and `PLEX_AUTH_SESSION_DIR` outside mapped media roots;
  session storage must also stay outside `OUTPUT` and `PFP_DIR`. Legacy avatars remain readable.
- Keep Plex tokens, credential-bearing URLs, and local filesystem paths out of browser
  payloads and logs. Never expose backend secrets through public environment variables.
- Use `/library/items` paging and direct `/media/{id}` lookup. Never enumerate Plex to build
  a complete index or refresh the picker through `/all`; `/all` is processed-only legacy
  compatibility. Preserve processed IDs/links and version-specific Plex identities.
  Initial processed catalog reads must wait for the shared first scan, with per-request
  cancellation; only a successful scan result may be served during background refreshes.
- Processed/Plex artwork matching must remain conservative and bounded: compare title/year
  or series/season/episode identity, reject ambiguity, and enrich only requested items.
  Library URL state must preserve room context without remounting or reconnecting the room.
- Same-room media changes preserve the mounted player and room connection while the next
  source loads. Reuse freshly loaded title metadata for initial provider setup; recovery
  must revalidate it. Artwork has a five-minute private browser freshness window with ETags.
  Room links use `/<room>` and `/<room>/media/<media>`; the path owns room identity.
  Preserve root `?mediaId=` entry links, Discord root `channel_id` launches, and the
  documented oEmbed routes. Do not restore unused query-based room or `/rooms/` aliases.
- Shared UI components follow shadcn/Tailwind 4 conventions. Select uses Base UI's
  non-modal primitive; other controls use Radix. Menus, selects and room dialogs must
  leave page scrolling enabled. Preserve Tabler
  icons, the local `cn` helper, fullscreen portal containers, and existing namespace exports
  when updating generated components. Check Select popups inside the room picker on mobile.
- Keep metadata/artwork caches bounded and cache only requested entries. Preserve original
  byte ranges, HEAD, validators, cancellation, streaming deadlines, and compression bypass.
- Raw demuxing/decoding stays client-side. Keep audio, subtitles, HDR choices, and versions
  inside Vidstack settings. Audio/subtitle preferences are local; version changes are shared.
  Keep Encoded and Raw defaults in `lib/player/track-selection.ts`: audio prefers Japanese,
  English, then Chinese; subtitles choose the saved/default language before format,
  with shared format priorities within that language. Persist audio only
  after explicit selection, never while applying defaults or falling back from missing tracks.
  Automatic subtitle ties prefer the largest known byte size within the same format,
  language and CueForge/annotation category, after saved matching. Preserve menu order,
  companion restoration and unknown-size ordering; never scan media to determine sizes.
  Keep subtitle catalog construction, toggles, matching and per-format layer persistence
  shared in `lib/player/subtitle-selection.ts` and `SubtitlesMenuSection.tsx`. Preserve
  Encoded's format/language policy and layout; Raw uses version/stream identities rather
  than titles. Keep ASS font fallback and layer composition shared in
  `lib/player/subtitle-rendering.ts`; Raw uses one ASS renderer for collision-aware
  stacking and bounded packet windows, without a separate track-count cap.
  Encoded subtitle chunks can contain long overlapping seek preroll. Feed each stream
  monotonically, even after dedupe entries expire, and consume due preroll before it can
  evict upcoming packets. Preserve prefetched captions on sink resume; clear old caption
  state explicitly for a real provider seek or track reset.
- Audio normalization is a local control beside Captions. AI HDR and normalization
  start off for each title and after reload or leaving the player; never persist them
  or restore legacy saved values. Keep explicit choices through track/output changes
  and recovery of the current title. Preserve the PCM hook before
  user volume and the native element's clock, volume and mute. Downmix to stereo before
  measuring loudness; link left/right gain and guard peaks after mixing. Keep bounded
  AudioWorklet processing and an exact original-channel bypass when disabled; never
  seek, reload or broadcast playback events for a normalization toggle. See
  [audio normalization](docs/audio-normalization.md) for assets, lifecycle and checks.
- Compatible and multichannel Encoded Plex audio explicitly configures the browser
  speaker destination and remixes decoded channel layouts to that output in libmedia before Web Audio. Preserve
  center/side/back content when downmixing to stereo and speaker positions on surround
  outputs. Quad requires an explicit FL/FR/BL/BR layout; FFmpeg's default four-channel
  layout has center/back-center positions. Restore the shared context when the last
  PCM player stops.
  Server encodes accept decodable 1-64-channel audio, preserving speaker positions
  in standard Opus layouts with silent padding where possible. Explicitly mix
  height/wide and other unrepresentable named layouts to 7.1; unidentified layouts
  fold all channels to labelled stereo without inventing speaker positions. Show
  conversions in the audio menu without altering saved track identity. Per-track Opus
  targets use `ENCODE_AUDIO_SURROUND_KBPS_PER_CHANNEL` (default 80) times the smaller
  source/encoded channel count, including mono and stereo.
  Multichannel titles use WASM PCM even when native Opus is advertised;
  mono/stereo-only encoded outputs can share the native video clock. Processed media keeps
  its existing stereo behavior. Output is decoded PCM, not Dolby/DTS/Atmos bitstream passthrough.
- Server encodes use 12-second segments, including AI HDR; bump the profile revision when
  duration changes. Share cache keys by source fingerprint, codec, profile and time segment,
  never by participant. Preserve cancellation, GPU limits, byte/count cache bounds, original
  read-only handles and timestamp continuity. Use NVENC exclusively for AV1/HEVC video
  encoding. `ENCODE_CONCURRENCY` accepts 1–32 shared pipelines and defaults to 2. Use
  fast p3 and CQ 24 by default, using the documented NVENC rate-control mapping.
  CPU source decoding must never substitute a software video encoder.
  Automatic always prefers browser-supported Encoded AV1, then HEVC, independent of
  network conditions. Unavailable or failed encoding must not fall back to original
  playback; Compatible requires an explicit saved user choice. Do not probe network speed.
  Prefer one native clock for mono/stereo-only encoded video/Opus audio;
  multichannel titles use the Compatible PCM speaker path, including on iOS. Keep
  subtitle menu roots mounted during provider changes; Vidstack hides sibling menus when opening a submenu.
  Bitrate means bounded compressed packet bytes over media time, not network throughput.
  Keep encoded output labeled HDR10/HLG/SDR; do not claim preserved dynamic HDR.
  `AI_HDR_ENABLED` defaults off and gates every enhanced resource before probing or cache
  access. AI HDR is a local Plex toggle before audio normalization; its encoded variant
  must have separate URLs/cache identity and preserve the saved ordinary output choice.
  SDR uses NVIDIA TrueHDR; PQ/HLG use frame-adaptive expansion to a 1600-nit HDR10
  ceiling. Inspect container and decoded color metadata; reject conflicting HDR signals.
  Untagged 8-bit 4:2:0 AVC at HD dimensions may use the conventional limited-range
  Rec.709 SDR assumption after decoded-frame checks and absence of all HDR metadata.
  Keep other ambiguous/high-bit-depth/wide-gamut sources rejected.
  Keep canonical 4:2:0 decode/filter/encode frames on the GPU when timestamp checks
  pass; retain the normalized reference path for other colors/formats and VFR.
  Both paths must share scene analysis, tone/gamut mapping and the two-second lead-in.
  Bound and remove compressed job intermediates; never persist decoded frames.
  Never substitute a metadata-only relabel or ordinary encode after enhancement fails.
  NVENC tests need a GPU; CI exercises the scheduling/cache contracts with temporary fixtures.
- Missing room links are recreated by the client through `POST /rooms`, including
  media links after authorization. Creation is idempotent for an existing room ID;
  only `PUT /rooms/{room}` or authorized socket changes replace its media. GET and
  share previews must not create rooms.
- Room time is seconds; libmedia time is milliseconds. Preserve serialized provider commands,
  media-generation checks, stale-message rejection, and remote-event suppression through
  readiness, seeks, buffering, track changes, recovery, and teardown. Loading must not emit
  accidental pauses or stale positions.
  Foreground/online recovery must request the current room timeline without resuming
  a paused room. Bound decoder commands and teardown, cancel obsolete generations,
  and recover the selected output without broadcasting a stale local position.
  Background clock updates must not change the shared timeline. Prime unstarted
  decoders before restoring paused positions, and let the latest room seek replace
  an unfinished seek even when the native clock still matches the latest target.
  Hold both PCM playback clocks until both decoders finish seeking, then restore
  the requested play state without publishing a stale seek or an internal pause.
  Automatic connections after media replacement preserve room pause state; only
  an explicit initial join may request the solo-room autoplay policy.
- Software tone mapping is temporarily disabled by `SOFTWARE_TONE_MAPPING_ENABLED`.
  Preserve its implementation for rework, migrate saved `sdr` choices to Compatible,
  and require native video for active raw/encoded modes on SDR and HDR displays.
- Prefer native video/MSE for HDR. Keep source format separate from output mode. The
  MSE initialization segment must include HEVC mastering/light-level metadata even
  when it exists only in bitstream SEI. Keep audio-only MKV seeks on the cluster index.
  The canvas renderer produces explicitly labeled SDR, with reference-pixel tests. Label
  automatically selected compatible representations. Generic codec support
  does not verify Dolby Vision/HDR10+; Profile 7 enhancement-layer playback remains unverified.
  Read [HDR requirements and limits](docs/plex-raw-media.md#playback-and-hdr) before changing
  capability detection or the qualification registry.
- Keep room participation independent of decoding. Preserve chat, profiles, notifications,
  games/tabs, presence, and existing voice behavior on unsupported clients. Do not introduce
  global COOP/COEP isolation headers that break Discord Activities.
  Voice uses room-authorized WebSocket signaling and WebRTC audio. Keep negotiation
  serialized per peer, deterministic offer roles, session checks, bounded ICE retries,
  and established connections across mute toggles. Cancel pending microphone requests
  on leave/disposal; audio-device errors must not crash the room. Never log SDP, ICE,
  or TURN credentials. Optional `VOICE_TURN_URLS`/`VOICE_TURN_SECRET` use temporary
  browser credentials; the shared secret stays in Go. See [voice chat](docs/voice-chat.md).
  Raw fullscreen must target the active libmedia video when only iOS native fullscreen
  is available, refresh support after metadata loads, and detach listeners on media changes.
  Prefer whole-player element fullscreen on Android and desktop to retain controls and overlays.
  Mirror Raw text subtitle layers into one bounded native cue track for iOS video fullscreen,
  using the same text merge rules as Encoded. Keep it hidden inline and in element fullscreen,
  clear old cues on seeks/selection changes, and release it with the active video.
- Frontend public bases (`SERVER_BE`, `SERVER_STATIC`) and internal bases
  (`SERVER_INTERNAL_BE`, `SERVER_INTERNAL_STATIC`) are separate runtime settings. Preserve
  relative-path proxying and Discord Activity mappings; do not bake private hosts into bundles.

## Generated files and deployment

- `npm run dev` and `npm run build` prepare locally served player assets. The first run may
  fetch immutable, hash-checked decoder files; playback must not depend on a third-party CDN.
- Before modifying libmedia, read [the pinned build guide](scripts/libmedia/README.md).
  Change the reproducible patches, rebuild, export the manifest/binaries, and qualify the
  result together. Do not hand-edit bundles or format hash-pinned artifacts. Preserve licenses.
- Keep `.env`, `cache/`, `data/`, media files, and generated `public/vendor/libmedia/` out of
  commits. The checked-in `vendor/libmedia/` binaries and manifest are intentional.
- Keep Windows binaries under ignored `bin/windows/` and logs under ignored
  `.sparkle-backend/`. The tray owns its process tree through a kill-on-close Job Object;
  release the startup gate only after assignment. Stop/Restart/Quit use a private event
  for graceful Go shutdown before bounded forced cleanup. Closing logs only hides the
  window. Rebuild and Restart stages a backend-only build before stopping the server;
  failed builds preserve the running backend. Own gated compiler children in a separate
  job, keep logs and Quit responsive, and cancel builds on tray exit. Replace the binary
  only after shutdown, and retain the installer's Go path for tray rebuilds.
  Preserve single-instance activation, system DPI awareness, the yellow backend
  icon, bounded UTF-8 log display, and terminal-free children. Keep full disk logs with
  five UTC exit-timestamped tray-session archives plus the active log; recover interrupted
  sessions and delete only older recognized archives. Shortcut names and instance IDs
  must stay distinct from Sparkle-Transcoder.
  Run both Windows test scripts for launcher changes; they use disposable cache fixtures
  and must never inherit real Plex credentials or stop the developer's backend.
- Edit `scripts/service-worker.js` and `scripts/generate-sw.mjs`, not generated `public/sw.js`
  or `public/_sparkle/`. Cache only build-manifest assets by verified content revision;
  keep room HTML, APIs, credentials and streamed media out of worker caches. Production
  and development workers have separate policies; see [frontend caching](docs/frontend-caching.md).
  Regenerate Wordle dictionaries
  with `npm run generate:wordle-dictionary`, not manual edits to generated word lists.
- Preserve the managed Next.js block below. `CLAUDE.md` already imports `@AGENTS.md`; keep
  shared instructions here rather than maintaining a duplicate guide.
- `build.sh` and `scripts/docker-build-*.sh` publish images with `--push`; they are not local
  validation commands. Use the README's local Docker build commands for local images.
- `.github/workflows/docker.yml` tests both Linux images before publishing commit tags.
  Pull requests never publish; only the current default-branch head can promote `latest`.
  Keep Actions pinned to verified commit SHAs and Docker Hub credentials in Actions secrets.
  `scripts/ci/docker-smoke.sh` uses disposable fixtures and containers; never substitute the
  developer's `.env`, real Plex credentials, media mounts, or running backend for CI fixtures.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

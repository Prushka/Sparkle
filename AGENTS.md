# Sparkle agent guide

Sparkle is a self-hosted watch-party app: a Next.js/React frontend and a Go HTTP/WebSocket
backend. It serves existing processed media and reads Plex catalogs and mapped original
files. Optional on-demand NVENC encoding serves cached derivatives of Plex media.

## Working in this repository

- These instructions apply throughout the repository. Read any closer `AGENTS.md` before
  editing its subtree; explicit task instructions take precedence over repository guidance.
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

| Path                                                   | Responsibility                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `app/`, `proxy.ts`, `lib/server/`                      | Next routes, SSR/share metadata, runtime configuration, backend/static proxy             |
| `components/catalog-browser.tsx`, `lib/library.ts`     | Shared paged Library/picker and normalized catalog models                                |
| `components/player/`, `lib/player/`, `lib/suptitles/`  | Vidstack UI, raw provider, subtitles, synchronization, room features                     |
| `backend/cmd/api/`, `backend/internal/config/`         | Go entry point, HTTP routing/middleware, environment configuration                       |
| `backend/internal/catalog/`, `backend/internal/plex/`  | Catalog normalization, read-only Plex access, confined streaming and artwork             |
| `backend/internal/encode/`                             | Optional shared NVENC segments, confined inputs, bounded cache and GPU concurrency       |
| `backend/internal/jobs/`, `backend/internal/realtime/` | Existing processed jobs; room/WebSocket state, profiles, chat, games and voice signaling |
| `scripts/libmedia/`, `vendor/libmedia/`                | Reproducible player patches, pinned binaries, manifest and notices                       |
| `tests/e2e/`, `scripts/tests/`, `docs/`                | Browser/codec checks, setup reference and qualification evidence                         |

## Setup and verification

Use npm with `package-lock.json`; the Go module lives in `backend/` and requires Go 1.25+.
Follow the [local setup](README.md#local-development) for `.env` and separate frontend/backend
terminals. Do not overwrite an existing `.env`. Startup scripts load the root `.env` and
resolve output/cache/profile paths relative to the repository; direct `go run` does neither.

| Command                                            | Directory / purpose                                                    |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `npm ci`                                           | Root; install locked frontend dependencies                             |
| `npm run dev`                                      | Root; webpack dev server on port 3001, prepares player assets first    |
| `./start-backend.ps1` or `bash ./start-backend.sh` | Root; API on port 1323 by default                                      |
| `npm run check`                                    | Root; TypeScript check for frontend changes                            |
| `npm run test:player`                              | Root; focused subtitle parser/bitmap checks                            |
| `npm run build`                                    | Root; production webpack/Next build and service-worker generation      |
| `go test ./...`                                    | `backend/`; backend tests, using temporary files and mock Plex servers |
| `go vet ./...` / `go test -race ./...`             | `backend/`; static/concurrency checks when backend behavior changes    |
| `npm run test:e2e`                                 | Root; Playwright against an already running app                        |

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

- Plex access is read-only and endpoint-allowlisted. Do not add watched-state updates,
  scans, Plex transcoding, media modifications, or whole-original-file caching.
  Server decoding is confined to the explicit optional encoded mode; raw playback remains client-side.
- Resolve the longest matching mapping prefix and use root-confined file access. Retain
  traversal, symlink/junction, alternate-stream, and allowed-section protections. Keep
  `PFP_DIR` and `MEDIA_CACHE_DIR` outside mapped media roots; legacy avatars remain readable.
- Keep Plex tokens, credential-bearing URLs, and local filesystem paths out of browser
  payloads and logs. Never expose backend secrets through public environment variables.
- Use `/library/items` paging and direct `/media/{id}` lookup. Never enumerate Plex to build
  a complete index or refresh the picker through `/all`; `/all` is processed-only legacy
  compatibility. Preserve processed IDs/links and version-specific Plex identities.
- Processed/Plex artwork matching must remain conservative and bounded: compare title/year
  or series/season/episode identity, reject ambiguity, and enrich only requested items.
  Library URL state must preserve room context without remounting or reconnecting the room.
- Shared UI components follow shadcn/Tailwind 4 conventions. Select uses Base UI's
  non-modal primitive; other controls use Radix. Menus, selects and room dialogs must
  leave page scrolling enabled. Preserve Tabler
  icons, the local `cn` helper, fullscreen portal containers, and existing namespace exports
  when updating generated components. Check Select popups inside the room picker on mobile.
- Keep metadata/artwork caches bounded and cache only requested entries. Preserve original
  byte ranges, HEAD, validators, cancellation, streaming deadlines, and compression bypass.
- Raw demuxing/decoding stays client-side. Keep audio, subtitles, HDR choices, and versions
  inside Vidstack settings. Audio/subtitle preferences are local; version changes are shared.
- Server encodes share cache keys by source fingerprint, codec, profile and time segment,
  never by participant. Preserve cancellation, GPU limits, byte/count cache bounds, original
  read-only handles and timestamp continuity. Match the documented Sparkle-Transcoder CQ
  profile. Keep encoded output labeled HDR10/HLG/SDR; do not claim preserved dynamic HDR.
  NVENC tests need a GPU; CI exercises the scheduling/cache contracts with temporary fixtures.
- Room time is seconds; libmedia time is milliseconds. Preserve serialized provider commands,
  media-generation checks, stale-message rejection, and remote-event suppression through
  readiness, seeks, buffering, track changes, recovery, and teardown. Loading must not emit
  accidental pauses or stale positions.
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
- Edit `scripts/generate-sw.mjs`, not generated `public/sw.js`. Regenerate Wordle dictionaries
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

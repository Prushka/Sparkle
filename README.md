# Sparkle

Sparkle is a self-hosted watch-party app for the browser and Discord Activities.
A Next.js/React frontend and Go backend keep room playback, chat, and shared
activities synchronized. Browse existing processed media and a read-only Plex
library from the same Library view.

![Watch-party room](assets/main.png)

## Features

- Shared play/pause, seeking, media changes, reconnects, profiles, chat, and notifications.
- Plex sign-in in Library and the player. Server members can access every configured
  Raw library; anonymous visitors can use existing Encoded media. Raw rooms prompt
  visitors to sign in or leave. Shared Raw links render full titles, descriptions and
  covers without sign-in; playback remains protected. See [authentication setup](docs/plex-auth.md).
- **Go back to library** beside **Change media** clears the room's selected media and
  returns everyone to Library while keeping the same room ID and library filters.
- A paged, searchable poster Library with source filters, seasons, episodes, and **Raw**
  and **Encoded** badges. Back/Forward preserves the room, hierarchy, and filters.
  Search applies to the current level; opening a show or season clears it, and going
  back restores the parent search. Menus and dialogs leave page scrolling enabled.
  Large Plex libraries load on demand; confidently matched processed titles reuse Plex
  covers and descriptions.
- Vidstack controls for playback, audio selection, subtitles, HDR options, and media versions.
- Shared Encoded/Raw track priorities: Japanese → English → Chinese audio, with only
  explicit choices saved; subtitles share format tabs, track toggles, language fallback,
  and per-format layer preferences across playback sources.
- Optional client-side audio normalization beside Captions, with a saved local preference
  for Encoded MP4 and every Raw playback mode. Multichannel audio is downmixed to
  stereo before normalization; disabling restores the original audio routing.
- Optional shared NVENC AV1/HEVC playback for Plex, with on-demand cached segments and a
  saved output preference. Automatic selects a compatible encode on a measured slow connection.
- Embedded ASS/SSA with multilingual fallback fonts, text subtitles, and PGS/SUP bitmap
  subtitles. Raw and Encoded share subtitle layer sizing and stacking, without a
  three-track cap; layer and audio preferences stay local to each participant.
- Raw caption toggle and supported-browser picture-in-picture. Chrome Document PiP keeps
  subtitle layers; raw Google Cast options explain tab casting and direct-cast limitations.
- Shared YouTube, Chess, and Wordle tabs, plus browser voice chat outside Discord Activities.
- Discord identity, avatars, Rich Presence, and share previews with media artwork.

[Demo](https://sparkle.muddy.ca) · [Plex setup and playback limits](docs/plex-raw-media.md) ·
[Validation and browser coverage](docs/raw-media-validation.md)

## Media sources and playback

| Source   | What Sparkle reads                                                    | Playback                                                                                               |
| -------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Encoded  | Existing `OUTPUT/<id>/job.json` directories and their prepared assets | Existing encoded video/audio, extracted subtitles, posters, chapters, and storyboards                  |
| Plex raw | Plex metadata plus the original files through local folder mappings   | Original-file range requests; client-side demuxing and decoding through pinned libmedia AVPlayer 1.3.1 |

Raw playback reads original files and decodes in the browser. With `ENCODE_ENABLED=true`,
the backend can also create NVENC AV1/HEVC segments on demand for Plex media, using
the fast `p3` preset by default with no software video encoding fallback. Identical
requests share one GPU job and cache, including across rooms. Original media stays read-only;
Sparkle never starts a Plex transcoding session or changes Plex watched state. No complete
original file is cached. Artwork has a 512 MiB budget; encoded segments default to 20 GiB.
See [server encoding](docs/server-encoding.md) for GPU setup, settings and limits.
Encoded audio and video share a native playback clock on compatible browsers.
HDR output settings show live bitrate for the active playback mode.
Software tone mapping is temporarily disabled; Compatible and AV1/HEVC playback use
native video on SDR and HDR displays. Saved Tone mapping selections switch to Compatible.

The waveform button beside Captions enables [audio normalization](docs/audio-normalization.md).
It downmixes multichannel audio to stereo before adjusting loudness in an AudioWorklet,
preserves stereo balance and the playback clock, and restores the original samples and
channel routing when off. The preference is local to each browser.

Raw playback supports client WASM fallbacks, including TrueHD audio and embedded
subtitles. TrueHD output is decoded PCM, not Atmos bitstream passthrough. Raw
storyboards are currently omitted; processed storyboards remain available.

HDR prefers native video/MSE with exact codec/profile checks. Automatic mode tries
native Dolby Vision or HDR10+ and then a labeled compatible HDR10/HLG representation.
The client preserves HDR color signaling and supplies HEVC mastering/light-level
metadata to the native player even when it exists only in the encoded bitstream.
Vidstack → Video Settings also offers client-side SDR tone mapping for PQ/HLG and
Dolby Vision Profile 5 (including RPU reshaping). Source format, renderer and output
are reported separately. **Full dynamic-HDR display output is not yet qualified**;
native runtime admission is labeled unverified. Profile 7 enhancement layers are
not decoded; its compatible base layer remains playable. Unsupported playback does not prevent participation in
the room. See the [qualification record](docs/raw-media-validation.md) for tested
Windows Chrome/Edge combinations and pending Safari, mobile, Firefox, and Activity checks.

## Local development

Prerequisites: Node.js LTS with npm, Go 1.25 or newer, and either existing
processed output or a reachable Plex server with readable local media mappings.
Plex is optional. Raw playback does not require server FFmpeg. Optional encoded playback
requires FFmpeg/ffprobe and an NVIDIA GPU with the selected 10-bit NVENC encoder.

1. Install dependencies from the repository root:

   ```sh
   npm ci
   ```

2. For a fresh checkout, copy `.env.example` to `.env` and edit it. Preserve an
   existing `.env`. The example's Plex address, section IDs, and Windows paths
   must match your installation. For processed-only operation, remove all
   `PLEX_*` entries. Keep the four `SERVER_*` bases configured.

3. Start the backend in one terminal, from the root:

   ```powershell
   # Windows PowerShell
   .\start-backend.ps1
   ```

   ```sh
   # Linux/macOS or Bash
   bash ./start-backend.sh
   ```

4. Start the frontend in another terminal:

   ```sh
   npm run dev
   ```

Open <http://localhost:3001>. The backend defaults to port `1323`. The startup
scripts load the root `.env` and resolve relative output, profile, and cache
paths from the repository root. Set `ENV_FILE` to use another backend environment
file; the Bash script sources that file as shell code. Direct `go run ./cmd/api`
from `backend/` requires exporting configuration yourself.

`predev` and `prebuild` prepare the player assets automatically. The first run
may download pinned decoder files with SHA-256 verification. They are served
locally during playback. Use `npm run prepare:player` to prepare them separately;
the [player build guide](scripts/libmedia/README.md) covers changing the pinned integration.

### Windows tray backend

To run the backend without a terminal and start it automatically at Windows sign-in,
stop any existing terminal-launched backend, then run from the repository root:

```powershell
.\install-backend-startup.ps1 -Start
```

The installer builds a native **Sparkle Backend** tray app and a compiled Go backend,
then adds current-user Startup and Start Menu shortcuts. No administrator access or
.NET SDK is needed. Go is required to build/update, but not to run the installed app.
It uses the existing `.env`; the frontend still runs separately.

Double-click the tray icon or open **Sparkle Backend** from Start to see live logs
in a dedicated window. Closing that window hides it. Right-click the tray for
Start, Stop, Restart, or Quit. Restarting the backend clears in-memory rooms/chat.
Logs are bounded and stored in `.sparkle-backend/logs/sparkle.log`; a fresh tray
session replaces the previous session's log. Sparkle-Transcoder's shortcuts remain
separate. See [Windows launcher setup, updates, and tests](docs/windows-backend.md).

## Configuration

Use [.env.example](.env.example) as the starting point. Frontend configuration
is read at runtime, including in Docker; changing these values does not require
rebuilding the image. Restart the relevant service after changing its environment.

### Frontend

| Variable                       | Purpose / example                                                        |
| ------------------------------ | ------------------------------------------------------------------------ |
| `SERVER_BE`                    | Browser API/WebSocket base; `/be`                                        |
| `SERVER_STATIC`                | Browser processed-asset base; `/static`                                  |
| `SERVER_INTERNAL_BE`           | Private API base for SSR and the frontend proxy; `http://localhost:1323` |
| `SERVER_INTERNAL_STATIC`       | Private static base; `http://localhost:1323/static`                      |
| `PUBLIC_DISCORD_CLIENT_ID`     | Optional Discord application/OAuth2 client ID                            |
| `PUBLIC_REQUEST_URL`           | Optional Library Request link; absolute public HTTP(S) URL               |
| `SERVER_DISCORD_CLIENT_SECRET` | Optional server-only Discord OAuth2 secret                               |

Public bases beginning with `http://` or `https://` remain absolute; other values
are normalized to relative paths. Relative `/be` and `/static` requests are
forwarded to their corresponding internal bases. Keep private addresses and
credentials out of browser configuration.

The Library's **Request** link opens `PUBLIC_REQUEST_URL` in a new tab, keeping the
current room open. Leave it empty to hide the link. Invalid URLs and URLs containing
a username or password are ignored.

### Backend

| Variable                    | Purpose / example                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `ADDR`                      | Listening address; `:1323`                                                           |
| `OUTPUT`                    | Existing processed-media root; `./output` in `.env.example`                          |
| `JOBS_CACHE_TTL`            | Processed catalog refresh interval; `15m` in the example/startup scripts             |
| `PFP_DIR`                   | Writable directory for new avatars; `./data/pfp`                                     |
| `MAX_PFP_BYTES`             | Avatar upload limit; `12000000` bytes                                                |
| `MEDIA_CACHE_DIR`           | Writable artwork and optional encoded-segment cache; `./cache/media`                 |
| `PLEX_URL`                  | Plex server base URL, without a token or credentials in the URL                      |
| `PLEX_TOKEN`                | Server-only Plex token                                                               |
| `PLEX_LIBRARY_IDS`          | Comma-separated allowed section IDs; empty allows all movie/show sections            |
| `PLEX_PATH_MAPPINGS`        | JSON array mapping absolute Plex roots to absolute backend-visible roots             |
| `PLEX_AUTH_ORIGINS`         | Exact trusted frontend origins; defaults to localhost and 127.0.0.1 on port 3001     |
| `PLEX_AUTH_COOKIE_SECURE`   | Secure cookies; `true` by default, `false` allowed only for loopback development     |
| `PLEX_AUTH_COOKIE_SAMESITE` | `lax` by default; `none` enables Secure partitioned cookies for cross-site embedding |

Windows mapping example:

```dotenv
PLEX_PATH_MAPPINGS='[{"plex":"/data/Managed-Videos","local":"O:/Managed-Videos"}]'
```

The local directory must already exist and be readable by the backend account.
Use forward slashes in Windows JSON; services may need an accessible UNC path
instead of an interactive mapped drive. Both writable directories must be
outside mapped media roots. Existing `OUTPUT/pfp` avatars remain readable;
new uploads go to `PFP_DIR`.

The API's direct configuration defaults and optional HTTP timeout settings are
defined in [config.go](backend/internal/config/config.go). Without the startup
scripts, its processed-cache default is `30m` and relative paths use the process
working directory. Rooms and their live state are held in backend memory and
are not persisted across a backend restart.

Plex account tokens remain in backend memory behind an HttpOnly session cookie;
they are never stored in browser localStorage. Sessions last up to 14 days but
backend restarts sign everyone out. Signed-in room profiles use the Plex name and
avatar; clicking your badge opens the Plex account dialog. Sign-out restores your
saved guest profile. Use HTTPS and configure the actual frontend
origin for deployment; see [Plex sign-in](docs/plex-auth.md) for proxy and Activity settings.

See [Plex configuration](docs/plex-raw-media.md#configuration) for library IDs,
mapping confinement, cache limits, and the catalog/streaming API.

## Docker

[compose.example.yml](compose.example.yml) defines the frontend and backend,
with processed output and original media mounted read-only. Avatars and artwork
cache have separate writable mounts.

Configure `.env`, set `PLEX_MEDIA_HOST_ROOT` to the host's media directory, and
adjust the Compose mapping's `plex` root to match Plex. Its `local` root must
match the **container** mount path, such as `/media/Managed-Videos`, even when
the host uses a Windows drive. For processed-only deployment, remove the Plex
environment entries and raw-media mount from your copy of the Compose file.

To build the current checkout locally with the image names used by that example:

```sh
docker build -t meinya/sparkle-api:latest -f backend/Dockerfile backend
docker build -t meinya/sparkle-next:latest .
docker compose -f compose.example.yml up -d
```

The frontend listens on port `3000`; internal requests use `sparkle-api:1323`.
Plex credentials are passed only to the backend. The API needs network access
to Plex and read access to the mounted media. CI checks both containers together
using disposable fixtures; deployment-specific Plex mounts and physical HDR output
still need validation on the target installation.

### Automatic image publishing

[GitHub Actions](https://github.com/Prushka/Sparkle/actions/workflows/docker.yml) builds
and tests both `linux/amd64` images on branch pushes, pull requests, and manual runs.
It runs Go race tests/vet, TypeScript and player tests, then starts both built images
with disposable fixtures and checks HTTP APIs, frontend proxying, byte ranges, pinned
player assets, and synthetic Chrome Library/room regressions. These checks need no
Plex credentials or personal media; real-media and physical HDR qualification remain
separate. Failed browser checks retain traces, screenshots and error context in the
run's `browser-smoke-<attempt>` artifact for seven days.

- Branch pushes and manual runs publish `meinya/sparkle-api:<short-commit>` and
  `meinya/sparkle-next:<short-commit>` only after both images pass.
- The current `main` commit also updates both `:latest` tags. Promotions are serialized
  and recheck the branch head so an older, slower run cannot replace a newer release.
- Pull requests build and test without signing in to Docker Hub or publishing images.
- Repository Actions secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` authorize
  publishing. The token must have write access to both Docker Hub repositories.

Use the Actions page's **Run workflow** button to retry manually. Publishing does not
restart running deployments; pull the new images and recreate your services when ready:

```sh
docker compose -f compose.example.yml pull
docker compose -f compose.example.yml up -d
```

For manual publishing, `bash ./scripts/docker-build-all.sh` builds **and pushes**
both images; `build.sh` delegates to it. The scripts accept `SPARKLE_API_IMAGE`,
`SPARKLE_NEXT_IMAGE`, and `PLATFORM` (default `linux/amd64`).

## Discord Activities

The same frontend serves standalone browsers and Discord Activity frames. In an
Activity, the Embedded App SDK authorizes `identify` and `rpc.activities.write`,
exchanges the authorization code through `/api/token`, and uses the authenticated
Discord user for the Sparkle profile. Discord names and avatars replace local
profile editing; Rich Presence updates while watching.

To configure an Activity:

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications),
   enable Activities, and add `https://127.0.0.1` as the OAuth2 redirect URI.
2. Add your Discord users as Application Testers.
3. Configure URL mappings for the frontend, API, and static assets. Their prefixes
   must match the pathnames in `SERVER_BE` and `SERVER_STATIC`.
4. Set `PUBLIC_DISCORD_CLIENT_ID` and `SERVER_DISCORD_CLIENT_SECRET` on the frontend server.

Example portal targets omit the protocol:

| Prefix    | Target                       |
| --------- | ---------------------------- |
| `/`       | `sparkle.example.com`        |
| `/be`     | `sparkle.example.com/be`     |
| `/static` | `sparkle.example.com/static` |

Use `SERVER_BE=/be` and `SERVER_STATIC=/static` with the private internal bases
from your deployment. Activity traffic uses Discord's proxy. Sparkle disables
its browser WebRTC voice chat in Activities and keeps decoding compatible with
non-isolated execution. Actual embedded raw-playback qualification remains
pending; ordinary non-isolated browser tests do not establish Activity support.

<details>
<summary>Discord screenshots</summary>

![Desktop Activity](assets/app.png)

<img src="assets/mobile.jpeg" width="300" alt="Mobile Activity">
<img src="assets/status.png" width="400" alt="Discord Rich Presence">
<img src="assets/embed.png" width="400" alt="Discord media embed">

</details>

## Development checks

From the repository root:

```sh
npm run check
npm run test:player
npm run build
```

From `backend/`:

```sh
go test ./...
go vet ./...
go test -race ./...
```

Race checks require CGO and a supported C compiler. `npm run lint` runs Prettier
and ESLint across the repository; use scoped formatting for authored files rather
than rewriting generated or vendored assets.

Playwright requires a running app and installed Chrome by default. It uses port
`3002` unless overridden; for the local dev server, run:

```powershell
$env:SPARKLE_TEST_URL = 'http://127.0.0.1:3001'
npm run test:e2e
```

```sh
SPARKLE_TEST_URL=http://127.0.0.1:3001 npm run test:e2e
```

The synthetic Library test runs without media fixtures. Two-client playback and
multipart tests require mapped fixture IDs and otherwise skip. See
[reproduction settings](docs/raw-media-validation.md#reproduce) for browser
channels, fixtures, codec/HDR scripts, and remaining hardware checks. Test
artifacts go under ignored `cache/`.

## Repository guide

| Path                                                  | Contents                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| `app/`, `lib/server/`, `proxy.ts`                     | Next.js App Router, SSR/share metadata, runtime API/static proxy      |
| `components/`, `lib/player/`, `lib/suptitles/`        | Library, Vidstack playback, room UI, subtitles and synchronization    |
| `backend/cmd/api/`, `backend/internal/`               | Go API, Plex/catalog, processed-job reader and realtime room service  |
| `windows/`, `*-backend*.ps1`, `build-windows-app.ps1` | Windows tray host, launcher/installer and native lifecycle tests      |
| `scripts/`, `vendor/libmedia/`                        | Build/validation scripts, pinned patched player and decoder artifacts |
| `tests/e2e/`, `docs/`                                 | Browser tests, Plex setup and playback qualification records          |
| `public/media/`                                       | Bundled emotes, sound effects and other room assets                   |

Contributor and coding-agent instructions live in [AGENTS.md](AGENTS.md).
Keep setup and behavior documentation aligned with code; record codec/device
evidence in the qualification guide rather than claiming universal browser support.

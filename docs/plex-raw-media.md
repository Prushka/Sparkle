# Plex raw media

Sparkle keeps processed media and adds a paged, read-only Plex catalog. `/all`
continues to return processed items only. Raw media uses original-file range
requests with client-side decoding. Optional [server encoding](server-encoding.md)
provides shared NVENC derivatives; Plex access and original files stay read-only.
There is no Plex transcoding session or full-original-file cache.
Raw media requires [Plex sign-in](plex-auth.md): any member of the configured
server can access every configured library. Anonymous visitors use existing Encoded media.
Shared Raw links expose title metadata and covers without a session for complete
previews; library browsing, room participation and playback still require membership.
Audio output is decoded PCM: TrueHD decoding does not imply
Atmos bitstream passthrough.

## Configuration

Set these **backend-only** variables in `.env` (see `.env.example`):

```dotenv
PLEX_URL=http://192.168.1.177:32400
PLEX_TOKEN=your-existing-token
PLEX_LIBRARY_IDS=1,11,17,2,12,3,13
PLEX_PATH_MAPPINGS='[{"plex":"/data/Managed-Videos","local":"O:/Managed-Videos"}]'
MEDIA_CACHE_DIR=./cache/media
PFP_DIR=./data/pfp
```

These section IDs were resolved against the supplied server: Anime `1`, Anime-R
`11`, Demo `17`, Movies `2`, Movies-R `12`, TV `3`, TV-R `13`. IDs belong to that
server; configure the matching IDs for another installation. An empty ID list
allows all movie/show sections. To run without Plex, omit all Plex variables.
Never place the token in a `NEXT_PUBLIC_*` variable or browser URL.

On Windows, use forward slashes in JSON and run the backend under an account
that can read the mapped drive. Windows services commonly cannot see interactive
session drive letters; use an accessible UNC path or mount for that account.
`start-backend.ps1` resolves writable paths before changing directories. Both
writable directories must be outside every mapped media root; startup rejects
nested paths and existing symlink/junction aliases. Mapped files are opened
read-only with Go's root-confined file API. The longest Plex directory prefix
wins. Traversal, alternate streams, and symlink/junction escapes are rejected.

New avatars go to `PFP_DIR`. Existing `OUTPUT/pfp/*.png` remain readable through
the same `/static/pfp/` URLs. No migration or write into `OUTPUT` is required.

For Linux Docker, use `compose.example.yml`, set `PLEX_MEDIA_HOST_ROOT` to the
host directory, and use container paths in `PLEX_PATH_MAPPINGS`. Both the raw
mount and processed output mount are `:ro`; cache and profiles have separate
writable mounts. Do not mount the media directory at a writable cache/profile
location. The API container needs network access to Plex. The frontend never
needs Plex credentials or direct filesystem access.

## Catalog and storage bounds

- `/library/sources`: processed source and permitted Plex sections.
- `/library/items`: `source=all|processed|plex`, `libraryId`, `kind=all|movies|shows`,
  `query`, `sort`, `limit` (48 default, 100 maximum), opaque `cursor`.
- `/library/items/{id}/children`: seasons/episodes requested on expansion.
- `/media/{id}`: normalized details plus legacy job fields for existing clients.
- `/media/{id}/parts/{partId}/file`: original bytes, GET/HEAD, ranges and validators.
- `/media/{id}/artwork/{poster|backdrop}`: controlled original-artwork proxy.

Search and ordering are forwarded to Plex. Cursors hold signed, expiring,
filter-bound source offsets. Each merged page uses bounded section requests;
joining a room uses direct metadata lookup. No startup Plex scan or complete
Plex index exists. Virtualization bounds rendered cards; loaded page metadata
remains in the current browser view until filters/navigation change.

Processed artwork enrichment only looks up items on the requested page or a direct
media lookup. Movies require a filename title and year; episodes require the exact
series title, season/episode numbers, and episode title. Punctuation and recognized
release suffixes are normalized. A year in a series title must also agree. Multiple
Plex copies are accepted only when their canonical Plex GUID agrees. Ambiguous,
truncated, or incomplete matches keep the original processed artwork and metadata.
Matching searches each permitted section of the appropriate type with a maximum of
32 candidates; season/episode queries filter by index and cap results at 100.
It never enumerates a show or library to find a match. Four workers and a four-second
request budget bound enrichment work; a 256-entry, five-minute cache includes misses
and coalesces concurrent lookups. Processed IDs and playback assets remain unchanged.

Metadata memory cache: at most 256 entries / 32 MiB, one-minute TTL. Plex
responses: at most 8 MiB, eight concurrent metadata/artwork requests per backend.
Artwork: at most 12 MiB per item, 512 MiB disk budget, 24-hour TTL with oldest
entry eviction. Raw mode caches only requested metadata/artwork; optional encoded
segments use a separate bounded cache under `MEDIA_CACHE_DIR/encoded`. File writes renew a
60-second idle deadline and stop on request cancellation. File responses bypass
compression. Browser range reads use 4 MiB chunks and decoder preload is four
seconds; the browser and demuxer may require additional index/probe reads.

## Playback and HDR

The Library and room media picker share a poster grid, source/library filters,
search, sort, and breadcrumbs. Shows open into seasons and then landscape episode
cards. Scrolling loads the next page automatically; the grid virtualizes long lists.
The compact toolbar uses shared shadcn-style Select/InputGroup components, keeps every
search/filter control visible, and wraps on small screens. Every title has a **Raw**
or **Encoded** badge. The default view includes both sources. Library hierarchy and
filters live in the URL, preserving the room and unrelated parameters across browser
Back/Forward and reload without remounting the room. The in-room picker keeps its own
navigation. Search applies to the current level, resets on entering a show/season,
and is restored when returning to its parent. Clearing cancels pending searches;
history navigation never schedules a new search. Select uses Base UI's non-modal
mode, and room dialogs/dropdowns use Radix's non-modal mode, so these controls do
not lock page scrolling. Mounted, overscanned cards load posters eagerly so scrolling does not depend
on image hover or native lazy-loading inside translated virtual rows.

Raw playback uses the existing Vidstack control bar. **Settings → Video Settings**
contains embedded audio, source/output HDR information, explicit compatible HDR
fallbacks, and shared media versions. **Settings → Subtitles** contains the primary
track and additional same-format layers. These menus remain accessible when HDR
playback is unsupported, so the user can select a compatible representation.

The **CC** button (or **C** while the player is focused) toggles raw subtitles and
restores the selected primary/additional layers. Subtitle entries are available
on the first Settings open, without visiting Video Settings first. PiP is exposed
when the active renderer and browser support it: Chrome Document PiP moves the
original video/canvas and subtitle layers into the floating window, with playback
still synchronized to the room. Native video PiP is a fallback where available;
it does not carry the custom subtitle overlays. Document PiP requires a top-level
page and is not enabled inside Discord Activity iframes.

Raw **Google Cast options** explains Chrome tab casting and the option to choose
a compatible processed version. It is not a direct receiver-casting implementation:
the raw provider's browser demuxer, audio decoder, and subtitle renderer cannot
be handed to a Cast receiver as a playable media URL. No server transcoding or
capture/re-encoding is added for PiP or casting.

Pinned libmedia AVPlayer 1.3.1 is adapted to Vidstack. Demuxing, WASM audio/video
fallbacks, AudioWorklet output, text subtitles, JASSUB ASS/fonts, and incremental
PGS run in the browser. Assets are served from `/vendor/libmedia/`; clients do
not fetch decoders from a third-party CDN. No global COOP/COEP headers are added.
Non-isolated execution is exercised by the real-media test script.

Raw and Encoded playback share track-selection priorities. Without an available
saved audio choice, prefer Japanese, then English, then Chinese, then the first
available track. Only explicit audio selections write `audioSelection` to local
storage; matching uses the track within the same media, then title/language across
media. Automatic fallbacks never overwrite the saved choice. Existing explicit
Raw audio choices remain supported until a new shared choice is made.

Subtitles share the Encoded selection and persistence policy in every Raw mode:
ASS/SSA, VTT, SRT, then
PGS/SUP on desktop, with VTT ahead of ASS on iOS/Android; prefer English within
the selected format. Saved choices retain their language when the exact track is
missing. Both sources use `subtitleSelection`, `subtitleLanguage`, and per-format
`subtitleLayers`; Off and explicit selections carry between sources. Automatic
fallbacks do not overwrite the saved primary preference. Raw identities include
the media version and original stream index, so duplicate titles restore correctly
across Compatible, Encoded AV1, and Encoded HEVC. Legacy Raw preferences are used
when no shared preference exists; legacy title-only choices cannot identify which
of two identically titled tracks was previously selected.

Both menus use the same format tabs and track toggles: Styled (ASS/SSA), Native
(VTT), Text (SRT), and Image (PGS/SUP), showing only available formats. ASS and VTT
support same-format companions. Changing formats restores that format's layers;
turning off the primary promotes its next companion. Neither source imposes a
three-track cap. SRT and PGS select one track at a time. Both sources share
multilingual ASS fallback fonts, font normalization, and merged style/event
composition in `lib/player/subtitle-rendering.ts`. Tracks with different ASS script
resolutions are normalized before merging. Styled layers shrink together
and share one libass collision domain; Native layers stack as lines with the same
size policy. Raw composes bounded active packet windows instead of downloading
whole tracks, including in NVENC AV1/HEVC mode. Embedded fonts remain available.
Catalog construction, preference matching, toggle transitions, and storage are shared.
Audio and subtitle choices stay local. Media-version choices are room-wide.
Multipart positions are converted to one seconds-based room timeline. Parts
without reliable durations are explicitly rejected rather than synchronized to
an invented timeline. Raw storyboards are optional and currently omitted;
processed storyboards remain available.

Native video/MSE is preferred for HDR, with color-managed browser conversion on
SDR displays. Automatic mode first probes the exact Dolby codec/profile/level or
HDR10+ ST2094-40 capability. The MSE MIME and MP4 sample entry agree with the Dolby
configuration; generic HEVC support is never treated as Dolby support. Compatible
HDR10/HLG playback is selected when necessary and identified in Video Settings.

The **Tone mapping** option and automatic software fallback are temporarily disabled
pending performance rework. Saved tone-mapping selections migrate to **Compatible**.
All active raw and encoded modes require native video/MSE on SDR and HDR displays;
HDR-to-SDR conversion is handled by the browser. Unsupported native codecs require
an available Encoded AV1/HEVC mode or another media version, rather than a canvas fallback.

The retained, inactive software implementation decodes PQ and HLG
to integer high-bit-depth frames, converted to linear BT.2020, tone mapped with a
monotonic highlight shoulder, gamut compressed, and encoded to full-range sRGB.
This WebGL2 path produces SDR on either SDR or HDR displays; it does not claim
native HDR brightness. Software decoding can be CPU-limited at high resolutions.
It currently requires BT.2020 non-constant-luminance source color, except for the
separate Dolby Profile 5 path. Unsupported color matrices are rejected.

Profile 5 has no HDR10-compatible base layer. Its inactive client SDR path uses FFmpeg's
per-frame RPU metadata, polynomial/MMR reshaping and IPT-PQ/LMS color transforms.
Missing/malformed metadata and residual enhancement-layer formats are rejected.
No Dolby display signal is produced by SDR rendering. Profile 7 uses its compatible
HDR10 base layer; full enhancement-layer composition is not implemented.

Dolby Vision and HDR10+ native playback is **not advertised as verified full dynamic
HDR**. The physical qualification registry remains empty. Browser-reported native
dynamic HDR is labeled unverified; metadata preservation and runtime admission do
not prove RPU/EL or per-scene output on an external display. Unsupported clients
remain in the room. Output-mode changes are local, preserve time/pause/track
preferences, and reject callbacks carrying a previous decoder's track IDs.

The integration carries Matroska color/mastering/light-level metadata into MP4
`colr`, `mdcv`, and `clli`, preserves Dolby configuration signaling, and retains
unchanged video packets. When HEVC mastering/light-level data exists only in
bitstream SEI, the client also extracts it from hvcC or the first keyframe into
the MSE initialization segment. Existing MP4 HDR boxes are preserved when remuxing, and
AV1 codec strings include their full bit-depth and color characteristics.
Preservation is distinct from proof of rendered
output. Qualification must record exact OS/browser/GPU/display, codec/profile,
reference signal, and observed output. Use Dolby's browser test kit and known
HDR10+/PQ/HLG references on physical hardware before adding a qualification.

Embedded audio uses a separate client decoder while HDR video stays on native
MSE; both indexed seeks start together, and pause commands reach both decoders. Ordinary
drift is corrected with small audio-rate adjustments instead of repeated seeks.
Audio-only Matroska reads reuse video-indexed cluster positions, including the
last cue, so a distant seek does not scan from the beginning of a large file.

## Validation

```powershell
cd backend
go test ./...
cd ..
npx tsc --noEmit
npm run test:e2e
```

E2E defaults to `http://127.0.0.1:3002` and installed Chrome. Set
`SPARKLE_TEST_URL` and `SPARKLE_TEST_CHANNEL` as needed. Set `SPARKLE_RAW_TEST_ID`
to a mapped SDR item to enable the two-client test. Real codec tests are opt-in:

```powershell
$env:SPARKLE_MEDIA_FIXTURES='[{"id":"plex-server-item-version","seekSeconds":80,"subtitleCodec":94230}]'
node scripts/tests/qualify-media.mjs
```

Evidence is written under ignored `cache/`, never under mapped roots. See
[the qualification record](raw-media-validation.md) for tested and pending
combinations. See [the player build instructions](../scripts/libmedia/README.md)
for source pins, patches, and decoder rebuilding.

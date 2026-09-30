# Optional server encoding

Vidstack → Video Settings → HDR output offers **Automatic**, **Compatible**,
**Encoded AV1**, and **Encoded HEVC** for every Plex video,
including SDR. The selection is saved in browser localStorage (`sparkle.raw.hdr`).
The software **Tone mapping** option and fallback are temporarily disabled; existing
saved selections migrate to **Compatible**. All modes use native video, including
browser-managed HDR-to-SDR conversion on SDR displays.
Each participant chooses locally; identical encodes are shared across participants
and rooms. The room continues to identify the original Plex item and media version.
These derivatives require the same [Plex membership](plex-auth.md) as the original;
they are separate from the public Encoded catalog.
The HDR output panel shows live video-plus-selected-audio bitrate for the active
mode, including original playback and server encodes. It measures compressed
packet bytes over the preceding three seconds of media, updated once per second;
it is not network download speed or an estimate for inactive modes. Hover the
readout for the video/audio breakdown. Seeks and mode changes reset the measurement.

Automatic always prefers supported 10-bit AV1, then HEVC, provided the server
successfully tested that NVENC encoder and the browser admits its native MSE codec.
Network speed and Save Data do not affect selection; no network probe is performed.
If neither codec is available or encoding fails, playback reports the error and stays
in Automatic. Original-file playback requires explicitly selecting Compatible, which
is also saved across reloads. Constant quality is not adaptive bitrate: extremely slow
connections can still buffer.

Playback recovery retries the selected encoded output and offers **Retry playback**
after an interruption. A returning request waits for a cancelled encode job to finish
cleaning up, then shares a fresh job; it does not inherit the abandoned job's failure.
Room recovery refreshes the authoritative timeline without changing its pause state.

## Setup

Compatible playback remains available without FFmpeg or a GPU. On Windows,
`./scripts/install-ffmpeg.ps1` (requires 7-Zip) installs the SHA-256-checked
[FFmpeg 9.0.2 full build](https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2)
under ignored `bin/` and prints its `FFMPEG`/`FFPROBE` settings. It preserves
the existing `.env`, system tools, and older runtime directories. Keep the full
distribution, including licenses and notices, together.
To enable encoding, add these backend settings to the existing `.env`, adapting tool paths:

```dotenv
ENCODE_ENABLED=true
FFMPEG=C:/tools/ffmpeg/bin/ffmpeg.exe
FFPROBE=C:/tools/ffmpeg/bin/ffprobe.exe
ENCODE_QUALITY=24
ENCODE_PRESET=p3
# Opus target kbps per retained channel; silent padding does not increase the target.
ENCODE_AUDIO_SURROUND_KBPS_PER_CHANNEL=80
ENCODE_CONCURRENCY=2
ENCODE_CACHE_BYTES=42949672960
ENCODE_CACHE_TTL=12h
```

Use a current FFmpeg build with `av1_nvenc`, `hevc_nvenc`, `libopus`, and
`libplacebo`/Vulkan for Dolby Vision Profile 5 conversion. The NVIDIA driver and
GPU must support the selected 10-bit encoder. Startup performs short real encoder
probes; unsupported codecs are not advertised. FFmpeg processes run without a
visible console on Windows. Restart the backend after configuration changes.

The API image includes Debian FFmpeg. On a Linux Docker host with NVIDIA
Container Toolkit installed:

```sh
docker compose -f compose.example.yml -f compose.nvidia.yml up -d
```

The override grants the API container GPU access and enables encoding. Media and
processed-output mounts remain read-only; cache and profiles remain separate writable
mounts. Graphics/Vulkan support is required for Profile 5. Normal Docker/CI runs do
not enable encoding and do not require a GPU. Physical GPU/container qualification
is separate from a successful image build.

## AI HDR

`AI_HDR_ENABLED=false` (the default) hides the **AI HDR** button and rejects every
enhanced API request, including already cached segments. With the flag enabled,
Plex players show the button immediately before audio normalization. The choice is
local and held only in memory for the current title. It starts off for each title
and after reload or leaving the player; old `sparkle.raw.aiHDR` values are ignored.
Track/output changes and recovery of the current title retain an explicit choice.
It does not change anyone else's room playback setting.
Turning it on uses an enhanced AV1/HEVC encode, including from Compatible mode.
Turning it off restores the saved ordinary output choice, position and pause state.
Both directions prime replacement decoders silently, hold video and PCM audio
through their indexed seeks, and discard queued pre-seek samples before resuming.
Encoded replacements and recovery pass the saved part-relative timestamp to both
HLS readers before probing/prefetching. They start with the containing segment,
including at exact twelve-second boundaries, and decode its preroll to the target.
The manifest advertises `timestampStart`; older backends retain silent startup
followed by seeking. Playlist requests accept a bounded integer `startSegment`
hint, propagated through the master playlist to initialization URLs. An init
request with that hint serves headers from the selected segment's existing encode
job. Full playlists, absolute media timestamps and fragment URLs remain unchanged,
so backward seeking works and participants still share the same cache entries.
The hint does not change encoded bytes or the profile revision.
Missing GPU/filter support leaves the button disabled. Processing failures are
reported, without silently substituting ordinary video.

On Windows, run `./scripts/install-ai-hdr.ps1` (requires 7-Zip). It installs portable,
SHA-256-checked NVEncC 9.36, including NGX/TrueHDR and libplacebo, into ignored `bin/` and prints
the backend settings to add to your existing `.env`:

```dotenv
ENCODE_ENABLED=true
AI_HDR_ENABLED=true
NVENCC=C:/path/to/Sparkle/bin/nvencc-9.36/NVEncC64.exe
```

Restart the backend. `NVENCC` defaults to `NVEncC64` on PATH. Keep the distribution's
DLLs, licenses and notices together. FFmpeg also needs `zscale`, `libplacebo`, and the
existing NVENC/Opus support. Startup tests SDR conversion and HDR filtering through
each encoder before advertising support. SDR conversion requires the bundled NVIDIA
NGX/TrueHDR DLLs. An older 9.35 installation must include its separate NGX archive;
the 9.36 package includes these dependencies. The installer preserves the existing
`.env` and older runtime directories.
This integration is qualified on Windows; the supplied Linux Docker image does not
include NVEncC. Keep the optional feature disabled there until separately qualified.

The backend reads stream metadata and a bounded sample of decoded frame metadata:
transfer function, primaries, matrix, range, mastering maximum, MaxCLL/MaxFALL,
Dolby Vision profile/base compatibility and dynamic-metadata indicators. Contradictory
color information fails closed. A narrow exception handles conventional untagged HD
SDR releases: H.264, 8-bit 4:2:0, 1280–1920 pixels wide and 720–1088 high may fill
missing transfer/primaries/matrix with Rec.709 and missing range with limited range.
Decoded frames must also be 8-bit 4:2:0; every declared color tag must agree with
limited-range Rec.709, and no HDR mastering, light-level or dynamic metadata may be
present. This is an SDR interpretation, not proof of an untagged source's original
grade. Other missing-color cases, including untagged 10-bit material, remain rejected.
A mastering-display maximum is not proof that the movie contains highlights at
that brightness. It does not set the enhancement curve's exposure.

- Recognized SDR uses **NVIDIA AI TrueHDR** with `maxluminance=800`, `contrast=100`,
  `saturation=85`, `middlegray=50`. Compared with the old 1600/125/75/44 settings,
  these reduce highlight dominance and contrast while lifting ordinary brightness.
  The peak parameter is an inference target, not a hard output clamp: the synthetic
  white patch measures about 994 nits. The normalized source remains ten-bit Rec.709
  until NVEncC converts to NGX's RGB8 input; TrueHDR returns FP16 HDR for ten-bit
  AV1/HEVC encoding. The output is not eight-bit. No additional HDR expansion shader
  is applied to SDR; NVEncC's fixed filter order would run it before TrueHDR.
- PQ uses absolute source luminance; HLG first uses a fixed 1,000-nit reference
  display conversion. A GPU shader samples a bounded spatial grid and computes
  the log-average brightness with sample luminance capped at 203 nits. Black bars
  are excluded. A small specular flash therefore has little influence on overall
  exposure, while broad changes in the picture adjust the grade.
- Midtones receive **1.6–2.2× exposure**, with the greater lift for dim scenes.
  A smooth near-black toe and fade guard reduce this toward 1× for darkness.
  Highlights receive an additional smooth 1–1.70× gain above 100 nits, reaching
  full strength at 600 nits. Broad bright areas reduce the additional gain to
  1.45×. The transitions operate in logarithmic brightness to avoid a sharp knee.
  No sharpening, local contrast recovery or scene-peak stretching is applied.
- The HDR shader uses only the current frame. Cuts need no settling and independent
  segments use the same grade as continuous filtering. It deliberately limits
  adaptation instead of accumulating a moving peak detector's exposure history.
  The two-second decode lead-in is retained for both HDR and TrueHDR. This is
  content-adaptive global grading, not a reproduction of a TV's proprietary
  temporal or regional algorithm; it cannot identify faces or lighting intent.
- A twice-continuously-differentiable HDR shoulder above 800 nits approaches
  **1,600 nits**. Scaling RGB together preserves chromaticity and bounds bright
  components as well as neutral whites. Both modes output 10-bit BT.2020/PQ HDR10,
  with a 1,600-nit processing envelope recorded in mastering/MaxCLL boxes and
  unknown MaxFALL. TrueHDR is qualified against that envelope, but its internal
  neural mapping is not a mathematical hard clamp. These metadata values are not
  measured whole-title light levels or the viewer's panel brightness.

One shared grade serves all devices. Native video/MSE, the OS and the display
perform final display mapping; the browser cannot reliably report exact panel
peak brightness. There is no G6-specific grade, calibration UI or separate bright-room
mode. SDR conversion uses NVIDIA's neural model; existing HDR uses the bounded
shader. The manifest mode for SDR remains
`sdr-expansion`; PQ/HLG use `hdr-expansion`.

Dolby Vision Profile 5 is reshaped through FFmpeg/libplacebo before expansion.
Profiles 7/8 use their compatible base signal; Profile 7 enhancement layers and
preservation of Dolby Vision/HDR10+ artistic dynamic metadata are not claimed.
Output is an optional new grade, not recovered highlight detail or a faithful
reconstruction of the studio master. Native HDR10 compatibility does not establish
physical image quality on every HDR panel or qualify iOS Safari hardware.

For canonical limited-range 4:2:0 sources (10-bit BT.2020 PQ/HLG or 8-bit Rec.709
SDR), NVEncC keeps NVDEC decoding, the same enhancement filters and NVENC encoding
on GPU surfaces. FFmpeg copies a bounded compressed video window from the confined
source handle, then copies the enhanced segment into fragmented MP4. It does not
transfer decoded frames between processes. Input windows are capped at 128 MiB,
stay inside the existing job byte budget and are removed before caching completes.
Packet timestamps, frame counts and the segment's keyframe are checked before use.
Fractional constant frame rates are supported without rounding to an integer rate.

Other color spaces, full-range sources, Dolby Vision Profile 5, variable frame rates
and unsupported GPU decoders retain the normalized reference pipeline. That path
streams raw frames through bounded OS pipes without decoded files on disk. Both
paths share the exact normalization and TrueHDR settings or adaptive HDR shader,
two-second decode lead-in and Opus audio processing. Shader files are embedded in
the backend, written privately per job and removed before caching. Any shader
diagnostic fails the job, including libplacebo disabling a hook with a successful
process exit. Mastering metadata is written after
filtering so it cannot change libplacebo's target gamut. The optimized NVENC QVBR
path uses a generous 500 Mbps ceiling to avoid NVEncC's implicit low bitrate cap;
it retains p3/CQ 24, dimensions and frame rate. Different GPU chroma conversion and
encoder wrappers can produce small pixel differences from the reference encode.

Both paths share GPU concurrency, cancellation, cache size/TTL and original file
confinement. Enhanced profile revision `ai-hdr-adaptive-v4` separates this grade from older
cached derivatives. Performance depends on source decoding, resolution, GPU,
storage and concurrent streams; a single sample cannot establish sustained throughput.

For repeatable synthetic GPU qualification, set `SPARKLE_TEST_NVENCC` to the absolute
executable and run `go test ./internal/encode -run 'TestAIHDR' -v` from `backend/`.
The tests cover SDR/PQ/HLG in AV1/HEVC, MP4 HDR signaling, first/middle/final segment
timestamps, fractional frame rates, VFR fallback, bounded midtone lift, black level,
bounded highlights, monotonic gradients, moving highlights/flashes, continuous vs
independent segment grades, full-scene adaptation, letterbox/cut invariance, and
reference color comparisons. They skip when
the executable is not supplied.
For a confined, read-only real-source check, also set `SPARKLE_AI_HDR_SOURCE` to
the source file and run `go test ./internal/encode -run '^TestAIHDRSource$' -v`.
It exercises both codecs through the production selector, validates decoded HDR10
signaling and compares eligible GPU output against the normalized reference grade.
The comparison decodes from the beginning to avoid source-specific reference seek
errors, so this optional test can take several minutes. It never saves decoded frames.
Set `SPARKLE_AI_HDR_FIXTURE_DIR` to an absolute ignored directory during the GPU
test to export synthetic segments, then run `node scripts/tests/qualify-ai-hdr.mjs`
from the repository root with the same variable. It checks two Chrome providers,
local on/off choices, timeline changes/recovery, flag-off behavior and the actual
Vidstack button in desktop/mobile layouts. Fixtures do not exercise Plex authentication
or full watch-party WebSocket transport, which retain their separate test suites.

On the RTX 5090 host, the adaptive-grade regression lifts a 103-nit PQ patch to
approximately 167 nits. Fixed patch fixtures produce approximately 175/285/423 nits
for 100/150/200-nit inputs, while 400/800-nit highlights become approximately
1,058/1,495 nits and a 4,000-nit patch rolls to about 1,575 nits. The same 100-nit
patch measures about 204 nits in a dark scene and 156 in a bright scene. TrueHDR
white in the SDR test scene is approximately 994 nits, with 70% code gray at 151
nits. Small differences include source
quantization, color conversion and video compression. These are decoded signal
checks, not physical-display or subjective image-quality qualification. See the
[qualification record](raw-media-validation.md) for coverage and remaining gaps.

### Processing choices and research

The current stack keeps NVEncC/NVENC and libplacebo on shared GPU surfaces.
[NVEncC 9.36](https://github.com/rigaya/NVEnc/releases/tag/9.36) bundles the NVIDIA
VFX 1.3 NGX runtime. Its
[TrueHDR wrapper](https://github.com/rigaya/NVEnc/blob/9.36/NVEncCore/NVEncFilterNGX.cpp)
exposes the four settings above and uses RGB8 input/FP16 output. NVIDIA's newer
[VFX TrueHDR API](https://docs.nvidia.com/maxine/vfx/latest/Filters/TrueHDR.html)
has a different packed-output interface; its defaults are not assumed to be
calibration values for this wrapper.

[libplacebo](https://libplacebo.org/options/) offers histogram-based peak detection,
scene detection, spline mapping, exposure adaptation and gamut mapping. FFmpeg's
[libplacebo filter](https://ffmpeg.org/ffmpeg-filters.html#libplacebo) and
[AviSynth's libplacebo_Render](https://github.com/Asd-g/libplacebo_Render) wrap that
same engine. Changing wrappers alone does not solve excessive inverse expansion.
In a neutral-patch comparison, a spline with a 20-frame smoothing period and
0.4 knee adaptation moved an unchanged 100-nit patch from 491 to 232 nits when a
different patch rose from 200 to 400 nits. ST2094-40 preserved approximately 99 nits
but did not expand that source. The bounded adaptive shader held approximately
197 nits throughout this comparison. This test motivates the chosen bounds; it
does not establish superiority for all content or every libplacebo configuration.

[madVR Envy](https://madvr.com/EnvyModelComparison.pdf) documents frame analysis,
scene detection and shadow/highlight recovery in a dedicated playback processor.
It is a useful design reference, not the server encoder used here. Research systems
such as [ITMLUT](https://github.com/AndreGuo/ITMLUT) address learned SDR-to-HDR
conversion; replacing TrueHDR with a separately trained conversion model would
require its own integration and video qualification. Sparkle instead uses NVIDIA's
requested AI conversion and bounded source-pixel statistics for existing HDR.

## Encoder profile and HDR

The defaults use constant quality **24**, **10-bit**, variable frame rate, source
dimensions/color range, and **Opus with explicit speaker-layout handling**.
Every audio track defaults to 80 kbps per source channel: 80 kbps mono, 160 kbps
stereo, 480 kbps for 5.1, and 640 kbps for 7.1. Both video
outputs exclusively use **NVENC** (FFmpeg or NVEncC) with **p3 (fast)** by
default. Quality and speed override the reference Sparkle-Transcoder's quality 22
and slower presets. There is no software video encoding fallback: an
unavailable NVIDIA encoder makes that encoded mode unavailable. Source decoding
may use the CPU when NVDEC cannot decode a source; output video is still encoded
on the GPU. Ordinary and AI HDR encodes share the same audio policy.

NVENC uses VBR constant quality with target bitrate zero and initial I/P/B
quantizers CQ-2/CQ/CQ+2 (22/24/26 by default). Streaming adds closed two-second
keyframe intervals. These
settings follow [HandBrake's NVENC mapping](https://github.com/HandBrake/HandBrake/blob/master/libhb/encavcodec.c).
No resolution or frame-rate reduction is imposed.
`ENCODE_AUDIO_SURROUND_KBPS_PER_CHANNEL` is the only audio bitrate setting and
accepts 32-128 (default 80). Despite its name, it applies to mono and stereo too.
Each track's VBR target is this value times the smaller of its source and encoded
channel counts, in kilobits per second. Silent padding does not increase the
target; a 12-channel source mixed to 7.1 targets 640 kbps, and an unidentified
12-channel source folded to stereo targets 160 kbps. This is not measured media
bitrate. The removed `ENCODE_AUDIO_KBPS` and
`ENCODE_AUDIO_MONO_KBPS` settings are ignored. All settings participate in the
shared cache identity.

Decodable input tracks with 1-64 channels are accepted. Known speaker positions
are preserved whenever a standard Opus layout can carry them, with silent padding
as needed:

| Source layout                                          | Encoded layout | Treatment                                        |
| ------------------------------------------------------ | -------------- | ------------------------------------------------ |
| Mono, stereo, 3.0, quad, 5.0, 5.1, 6.1, 7.1            | Same           | Preserve                                         |
| 2.1, 3.1                                               | 5.1            | Silent missing speakers                          |
| 3.0(back), 4.0, 4.1, 6.0                               | 6.1            | Preserve back center; silent missing speakers    |
| Quad(side), 5.0(side), 5.1(side), 7.0                  | 7.1            | Preserve side positions; silent missing speakers |
| Wide, height, other named combinations that do not fit | 7.1            | Explicit horizontal surround mix                 |
| Unidentified channels                                  | Stereo         | Fold all even/odd channel indices to left/right  |

Named layouts include 7.1(wide), 7.1(wide-side), 5.1.2/5.1.4, 7.1.2/7.1.4,
9.1.4/9.1.6 and 22.2, plus ordered speaker lists reported by FFprobe. Height
channels feed corresponding horizontal speakers at -3 dB; wide fronts feed the
front pair. Back center splits across the rear pair when a direct back-center
position cannot be retained. Top back center splits at -6 dB per rear speaker;
extra LFE feeds LFE. A common gain bounds the matrix sums without changing the
relative speaker balance. No channel is silently discarded by the server mix.

Unidentified, inconsistent, or unrecognized layout metadata uses the labelled
stereo fallback; it does not invent speaker positions or assign an unknown channel
to LFE. This includes every input channel but cannot recover missing spatial
information. The audio menu shows **7.1 mix** or **Stereo mix (unknown layout)**
for converted tracks, without changing saved track identity. The manifest exposes
per-track source/encoded widths, layout, and conversion alongside its maximum
encoded width. Compatible remains available for original client decoding.
Opus mapping family 0 is used for mono/stereo and family 1 for surround.
Height/wide positions after mixing, Atmos/DTS:X objects, and compressed bitstream
passthrough are not preserved. Browser speaker output remains at most 7.1.

Multichannel titles use the same locally served WASM audio decoder and layout-aware
PCM remix as Compatible. Video remains native MSE/ManagedMediaSource; audio loads
only its own playlist. The browser's accepted speaker capacity determines mono,
stereo, quad, 5.1 or 7.1 output. Normalization deliberately produces stereo while
on; disabling it restores device-mapped PCM. Track selection stays local.
Generic native Opus support is never used as evidence of multichannel support.
This also avoids depending on Safari's native multichannel Opus decoder or
WebCodecs audio support. iOS still needs a supported native video codec, a secure
context, and user-initiated playback. The shared PCM context is prepared before
Join/Play and resumed synchronously from click, touch-end, or keyboard gestures;
this does not seek or broadcast a room command. Physical iOS Safari qualification is separate
from desktop browser tests.
Separate HLS audio/video renditions share the segment timeline. Multiplexing them
into one file would not eliminate the separate PCM presentation clock needed for
surround decoding/remixing. Mono/stereo-only outputs already use one native clock
when supported. Decoder readiness, seek coordination and clock correction maintain
sync for the PCM path; container separation alone does not cause drift.

AV1 disables S12M timecode insertion (`-s12m_tc 0`) to avoid the
[FFmpeg/NVENC malformed timecode metadata bug](https://forums.developer.nvidia.com/t/ffmpeg-av1-nvenc-encoder-sometimes-generates-undecodeable-bitstreams/364011),
which can make Chrome stop with a native decode error. This removes only timecode
insertion; it retains HDR color, mastering and light-level metadata. Encode profile
revision v8 separates the expanded layout policy from earlier cache entries;
segments remain 12 seconds.
Native decoder failures reach the player's error state instead of leaving it buffering; users
can choose another output mode while staying in the room.

PQ and HLG retain 10-bit color signaling and use native video/MSE, including browser
tone mapping on SDR displays. Dolby Vision Profile 5 needs libplacebo to apply its
RPU and convert to BT.2020/PQ; see [FFmpeg's libplacebo documentation](https://ffmpeg.org/ffmpeg-filters.html#libplacebo).
Profiles 7/8 with compatible base layers use that base. Encodes strip Dolby Vision
and HDR10+ dynamic metadata and identify their result as **HDR10**, **HLG**, or **SDR**.
Profile 7 enhancement layers are not decoded. Encoded output is never described as
full Dolby Vision or HDR10+. Source format remains visible separately in settings.

## Segments, safety, and limits

- Twelve-second independently encoded segments form one seekable HLS/fMP4 timeline,
  for ordinary and AI HDR output. The final segment is shortened to the remaining duration.
  The player targets a 24-second preload; the backend encodes requested segments
  on demand without an independent lookahead loop.
  A master playlist joins separate video/audio playlists in one player. On browsers
  with native Opus/MSE support and exclusively mono/stereo audio, both tracks share
  the native video clock and buffering. Multichannel titles and unsupported native
  audio use the client PCM decoder with the existing Compatible synchronization. Audio does not download video a second
  time. Distant seeks generate only the requested segments.
- Audio fragments use 48 kHz, 20 ms Opus packets, with a short discarded encoder
  warm-up. Encoder lookahead and end padding are removed before timestamp rebasing;
  full segments contain exactly 600 packets per track without boundary overlaps.
  Embedded track switches flush the previous native audio buffer before resuming.
- Cache keys include source identity/size/modification time, selected codec,
  encoder settings, tool build/profile revision and segment position. Concurrent requests
  share one job. Complete segments survive restarts; incomplete ones are discarded.
  Manifest/playlist fingerprints include the profile and tool revision too, so browser
  caches cannot reuse fragments generated by an older encoder configuration.
- `ENCODE_CONCURRENCY` accepts 1–32 simultaneous pipelines (default 2), shared by
  ordinary and AI HDR encodes. The admission limit is 32 jobs total, including running
  and queued jobs; available cache reservations can impose a lower limit.
- Default bounds: 40 GiB disk budget, 12-hour idle
  expiry, 4,096 cache entries, 256 MiB reservation per job and a two-minute job
  deadline. Active responses are pinned against eviction. Abandoned requests cancel
  unused jobs after a one-second grace period. No work runs simply from browsing Library.
- Source probes are limited to two concurrent processes and a 64-entry/32 MiB
  metadata cache. A media version may contain up to 24 audio and 64 subtitle tracks.
- FFmpeg reads a random private loopback endpoint backed by an already confined,
  read-only file handle. It receives no Plex token or media filesystem path.
  Process diagnostics are not exposed to browsers or application logs.
- ASS/SSA, text and PGS packets are copied to cached subtitle chunks, then rendered
  in the browser with the existing font/subtitle layers. Fonts are fetched lazily
  when ASS/SSA is selected, once per part. Subtitle chunks and client queues are bounded; captions are never burned
  into the shared video. Track choices remain local.
- All generated files stay beneath `MEDIA_CACHE_DIR/encoded`, outside mapped media
  roots. Cache and segment endpoints retain ranges, HEAD, validators and cancellation;
  encoded file responses bypass compression.

API: `GET /encoding/capabilities` and
`GET /media/{id}/parts/{partId}/encoded/{av1|hevc}/{resource}`. Resources are a
manifest, master/video/audio playlists, their init files, numbered fragment/subtitle
files and `fonts.json`. They cannot name arbitrary paths, commands or encoder arguments. Plex
allowed-section and mapping checks apply before serving cached derivatives too.

## Validation

The Windows encoder baseline is FFmpeg 9.0.2 full with NVEncC 9.36. GPU checks
cover AV1/HEVC SDR, PQ and HLG, ten-bit output metadata, frame-local grading,
segment timestamps, multichannel Opus layouts, and Dolby Vision Profile 5
conversion. Browser checks use decoded media; they do not qualify a physical
HDR display or iOS Safari device.

`go test ./...` covers cache coalescing/cancellation, eviction, read-only input
ranges, response validators, subtitle data and fragment timestamp rewriting.
GPU/browser checks use an already running isolated backend with encoding enabled:

```powershell
$env:SPARKLE_TEST_URL='http://127.0.0.1:3004'
$env:SPARKLE_ENCODE_TEST_ID='your-version-specific-plex-id'
$env:SPARKLE_ENCODE_EXPECTED_HDR='HDR10' # optional HDR10 or HLG
npx playwright test tests/e2e/encoded.spec.ts --workers=1
```

The opt-in audio fixture test generates two continuous tones, encodes both modes,
and verifies every audio packet's timestamp and duration. The browser check samples
decoded PCM across two twelve-second segment boundaries and checks the frequency after changing
tracks. Use an absolute, disposable fixture directory outside mapped media roots:

```powershell
$env:SPARKLE_ENCODE_AUDIO_FIXTURE_DIR="$PWD/cache/encoded-audio-fixture"
$env:FFMPEG='C:/tools/ffmpeg/bin/ffmpeg.exe'
$env:FFPROBE='C:/tools/ffmpeg/bin/ffprobe.exe'
go -C backend test ./internal/encode -run TestNVENCAudioContinuityFixture -v
node scripts/tests/qualify-encoded-audio.mjs
```

Use `SPARKLE_RAW_ENCODE_MODE=av1` or `hevc` with the existing `raw.spec.ts`
two-client test to exercise room synchronization through encoded playback.
GPU encode success and decoded frame color metadata do not qualify physical HDR
display output or dynamic HDR. Keep device coverage in the
[qualification record](raw-media-validation.md).

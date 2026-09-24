# Optional server encoding

Vidstack → Video Settings → HDR output offers **Automatic**, **Compatible**,
**Tone mapping**, **Encoded AV1**, and **Encoded HEVC** for every Plex video,
including SDR. The selection is saved in browser localStorage (`sparkle.raw.hdr`).
Each participant chooses locally; identical encodes are shared across participants
and rooms. The room continues to identify the original Plex item and media version.
The HDR output panel shows live video-plus-selected-audio bitrate for the active
mode, including original playback and client tone mapping. It measures compressed
packet bytes over the preceding three seconds of media, updated once per second;
it is not network download speed or an estimate for inactive modes. Hover the
readout for the video/audio breakdown. Seeks and mode changes reset the measurement.

Automatic normally uses original playback. On a slow network it prefers supported
10-bit AV1, then HEVC, provided the server successfully tested that NVENC encoder
and the browser admits its native MSE codec. Save Data/2G/3G or a capped 1 MiB range
sample below the source's average bitrate triggers encoding. Sustained buffering
can trigger another sample, with a 30-second cooldown. It does not switch repeatedly
between raw and encoded playback as throughput fluctuates. Constant quality is not
adaptive bitrate: extremely slow connections can still buffer.

## Setup

Raw playback remains available without FFmpeg or a GPU. To enable encoding on
Windows, add these backend settings to the existing `.env`, adapting tool paths:

```dotenv
ENCODE_ENABLED=true
FFMPEG=C:/tools/ffmpeg/bin/ffmpeg.exe
FFPROBE=C:/tools/ffmpeg/bin/ffprobe.exe
ENCODE_QUALITY=22
ENCODE_PRESET=p3
ENCODE_AUDIO_KBPS=144
ENCODE_CONCURRENCY=2
ENCODE_CACHE_BYTES=21474836480
ENCODE_CACHE_TTL=24h
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

## Encoder profile and HDR

The defaults match Sparkle-Transcoder's current quality **22**, **10-bit**, variable
frame rate, source dimensions/color range, and **144 kbps stereo Opus** for all audio
tracks. Both video outputs exclusively use **NVENC** (`av1_nvenc` / `hevc_nvenc`)
with **p3 (fast)** by default. This speed choice overrides the reference
Transcoder's slower presets. There is no software video encoding fallback: an
unavailable NVIDIA encoder makes that encoded mode unavailable. Source decoding
may use the CPU when NVDEC cannot decode a source; output video is still encoded
on the GPU. Audio continues to use stereo Opus.

NVENC uses VBR constant quality with target bitrate zero and initial I/P/B
quantizers 20/22/24. Streaming adds closed two-second keyframe intervals. These
settings follow [HandBrake's NVENC mapping](https://github.com/HandBrake/HandBrake/blob/master/libhb/encavcodec.c).
No resolution or frame-rate reduction is imposed. Audio is downmixed to stereo;
Atmos/DTS:X bitstream passthrough is not provided.

PQ and HLG retain 10-bit color signaling and use native video/MSE, including browser
tone mapping on SDR displays. Dolby Vision Profile 5 needs libplacebo to apply its
RPU and convert to BT.2020/PQ; see [FFmpeg's libplacebo documentation](https://ffmpeg.org/ffmpeg-filters.html#libplacebo).
Profiles 7/8 with compatible base layers use that base. Encodes strip Dolby Vision
and HDR10+ dynamic metadata and identify their result as **HDR10**, **HLG**, or **SDR**.
Profile 7 enhancement layers are not decoded. Encoded output is never described as
full Dolby Vision or HDR10+. Source format remains visible separately in settings.

## Segments, safety, and limits

- Six-second independently encoded fragments form one seekable HLS/fMP4 timeline.
  A master playlist joins separate video/audio playlists in one player. On browsers
  with native Opus/MSE support, both tracks share the native video clock and buffering;
  periodic independent audio speed corrections are unnecessary. Unsupported native
  audio retains the client decoder fallback. Audio does not download video a second
  time. Distant seeks generate only the requested segments.
- Audio fragments use 48 kHz, 20 ms Opus packets, with a short discarded encoder
  warm-up. Encoder lookahead and end padding are removed before timestamp rebasing;
  full fragments contain exactly 300 packets per track without boundary overlaps.
  Embedded track switches flush the previous native audio buffer before resuming.
- Cache keys include source identity/size/modification time, selected codec,
  encoder settings, tool build/profile revision and segment position. Concurrent requests
  share one job. Complete segments survive restarts; incomplete ones are discarded.
  Manifest/playlist fingerprints include the profile and tool revision too, so browser
  caches cannot reuse fragments generated by an older encoder configuration.
- Default bounds: two GPU jobs, 32 pending jobs, 20 GiB disk budget, 24-hour idle
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
decoded PCM across four fragment boundaries and checks the frequency after changing
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

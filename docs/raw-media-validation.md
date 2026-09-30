# Raw-media validation record

Validated September 22–30, 2026 on Windows using the configured Plex server and
read-only mapped files. This records implementation evidence, not certification
of every codec, browser, display, or Dolby profile.

## Automated checks

| Check                          | Result                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Go unit/integration tests      | Pass, including `go test -race ./...`                                                                              |
| TypeScript                     | Pass                                                                                                               |
| Next production build          | Pass, including Windows standalone server; route parameter types updated for Next 16                               |
| Linux amd64 backend build      | Pass; Docker runtime validation pending                                                                            |
| Million-item synthetic catalog | 48-item pages, bounded hierarchy/search/direct lookup, virtualized cards; no Plex index or `/all` request          |
| Filesystem/storage             | Longest-prefix mappings, traversal/symlink confinement, section allowlist, redaction, profile/output separation    |
| HTTP                           | GET/HEAD, ranges, suffix/invalid ranges, ETag, If-Range, cancellation                                              |
| Cache limits                   | Metadata entry/byte limits and artwork eviction exercised                                                          |
| Subtitle safety                | Fragment assembly, truncated RLE and oversized bitmap rejection; MP4 text lengths, style-box exclusion and Unicode |

## Real files, client-side decoding

### Subtitle timing and language selection

September 27, 2026: a browser regression reproduced old PGS images at the current
playhead when Encoded subtitle requests repeated long seek preroll. Avatar's bounded
source inspection returned packets from 681 seconds for a request starting at 1260
seconds; all 235 English bitmap objects in that sample decoded successfully. The
fault was expired dedupe entries allowing old packets back into the bounded queue.
Per-stream timestamp progress now rejects that overlap, and due preroll is consumed
without displacing future packets. Compatible sink resume retains prefetched image,
styled, and text captions; provider seeks and track resets clear the old timeline.
This includes the indexed seeks used for audio/subtitle changes. Initial Compatible
selection refills the selected track so a late packet from the decoder's original
default cannot remain visible after a different default is applied.

Chrome renderer checks compare chronological delivery against overlapping Encoded
chunks at one-second samples in four bounded windows: Avatar English/French PGS at
30–87 and 1260–1318 seconds, plus English ASS/SRT from ZENSHU episodes 1 and 2 at
90–148 and 120–177 seconds. All comparisons passed. These replay extracted subtitle
packets through the real browser renderers; they are not full-movie playback or
physical-device HDR qualification. Generated pixel assertions also cover overlapping
chunks, forward/backward seeks, active/prefetched image resume, and track replacement.
An authored PGS-in-MKV fixture also passes actual libmedia demux/playback through
pause/resume and forward/backward indexed seeks.

Caption Off is independent of temporary sink suspension: libmedia can restart its
subtitle clock during seeks or resume. The provider disables delivery to the primary
renderer until a track is selected again. Regression checks cover late packets,
sink reset/resume, and re-enabling PGS, ASS, and text, including the native cue mirror.
The PGS MKV also exercises the full provider with image captions as its first subtitle
track: the initial cue appears, Off survives seeks and pause/resume, and re-enabling
captions restores the current image.

Selection checks cover language before format for ASS, VTT, SRT and PGS, desktop
and mobile priorities, missing saved formats, and version/transport-specific Plex IDs.
Explicit saved choices, Off, size ties, local layers, and menu ordering remain covered.

To repeat renderer checks, run `npx playwright test tests/e2e/subtitle-rendering.spec.ts`
against the running app. The MKV test needs `node scripts/tests/prepare-track-fixture.mjs`
followed by `node scripts/tests/prepare-pgs-fixture.mjs`; without that fixture it skips.
Optional `SPARKLE_SUBTITLE_PACKET_FIXTURES` is a JSON array
of `{path, start, end, tracks}` entries referencing private, bounded packet JSON files
under ignored `cache/`. Times are seconds and tracks are numeric source stream IDs.
The JSON contains `tracks` with `{id, codec, header}` (codec name and base64 header)
and `packets` with `{id, pts, duration, data}` (milliseconds and base64 payload).
Keep original media, subtitle contents, credentials and source paths out of commits.

### Existing codec qualification

Chrome 153.0.8010.53 on Windows, headless and **not cross-origin isolated**:

| Material           | Evidence                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| H.264 8-bit, AAC   | Playing clock advances, indexed seek and pause                                                       |
| H.264 10-bit, AAC  | Client fallback plays and seeks; ASS with 15 fonts                                                   |
| HEVC SDR, FLAC     | Playing clock advances, seek, pause; ASS with eight fonts                                            |
| HEVC SDR, E-AC-3   | Track selected and client playback advances                                                          |
| H.264, DTS         | Playing clock advances, seek and pause                                                               |
| H.264, AC-3        | Track selected, playing clock advances                                                               |
| H.264, TrueHD      | Browser WASM decoder plays and seeks; PCM output, no Atmos passthrough claim                         |
| ASS/embedded fonts | Visible captions inspected after seek; local JASSUB worker/WASM                                      |
| SRT                | Visible text observed after seek                                                                     |
| MP4 embedded text  | Caption text displayed without binary styling-box bytes                                              |
| PGS                | Visible bitmap captions inspected; zlib-compressed Matroska packets and fragmented objects supported |
| Multiple subtitles | Four styled tracks compose in one ASS renderer; matching Raw/Encoded shrink and collision behavior   |
| Large attachments  | Oversized attachment skipped correctly; aggregate attachment budget enforced before allocation       |

Five-second playback windows advanced approximately 4.5–4.8 seconds. Paused
clock settling stayed below 0.5 seconds in these samples. Range requests were
present on every original-file GET. Tests exercise selected windows, not entire
feature-length files or sustained audio/video lip-sync accuracy.

The approximately 74 GB sample is 73,577,101,905 bytes. A 128 MiB range-read
exercise across distant offsets, including the end of the file, increased API
RSS from 55.09 MiB to a measured peak of 55.38 MiB. This is a bounded-memory
range test, not a complete 74 GB transfer. No raw-file copy or derivative was
created. Test evidence and build artifacts are under ignored `cache/`.

## Compatible surround audio

Validated September 27, 2026 in Chrome **154.0.8037.58** on Windows with the
playback endpoint configured for 7.1; Chrome reported eight available channels.
Compatible retains native video and uses the original audio's client decoder.
Its destination now explicitly accepts the device width, and libmedia remixes
the decoded speaker layout before Web Audio can perform an implicit conversion.

The expanded `npm run test:surround` passed **64 codec/capacity combinations**:
AAC, AC-3, E-AC-3, DTS and FLAC 5.1, plus AAC, FLAC and TrueHD 7.1, each with
reported capacities from one through eight channels. These generated originals
carry a different frequency in every speaker channel. Spectral checks verify
center/side/back routing, LFE preservation on 5.1/7.1 outputs, its standard
omission from mono/stereo/quad, absence of signals in
unrelated speakers, playback after seeking, and destination restoration on teardown.
The lower-capacity cases constrain the test AudioContext's reported capacity; the
Windows speaker configuration remains 7.1 throughout. These are browser PCM
checks, not acoustic measurements of physical speakers.

| Reported capacity | Selected PCM output |
| ----------------- | ------------------- |
| 1                 | Mono                |
| 2 or 3            | Stereo              |
| 4 or 5            | Quad (FL/FR/BL/BR)  |
| 6 or 7            | 5.1                 |
| 8                 | 7.1                 |

The expanded checks exposed and fixed the four-channel output default: FFmpeg
selected FL/FR/FC/BC, so the browser interpreted dialogue as a rear channel.
The resampler now receives an explicit quad mask matching
[Web Audio's speaker order](https://www.w3.org/TR/webaudio/#channel-ordering).
The pre-fix FLAC 7.1 → quad test failed its center-to-front assertion; the corrected
output preserves separate left/right surrounds and folds center into both fronts.
Odd capacities exercise fallback downmixes, not native 2.1/3.0, 3.1, 5.0, 6.1 or
height-speaker output. The API reports capacity, without identifying those physical
arrangements. Lifecycle unit tests additionally cover reported capacities 0, 9,
16 and 32, the eight-channel ceiling, and restoring a pre-existing surround bus.

The pinned FFmpeg FLAC decoder labels six-channel FLAC as 5.1(side), while newer
FFprobe versions label the same assignment 5.1(back). The tests assert the actual
decoded layout and distinguish side/back positions on the eight-channel output.
Separate lifecycle tests cover shared-context ownership, driver layout rejection,
capacity changes between bindings, and restoration of the previous destination.

Authenticated Plex playback additionally exercised **X 4** (DTS 7.1),
**Lilo & Stitch (2002)** (TrueHD 7.1 and E-AC-3 5.1 track switching), and
**The Relative Worlds** (AC-3 5.1) with
normalization disabled and native video. These checks establish loading, selected
tracks and advancing playback clocks; the synthetic per-speaker signals provide
the channel-routing assertions. They do not certify Atmos or compressed bitstream
passthrough, receiver channel labels, physical speaker wiring or lip-sync.

The existing decoder/normalization qualification passed, including exact bypass,
volume/mute, seek, track changes and stereo AV1/HEVC output. Five focused two-client
track/transition tests passed, covering local tracks, pause/seek, delayed join,
reconnect, rapid processed/raw transitions and Automatic AV1/HEVC selection.
TypeScript, the player unit suite and the production build passed.

The four normalization room tests were also run against an isolated current
backend and the production frontend. The processed test passed. Compatible,
AV1 and HEVC passed playback/toggle/seek/reconnect assertions, then failed the
final simulated native-decoder-error check because the video did not pause.
The same Compatible failure was reproduced while serving the unchanged HEAD
player bundle. This pre-existing error-handling issue remains outside the
speaker-routing change; the full normalization room suite is not recorded as passing.

To reproduce, install FFmpeg/FFprobe with the listed encoders and Chrome, then run
`npm run test:surround`. It uses an isolated loopback fixture server and writes
reports under ignored `cache/surround-audio/`; no Plex credentials or real media
copies are needed. `SPARKLE_AUDIO_CASE` filters by fixture name,
`SPARKLE_AUDIO_OUTPUTS=1,4,5` restricts reported capacities, and
`SPARKLE_TEST_CHANNEL` selects the browser. Stereo-only hosts exercise stereo
fallback; the full matrix requires an eight-channel device. Filtered runs write
`partial-report.json` without replacing the full `report.json`.

## Encoded multichannel audio

Validated September 30, 2026 with Chrome **154.0.8037.92** on Windows and real
NVENC AV1/HEVC output. Profile v8 accepts decodable tracks with 1-64 channels,
preserves representable speaker positions, and explicitly mixes wider/height
layouts to 7.1 or unidentified layouts to stereo. The fixture contains 15 audio
tracks, with exact 20 ms packets across three 12-second segments. WavPack/AC-3
sources retain their speaker masks; an intentionally unlabelled 12-channel PCM
source exercises the unknown-layout policy. Source probing checks those masks
before encoding. Older profile cache entries are separate.

Twenty-six real encoded codec/layout combinations passed stereo output routing
and seek checks: both codecs with 5.1, 7.1, 5.1(side), 2.1, 4.0, 4.1, quad(side),
6.1(back), 7.1(wide), 7.1(wide-side), 7.1.4, 22.2 and unidentified 12-channel input.
The 7.1, height and unknown-layout cases crossed the 12- and 24-second boundaries
with continuous PCM and advancing native video. Large audio fragments exposed
unequal seek completion times; PCM playback now holds both clocks until both
seeks finish, preserving the requested pause/play state.

An additional 104 codec/layout/output combinations passed on virtual mono, quad,
5.1 and 7.1 PCM buses, including speaker isolation and LFE routing. The 7.1,
height and unknown-layout cases restored their speaker routes after normalization
was enabled and disabled. Sampled clock differences stayed within 354 ms (234 ms
on stereo runs). These checks inspect samples before the physical destination:
the host reported two output channels, so they do **not** qualify physical
surround speakers.

Fifteen focused room/fullscreen cases passed through the PCM path: pause/play,
seek, local tracks, delayed readiness, reconnect, rapid source changes, converted
audio labels in a 375-pixel mobile menu, and a deliberately delayed audio seek.
Conversion labels do not change saved track identity. Suspended PCM contexts
resumed directly in trusted user gestures.
The iOS fullscreen checks emulate the native and presentation APIs in Chrome;
they are not physical iOS qualification. Windows Playwright WebKit 26.6 exposes
no AudioContext here and cannot run the audio checks. Physical iPhone/iPad Safari,
headphones/Bluetooth/AirPlay changes, physical surround and HDR output remain
unqualified. Safari uses WASM Opus and explicit PCM speaker remixing, without
depending on native multichannel Opus/WebCodecs.

To reproduce from the repository root (requires NVENC and FFmpeg/FFprobe):

```powershell
$env:SPARKLE_ENCODE_AUDIO_FIXTURE_DIR="$PWD/cache/encoded-layout-fixture"
$env:FFMPEG=(Get-Command ffmpeg).Source
$env:FFPROBE=(Get-Command ffprobe).Source
go -C backend test ./internal/encode -run '^TestNVENCLayoutAudioFixture$' -count=1
$env:SPARKLE_AUDIO_OUTPUTS='2'
npm run test:surround
$env:SPARKLE_AUDIO_VIRTUAL_OUTPUT='1'
$env:SPARKLE_AUDIO_OUTPUTS='1,4,6,8'
npm run test:surround
```

Virtual runs write `virtual-report.json` separately. Clear these fixture variables
before returning to original-media qualification. Set `SPARKLE_TEST_ENCODED_PCM=1`
when running `track-selection.spec.ts` to exercise the safe PCM path with older
manifests that omit channel counts; the real surround fixtures above separately
establish channel content and ordering.

## Client audio normalization

Stereo downmix validated September 24–25, 2026 in Chrome 154.0.8037.57 on Windows,
without cross-origin isolation. The [normalization checks](audio-normalization.md#checks)
use generated, deterministic media through actual browser decoders and the Raw
provider, with captured output rather than only advancing player timestamps.

| Playback path            | Material                                           | Result                                                                   |
| ------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------ |
| Existing Encoded         | H.264/AAC stereo and 5.1 MP4                       | Pass; six-channel AAC input becomes two channels before normalization    |
| Raw Compatible           | HEVC PQ with AC-3/E-AC-3/DTS/FLAC 5.1 and FLAC 7.1 | Pass; native video with separate client PCM audio                        |
| Raw Tone mapping         | HEVC PQ/FLAC 5.1 MKV                               | Pass; client video/audio decoding                                        |
| Raw client fallback      | H.264/TrueHD 5.1 MKV                               | Pass; client PCM audio                                                   |
| Raw Encoded AV1 and HEVC | NVENC video/Opus, two audio tracks                 | Pass; four six-second segment boundaries, track and output-mode switches |

All eleven cases captured two-channel output and zero silent render quanta during 12-second steady-tone
windows (20 seconds for segmented encodes), while the UI thread was blocked for
80 ms every 400 ms. Volume, mute, pause/toggle, seek/resume, preference retention
and unity gain when disabled passed. The separate audio clock remained within
114 ms of the native video clock across the sampled steady-playback windows. This
compares reported clocks, not physical speaker/display latency.

DSP reference checks cover mono through conventional 7.1, 44.1/48 kHz,
quiet/loud material, per-speaker impulses, phase cancellation, stereo balance and
post-downmix peak protection. All reference mixes converged within 0.15 LUFS of
the −18 LUFS target. A separate eight-channel browser PCM graph verifies center
dialogue in both sides, side/back separation, LFE omission and actual two-channel
output independent of the physical output device. Rapid toggles restore the original
eight channels with sample-exact unity bypass; native AAC also restores all six
channels when disabled. Unknown channel counts bypass. Browser tests cover failed worklet loading,
cancelled installation, native element reuse and Audio Boost before/after
normalization. Two-client Encoded MP4 and Raw Compatible/AV1/HEVC app tests passed local preference
independence, saved state after reload, pause/seek/resume, reconnect and
desktop/320/390 px control-bar placement. The Raw startup check retains the
rendering surface and timer while asynchronously installing the audio graph.
Encoded Raw tests also restore the saved alternate audio track during startup.

Live Avatar (2009) checks exercised Compatible HEVC/AC-3 and Encoded HEVC/Opus
with normalization. Encoded AV1 exposed an unrelated NVENC timecode defect:
Chrome's native decoder stopped around 0.4 seconds with or without normalization.
An original six-second HEVC reference encoded with S12M insertion enabled
reproduces the failure in native video and libmedia MSE. Disabling only S12M
insertion passes both paths, retaining 10-bit BT.2020/PQ, the exact mastering
display values and content-light metadata. Native decode failures now reach
the provider instead of leaving it buffering. This validates bitstream handling,
not physical HDR output.
After installing the updated backend, the live movie also passed more than a
minute of native AV1 playback with normalization active and the English TrueHD
source track converted to Opus. Short checks do not establish feature-length
continuity or physical speaker latency.

To repeat that opt-in comparison, create short, video-only AV1 MP4 clips from a
timecode-bearing source using the documented NVENC profile, with `-s12m_tc 1`
and `-s12m_tc 0`. Set `SPARKLE_AV1_BROKEN_FIXTURE` and
`SPARKLE_AV1_FIXED_FIXTURE` to those local clips, then run
`node scripts/tests/qualify-native-av1.mjs`. It uses a temporary loopback server
and checks native playback, MSE playback and sanitized error propagation.

Libmedia downmixed the Raw multichannel fixtures for the stereo output device before
the normalizer; native AAC 5.1 and the eight-channel PCM graph exercise the new
downmix directly. These are generated codec fixtures, not a qualification of every
channel-layout variant or Atmos passthrough. Actual surround-speaker output, Bluetooth, other browsers and
feature-length playback have not been qualified by these tests. Normalization
adds no sample queue or timeline changes. Physical HDR qualification is separate.

## Optional server encoding

NVENC validation on September 23, 2026 used Windows, an RTX 5090, driver 616.92,
and FFmpeg `2026-05-28-git-7b46c6a2a3` with the original CQ 22 / p7 / 10-bit /
144 kbps stereo Opus profile. Test services and generated segments used an isolated
cache; the existing running backend and its rooms were not replaced during testing.

The current **p3 (fast)** default separately passed three-second GPU conversions
with both AV1 and HEVC on SDR and Dolby Vision Profile 5, 8.1 and 8.4 reference
clips. Output retained the expected SDR/PQ/HLG signaling. Backend tests verify
that a software source-decoder retry still uses the selected NVENC video encoder.
The broader browser checks and timing measurements below used p7.

- AV1 and HEVC output passed 10-bit/color/timestamp probes for 4K PQ and HLG,
  the approximately 74 GB Profile 7/HDR10+ source with TrueHD and PGS, H.264 with
  TrueHD/SRT/ASS/PGS, and H.264 High 10 with AAC/ASS and 15 embedded fonts.
- Three-second reference conversions passed for Dolby Vision Profiles 5, 8.1 and
  8.4 with both encoders. Profile 5 applies libplacebo RPU conversion; output is
  compatible PQ/HLG without Dolby configuration. Profile 7 uses its base layer.
- Chrome tests passed native AV1/HEVC frames,
  segment boundaries, pause/resume, and a seek to about 4,998 seconds in the large
  source. Decoded frames reported limited-range BT.2020/PQ; HLG fixtures reported
  BT.2020/HLG. HEVC output retained mastering and content-light SEI in the sampled
  Profile 7 segment (1,000 nit maximum, MaxCLL 1,000 / MaxFALL 168).
- Two-client AV1 and HEVC tests passed delayed join, reconnect, pause/play, seeking,
  local track changes, encoded/original mode changes and room event suppression.
  The AV1 run also covered rapid processed/raw transitions. Switching stereo
  encoded audio to surround original audio exposed a pooled-resampler allocation
  bug; the reproducible client patch and the same regression now pass.
- An ASS fixture passed lazy font loading, caption renderer initialization,
  mobile output-menu bounds at 390×844, codec selection and reload persistence.
  Cache unit tests cover shared jobs, cancellation, reservations, pinned eviction,
  confined handles, validators and font separation. Go race/vet checks pass.
- Fresh six-second 4K Profile 7 segments at 120 seconds took approximately 2.6 seconds
  for AV1 and 3.7 seconds for HEVC; the High 10 SDR sample took 1.1–1.4 seconds.
  These p7 measurements are not benchmarks of the current fast p3 default, nor
  a guarantee for every GPU or source.
  Constant-quality output can still exceed a very slow connection's bandwidth.

No physical display or dynamic-HDR qualification is implied by these checks.
Server encodes deliberately produce compatible HDR10, HLG or SDR, and do not
preserve full Dolby Vision/HDR10+. NVIDIA Docker runtime validation remains pending
on a host with Docker and the NVIDIA Container Toolkit. Safari, Firefox and mobile
hardware encoding playback have not been qualified by this record.

The audio-continuity update was additionally tested with **CQ 22 / p3** on the
same Windows/NVIDIA setup:

- Both encoders produced five contiguous six-second fragments from a deterministic
  two-track tone fixture. All Opus packets had 20 ms duration and contiguous PTS.
  Chrome PCM sampling crossed four boundaries without a dropout; changing tracks
  changed decoded output from 440 Hz to 880 Hz. Video and Opus used one native clock.
- The reported anime episode (Opus/E-AC-3 with embedded captions) passed AV1 and
  HEVC playback across five boundaries. All five HDR output choices reported measured
  bitrate, and changing modes with Video Settings open kept Subtitles separate.
  Mobile menu/readout bounds and ASS font loading passed at 390×844.
- The 4K AV1/PQ sample passed both encoded modes, pause/resume and a seek to
  108 seconds. Decoded frames retained limited-range BT.2020/PQ signaling.
- The H.264/TrueHD fixture passed two-client AV1 synchronization, delayed join,
  reconnect, local track changes, encoded/original switching, PiP and rapid
  processed/raw transitions. A pending native packet-read teardown error found by
  this test was fixed in the reproducible player patch.

These are bounded playback regressions, not an hours-long listening test or
physical audio/video timing certification. Reproduction includes the deterministic
PCM check in the [server encoding guide](server-encoding.md#validation).

See [server encoding](server-encoding.md) for opt-in configuration and reproduction.

The adaptive AI HDR grade (`ai-hdr-adaptive-v4`) was checked on September 30, 2026
with Windows, RTX 5090 and NVEncC 9.36, with the same GPU matrix also passing on
9.35 plus NGX. Its GPU tests cover SDR/PQ/HLG in AV1/HEVC,
first/middle/final segments, fractional frame rates, VFR reference fallback and
GPU/reference color comparisons. `TestAIHDRNaturalGrade` additionally compares
continuous processing with independently requested 12-second segments, including
their first frames, a moving highlight, a one-frame flash, black preservation and
monotonic gradients/fades. Its fixed 100-nit PQ patch stays approximately 175 nits
while another highlight changes. The separate spline comparison and its settings
are recorded in the [processing research](server-encoding.md#processing-choices-and-research).
`TestAIHDRSceneAdaptation` measures the same 100-nit patch at approximately 204 nits
in a dark scene and 156 in a bright scene, checks letterbox invariance and immediate
cut consistency, and verifies a full fade to black. The SDR fixture uses NVIDIA
TrueHDR at 800/100/85/50; white is approximately 994 nits and 70% code gray is
151 nits, with black below 0.001 nit. Single-code gradient checks use CQ/QP 12 to
separate the grade from codec quantization; playback fixtures retain p3/CQ 24.
Native Chrome passes all six SDR/PQ/HLG × AV1/HEVC combinations with the new
segments, two-provider seek/pause/play, silent delayed-audio transitions, timestamp
startup, native stereo audio and desktop/mobile controls. Sampled PCM/video clock
differences stayed at or below 178 ms; no positive boundary stall was detected. These
are bounded browser clock checks, not measured acoustic lip sync. The fixture harness
does not exercise Plex authentication or full watch-party WebSocket transport.
Ordinary decoder preroll warnings do not masquerade as shader failures; actual
libplacebo errors fail closed even when the encoder exits successfully. The
hash-pinned 9.36 installer includes NGX and libplacebo and passes extraction and
runtime checks. The existing 9.35 runtime passes with its extra NGX archive;
a base-only 9.35 installation no longer provides the required SDR conversion.
These tests establish bounded decoded signal behavior, not subjective naturalness
or physical LG G6/iOS Safari HDR qualification. The HDR shader is frame-local;
it does not reproduce a television's proprietary temporal or regional algorithm.

September 30 client transition checks additionally cover silent decoder priming,
parallel paused seeks, PCM-buffer replacement and restoration of user volume.
`qualify-ai-hdr.mjs` passes all six SDR/PQ/HLG × AV1/HEVC combinations with an
artificially delayed audio seek, playing/paused output changes and recovery.
Crossing a twelve-second boundary produced no video stall; sampled audio/video
clock differences stayed below the 250 ms test limit, including startup.
These are browser clock samples, not measured acoustic lip sync.
Timestamp-start checks cover replacement loads at 12 seconds (an exact boundary),
13 seconds (within a segment), and paused recovery at 24 seconds (the final short
segment). Network assertions require both target init headers and target fragments,
with no earlier audio/video fragments requested during the replacement. Backward
seeks retain the original timeline. Five repeated AV1/HEVC × PCM/native-audio
startup runs pass; `qualify-ai-hdr.mjs --startup-only` runs this focused matrix.
Go service tests check target-init cache reuse, unchanged full playlists and fragment
URLs, AI HDR identity, and rejection of invalid/out-of-range startup hints.
The focused room cases pass local tracks, pause/play, seeks, delayed readiness,
reconnect, rapid media changes, stuck-seek recovery and temporary
toggle retention/reset. Rejected-AI-HDR recovery now passes after correcting native
startup alignment: the HEVC fixture's first presentation frame is at 12.100 seconds,
so seeking its replacement to the nominal 12.000-second boundary left native
`play()` pending in an unbuffered gap. Startup now uses the later of the requested
time and the common buffered audio/video start. Three repeated AV1/HEVC runs at
12 and 13 seconds on both native and PCM audio paths pass (24 cases), including
paused position restoration, backward/forward seeking and resumed playback.
Real encoded timestamp-start checks also pass all four AV1/HEVC × native/PCM
combinations without requesting opening fragments. Six mocked iOS fullscreen API
cases also pass; physical iOS Safari and HDR display qualification remain outstanding.

The live Avatar Chrome tab reported an eight-channel speaker destination.
Normalization reported active stereo processing when enabled and an eight-channel,
zero-gain-adjustment bypass when disabled. Real FLAC 7.1 decoder checks pass mute,
volume, seek and normalization, alongside sample-exact eight-channel graph bypass.
Segment continuity checks combine native clocks and spectral sampling with an
audio-thread capture; a main-thread analyser reading alone cannot prove an audible
dropout. AV1/HEVC 7.1 and 7.1.4-to-7.1 mixes cross both 12/24-second boundaries
with no silent render quanta in the final capture. Eight stereo-output layout
cases and sixteen virtual stereo/7.1 routing cases pass. The audio-only decoder
follows PCM consumption rather than applying an additional wall-clock silence
gate alongside the provider's A/V sync.
Late-start recovery also preserves the selected multichannel track and speaker
routing on real two- and eight-channel destinations. One HEVC height-layout
stereo-downmix run recorded 17 silent render quanta (about 45 ms) at a boundary;
focused repeats passed with both timestamp startup enabled and disabled. Its cause
remains unconfirmed; passing bounded captures do not establish dropout-free playback.
Bounded AI HDR playback around the opening and a later scene did not reproduce the
reported intermittent picture freeze; one dropped frame was observed among roughly
5,000 frames in the longer sampled run. This does not establish stutter-free playback
throughout the movie or under arbitrary CPU/GPU load.

The v4 real-source matrix was rerun on September 30 with NVEncC 9.36 for both AV1
and HEVC. Every output was decoded and checked for 10-bit BT.2020/PQ, 1,600-nit
mastering metadata and absence of residual Dolby Vision/HDR10+ signaling:

| Source                                                 | AI HDR processing                              | AV1 / HEVC  |
| ------------------------------------------------------ | ---------------------------------------------- | ----------- |
| ZENSHU S01E01, untagged 1080p 8-bit H.264              | Checked Rec.709 SDR assumption, NVIDIA TrueHDR | Pass / Pass |
| Avatar, HDR10 with 1,000-nit mastering and zero MaxCLL | Adaptive PQ expansion                          | Pass / Pass |
| Weathering with You, HDR10 with MaxCLL 992             | Adaptive PQ expansion                          | Pass / Pass |
| Avatar: Fire and Ash, HDR10+ with MaxCLL 274           | Adaptive PQ expansion from the HDR10 signal    | Pass / Pass |
| Dune: Part One, Dolby Vision Profile 7                 | Adaptive expansion from the HDR10 base layer   | Pass / Pass |
| Dolby reference Profile 5                              | Dolby reshaping, then PQ expansion             | Pass / Pass |
| Dolby reference Profile 8.1                            | Adaptive expansion from the PQ base signal     | Pass / Pass |
| Dolby reference Profile 8.4                            | HLG-to-PQ adaptive mapping                     | Pass / Pass |

A sampled twelve-second Avatar segment, including audio, rendered in approximately
4.1 seconds for AV1 and 3.8 seconds for HEVC. The SDR sample took 3.3/3.5 seconds.
These are bounded single-job measurements, not sustained or concurrent throughput
qualification. Profile 5 uses its reshaping/reference path; the other eligible
sources also pass sampled GPU/reference color comparisons.

The untagged SDR check reproduces a source previously rejected with “AI HDR
unavailable.” Its stream and decoded frames lack color tags, so it uses the
documented narrow HD AVC assumption; regression tests still reject untagged
10-bit, wide-gamut, full-range and conflicting HDR metadata. Qualified GPU-path
sources also passed sampled decoded RGB comparisons against the normalized
reference grade. The real-source comparison decodes the reference from the start
before discarding pre-roll: input-side FFmpeg seeks in the Profile 8 MP4 reference
files lost HEVC parameter sets and otherwise compared different scenes.

Authenticated Chrome playback on the running backend verified ZENSHU, Avatar,
Avatar: Fire and Ash and Dune: Part One with AI HDR in both AV1 and HEVC, native decoded video and
advancing clocks across segment boundaries. ZENSHU also passed with Compatible
selected while AI HDR supplied AV1; Avatar passed a seek in HEVC. These checks
cover selected playback windows, not complete feature-length files.

These checks do not qualify physical peak luminance, Dolby Vision/HDR10+ dynamic
metadata preservation or additional display/browser models. See the
[AI HDR pipeline and reproduction instructions](server-encoding.md#ai-hdr).

## Native HDR and dynamic HDR

Native AV1 MP4 **PQ and HLG** samples played at 3840×2160. MSE initialization
segments retained BT.2020 primaries/matrix, the correct PQ (16) or HLG (18)
transfer characteristic, limited range, and byte-identical `mdcv` mastering
metadata. Headless Chrome reported **SDR tone mapping** on its SDR display.
The interactive Chrome session on the user's display reported **HDR10** for
the PQ sample and displayed video with working embedded audio/subtitle menus.
These are pipeline and UI checks; screenshots cannot certify physical luminance
or color accuracy.

The sampled HEVC 10-bit **Dolby Vision Profile 7 / HDR10+** file was tested
separately. Original playback used its explicitly labeled compatible HDR10 representation;
Chrome displayed native MSE video at 3840×2160 while a separate client instance
decoded TrueHD. On the test's SDR display, the UI reported **SDR tone mapping**.
The native clock advanced beyond 13 seconds without a page error.

The MSE initialization segment carried `nclx` primaries 9, transfer 16, matrix 9,
limited range (BT.2020/PQ). Demuxing retained the file's Dolby configuration
record. This sample did not provide container mastering metadata; its encoded
video metadata remains in unchanged packets and its static HEVC SEI is now also
copied into native MSE `mdcv`/`clli` boxes. Added container `mdcv`/`clli`
writing uses the specified G/B/R primary order, following the
[FFmpeg MP4 writer](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/movenc.c).
The MP4-to-MP4 mastering-box path passes byte preservation checks; Matroska
mastering conversion still needs a reference fixture with container metadata.

The HEVC Profile 8 / HDR10+ / E-AC-3 regression sample originally supplied only
`colr` to MSE despite containing mastering and light-level SEI. The repaired
initialization segment preserves those SEI payloads byte for byte: mastering
maximum 1,000 nits, minimum 0.005 nits, MaxCLL 1,087 and MaxFALL 355. The Profile 7
sample also passes exact SEI-to-box comparison. Native decoding retains limited
range, BT.2020 primaries/matrix and PQ transfer through distant seeks. These
checks exercise Chrome 153 on Windows without cross-origin isolation; physical
display luminance and full dynamic-HDR processing remain unqualified.

The long-file regression checks a paused halfway seek, rapid subsequent seeks,
resume/pause, bounded range requests, and desktop/mobile HDR menus. Audio-only
MKV decoding now uses video-indexed interleaved clusters instead of scanning
forward from previously visited positions. Timing evidence is specific to the
local test machine and storage, not a network-performance guarantee.
Chrome and Edge both pass this regression with BT.2020/PQ decoded frames:
pause completes in about 20–40 ms and a halfway seek in about 0.4 seconds,
requesting 44 MiB of bounded ranges for the two decoder readers.

The updated HEVC codec-string builder uses the hvcC profile/tier/level, complete
constraint bytes and bit-reversed RFC compatibility flags. Unsupported native
PQ/HLG combinations can use client-side SDR rendering instead of being blocked.

**No full dynamic-HDR combination is certified by this change.** The qualification
registry remains empty. In particular, Profile 7 enhancement-layer rendering,
native Dolby/HDR10+ per-scene display output, HLG physical reference rendering,
and physical HDR-versus-SDR color accuracy still require appropriate
reference files and hardware. Generic HEVC/AV1 support is insufficient evidence.
The user's existing native Chrome AV1 HDR playback is the basis for preferring
native video; it is not recorded as a new physical test performed here.

Use [Dolby's browser test kit](https://ott.dolby.com/browser_test_kit/index.html)
and appropriate HDR10+/HLG reference material when qualifying exact browser,
OS, GPU, display and codec/profile combinations. Never mark base-layer output
as full Dolby Vision. A client without a compatible decoder remains in the
party and receives an explicit playback limitation.

### Client SDR renderer (September 2026)

- Chrome rendered the 3840×2160 AV1/PQ fixture through the software SDR path;
  native → software switching continued past 11 seconds with no page error.
- Edge rendered the 3840×2160 AV1/HLG fixture through software SDR. This heavy
  fixture advanced about four seconds in fourteen seconds on the test machine;
  native decoding remains the preferred path for smooth 4K playback.
- Dolby's public `dolby-vision-contents` **Sol Levante Profile 5 1080p24** file
  decoded and sought to 30 seconds in Chrome and Edge using RPU reshaping and
  SDR output. Its SHA-256 is
  `87fe0115f3002a621d2380a9f91852ef91a15854a446efe26de8744f77ef5346`.
  Four ranges read approximately 16 MiB from the 142 MB reference file. Frames
  were visually inspected; this is not a physical display/color certification.
- WebGL pixel tests cover 10/12-bit full/limited-range PQ and HLG, neutral black,
  published PQ code values, highlight separation through 10,000 nits, and gamut
  compression. Dolby tests cover polynomial/MMR identity reshaping, matrix
  updates and malformed/truncated RPU metadata rejection.
- Dolby Profile 8.1 and 8.4 1080p24 reference files also passed software SDR
  playback and 30-second seeking in Chrome. The HEVC/PQ MPEG-TS sample played
  at 3840×2160 in Edge after normalizing Plex's container name.
- The large Profile 7/HDR10+ file played in Edge using its labeled HDR10 base
  layer. Inspection of MSE packets observed **384 Dolby RPU NAL units and 384
  HDR10+ SEI messages**, with a largest append of 1,400,768 bytes. Metadata
  reached MSE; this does not prove dynamic metadata processing by the display.
- Updated Chrome two-client tests passed native → software conversion during
  playback and software → native conversion while paused, with no accidental
  room pause. Edge passed all eight browser regression tests, including local
  captions/audio, PiP, rapid processed/raw transitions and multipart recovery.
- Real-media regression runs passed H.264 High 10/AAC/ASS with 15 embedded fonts,
  FLAC/PGS, HE-AAC/SRT and DTS. No unbounded raw-file GET requests were observed.

Reference source: [Dolby Laboratories test contents](https://github.com/DolbyLaboratories/dolby-vision-contents).
The separate OTT browser test kit returned HTTP 403 during this run; it was not
recorded as successfully tested. Reference files live only in the ignored test
cache and are not distributed with the application.

## Browser and party matrix

| Environment                  | Current evidence                                                                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Windows Chrome 153.0.8010.53 | Real-codec checks above; SDR and native AV1 PQ two-client sync, responsive Library, compatible HDR path                                   |
| Windows Edge 153.0.4234.48   | Production-build Library, two-client sync, local audio/subtitles, rapid raw/processed switching and multipart delayed-range recovery pass |
| Firefox                      | Playwright Firefox 155 downloaded; Windows rejected launch with a side-by-side runtime configuration error. No playback claim             |
| Safari / iOS / iPadOS        | Physical-device validation pending                                                                                                        |
| Android Chrome               | Physical-device validation pending                                                                                                        |
| Discord Activities           | Non-isolated browser decoding passes; actual embedded Activity/voice integration validation pending                                       |
| Linux Docker                 | Backend cross-compiles; read-only mount example supplied, container runtime test pending                                                  |

Android fullscreen regression coverage uses Pixel 7 touch/mobile emulation in
Windows Chrome with the actual element Fullscreen API. Compatible, AV1, HEVC and
Automatic pass touch entry/exit, browser-driven exit, portrait/landscape controls,
continued playback, and settings/subtitle containment within the fullscreen player.
The subtitle checks select distinct English and Chinese VTT layers and assert both
remain visible with the native caption track hidden to avoid duplicates.
This is browser automation evidence, not physical Android-device qualification.

iOS fullscreen regression tests simulate both WebKit fullscreen APIs in Chrome
while using real native TextTrack/VTTCue scheduling and libmedia playback. Compatible,
AV1 and HEVC exercise merged English/Chinese captions, native-track activation before
entry, cue changes/gaps, forward/backward seeks, exit to inline overlays, layer removal
and captions off. These tests do not qualify Safari's system player or physical devices.

Recovery checks use the production build in Chrome with generated AV1/HEVC fixtures.
They simulate an app-suspended native video, an unfinished decoder seek, a socket
that reports open while dropping traffic, and a failed encoding manifest. Coverage
includes automatic recovery, explicit retry without original-file fallback, accurate
paused seeks, two-client pause/play after reconnect, and retiring an unfinished decoder
when changing Plex media in the same room. iPhone 13 emulation also combines offline
mode with an injected decoder failure: deferred room snapshots must not replay over
local pause/seek commands after recovery, and those controls must reach the other
viewer. A rejected AI HDR manifest must show an interruption reason; turning AI HDR
off restores ordinary encoding, the paused room position, and working playback controls.
Pixel 7 emulation covers the returning viewer with a half-open socket. These are Chrome
simulations; physical Safari/iOS and Android app-switch qualification remains pending.

Room timeline regressions also simulate a background native clock resetting to zero,
a delayed viewer joining at a paused position, and conflicting in-flight room seeks.
Media replacement tests use different 48-second and 24-second durations with the old
media playing or paused. Two-client iPhone 13 and Pixel 7 emulation checks return from
a backgrounded old source to a delayed replacement paused at 12 seconds, then verify
shared play/pause. These Chrome simulations do not qualify physical Safari or Android.

Media identities/revisions are attached to playback updates and backend tests
reject stale generations. Decoder operations serialize, obsolete seeks coalesce,
and remote suppression spans asynchronous operations. Two-client tests cover
pause/play, seek, delayed startup, reconnect, local audio/subtitle changes and
rapid raw/processed transitions. The same two-client checks pass with native
AV1 PQ plus a separate client audio decoder. Resume events reach Vidstack in
play/playing order, and destroyed providers cannot publish late callbacks.
A synthetic two-part timeline backed by a real
short fixture passes forward/backward seeks, the automatic part boundary, and
recovery after a five-second delayed range request without broadcasting a pause.
This does not qualify every real multipart encoding combination.
Edge's rapid raw/processed transition test also passes three consecutive runs
after guarding decoder and audio-renderer continuations during teardown.
Interactive Chrome checks cover chat delivery, Wordle startup, Chess setup, and
the paged in-room picker. Microphone permissions were not changed.

Chrome UI regression checks cover first-open subtitle menu sizing, the raw CC toggle,
and Document PiP entry/exit while playback advances without sending an accidental
room pause. Desktop/mobile Library checks cover automatic paging, preserved filters,
Back/Forward/reload with the room and hierarchy intact, a single search clear button,
dropdown triggers/popups at 320/390/768/1366 pixels, and covers loading after scrolling
without hover. Live Plex checks verify processed movie/show, season, and episode
artwork/description matches; backend tests reject remakes, ambiguous identities,
truncated results, and wrong episode ordering while bounding queries and cache entries.
The raw Cast
control presents its direct-casting limitation; no receiver playback is claimed.

Separate long-session buffering/recovery, native video PiP on other browsers, casting
to a physical receiver and physical audio/video timing qualification remain necessary.
Raw previews are currently
omitted; processed storyboards continue to work.

## Reproduce

Start the API and frontend with the configured read-only mappings. Run
`go test -race ./...` in `backend`, then `npm run check`, `npm run test:player`,
and `npm run build` at the root. Browser tests use `SPARKLE_TEST_URL` (default
`http://127.0.0.1:3002`) and `SPARKLE_TEST_CHANNEL` (`chrome`, `msedge`, `firefox`).

- `SPARKLE_RAW_TEST_ID`: mapped SDR fixture for the two-client E2E test.
- `SPARKLE_TEST_BACKEND_URL`: E2E room/metadata API base when the running frontend
  uses a separate backend origin; defaults to `/be` relative to `SPARKLE_TEST_URL`.
- `SPARKLE_RAW_EXPECTED_HDR`: source format label when running that same test
  with a native HDR fixture, for example `HDR10` for AV1 PQ.
- `SPARKLE_RAW_SECOND_ID` and `SPARKLE_PROCESSED_TEST_ID`: enable rapid switching
  and processed/raw transition checks in the same E2E test.
  The second raw fixture should be short; it also backs the synthetic multipart test.
- `SPARKLE_MEDIA_FIXTURES`: JSON array of IDs and optional `seekSeconds`,
  `audioCodec`, `subtitleCodec`, `subtitleId`, `subtitleLayers` for
  `node scripts/tests/qualify-media.mjs`.
- `SPARKLE_HDR_TEST_ID`: HDR item for `node scripts/tests/qualify-hdr.mjs`.
  It captures native pipeline evidence, including HEVC SEI-to-box preservation,
  not physical HDR certification. Use a long HEVC PQ file with audio for
  `npx playwright test tests/e2e/raw-native.spec.ts`, which also checks distant
  seeks, decoded frame color, pause/resume and compact desktop/mobile settings.
- `SPARKLE_HDR_MODE=sdr`: exercise local software tone mapping in that script.
- `SPARKLE_DOLBY_FIXTURE`: local official reference file for
  `node scripts/tests/qualify-dolby.mjs` (default
  `cache/hdr-fixtures/dolby-profile5.mp4`). This test-only range server binds to
  loopback and closes after the run; it does not modify the app catalog or Plex.
- `npx playwright test tests/e2e/hdr-color.spec.ts`: synthetic GPU reference tests
  without Plex credentials or media fixtures.
- `node scripts/tests/prepare-track-fixture.mjs --nvenc` creates disposable
  multilingual MKV, processed MP4, and NVENC AV1/HEVC fixtures in the ignored cache.
  Run `npx playwright test tests/e2e/track-selection.spec.ts` against the running app
  to check shared track priorities, explicit-only audio persistence, captions,
  local track changes while playing/paused, reconnects, source transitions and
  two-client synchronization. Subtitle cases cover missing saved tracks, duplicate
  titles across Compatible/AV1/HEVC and reloads, shared Off state, per-format ASS/VTT
  layers (including four styled tracks in all three modes), promotion of companion
  tracks, merged text packets, and matching
  Encoded/Raw controls at desktop and 375 px widths. These use real decoders and synthetic metadata/file
  routes without Plex credentials. Omit `--nvenc` without a supported GPU; the
  AV1/HEVC cases skip when those fixtures are absent. Subtitle policy also has
  desktop/mobile unit coverage in `npm run test:player`; this is not physical
  mobile-device or HDR qualification.
  Automatic cases check AV1 preference, HEVC when AV1 is unsupported, fast/slow
  connection hints, no original-file network probe, reload persistence, explicit
  Compatible recovery, and unavailable/failed encoding without an original-file fallback.
  Two-client synchronization also runs with Automatic selected.
- `npx playwright test tests/e2e/subtitle-rendering.spec.ts` checks the real local
  JASSUB worker without Plex credentials. Chinese ink masks distinguish real glyphs
  from repeated missing-font boxes; four styled layers with different script resolutions
  share one renderer and shrink,
  then restore their size when layers are removed. Five text layers stack as lines;
  seek clearing and worker/canvas teardown are covered. Screenshots accompany these checks.

`SPARKLE_BUILD_DIR=.next-raw-validation` isolates a validation build from an
existing development checkout. The ordinary build still uses `.next`.

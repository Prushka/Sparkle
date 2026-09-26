# Raw-media validation record

Validated September 22–23, 2026 on Windows using the configured Plex server and
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

Chrome 153.0.8010.53 on Windows, headless and **not cross-origin isolated**:

| Material           | Evidence                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------ |
| H.264 8-bit, AAC   | Playing clock advances, indexed seek and pause                                                         |
| H.264 10-bit, AAC  | Client fallback plays and seeks; ASS with 15 fonts                                                     |
| HEVC SDR, FLAC     | Playing clock advances, seek, pause; ASS with eight fonts                                              |
| HEVC SDR, E-AC-3   | Track selected and client playback advances                                                            |
| H.264, DTS         | Playing clock advances, seek and pause                                                                 |
| H.264, AC-3        | Track selected, playing clock advances                                                                 |
| H.264, TrueHD      | Browser WASM decoder plays and seeks; PCM output, no Atmos passthrough claim                           |
| ASS/embedded fonts | Visible captions inspected after seek; local JASSUB worker/WASM                                        |
| SRT                | Visible text observed after seek                                                                       |
| MP4 embedded text  | Caption text displayed without binary styling-box bytes                                                |
| PGS                | Visible bitmap captions inspected; zlib-compressed Matroska packets and fragmented objects supported   |
| Multiple subtitles | Primary ASS plus SRT and a second ASS layer receive packets from one demuxer; both ASS renderers ready |
| Large attachments  | Oversized attachment skipped correctly; aggregate attachment budget enforced before allocation         |

Five-second playback windows advanced approximately 4.5–4.8 seconds. Paused
clock settling stayed below 0.5 seconds in these samples. Range requests were
present on every original-file GET. Tests exercise selected windows, not entire
feature-length files or sustained audio/video lip-sync accuracy.

The approximately 74 GB sample is 73,577,101,905 bytes. A 128 MiB range-read
exercise across distant offsets, including the end of the file, increased API
RSS from 55.09 MiB to a measured peak of 55.38 MiB. This is a bounded-memory
range test, not a complete 74 GB transfer. No raw-file copy or derivative was
created. Test evidence and build artifacts are under ignored `cache/`.

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
- Chrome tests passed automatic slow-network selection, native AV1/HEVC frames,
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
separately. Automatic mode selected its explicitly labeled compatible HDR10 representation;
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
  layers, promotion of companion tracks, rendered text packets, and matching
  Encoded/Raw controls at desktop and 375 px widths. These use real decoders and synthetic metadata/file
  routes without Plex credentials. Omit `--nvenc` without a supported GPU; the
  AV1/HEVC cases skip when those fixtures are absent. Subtitle policy also has
  desktop/mobile unit coverage in `npm run test:player`; this is not physical
  mobile-device or HDR qualification.

`SPARKLE_BUILD_DIR=.next-raw-validation` isolates a validation build from an
existing development checkout. The ordinary build still uses `.next`.

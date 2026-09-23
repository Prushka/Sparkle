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
separately. After explicitly selecting its compatible HDR10 representation,
Chrome displayed native MSE video at 3840×2160 while a separate client instance
decoded TrueHD. On the test's SDR display, the UI reported **SDR tone mapping**.
The native clock advanced beyond 13 seconds without a page error.

The MSE initialization segment carried `nclx` primaries 9, transfer 16, matrix 9,
limited range (BT.2020/PQ). Demuxing retained the file's Dolby configuration
record. This sample did not provide container mastering metadata; its encoded
video metadata remains in unchanged packets. Added container `mdcv`/`clli`
writing uses the specified G/B/R primary order, following the
[FFmpeg MP4 writer](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/movenc.c).
The MP4-to-MP4 mastering-box path passes byte preservation checks; Matroska
mastering conversion still needs a reference fixture with container metadata.

Another HEVC/PQ sample failed the exact native capability probe on this machine
and was explicitly rejected; room participation remained available. Codec,
profile and device differences matter even within the same browser.

**No full dynamic-HDR combination is certified by this change.** The qualification
registry remains empty. In particular, Profile 7 enhancement-layer rendering,
RPU application, HDR10+ per-scene output, HLG reference rendering,
and physical HDR-versus-SDR color accuracy still require appropriate
reference files and hardware. Generic HEVC/AV1 support is insufficient evidence.
The user's existing native Chrome AV1 HDR playback is the basis for preferring
native video; it is not recorded as a new physical test performed here.

Use [Dolby's browser test kit](https://ott.dolby.com/browser_test_kit/index.html)
and appropriate HDR10+/HLG reference material when qualifying exact browser,
OS, GPU, display and codec/profile combinations. Never mark base-layer output
as full Dolby Vision. A client without a compatible native path remains in the
party and receives an explicit playback limitation.

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

Separate long-session buffering/recovery, casting/PiP and physical audio/video timing
qualification remains necessary. Raw previews are currently
omitted; processed storyboards continue to work.

## Reproduce

Start the API and frontend with the configured read-only mappings. Run
`go test -race ./...` in `backend`, then `npm run check`, `npm run test:player`,
and `npm run build` at the root. Browser tests use `SPARKLE_TEST_URL` (default
`http://127.0.0.1:3002`) and `SPARKLE_TEST_CHANNEL` (`chrome`, `msedge`, `firefox`).

- `SPARKLE_RAW_TEST_ID`: mapped SDR fixture for the two-client E2E test.
- `SPARKLE_RAW_EXPECTED_HDR`: source format label when running that same test
  with a native HDR fixture, for example `HDR10` for AV1 PQ.
- `SPARKLE_RAW_SECOND_ID` and `SPARKLE_PROCESSED_TEST_ID`: enable rapid switching
  and processed/raw transition checks in the same E2E test.
  The second raw fixture should be short; it also backs the synthetic multipart test.
- `SPARKLE_MEDIA_FIXTURES`: JSON array of IDs and optional `seekSeconds`,
  `audioCodec`, `subtitleCodec`, `subtitleId`, `subtitleLayers` for
  `node scripts/tests/qualify-media.mjs`.
- `SPARKLE_HDR_TEST_ID`: HDR item for `node scripts/tests/qualify-hdr.mjs`.
  It captures native pipeline evidence, not physical HDR certification.

`SPARKLE_BUILD_DIR=.next-raw-validation` isolates a validation build from an
existing development checkout. The ordinary build still uses `.next`.

# Client audio normalization

The waveform toggle immediately left of Captions applies to existing Encoded MP4
and Raw Compatible, Tone mapping, Encoded AV1 and Encoded HEVC playback. It is off
by default. `sparkle.audio.normalize` in localStorage remembers the choice across
reloads, media, tracks and HDR output modes. It does not change other participants'
settings, voice chat, files, server encoding parameters or room messages.

## Processing

[loudness-worklet 2.0.3](https://github.com/lcweden/loudness-worklet) is pinned in
the npm lockfile. Its BS.1770 K-weighted meter runs inside a single AudioWorklet
with Sparkle's linked gain controller. Processing uses a 400 ms analysis window,
a -18 LUFS target, at most +12 dB boost / -18 dB attenuation, a silence gate,
80 ms gain-reduction smoothing and a 2 s gain-increase response. The analysis
window does **not** buffer or delay output samples. A linked sample-peak guard
includes LFE and reserves 2 dB headroom. It is not a certified true-peak limiter
or an offline, two-pass loudness scan; highly dynamic material may not stay at
the exact target.
The adapter disables unused integrated/LRA histograms and oversampled true-peak
analysis; only momentary loudness and Sparkle's sample-peak guard are used. This
reserves audio-thread time for decoding rather than unused meter displays.

Supported decoded speaker layouts are mono, stereo, 5.0, 5.1 and conventional
7.1. LFE is excluded from loudness measurement, but receives the same gain and
peak protection. All channels retain their order and relative levels. The player
or browser may already downmix to the output device's channel count. This feature
does not add surround hardware, recover discarded channels or preserve compressed
bitstream/Atmos passthrough. Unrecognized decoded layouts bypass processing.

Turning off returns to sample-exact unity gain after a short click-avoiding ramp
(within 100 ms). The normalizer adds no lookahead, sample queue, resampling or
timeline offset. Main-thread UI work does not process or transfer audio samples.
Volume and mute remain independent: the WASM hook is before the user's gain;
native measurement compensates for the element volume. Seek/track changes reset
the adaptation window without restarting playback.

## Integration and failure handling

The patched libmedia player exposes PCM and native-element graph hooks, installed
before audio starts and disposed during player teardown. Both the combined native
video/audio route and separate WASM audio route use the same controller. Existing
Encoded MP4 configures Vidstack's native provider before setup. Its existing Audio
Boost control shares the native source and applies its gain after normalization;
neither control competes for the browser's single media-element source. Mode changes
create a fresh binding with the saved preference; they retain the existing room
readiness/synchronization rules.
The native-video startup recovery loop excludes Raw playback: its asynchronously
created video is a child of the Raw provider, not a replacement Vidstack target.
This keeps the rendering surface and synchronization timer attached while the
worklet loads. Paused Raw sessions install their audio graph when playback starts.

Non-isolated libmedia audio reports its clock every 50 ms. The separate-audio
sync controller uses 120/40 ms hysteresis to avoid repeatedly entering/flushing
time stretching. WASM output uses two bounded 20-quantum PCM buffers (about
53 ms each at 48 kHz), included in libmedia's presentation-time calculation,
to tolerate decoder scheduling jitter. These are decoder buffers, not a
normalization lookahead queue.

AudioWorklet requires a secure context (HTTPS or localhost). Module loading or
context failures retain the direct audio route and the button explains that
normalization is unavailable. There are no new isolation headers; SharedArrayBuffer
is unnecessary. Native contexts are reused, and removed elements are disconnected;
reused elements restore their direct route even when the setting is off.

`npm run prepare:player` serves the worklet and MIT license locally under
`public/vendor/libmedia/audio/`. The preparation script verifies the pinned meter
hash, exports its processor for synchronous composition, and adjusts its 7.1
weight table for Web Audio's side/back-surround layout. Change this reproducible
adapter and the source worklet, never generated files. Rebuild/export libmedia
when its graph hooks change; see [the build guide](../scripts/libmedia/README.md).

## Checks

- `npm run prepare:player` then `npm run test:player`: calibrated 1 kHz reference
  signals, 44.1/48 kHz, mono through 7.1, linked gain, LFE peaks, unknown-layout
  bypass, sample counts and exact off-state samples.
- `npm run test:audio`: real browser decoders, generated AAC stereo/5.1 MP4,
  HEVC PQ + FLAC 5.1 MKV, H.264 + TrueHD 5.1 MKV and shared NVENC AV1/HEVC +
  Opus fragments. Requires FFmpeg with NVENC and previously generated
  `cache/encoded-audio-fixture` from the opt-in Go
  `TestNVENCAudioContinuityFixture` test. Uses an isolated loopback fixture server,
  never real Plex credentials. Reports under ignored `cache/audio-normalization/`.
  `SPARKLE_AUDIO_CASE` optionally selects a case by name; `SPARKLE_TEST_CHANNEL`
  can select installed Chrome or Edge.
- With the app/API running, `SPARKLE_TEST_URL=http://localhost:3001`
  `npx playwright test tests/e2e/audio-normalization.spec.ts` checks the saved
  toggle, local independence, desktop/320/390 px placement, reload, and two-client
  pause/seek/resume for Encoded MP4 and Raw Compatible/AV1/HEVC. Encoded Raw
  cases also restore a saved alternate audio track. Generate the above media
  fixtures first. The AV1 startup check delays initialization by 6.5 seconds under
  ordinary autoplay policy. Native decoder errors must leave chat available and
  must not pause another participant.

Browser capture checks measure decoded output and silent render quanta during
steady tones under UI-thread load. They do not certify physical speaker/display
latency, Bluetooth devices or every browser/OS combination.

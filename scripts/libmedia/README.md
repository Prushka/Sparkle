# Pinned client player build

Normal app builds need only `npm ci` followed by `npm run build` (or `npm run
dev`). `prepare-player-assets.mjs` copies the checked-in patched player and
TrueHD WASM and fetches stock decoder assets from an immutable commit with
SHA-256 validation. All playback assets are subsequently served locally.

The build cache is disposable. Do not place unrelated changes in
`cache/libmedia-source`: `patch.mjs` resets **only its named source files** to
that checkout's committed versions before applying the complete patch series.

## Source pins

| Component         | Revision                                            |
| ----------------- | --------------------------------------------------- |
| libmedia AVPlayer | v1.3.1 / `152f629d3021fd8013efa464fcb7b55f9fbe7753` |
| common submodule  | `00c9c3c481cf7c53ed252cec6ca2dc6e9732ea28`          |
| cheap submodule   | `85cc79e032cbd417e3bb4a218bdf26da537b970b`          |
| zhaohappy FFmpeg  | `3a14ab29692763e561610412cdeb1985da4e3cd8`          |
| Emscripten SDK    | 4.0.10 / `62a853cd3b3134398ce85cde8bb5cbb2ef0194cb` |

Sources: <https://github.com/zhaohappy/libmedia>,
<https://github.com/zhaohappy/FFmpeg>, <https://github.com/emscripten-core/emsdk>.
The app dependency is pinned to `@libmedia/avplayer` 1.3.1; runtime uses the
patched checked-in bundle rather than the unmodified npm bundle.

## Rebuild

Prerequisites: Git, Node/npm, Python, bash, make, a C compiler for FFmpeg's build
helpers, and Emscripten. On Windows use MSYS2 UCRT64 and install `make`,
`diffutils`, and the UCRT64 GCC package. Node must be available on its PATH.
Use LF line endings in shell scripts (`git -c core.autocrlf=false clone ...`).

Clone into the following directories, checking out the exact revisions above:

```sh
git -c core.autocrlf=false clone --branch v1.3.1 --recurse-submodules https://github.com/zhaohappy/libmedia cache/libmedia-source
git -c core.autocrlf=false clone --branch libmedia7.0 https://github.com/zhaohappy/FFmpeg cache/FFmpeg
git -C cache/FFmpeg checkout 3a14ab29692763e561610412cdeb1985da4e3cd8
git -c core.autocrlf=false clone --branch 4.0.10 https://github.com/emscripten-core/emsdk cache/emsdk
```

Install and activate SDK 4.0.10 using `cache/emsdk/emsdk` (Linux) or
`cache/emsdk/emsdk.bat` (Windows). This changes the local SDK configuration only;
no global activation is needed. In the libmedia checkout run `npm ci
--ignore-scripts`; in `packages/common` run `npm ci --ignore-scripts`. Copy
`locks/cheap-pnpm-lock.yaml` to `packages/cheap/pnpm-lock.yaml` and run
`npx --yes pnpm@10.18.3 install --frozen-lockfile --ignore-scripts` there. The
upstream postinstall is unnecessary for this build.

From the Sparkle root:

```sh
node scripts/libmedia/patch.mjs
bash scripts/libmedia/build-truehd.sh
cd cache/libmedia-source
npm run build-avplayer -- --env esm=1
cd ../..
node scripts/libmedia/export-build.mjs
node scripts/prepare-player-assets.mjs
```

`build-truehd.sh` creates a separate FFmpeg configuration under
`cache/truehd-pic-build`, enables only the TrueHD decoder, and links against the
pinned libmedia FFmpeg utility/resampling archives. It produces a baseline WASM
module for non-isolated browsers. No server FFmpeg executable is installed or
invoked for media processing. For another configure profile use a new build
directory instead of reusing `config.h` from an incompatible build.

The patches add TrueHD/PGS admission, non-isolated subtitle packet transfer,
embedded font access, bounded subtitle sinks/layers, zlib-compressed Matroska
subtitle packets, native HDR guards, exact High 10/HEVC/AV1 color probes,
Matroska Dolby configuration signaling, and MP4 static/Dolby HDR box preservation.
`hdr-metadata.ts` extracts bounded HEVC SEI from hvcC and the first video packet
into native MSE `mdcv`/`clli` boxes without modifying samples. It is hash-pinned
in the exported manifest and shares its parser with malformed-input/unit tests.
The Matroska seek patch lets audio-only playback use interleaved video-cue
clusters, including the final cue, instead of scanning forward through the file.
Native Dolby playback uses the selected Dolby codec in both MSE and the MP4
sample entry. `hdr-sdr.ts` supplies the tested integer-frame PQ/HLG → sRGB shader;
`dovi-sdr.ts` adds bounded per-frame Profile 5 RPU polynomial/MMR and color transforms.
Both source files are copied by the patch script and hashed in the manifest.
Software HDR explicitly disables WebCodecs to avoid implicit 8-bit conversion.
It produces SDR, never an HDR canvas signal. Profile 7 enhancement layers remain
outside this decoder; HDR10+ software playback uses the compatible PQ representation.

`dovi-layout.c` checks the FFmpeg metadata ABI used by `readDovi`. Compile it with
the pinned Emscripten compiler and `-Icache/FFmpeg -sWASM_ASYNC_COMPILATION=0`,
then run the generated JavaScript with Node. The wasm32 record sizes are
12 / 18 / 1672 / 5136 / 196 bytes (metadata/header/curve/mapping/color). Reverify
all printed offsets before changing FFmpeg or enabling wasm64 assets.
Pending subtitle/decoder pulls are cancelled during teardown; native play
promises are observed across pause and source changes.
`export-build.mjs` records source revisions and stock
codec hashes. After changing patches, rebuild and run the browser qualification
script; successful compilation alone does not establish decoder compatibility.

## Redistribution

The libmedia bundle and FFmpeg decoder use LGPL licensing; `vendor/libmedia/LICENSE`
contains the libmedia LGPLv3 text. Keep notices and corresponding patched source
available when distributing binaries. Source revisions and the full modification
script are supplied above. JASSUB is installed under its package's combined
license terms; its notices and worker license text are copied with its assets.
The original source directories include component-specific licenses. This
integration does not remove the requirement to supply corresponding source or
relinking material required by the applicable LGPL version when distributing
modified binaries.

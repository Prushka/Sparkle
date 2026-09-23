#!/usr/bin/env bash
# Run in MSYS2 on Windows, or bash on Linux. Dependencies are local to cache/.
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LM="$TASK_ROOT/cache/libmedia-source"
FF="$TASK_ROOT/cache/FFmpeg"
SDK="$TASK_ROOT/cache/emsdk"
export PATH="$SDK/upstream/emscripten:$PATH"
export EMSDK_PYTHON="$SDK/python/3.13.3_64bit/python.exe"
if [[ ! -f "$EMSDK_PYTHON" ]]; then unset EMSDK_PYTHON; fi
BUILD="$TASK_ROOT/cache/truehd-pic-build"
mkdir -p "$BUILD" "$LM/lib/decode/truehd" "$LM/dist/include" "$LM/dist/decode"
cd "$BUILD"
if [[ ! -f config.h ]]; then
  bash "$FF/configure" --cc=emcc --cxx=em++ --ar=emar --ranlib=emranlib \
    --cpu=generic --target-os=none --arch=webassembly --enable-cross-compile \
    --disable-programs --disable-doc --disable-network --disable-everything \
    --disable-avformat --disable-avfilter --disable-avdevice --disable-swscale --disable-swresample \
    --disable-runtime-cpudetect --disable-debug --enable-pic --disable-autodetect --nm=emnm --enable-pthreads --disable-w32threads --disable-os2threads \
    --enable-wasmatomic --disable-websimd128 --enable-decoder=truehd \
    --extra-cflags="-I$LM/packages/cheap/include -O3 -mno-bulk-memory -no-pthread -mno-sign-ext"
fi
make -j4 libavcodec/libavcodec.a
cp libavcodec/libavcodec.a "$LM/lib/decode/truehd/libavcodec.a"
cd "$LM"
bash build/config.sh "$LM/dist/include"
emcc -O3 --no-entry -Wl,--no-check-features -mno-bulk-memory -no-pthread -mno-sign-ext \
  packages/avcodec/src/clib/decode.c packages/avcodec/src/clib/logger/log.c \
  lib/ffmpeg/lib/libavutil.a lib/ffmpeg/lib/libswresample.a lib/decode/truehd/libavcodec.a \
  -I lib/ffmpeg/include -I packages/cheap/include -I dist/include \
  -s WASM=1 -s FILESYSTEM=0 -s FETCH=0 -s ASSERTIONS=0 -s ALLOW_MEMORY_GROWTH=1 \
  -s IMPORTED_MEMORY=1 -s INITIAL_MEMORY=17367040 -s USE_PTHREADS=0 -s MAIN_MODULE=2 \
  -s SIDE_MODULE=0 -s MALLOC=none -s ERROR_ON_UNDEFINED_SYMBOLS=0 -o dist/decode/truehd.wasm
"$SDK/upstream/bin/wasm-opt" dist/decode/truehd.wasm -o dist/decode/truehd.wasm --all-features --signext-lowering
node packages/cheap/build/wasm-opt.cjs -i dist/decode/truehd.wasm --bss -o dist/decode/truehd.wasm

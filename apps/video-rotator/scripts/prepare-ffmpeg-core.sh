#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
CORE_SOURCE="$ROOT_DIR/node_modules/@ffmpeg/core/dist/umd"
CORE_TARGET="$ROOT_DIR/public/ffmpeg-core"

mkdir -p "$CORE_TARGET"
cp "$CORE_SOURCE/ffmpeg-core.js" "$CORE_TARGET/ffmpeg-core.js"
cp "$CORE_SOURCE/ffmpeg-core.wasm" "$CORE_TARGET/ffmpeg-core.wasm"

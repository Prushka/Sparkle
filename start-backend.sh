#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-"$ROOT_DIR/.env"}"

if [[ -f "$ENV_FILE" ]]; then
	set -a
	# shellcheck source=/dev/null
	source "$ENV_FILE"
	set +a
fi

export ADDR="${ADDR:-:1323}"
export OUTPUT="${OUTPUT:-"$ROOT_DIR/backend/output"}"
export JOBS_CACHE_TTL="${JOBS_CACHE_TTL:-15m}"
export MAX_PFP_BYTES="${MAX_PFP_BYTES:-12000000}"

case "$OUTPUT" in
	/*) ;;
	*) OUTPUT="$ROOT_DIR/$OUTPUT" ;;
esac
export OUTPUT

mkdir -p "$OUTPUT"

cd "$ROOT_DIR/backend"
exec "${GO:-go}" run ./cmd/api

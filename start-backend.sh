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

export PFP_DIR="${PFP_DIR:-"$ROOT_DIR/data/pfp"}"
export MEDIA_CACHE_DIR="${MEDIA_CACHE_DIR:-"$ROOT_DIR/cache/media"}"
export PLEX_AUTH_SESSION_DIR="${PLEX_AUTH_SESSION_DIR:-"$ROOT_DIR/data/plex-auth"}"
case "$PFP_DIR" in /*) ;; *) export PFP_DIR="$ROOT_DIR/$PFP_DIR" ;; esac
case "$MEDIA_CACHE_DIR" in /*) ;; *) export MEDIA_CACHE_DIR="$ROOT_DIR/$MEDIA_CACHE_DIR" ;; esac
case "$PLEX_AUTH_SESSION_DIR" in /*) ;; *) export PLEX_AUTH_SESSION_DIR="$ROOT_DIR/$PLEX_AUTH_SESSION_DIR" ;; esac

cd "$ROOT_DIR/backend"
exec "${GO:-go}" run ./cmd/api

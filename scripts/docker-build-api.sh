#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${SPARKLE_API_IMAGE:-meinya/sparkle-api}"
PLATFORM="${PLATFORM:-linux/amd64}"

GIT_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
GIT_TAG="$GIT_COMMIT"
if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
	GIT_TAG="${GIT_TAG}-dirty"
fi

docker buildx build \
	--platform "$PLATFORM" \
	--build-arg "GIT_COMMIT=$GIT_COMMIT" \
	--build-arg "GIT_VERSION=$GIT_TAG" \
	--tag "$IMAGE:latest" \
	--tag "$IMAGE:$GIT_TAG" \
	--push \
	--file "$ROOT_DIR/backend/Dockerfile" \
	"$ROOT_DIR/backend"

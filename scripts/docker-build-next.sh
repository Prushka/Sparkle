#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${SPARKLE_NEXT_IMAGE:-meinya/sparkle-next}"
PLATFORM="${PLATFORM:-linux/amd64}"

GIT_COMMIT="$(git -C "$ROOT_DIR" rev-list -1 HEAD)"
GIT_VERSION="$(git -C "$ROOT_DIR" describe --tags --dirty --always)"

docker buildx build \
	--platform "$PLATFORM" \
	--build-arg "GIT_COMMIT=$GIT_COMMIT" \
	--build-arg "GIT_VERSION=$GIT_VERSION" \
	--tag "$IMAGE:latest" \
	--tag "$IMAGE:$GIT_VERSION" \
	--push \
	--file "$ROOT_DIR/Dockerfile" \
	"$ROOT_DIR"

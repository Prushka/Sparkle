#!/usr/bin/env bash
set -euo pipefail

# Only disposable fixtures are mounted. Never pass the developer's .env or media roots.
: "${LOCAL_API_IMAGE:?Set LOCAL_API_IMAGE to the built API image}"
: "${LOCAL_NEXT_IMAGE:?Set LOCAL_NEXT_IMAGE to the built frontend image}"
fixture_dir="$(mktemp -d)"
network="sparkle-ci-${GITHUB_RUN_ID:-local}-$$"
api="$network-api"
frontend="$network-next"
cleanup() {
  local status=$?
  if (( status != 0 )); then
    docker logs "$api" || true
    docker logs "$frontend" || true
  fi
  docker rm -f "$frontend" "$api" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$fixture_dir"
  return "$status"
}
trap cleanup EXIT

mkdir -p "$fixture_dir/output"
printf 'sparkle-container-range-fixture\n' > "$fixture_dir/output/ci-probe.txt"
# A user-defined bridge permits the host browser to reach the published frontend port.
# Docker's internal-only networks disable port publishing on current engines.
docker network create "$network" >/dev/null
docker run -d --name "$api" --network "$network" --network-alias sparkle-api \
  --read-only --tmpfs /data/pfp --tmpfs /cache/media \
  --mount "type=bind,source=$fixture_dir/output,target=/data/output,readonly" \
  "$LOCAL_API_IMAGE" >/dev/null
docker run -d --name "$frontend" --network "$network" -p 127.0.0.1::3000 \
  -e SERVER_BE=/be -e SERVER_STATIC=/static \
  -e SERVER_INTERNAL_BE=http://sparkle-api:1323 \
  -e SERVER_INTERNAL_STATIC=http://sparkle-api:1323/static \
  "$LOCAL_NEXT_IMAGE" >/dev/null

test "$(docker exec "$frontend" id -u)" = '1001'
port="$(docker port "$frontend" 3000/tcp)"
export SPARKLE_TEST_URL="http://$port"
for attempt in {1..60}; do
  if curl --fail --silent "$SPARKLE_TEST_URL/api/runtime-env" >/dev/null; then
    break
  fi
  if (( attempt == 60 )); then
    echo 'Frontend did not become ready within 60 seconds.' >&2
    exit 1
  fi
  sleep 1
done
node scripts/ci/smoke-images.mjs

# These synthetic tests need no private Plex catalog, credentials or media fixtures.
SPARKLE_TEST_CHANNEL=chrome npx playwright test \
  tests/e2e/library.spec.ts tests/e2e/room-layout.spec.ts tests/e2e/raw.spec.ts \
  --grep 'Library|virtualized|million-item|room controls'
echo 'Both containers passed API/proxy, range, player asset and browser smoke tests.'

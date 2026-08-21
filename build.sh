#!/usr/bin/env bash
set -euo pipefail

# Run with Bash (./build.sh or bash build.sh), not sh; BASH_SOURCE is Bash-specific.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec "$ROOT_DIR/scripts/docker-build-all.sh"

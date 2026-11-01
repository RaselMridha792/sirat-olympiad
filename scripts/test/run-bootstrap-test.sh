#!/usr/bin/env bash
# bootstrap.sh's tests (bootstrap.test.sh) in a throwaway ubuntu:24.04 container: no Docker socket, no network ports,
# removed at the end. It clones this checkout's HEAD, so commit first. About 2 minutes (apt).
# Usage: bash scripts/test/run-bootstrap-test.sh   (CI's checks job runs it)
set -euo pipefail
cd "$(dirname "$0")/../.."
dk() { MSYS_NO_PATHCONV=1 docker "$@"; }
hostpath() { if command -v cygpath > /dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/in"
git bundle create "$tmp/in/repo.bundle" HEAD 2> /dev/null
dk run --rm \
  -v "$(hostpath "$PWD"):/src:ro" \
  -v "$(hostpath "$tmp"):/work" \
  -e SRC=/src -e WORK=/work \
  ubuntu:24.04 bash /src/scripts/test/bootstrap.test.sh

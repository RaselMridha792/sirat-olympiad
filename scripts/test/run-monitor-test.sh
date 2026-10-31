#!/usr/bin/env bash
# Runs scripts/test/monitor.test.sh in a throwaway container with bash, GNU coreutils and flock. Every command
# monitor.sh calls is faked there: no Docker socket, no network. Used locally and in CI's docker job.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST_ROOT="$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*)
    export MSYS_NO_PATHCONV=1
    HOST_ROOT="$(cd "$ROOT" && pwd -W)"
    ;;
esac
exec docker run --rm -v "$HOST_ROOT:/repo:ro" -w /repo alpine:3.20 sh -c '
  apk add --no-cache -q bash coreutils util-linux >/dev/null && bash scripts/test/monitor.test.sh'

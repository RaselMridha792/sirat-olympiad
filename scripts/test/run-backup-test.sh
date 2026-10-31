#!/usr/bin/env bash
# Runs scripts/test/backup.test.sh in a throwaway container that has the tools it needs (age, rclone, the Docker CLI)
# and talks to this machine's Docker through its socket. The test starts and removes its own compose project,
# sirat-backup-test (one Postgres, no ports); nothing else is touched. Used locally and in CI's docker job.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOST_ROOT="$ROOT"
case "$(uname -s)" in
  MINGW* | MSYS*) # Git Bash: Docker wants a Windows path for the bind mount, and no path rewriting
    export MSYS_NO_PATHCONV=1
    HOST_ROOT="$(cd "$ROOT" && pwd -W)"
    ;;
esac
exec docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HOST_ROOT:/repo:ro" -w /repo \
  alpine:3.20 sh -c '
    apk add --no-cache -q bash age rclone docker-cli docker-cli-compose coreutils util-linux >/dev/null &&
    bash scripts/test/backup.test.sh'

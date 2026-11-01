#!/usr/bin/env bash
# The L9 deploy rehearsal without the VPS (LAUNCH-PLAN section 2, RUNBOOK section 2): project sirat-rh in its own clone
# inside a Docker volume (real Linux file modes), driven from an Alpine tools container on this Docker daemon; the
# steps are in deploy-rehearsal.sh. Release A is this checkout's HEAD, so commit first.
# Announce it before running: image builds take CPU for about 30-50 minutes, the stack 1.5-2 GB of RAM, and nginx
# listens on 127.0.0.1:18080/18443. It never touches project sirat. Everything it made is removed at the end.
# Usage: bash scripts/test/run-deploy-rehearsal.sh   (docker and git; Git Bash on Windows works)
set -euo pipefail
cd "$(dirname "$0")/../.."
# Git Bash on Windows: docker gets container paths as written (dk); host paths are converted as usual.
dk() { MSYS_NO_PATHCONV=1 docker "$@"; }
hostpath() { if command -v cygpath > /dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

P=sirat-rh
VOL=sirat-rh-clone
TOOLS=sirat-rh-tools
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "rehearsal: commit first (release A is HEAD)" >&2; exit 2; }
if [ -n "$(dk ps -aq --filter "label=com.docker.compose.project=$P")" ] || dk volume inspect "$VOL" > /dev/null 2>&1; then
  echo "rehearsal: project $P or volume $VOL already exists; remove it first" >&2
  exit 2
fi
# The clone lives where the daemon keeps the volume, and is mounted at that same path in the tools container, so the
# compose files' relative bind mounts (./nginx and so on) name a path the daemon has.
MOUNT="$(dk info --format '{{.DockerRootDir}}')/volumes/$VOL/_data"
tmp=$(mktemp -d)
mkdir -p "$tmp/in" "$tmp/out"
cleanup() {
  echo "rehearsal: cleaning up"
  dk rm -f "$TOOLS" > /dev/null 2>&1 || true
  dk compose -p "$P" down -v --remove-orphans > /dev/null 2>&1 || true
  for c in $(dk ps -aq --filter "label=com.docker.compose.project=$P"); do dk rm -f "$c" > /dev/null 2>&1 || true; done
  for v in $(dk volume ls -q --filter "label=com.docker.compose.project=$P"); do dk volume rm "$v" > /dev/null 2>&1 || true; done
  dk network rm "${P}_default" > /dev/null 2>&1 || true
  if [ -f "$tmp/out/shas" ]; then
    while read -r sha; do
      for r in migrate api worker web; do dk image rm -f "sirat-$r:$sha" > /dev/null 2>&1 || true; done
    done < "$tmp/out/shas"
  fi
  dk volume rm "$VOL" > /dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

git bundle create "$tmp/in/rh.bundle" HEAD refs/remotes/origin/main 2> /dev/null
dk volume create "$VOL" > /dev/null
dk run --rm --name "$TOOLS" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$VOL:$MOUNT" \
  -v "$(hostpath "$tmp/in"):/work/in:ro" \
  -v "$(hostpath "$tmp/out"):/work/out" \
  -v "$(hostpath "$PWD/scripts/test/deploy-rehearsal.sh"):/work/rehearsal.sh:ro" \
  -e CLONE_DIR="$MOUNT/sirat" -e OUT=/work/out \
  alpine:3.22 sh -c 'apk add --no-cache -q bash git curl jq util-linux coreutils findutils openssl ca-certificates su-exec \
    docker-cli docker-cli-compose docker-cli-buildx > /dev/null && bash /work/rehearsal.sh'

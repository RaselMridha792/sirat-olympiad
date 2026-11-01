#!/usr/bin/env bash
# L7's restore round trip (restore-roundtrip.sh) on this Docker daemon, from an Alpine tools container: projects
# sirat-drill-src and sirat-drill, the drill's ports on 127.0.0.1:18180 and 18125, the sirat-*:latest images (never a
# build), a clone of this checkout's HEAD in a Docker volume (so compose's relative bind mounts name a path the daemon
# has). Everything it made is removed at the end. Announce it on a shared machine (about 1.5 GB of RAM for a minute or
# two). Usage: bash scripts/test/run-restore-roundtrip.sh   (CI's docker job runs it, after the stack's build)
set -euo pipefail
cd "$(dirname "$0")/../.."
dk() { MSYS_NO_PATHCONV=1 docker "$@"; }
hostpath() { if command -v cygpath > /dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
VOL=sirat-drill-clone
TOOLS=sirat-drill-tools
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "round trip: commit first (it clones HEAD)" >&2; exit 2; }
for p in sirat-drill sirat-drill-src; do
  [ -z "$(dk ps -aq --filter "label=com.docker.compose.project=$p")" ] || { echo "round trip: project $p exists; remove it first" >&2; exit 2; }
done
MOUNT="$(dk info --format '{{.DockerRootDir}}')/volumes/$VOL/_data"
tmp=$(mktemp -d)
cleanup() {
  dk rm -f "$TOOLS" > /dev/null 2>&1 || true
  for p in sirat-drill sirat-drill-src; do
    for c in $(dk ps -aq --filter "label=com.docker.compose.project=$p"); do dk rm -f "$c" > /dev/null 2>&1 || true; done
    for v in $(dk volume ls -q --filter "label=com.docker.compose.project=$p"); do dk volume rm "$v" > /dev/null 2>&1 || true; done
    dk network rm "${p}_default" > /dev/null 2>&1 || true
  done
  dk volume rm "$VOL" > /dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
git bundle create "$tmp/repo.bundle" HEAD 2> /dev/null
# The single-quoted script runs in the tools container, which expands it.
# shellcheck disable=SC2016
dk volume create "$VOL" > /dev/null
dk run --rm --name "$TOOLS" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$VOL:$MOUNT" \
  -v "$(hostpath "$tmp"):/work/in:ro" \
  -e CLONE_DIR="$MOUNT/sirat" -e OUT=/work/out \
  alpine:3.22 sh -c 'apk add --no-cache -q bash git curl jq coreutils age docker-cli docker-cli-compose > /dev/null &&
    mkdir -p /work/out && git clone -q /work/in/repo.bundle "$CLONE_DIR" && bash "$CLONE_DIR/scripts/test/restore-roundtrip.sh"'

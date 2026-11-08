#!/usr/bin/env bash
# The VPS load kit's rehearsal (load-staging-rehearsal.sh) on this Docker daemon, from an Alpine tools container: project
# sirat-staging with nginx on 127.0.0.1:18088, the sirat-*:$SIRAT_TAG images (they must exist: the kit never builds
# them), a clone of this checkout's HEAD in a Docker volume (so compose's relative bind mounts name a path the daemon
# has). Everything it made is removed at the end, payments' fake image included. Announce it on a shared machine: it
# runs the whole stack and k6 for about ten minutes.
# Usage: SIRAT_TAG=<tag> [PARTS="exam registration"] bash scripts/test/run-load-staging-rehearsal.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${SIRAT_TAG:?SIRAT_TAG names the images to rehearse with (never latest on a shared machine)}"
dk() { MSYS_NO_PATHCONV=1 docker "$@"; }
hostpath() { if command -v cygpath > /dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
P=sirat-staging
VOL=sirat-staging-clone
TOOLS=sirat-staging-tools
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "rehearsal: commit first (it clones HEAD)" >&2; exit 2; }
[ -z "$(dk ps -aq --filter "label=com.docker.compose.project=$P")" ] || { echo "rehearsal: project $P exists; remove it first" >&2; exit 2; }
for s in migrate api worker web; do
  dk image inspect "sirat-$s:$SIRAT_TAG" > /dev/null 2>&1 || { echo "rehearsal: image sirat-$s:$SIRAT_TAG is missing" >&2; exit 2; }
done
MOUNT="$(dk info --format '{{.DockerRootDir}}')/volumes/$VOL/_data"
tmp=$(mktemp -d)
cleanup() {
  dk rm -f "$TOOLS" "$P-k6" > /dev/null 2>&1 || true
  for c in $(dk ps -aq --filter "label=com.docker.compose.project=$P"); do dk rm -f "$c" > /dev/null 2>&1 || true; done
  for v in $(dk volume ls -q --filter "label=com.docker.compose.project=$P"); do dk volume rm "$v" > /dev/null 2>&1 || true; done
  dk network rm "${P}_default" > /dev/null 2>&1 || true
  dk image rm -f "sirat-fake-paystation:$SIRAT_TAG" > /dev/null 2>&1 || true
  dk volume rm "$VOL" > /dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT
git bundle create "$tmp/repo.bundle" HEAD 2> /dev/null
dk volume create "$VOL" > /dev/null
# The single-quoted script runs in the tools container, which expands it.
# shellcheck disable=SC2016
dk run --rm --name "$TOOLS" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$VOL:$MOUNT" \
  -v "$(hostpath "$tmp"):/work/in:ro" \
  -e CLONE_DIR="$MOUNT/sirat" -e OUT=/work/out -e TAG="$SIRAT_TAG" -e PARTS="${PARTS:-exam registration}" \
  alpine:3.22 sh -c 'apk add --no-cache -q bash git coreutils iproute2 docker-cli docker-cli-compose > /dev/null &&
    mkdir -p /work/out && git clone -q /work/in/repo.bundle "$CLONE_DIR" && bash "$CLONE_DIR/scripts/test/load-staging-rehearsal.sh"'

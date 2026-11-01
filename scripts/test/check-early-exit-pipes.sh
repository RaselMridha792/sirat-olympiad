#!/usr/bin/env bash
# Under `set -o pipefail`, a pipe into a reader that stops early (grep -q, grep -m, head, awk ... exit) fails at
# random: the reader may quit while the writer is still writing, the writer dies of SIGPIPE (exit 141), and the
# whole pipeline counts as failed. backup.sh's age check failed an intact copy that way (2026-11-01, about once in
# 3000 runs). Every shell script in git that sets pipefail is checked; comments are skipped.
# Instead: a here-string (grep -q x <<< "$v"), a comparison ([ "$(head -c 21 f)" = ... ]), or `sed -n 1p`, which reads
# to the end. `head -n -N` reads everything and is allowed.
# Usage: bash scripts/test/check-early-exit-pipes.sh   (CI's checks job runs it)
set -euo pipefail
cd "$(dirname "$0")/../.."

EARLY='\|[[:space:]]*(grep[[:space:]]+-[a-zA-Z]*[qm]|grep[[:space:]][^|]*[[:space:]]-m[[:space:]]*[0-9]|head([[:space:]]|$)|awk[[:space:]][^|]*[^a-z_]exit[^a-z_])'
found=0
while IFS= read -r f; do
  grep -q 'pipefail' "$f" || continue
  hits=$(grep -nE "$EARLY" "$f" | grep -vE '^[0-9]+:[[:space:]]*#' | grep -vE '\|[[:space:]]*head[[:space:]]+-n[[:space:]]+-' || true)
  if [ -n "$hits" ]; then
    while IFS= read -r hit; do printf '%s:%s\n' "$f" "$hit"; done <<< "$hits"
    found=1
  fi
done < <(git ls-files '*.sh')

if [ "$found" = 1 ]; then
  echo "check-early-exit-pipes: a pipe into an early-exiting reader under pipefail (see the comment at the top)" >&2
  exit 1
fi
echo "check-early-exit-pipes: none"

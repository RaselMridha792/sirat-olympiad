#!/usr/bin/env bash
# The pre-push hook (scripts/git-hooks/pre-push) in throwaway repositories: a normal push passes; a commit that touches
# reference/ or descends from the old history is refused; a branch delete passes; a clone without the old root passes.
# The old root is a stand-in (SIRAT_OLD_HISTORY_ROOT), never the real one. CI runs this in its checks job.
set -uo pipefail
HOOK=$(cd "$(dirname "$0")/../git-hooks" && pwd)/pre-push
W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
fails=0
pass() { echo "  ok    $1"; }
fail() { echo "  FAIL  $1"; fails=$((fails + 1)); }
ZERO=0000000000000000000000000000000000000000

git init -q --bare "$W/remote.git"
git init -q "$W/repo"
cd "$W/repo" || exit 1
git config user.email t@test.invalid
git config user.name test
git config commit.gpgsign false
git config core.autocrlf false
git remote add origin "$W/remote.git"
echo one > a.txt && git add a.txt && git commit -qm one
git push -q origin HEAD:refs/heads/main
git fetch -q origin
base=$(git rev-parse HEAD)

hook() { printf 'HEAD %s refs/heads/x %s\n' "$1" "$2" | SIRAT_OLD_HISTORY_ROOT="${3:-$ZERO}" "$HOOK" origin "$W/remote.git" 2> "$W/err"; }

echo two > a.txt && git commit -qam two
hook "$(git rev-parse HEAD)" "$base" && pass "a normal commit passes" || fail "a normal commit passes"

git switch -q -c ref "$base"
mkdir -p reference && echo secret > reference/x.txt && git add reference && git commit -qm "adds reference"
ref_tip=$(git rev-parse HEAD)
if hook "$(git rev-parse HEAD)" "$base"; then fail "a commit adding reference/ is refused"; else
  grep -q 'touches reference/' "$W/err" && pass "a commit adding reference/ is refused" || fail "the refusal names reference/"
fi
if hook "$(git rev-parse HEAD)" "$ZERO"; then fail "... also as a new branch"; else pass "... also as a new branch"; fi

git switch -q --orphan old
echo old > o.txt && git add o.txt && git commit -qm "old root"
old_root=$(git rev-parse HEAD)
echo later > o.txt && git commit -qam "old later"
old_tip=$(git rev-parse HEAD)
if hook "$(git rev-parse HEAD)" "$ZERO" "$old_root"; then fail "a descendant of the old root is refused"; else
  grep -q 'old history' "$W/err" && pass "a descendant of the old root is refused" || fail "the refusal names the old history"
fi
git switch -q main 2> /dev/null || git switch -q -c main "$base"
hook "$(git rev-parse HEAD)" "$base" "$old_root" && pass "a branch that does not descend from it passes" ||
  fail "a branch that does not descend from it passes"
hook "$(git rev-parse HEAD)" "$base" 1234567890123456789012345678901234567890 &&
  pass "a clone that never saw the old root passes" || fail "a clone that never saw the old root passes"
printf 'refs/heads/gone %s refs/heads/gone %s\n' "$ZERO" "$base" | "$HOOK" origin "$W/remote.git" &&
  pass "deleting a remote branch passes" || fail "deleting a remote branch passes"

# The private archive holds the old history and reference/ by design: its exact URLs pass, nothing else does.
hook_to() { printf 'HEAD %s refs/heads/x %s\n' "$2" "$3" | SIRAT_OLD_HISTORY_ROOT="${4:-$ZERO}" "$HOOK" archive "$1" 2> "$W/err"; }
hook_to https://github.com/RaselMridha792/sirat-olympiad-archive.git "$old_tip" "$ZERO" "$old_root" &&
  pass "the archive (https) takes the old history" || fail "the archive (https) takes the old history"
hook_to git@github.com:RaselMridha792/sirat-olympiad-archive.git "$ref_tip" "$base" &&
  pass "the archive (ssh) takes reference/" || fail "the archive (ssh) takes reference/"
if hook_to https://github.com/RaselMridha792/sirat-olympiad.git "$old_tip" "$ZERO" "$old_root"; then
  fail "the public repository still refuses the old history"
else pass "the public repository still refuses the old history"; fi
if hook_to https://github.com/RaselMridha792/sirat-olympiad-archive-x.git "$ref_tip" "$base"; then
  fail "a look-alike archive URL still gets both checks"
else pass "a look-alike archive URL still gets both checks"; fi

# Through git itself: core.hooksPath in this throwaway repository only.
mkdir -p "$W/hooks" && cp "$HOOK" "$W/hooks/pre-push" && chmod +x "$W/hooks/pre-push"
git config core.hooksPath "$W/hooks"
git switch -q main 2> /dev/null || true
echo three > a.txt && git commit -qam three
git push -q origin HEAD:refs/heads/main 2> "$W/err" && pass "git push runs the hook, a normal push goes through" ||
  fail "git push runs the hook, a normal push goes through"
git switch -q ref
if git push -q origin HEAD:refs/heads/ref 2> "$W/err"; then fail "git push refuses the reference/ branch"; else
  grep -q 'REFUSED' "$W/err" && pass "git push refuses the reference/ branch" || fail "git push refusal message"
fi
[ -z "$(git --git-dir="$W/remote.git" branch --list ref)" ] && pass "and the remote never got it" || fail "and the remote never got it"

echo "pre-push hook test: $fails failed"
[ "$fails" = 0 ]

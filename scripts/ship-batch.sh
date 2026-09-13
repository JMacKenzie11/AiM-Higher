#!/usr/bin/env bash
#
# scripts/ship-batch.sh — commit, rebase, verify, push, in that order,
# stopping at the first failure.
#
# WHY THIS EXISTS. The sequence commit → rebase → test → push was run
# as one `&&` chain during F8 batch 6e. The rebase hit a conflict, and
# every later step ran anyway on a conflicted tree: the suite reported
# 1243 passing from a file with conflict markers in it, and the push
# sent the pre-rebase commit. Nothing reached main, and the repair
# cost more than the chain saved.
#
# `&&` does stop on a non-zero exit. `git rebase` returning non-zero on
# a conflict is not the problem either. The problem is that a shell
# chain typed in a hurry is the wrong place to encode a sequence with a
# recoverable middle step, because the recovery leaves the working tree
# in a state the rest of the chain was never written for.
#
# So: one script, one order, explicit stops, and a refusal to push
# anything that has not just been verified in the state it will be
# pushed in.
#
#   scripts/ship-batch.sh "commit message file"
#
# It does NOT open a PR and it does NOT merge. Those stay manual.

set -Eeuo pipefail

fail() { printf '\n  %s\n\n' "$*" >&2; exit 1; }

[[ $# -eq 1 ]] || fail "usage: scripts/ship-batch.sh <commit-message-file>"
message_file="$1"
[[ -f "$message_file" ]] || fail "no such message file: $message_file"

branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" != "main" ]] || fail "refusing to run on main."

# ---- 1. commit whatever is staged ------------------------------
if git diff --cached --quiet; then
  printf '  nothing staged; skipping commit\n'
else
  git commit -q -F "$message_file"
  printf '  committed on %s\n' "$branch"
fi

git diff --quiet || fail "unstaged changes remain. Stage or stash them; a
  half-staged tree is two claims sharing one commit."

# ---- 2. rebase onto main, and STOP if it conflicts -------------
git fetch -q origin
if ! git rebase origin/main; then
  git rebase --abort >/dev/null 2>&1 || true
  fail "rebase onto origin/main conflicts, and this script will not
  guess at the resolution. Rebase by hand, check that the conflict
  boundary landed between whole entries rather than inside one, then
  run this again. F8 batch 6e lost half of batch 6d's entry to a
  mechanical resolution that looked fine."
fi
printf '  rebased onto origin/main\n'

# ---- 3. verify, in the state that will be pushed ---------------
npm run typecheck
npm test
printf '  typecheck and tests green on the rebased tree\n'

# ---- 4. push --------------------------------------------------
# --force-with-lease because a rebase rewrites the branch, and the
# lease is what makes that safe rather than merely convenient.
git push --force-with-lease -u origin "$branch"
printf '\n  pushed %s. Open the PR by hand, with the harness output in the body.\n\n' "$branch"

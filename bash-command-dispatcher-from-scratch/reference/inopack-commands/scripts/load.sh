#!/usr/bin/env bash
# load.sh — "load": pull the shared integration branches (master / dev / stage)
# from origin in every INOPACK repo, fast-forward only, WITHOUT changing your
# checked-out branch. The "load" half of the cross-machine pair (save.sh is the other).
#
#   - Updates whichever of master / dev / stage actually exist on origin per repo.
#   - A branch that is NOT currently checked out is fast-forwarded via a fetch refspec
#     (no working-tree change).
#   - If one of them IS your current branch, it's fast-forwarded in place — skipped if
#     the tree is dirty, so uncommitted work is never clobbered.
#   - Your feature/fix branch checkout is never changed; you stay where you are.
#   - NEVER silent: each branch reports its real outcome — UPDATED (with the
#     old..new short SHA and the count of new commits), "already up to date", or
#     why it was left alone (dirty / diverged). A branch is only ever announced as
#     updated when its SHA actually moved.
#
# Usage: scripts/load.sh [--reconcile-current]

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPOS=("." "nestjs-inopack-graphql" "react-inopack")
SHARED=("master" "dev" "stage")
reconcile_current=0
case "${1:-}" in
  "") ;;
  --reconcile-current) reconcile_current=1 ;;
  *) echo "usage: load.sh [--reconcile-current]"; exit 2 ;;
esac

for repo in "${REPOS[@]}"; do
  dir="$ROOT/$repo"
  [ -d "$dir/.git" ] || { echo "skip $repo (not a git repo)"; continue; }

  name="$repo"
  if [ "$repo" = "." ]; then
    url="$(git -C "$dir" remote get-url origin 2>/dev/null)"
    name="$(basename "${url%.git}")"
  fi
  echo "======== $name ========"

  git -C "$dir" fetch origin --prune --quiet 2>/dev/null
  cur="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
  dirty="$(git -C "$dir" status --porcelain | grep -c .)"

  for b in "${SHARED[@]}"; do
    git -C "$dir" rev-parse --verify --quiet "origin/$b" >/dev/null || continue  # not on origin
    label=""; [ "$b" = "$cur" ] && label=" (current)"

    # SHA of the local branch BEFORE we touch it (empty if it doesn't exist yet).
    before="$(git -C "$dir" rev-parse --verify --quiet "refs/heads/$b" || true)"

    if [ "$b" = "$cur" ]; then
      if [ "$dirty" != "0" ]; then
        echo "  $b$label — DIRTY, skipped (uncommitted work left untouched)"
        continue
      fi
      if [ "$reconcile_current" = 1 ]; then
        echo "  $b$label — reconciling with origin/$b when needed"
        git -C "$dir" merge --no-edit "origin/$b" || {
          echo "  $b$label — CONFLICT; resolve files, then run save"; exit 1; }
      else
        git -C "$dir" merge --ff-only "origin/$b" >/dev/null 2>&1 || {
        echo "  $b$label — cannot fast-forward (diverged), left as is"; continue; }
      fi
    else
      git -C "$dir" fetch origin "$b:$b" >/dev/null 2>&1 || {
        echo "  $b$label — cannot fast-forward (diverged/local ahead), left as is"; continue; }
    fi

    # SHA AFTER: announce an update only if it actually moved.
    after="$(git -C "$dir" rev-parse --verify --quiet "refs/heads/$b" || true)"
    if [ -z "$before" ]; then
      echo "  $b$label — created locally at ${after:0:7} (tracking origin/$b)"
    elif [ "$before" = "$after" ]; then
      echo "  $b$label — already up to date (${after:0:7})"
    else
      n="$(git -C "$dir" rev-list --count "$before..$after" 2>/dev/null || echo '?')"
      s=s; [ "$n" = 1 ] && s=
      echo "  $b$label — UPDATED ${before:0:7}..${after:0:7} ($n new commit$s)"
    fi
  done

  # Also pull the current branch if it's a feature/fix branch (not already covered above).
  case "$cur" in
    feature/*|fix/*)
      git -C "$dir" rev-parse --verify --quiet "origin/$cur" >/dev/null 2>/dev/null || {
        echo "  $cur (current) — no remote tracking branch, skipped"
        echo "  (staying on: $cur)"; echo; continue
      }
      before="$(git -C "$dir" rev-parse --verify --quiet "refs/heads/$cur" || true)"
      if [ "$dirty" != "0" ]; then
        echo "  $cur (current) — DIRTY, skipped (uncommitted work left untouched)"
      else
        git -C "$dir" merge --ff-only "origin/$cur" >/dev/null 2>&1 && {
          after="$(git -C "$dir" rev-parse --verify --quiet "refs/heads/$cur" || true)"
          if [ "$before" = "$after" ]; then
            echo "  $cur (current) — already up to date (${after:0:7})"
          else
            n="$(git -C "$dir" rev-list --count "$before..$after" 2>/dev/null || echo '?')"
            s=s; [ "$n" = 1 ] && s=
            echo "  $cur (current) — UPDATED ${before:0:7}..${after:0:7} ($n new commit$s)"
          fi
        } || echo "  $cur (current) — cannot fast-forward (diverged), left as is"
      fi
      ;;
  esac

  echo "  (staying on: $cur)"
  echo
done

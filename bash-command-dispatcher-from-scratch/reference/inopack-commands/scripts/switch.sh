#!/usr/bin/env bash
# switch.sh - switch the canonical pair by default, or explicitly enter a paired worktree.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/workspace.sh"
inopack_workspace_resolve
use_worktree=0
if [ "${1:-}" = "--worktree" ]; then use_worktree=1; shift; fi
target="${1:-}"; [ -n "$target" ] || { echo "usage: switch.sh [--worktree] <branch>"; exit 2; }

if [ "$use_worktree" = 1 ]; then
  case "$target" in feature/*|fix/*) ;; *) echo "--worktree accepts only feature/* or fix/* branches"; exit 2 ;; esac
    echo "### ensure paired worktree for $target ###"
    inopack_ensure_branch_worktrees "$target" || exit 1
    wt="$(inopack_worktree_root "$target")"
    echo "Workspace ready: $wt"
    echo "Run: cd $wt"
    exit 0
fi

case "$target" in dev|stage|master|feature/*|fix/*) ;; *)
  echo "switch accepts dev, stage, master, feature/*, or fix/*"; exit 2 ;;
esac

retire_worktree=0
for repo in nestjs-inopack-graphql react-inopack; do
  dir="$ROOT/$repo"
  existing_worktree="$(inopack_branch_worktree_path "$dir" "$target")"
  canonical_path="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null || true)"
  if [ -n "$existing_worktree" ] && [ "$existing_worktree" != "$canonical_path" ]; then
    if [ -n "$(git -C "$existing_worktree" status --porcelain)" ]; then
      echo "$repo: $target has uncommitted work in $existing_worktree"
      echo "Save or clean that worktree, then retry the canonical switch."
      exit 1
    fi
    retire_worktree=1
  fi
done

if [ "$retire_worktree" = 1 ]; then
  echo "### remove clean paired worktree for canonical switch ###"
  inopack_remove_branch_worktrees "$target" || exit 1
fi

echo "### save current canonical code workspace before switching ###"
(cd "$ROOT" && bash "$ROOT/scripts/save.sh" --scope workspace) || exit 1
for repo in nestjs-inopack-graphql react-inopack; do
  dir="$ROOT/$repo"; git -C "$dir" fetch origin --prune --quiet 2>/dev/null
  if git -C "$dir" show-ref --verify --quiet "refs/heads/$target"; then
    git -C "$dir" checkout "$target" || exit 1
  elif git -C "$dir" show-ref --verify --quiet "refs/remotes/origin/$target"; then
    git -C "$dir" checkout -b "$target" --track "origin/$target" || exit 1
  else
    echo "$repo: branch not found: $target"; exit 1
  fi
  # Fast-forward the checked-out branch to origin BEFORE integrating dev. Without
  # this, a stale local branch (routine in the cross-machine flow) merges
  # origin/dev onto an outdated base and conflicts spuriously. No-op for a branch
  # freshly created from origin above; a diverged/ahead branch is left as is with
  # a note rather than aborting the switch (mirrors load.sh).
  if git -C "$dir" show-ref --verify --quiet "refs/remotes/origin/$target"; then
    git -C "$dir" merge --ff-only "origin/$target" >/dev/null 2>&1 \
      || echo "$repo: $target not fast-forwarded to origin/$target (diverged or ahead), left as is"
  fi
  case "$target" in
    feature/*|fix/*)
      git -C "$dir" merge --no-edit origin/dev || { echo "$repo: could not sync origin/dev into $target"; exit 1; }
      ;;
  esac
done
echo "Canonical workspace ready: $ROOT"

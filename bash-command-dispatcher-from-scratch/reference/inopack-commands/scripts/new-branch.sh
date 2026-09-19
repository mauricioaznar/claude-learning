#!/usr/bin/env bash
# new-branch.sh - create a paired feature/fix branch; canonical checkout by default.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/workspace.sh"
inopack_workspace_resolve
REPOS=("nestjs-inopack-graphql" "react-inopack")
type="${1:-}"; shift 2>/dev/null || true
use_worktree=0
if [ "${1:-}" = "--worktree" ]; then use_worktree=1; shift; fi
name="${1:-}"; [ "$#" -gt 0 ] && shift; desc="$*"
case "$type" in
  feature) prefix="feature/"; section="## Features"; sub="features" ;;
  fix) prefix="fix/"; section="## Fixes"; sub="fixes" ;;
  *) echo "usage: new-branch.sh <feature|fix> [--worktree] <name> [description]"; exit 2 ;;
esac
[ -n "$name" ] || { echo "branch name is required"; exit 2; }
branch="$prefix$name"

echo "### save current code workspace before branching ###"
bash "$ROOT/scripts/save.sh" --scope workspace || exit 1

for repo in "${REPOS[@]}"; do
  dir="$ROOT/$repo"; git -C "$dir" fetch origin --prune --quiet 2>/dev/null
  if git -C "$dir" show-ref --verify --quiet "refs/heads/$branch"; then
    echo "$repo: branch already exists locally"
  elif git -C "$dir" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    git -C "$dir" branch --track "$branch" "origin/$branch"
    echo "$repo: created tracking branch"
  else
    git -C "$dir" rev-parse --verify --quiet origin/dev >/dev/null || { echo "$repo: origin/dev missing"; exit 1; }
    git -C "$dir" branch "$branch" origin/dev
    echo "$repo: created from origin/dev"
  fi
done

if [ "$use_worktree" = 1 ]; then
  echo "### create paired worktrees ###"
  inopack_ensure_branch_worktrees "$branch" || exit 1
  workspace="$(inopack_worktree_root "$branch")"
else
  echo "### check out branch in canonical repositories ###"
  for repo in "${REPOS[@]}"; do
    git -C "$ROOT/$repo" checkout "$branch" || exit 1
  done
  workspace="$ROOT"
fi

items="$ROOT/docs/work-items.md"; docdir="$ROOT/docs/$sub/ongoing"; doc="$docdir/${branch//\//-}.md"
if ! grep -q "\[branch: $branch\]" "$items" 2>/dev/null; then
  line="- $branch - ${desc:-(no description yet)} [branch: $branch]"
  tmp="$(mktemp)"; awk -v sec="$section" -v line="$line" '{print} $0==sec&&!done{print line;done=1}' "$items" >"$tmp" && mv "$tmp" "$items"
fi
if [ ! -f "$doc" ]; then
  mkdir -p "$docdir"
  printf '# %s\n\n%s\n\n## Goals\n\n\n## Status\n\n\n## Decisions\n\n\n## Remaining work\n' "$branch" "${desc:-(no description yet)}" > "$doc"
fi

echo "### publish branches from their code workspace ###"
(cd "$workspace" && bash "$ROOT/scripts/save.sh" --scope workspace "chore: start $branch") || exit 1
echo "### publish shared work-item registration ###"
bash "$ROOT/scripts/save.sh" --scope umbrella "chore: start $branch" || exit 1

echo "Work here: $workspace"
if [ "$use_worktree" = 1 ]; then
  echo "Initialize when needed: bash $ROOT/scripts/inopack.sh worktree-init $(basename "$workspace")"
fi

# No PR is opened here: a freshly branched feature/fix is identical to origin/dev
# (the "chore: start" commit only touches umbrella docs, not the code repos), so
# `gh pr create --base dev` would fail with "No commits between dev and <branch>".
# Open the PR later, once the branch has real work — e.g. at ship time.

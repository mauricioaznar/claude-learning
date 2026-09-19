#!/usr/bin/env bash
# worktree-init.sh - bootstrap dependencies for one paired worktree.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/workspace.sh"
inopack_workspace_resolve
slug="${1:-$INOPACK_WORKSPACE_SLUG}"
[ -n "$slug" ] || { echo "usage: worktree-init.sh <feature-or-fix-slug>"; exit 2; }
WT="$ROOT/worktrees/$slug"
GQL="$WT/nestjs-inopack-graphql"; REACT="$WT/react-inopack"
[ -d "$GQL" ] && [ -d "$REACT" ] || { echo "worktree not found: $WT"; exit 1; }

copy_env_files() {
  local source_dir="$1" target_dir="$2" label="$3" source_file target_file
  local copied=0
  shopt -s nullglob
  for source_file in "$source_dir"/.env "$source_dir"/.env.*; do
    target_file="$target_dir/$(basename "$source_file")"
    if [ -e "$target_file" ]; then
      continue
    fi
    cp -p "$source_file" "$target_file"
    echo "  copied $label/$(basename "$source_file")"
    copied=1
  done
  shopt -u nullglob
  [ "$copied" -eq 1 ] || echo "  no missing $label environment files"
}

echo "### local environment files ###"
copy_env_files "$ROOT/nestjs-inopack-graphql" "$GQL" graphql
copy_env_files "$ROOT/react-inopack" "$REACT" react
echo "### graphql dependencies + Prisma client ###"
(cd "$GQL" && npm ci && npm run db:generate)
echo "### react dependencies ###"
(cd "$REACT" && npm ci)

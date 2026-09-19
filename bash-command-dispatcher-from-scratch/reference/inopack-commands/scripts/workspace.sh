#!/usr/bin/env bash
# workspace.sh - shared INOPACK workspace resolution for commands run from the
# umbrella, canonical code checkouts, or a paired worktree.

inopack_workspace_resolve() {
  INOPACK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  INOPACK_CALLER_DIR="$(pwd -P)"
  INOPACK_WORKSPACE_KIND="canonical"
  INOPACK_WORKSPACE_SLUG=""

  case "$INOPACK_CALLER_DIR/" in
    "$INOPACK_ROOT/worktrees/"*)
      local remainder="${INOPACK_CALLER_DIR#"$INOPACK_ROOT/worktrees/"}"
      INOPACK_WORKSPACE_SLUG="${remainder%%/*}"
      [ -n "$INOPACK_WORKSPACE_SLUG" ] || return 1
      INOPACK_WORKSPACE_KIND="worktree"
      ;;
  esac

  if [ "$INOPACK_WORKSPACE_KIND" = "worktree" ]; then
    INOPACK_CODE_DIRS=(
      "$INOPACK_ROOT/worktrees/$INOPACK_WORKSPACE_SLUG/nestjs-inopack-graphql"
      "$INOPACK_ROOT/worktrees/$INOPACK_WORKSPACE_SLUG/react-inopack"
    )
  else
    INOPACK_CODE_DIRS=(
      "$INOPACK_ROOT/nestjs-inopack-graphql"
      "$INOPACK_ROOT/react-inopack"
    )
  fi
}

inopack_workspace_label() {
  if [ "$INOPACK_WORKSPACE_KIND" = "worktree" ]; then
    printf 'worktree:%s' "$INOPACK_WORKSPACE_SLUG"
  else
    printf 'canonical'
  fi
}

inopack_workspace_report_repo() {
  local dir="$1" label="$2"
  [ -d "$dir/.git" ] || [ -f "$dir/.git" ] || { printf '  %-28s not present\n' "$label"; return; }
  local branch dirty
  branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  dirty="$(git -C "$dir" status --porcelain 2>/dev/null | grep -c . || true)"
  [ "$dirty" = "0" ] && dirty="clean" || dirty="$dirty dirty"
  printf '  %-28s %s [%s]\n' "$label" "$branch" "$dirty"
}

inopack_branch_slug() { printf '%s' "${1//\//-}"; }

inopack_worktree_root() {
  printf '%s/worktrees/%s' "$INOPACK_ROOT" "$(inopack_branch_slug "$1")"
}

inopack_branch_worktree_path() {
  local repo_dir="$1" branch="$2"
  git -C "$repo_dir" worktree list --porcelain 2>/dev/null | awk -v ref="refs/heads/$branch" '
    /^worktree / { path=substr($0, 10) }
    $0 == "branch " ref { print path; exit }
  '
}

inopack_ensure_branch_worktrees() {
  local branch="$1" slug wt repo canonical path
  slug="$(inopack_branch_slug "$branch")"
  wt="$INOPACK_ROOT/worktrees/$slug"
  mkdir -p "$wt"
  for repo in nestjs-inopack-graphql react-inopack; do
    canonical="$INOPACK_ROOT/$repo"; path="$wt/$repo"
    [ -d "$canonical/.git" ] || { echo "missing canonical repo: $repo"; return 1; }
    git -C "$canonical" fetch origin --prune --quiet 2>/dev/null
    if ! git -C "$canonical" show-ref --verify --quiet "refs/heads/$branch"; then
      if git -C "$canonical" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
        git -C "$canonical" branch --track "$branch" "origin/$branch" || return 1
      else
        echo "branch not found: $branch ($repo)"; return 1
      fi
    fi
    if [ -d "$path/.git" ] || [ -f "$path/.git" ]; then
      echo "  $repo worktree already exists: $path"
    elif [ -e "$path" ]; then
      echo "worktree path exists but is not a Git worktree: $path"; return 1
    else
      git -C "$canonical" worktree add "$path" "$branch" || return 1
      echo "  created $repo worktree: $path"
    fi
  done
}

inopack_remove_branch_worktrees() {
  local branch="$1" wt repo canonical path
  wt="$(inopack_worktree_root "$branch")"
  for repo in nestjs-inopack-graphql react-inopack; do
    canonical="$INOPACK_ROOT/$repo"; path="$wt/$repo"
    [ -d "$canonical/.git" ] || continue
    if [ -d "$path" ] || [ -f "$path/.git" ]; then
      git -C "$canonical" worktree remove "$path" || return 1
      echo "  removed worktree: $path"
    fi
    git -C "$canonical" worktree prune
  done
  rmdir "$wt" 2>/dev/null || true
}

#!/usr/bin/env bash
# status.sh — branch + working-tree status across all INOPACK repos.
# (Renamed from branch-status.sh.)
#
# Usage:
#   scripts/status.sh             # DEFAULT: umbrella master + each code repo's
#                                 #   current branch vs dev, with uncommitted-file flags
#   scripts/status.sh features    # all feature/* branches (react+graphql) vs dev
#   scripts/status.sh fixes       # all fix/* branches (react+graphql) vs dev
#   scripts/status.sh --no-fetch  # skip the network fetch (combine with a mode)
#
# Baselines: code repos -> origin/dev; umbrella (inopack-claude) -> origin/master.
# "ahead" = commits the branch has that the baseline lacks; "behind" = the reverse.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODE_REPOS=("nestjs-inopack-graphql" "react-inopack")

FETCH=1
MODE=""
for a in "$@"; do
  case "$a" in
    --no-fetch) FETCH=0 ;;
    features|fixes) MODE="$a" ;;
    "") ;;
    *) echo "unknown arg: $a  (use: features | fixes | --no-fetch)"; exit 1 ;;
  esac
done

row() { printf "%-30s %-9s %7s %7s   %s\n" "$1" "$2" "$3" "$4" "$5"; }
fetch_repo() { [ "$FETCH" = 1 ] && git -C "$1" fetch origin --prune --quiet 2>/dev/null; }

dirty_note() { # $1 = dir -> "clean" or "N uncommitted"
  local n; n="$(git -C "$1" status --porcelain | grep -c .)"
  [ "$n" = "0" ] && echo "clean" || echo "$n uncommitted"
}

last_note() { # $1 = dir -> "  last: <subject> (<relative time>)"
  echo "  last: $(git -C "$1" log -1 --format='%s (%cr)' 2>/dev/null | cut -c1-60)"
}

ahead_behind() { # $1 dir, $2 base ref, $3 target ref -> sets globals AHEAD/BEHIND
  local c; c="$(git -C "$1" rev-list --left-right --count "$2...$3" 2>/dev/null)"
  BEHIND="$(echo "$c" | awk '{print $1}')"; AHEAD="$(echo "$c" | awk '{print $2}')"
  BEHIND="${BEHIND:-?}"; AHEAD="${AHEAD:-?}"
}

# ---------- filtered modes: features / fixes ----------
if [ -n "$MODE" ]; then
  [ "$MODE" = "features" ] && prefix="feature/" || prefix="fix/"
  for repo in "${CODE_REPOS[@]}"; do
    dir="$ROOT/$repo"
    [ -d "$dir/.git" ] || { echo "skip $repo (not a git repo)"; continue; }
    fetch_repo "$dir"
    echo "======== $repo  ($MODE vs dev)  [$(dirty_note "$dir")] ========"
    row "BRANCH" "SHA" "AHEAD" "BEHIND" "STATUS"
    branches="$(git -C "$dir" for-each-ref --format='%(refname:short)' refs/remotes/origin \
                | grep -E "^origin/$prefix" | sed 's#^origin/##' | sort -u)"
    if [ -z "$branches" ]; then row "(none)" "-" "-" "-" ""; echo; continue; fi
    for b in $branches; do
      sha="$(git -C "$dir" rev-parse --short "origin/$b")"
      ahead_behind "$dir" "origin/dev" "origin/$b"
      [ "$BEHIND" = "0" ] && st="up to date" || st="NEEDS SYNC (behind $BEHIND)"
      row "$b" "$sha" "$AHEAD" "$BEHIND" "$st"
    done
    echo
  done
  exit 0
fi

# ---------- default view ----------
# Umbrella: local master vs origin/master.
dir="$ROOT"
url="$(git -C "$dir" remote get-url origin 2>/dev/null)"; name="$(basename "${url%.git}")"
fetch_repo "$dir"
cur="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
echo "======== $name (umbrella, on: $cur)  [$(dirty_note "$dir")] ========"
last_note "$dir"
row "BRANCH" "SHA" "AHEAD" "BEHIND" "STATUS"
ahead_behind "$dir" "origin/master" "HEAD"
if   [ "$AHEAD" != "0" ]; then st="UNPUSHED (ahead $AHEAD)"
elif [ "$BEHIND" != "0" ]; then st="BEHIND (pull $BEHIND)"
else st="up to date"; fi
row "$cur" "$(git -C "$dir" rev-parse --short HEAD)" "$AHEAD" "$BEHIND" "$st"
echo

# Code repos (they mirror each other): dev baseline + current branch vs dev.
for repo in "${CODE_REPOS[@]}"; do
  dir="$ROOT/$repo"
  [ -d "$dir/.git" ] || { echo "skip $repo (not a git repo)"; continue; }
  fetch_repo "$dir"
  cur="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
  echo "======== $repo  (on: $cur)  [$(dirty_note "$dir")] ========"
  last_note "$dir"
  row "BRANCH" "SHA" "AHEAD" "BEHIND" "STATUS"
  row "dev" "$(git -C "$dir" rev-parse --short origin/dev 2>/dev/null)" "-" "-" "(baseline)"
  if [ "$cur" != "dev" ] && [ "$cur" != "HEAD" ]; then
    ahead_behind "$dir" "origin/dev" "HEAD"
    [ "$BEHIND" = "0" ] && st="up to date" || st="behind $BEHIND"
    row "$cur" "$(git -C "$dir" rev-parse --short HEAD)" "$AHEAD" "$BEHIND" "$st"
  fi
  echo
done

echo "======== paired worktrees (graphql branch is authoritative) ========"
canonical_graphql="$(git -C "$ROOT/nestjs-inopack-graphql" rev-parse --show-toplevel)"
wt_lines="$(git -C "$ROOT/nestjs-inopack-graphql" worktree list --porcelain 2>/dev/null || true)"
wt_path=""; wt_branch=""
while IFS= read -r line; do
  case "$line" in
    "worktree "*) wt_path="${line#worktree }" ;;
    "branch refs/heads/"*) wt_branch="${line#branch refs/heads/}" ;;
    "")
      if [ -n "$wt_path" ] && [ "$wt_path" != "$canonical_graphql" ]; then
        slug="$(basename "$(dirname "$wt_path")")"
        react_path="$ROOT/worktrees/$slug/react-inopack"
        gd="$(dirty_note "$wt_path")"; rd="$(dirty_note "$react_path")"
        ahead_behind "$wt_path" "origin/dev" "HEAD"
        row "$wt_branch" "worktree" "$AHEAD" "$BEHIND" "graphql:$gd react:$rd"
      fi
      wt_path=""; wt_branch=""
      ;;
  esac
done <<< "$wt_lines"
echo

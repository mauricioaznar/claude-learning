#!/usr/bin/env bash
# save.sh - deliberately commit and push the selected repository scope.
#
# A user-invoked bare save covers all three repositories: the paired code
# workspace resolved from $PWD plus the umbrella. Internal workflows pass an
# explicit narrower scope when they own only code or only shared metadata.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=workspace.sh
source "$ROOT/scripts/workspace.sh"
inopack_workspace_resolve

scope="all"
wip=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --scope) scope="${2:-}"; shift 2 ;;
    --all) scope="all"; shift ;;
    --wip) wip=1; shift ;;
    *) break ;;
  esac
done

case "$scope" in workspace|umbrella|all) ;; *)
  echo "usage: save.sh [--scope workspace|umbrella|all] [message]"; exit 2 ;;
esac

if [ "$wip" = 1 ]; then
  MSG="${*:-wip: workspace snapshot $(date '+%Y-%m-%d %H:%M:%S')}"
else
  MSG="${*:-save: cross-machine snapshot $(date '+%Y-%m-%d %H:%M:%S')}"
fi

bump_patch() {
  local pkg="$1/package.json"
  [ -f "$pkg" ] || return 1
  node -e '
    const fs = require("fs"), p = process.argv[1]; let s = fs.readFileSync(p, "utf8"), out;
    s = s.replace(/("version"\s*:\s*")(\d+)\.(\d+)\.(\d+)(")/,
      (_, a, maj, min, pat, z) => { out = `${maj}.${min}.${+pat + 1}`; return a + out + z; });
    if (!out) process.exit(1); fs.writeFileSync(p, s); process.stdout.write(out);
  ' "$pkg"
}

save_repo() {
  local dir="$1" kind="$2" name target cur newver out
  # Canonical checkouts have a .git directory; linked worktrees have a .git file.
  [ -d "$dir/.git" ] || [ -f "$dir/.git" ] || { echo "skip $dir (not a git repo)"; return; }
  cur="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
  target="$cur"
  name="$(basename "$dir")"; [ "$kind" = "umbrella" ] && name="inopack"
  echo "======== $name ($kind: $cur -> origin/$target) ========"
  if [ -n "$(git -C "$dir" status --porcelain)" ]; then
    if [ "$kind" = "code" ] && [ "$wip" != 1 ]; then
      newver="$(bump_patch "$dir")" && [ -n "$newver" ] && echo "  bumped version -> $newver"
    fi
    git -C "$dir" add -A
    git -C "$dir" commit --quiet -m "$MSG" && echo "  committed: $MSG" || echo "  commit failed"
  else
    echo "  nothing to commit"
  fi
  out="$(git -C "$dir" push origin "HEAD:$target" 2>&1)"
  if [ $? -eq 0 ]; then echo "  pushed $cur -> origin/$target"; else
    echo "  PUSH FAILED for $cur -> origin/$target:"; echo "$out" | sed 's/^/    /'
  fi
}

echo "### save scope: $scope ($(inopack_workspace_label))$( [ "$wip" = 1 ] && printf ' [WIP: no version bump]' ) ###"
case "$scope" in
  workspace) for dir in "${INOPACK_CODE_DIRS[@]}"; do save_repo "$dir" code; done ;;
  umbrella) save_repo "$INOPACK_ROOT" umbrella ;;
  all)
    for dir in "${INOPACK_CODE_DIRS[@]}"; do save_repo "$dir" code; done
    save_repo "$INOPACK_ROOT" umbrella
    ;;
esac

echo "### excluded from this save ###"
excluded=0
case "$scope" in
  workspace)
    inopack_workspace_report_repo "$INOPACK_ROOT" "umbrella"
    excluded=1
    ;;
  umbrella)
    for dir in "${INOPACK_CODE_DIRS[@]}"; do
      inopack_workspace_report_repo "$dir" "$(basename "$dir")"
    done
    excluded=1
    ;;
esac
if [ "$INOPACK_WORKSPACE_KIND" = "worktree" ]; then
  inopack_workspace_report_repo "$INOPACK_ROOT/nestjs-inopack-graphql" "canonical graphql"
  inopack_workspace_report_repo "$INOPACK_ROOT/react-inopack" "canonical react"
  excluded=1
fi
if [ "$excluded" = 0 ]; then echo "  (none)"; fi

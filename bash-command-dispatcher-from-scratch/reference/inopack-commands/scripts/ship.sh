#!/usr/bin/env bash
# ship.sh — "ship into <target>": merge the CURRENT branch (source) into <target>,
# across BOTH code repos, then push <target>. This is the ONLY sanctioned way to
# merge in this project — raw `git merge` is never used.
#
# Allowed transitions ONLY:
#   feature/* | fix/*         ->   dev      (integrate — IRREVERSIBLE; a feature
#                                            also bumps the MINOR version on dev)
#   feature/* | fix/* | dev   ->   stage
#   dev                       ->   master
# Anything else is refused before any git mutation happens.
#
# Versioning: only a feature/* -> dev ship bumps the minor number (x.Y.0) on dev,
# in both code repos; the bump is committed onto dev and pushed. fix/* -> dev does
# NOT bump (fixes are patch-level; patch is owned by save.sh).
#
# Irreversibility: integrating a feature/fix INTO dev cannot be reverted, so a
# -> dev ship prompts for confirmation first. Pass -y / --yes to skip the prompt
# (required when there's no terminal to read from, e.g. an automated run).
#
# The umbrella (inopack-claude) is single-branch (master) and is NOT shipped.
#
# Usage:
#   scripts/ship.sh stage          # merge current branch into stage
#   scripts/ship.sh into master    # the 'into' filler word is accepted
#   scripts/ship.sh dev            # integrate feature/fix into dev (will confirm)
#   scripts/ship.sh -y dev         # skip the irreversible-merge confirmation
#
# Behavior: save.sh first (commit + push the source), then per repo: check out the
# target, fast-forward it to origin, merge the source (--no-edit), [bump minor if
# feature->dev], push the target, and return to the source. Conflicts abort the
# merge and are flagged for manual fix.
#
# Work-item cleanup: a CLEAN feature/* | fix/* -> dev integration retires the work
# item — its ongoing doc (docs/{features,fixes}/ongoing/<branch>.md) moves to the
# matching archived/ folder and its `[branch: ...]` line is dropped from
# docs/work-items.md, so the startup summary stops listing finished work. A trailing
# save.sh commits + pushes that doc cleanup. (Skipped if the ship hit conflicts.)

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/workspace.sh"
inopack_workspace_resolve
REPOS=("nestjs-inopack-graphql" "react-inopack")
SOURCE_DIRS=("${INOPACK_CODE_DIRS[@]}")

# bump_minor <package.json> -> echoes new version (x.Y+1.0), editing only the
# "version" line. Fired when a feature is shipped into dev.
bump_minor() {
  local f="$1" v maj min pat nv
  [ -f "$f" ] || return 1
  v="$(grep -m1 '"version"' "$f" | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')"
  [ -z "$v" ] && return 1
  IFS=. read -r maj min pat <<< "$v"
  nv="$maj.$((min + 1)).0"
  sed -i -E "0,/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]+\"/s//\"version\": \"$nv\"/" "$f"
  echo "$nv"
}

# retire_work_item <src> — after a feature/* | fix/* is integrated into dev, the
# work is done, so stop the startup summary from listing it: move its ongoing doc
# into archived/ and drop its `[branch: <src>]` line from docs/work-items.md. This
# is the exact inverse of new-branch.sh, which created both. Edits the umbrella
# docs only; the trailing save.sh commits + pushes them.
retire_work_item() {
  local src="$1" sub
  case "$src" in
    feature/*) sub="features" ;;
    fix/*)     sub="fixes" ;;
    *) return 0 ;;
  esac
  local items="$ROOT/docs/work-items.md"
  local ongoing="$ROOT/docs/$sub/ongoing"
  local archived="$ROOT/docs/$sub/archived"
  local docname="${src//\//-}.md"   # feature/payroll -> feature-payroll.md

  # 1) move the ongoing doc into archived/
  if [ -f "$ongoing/$docname" ]; then
    mkdir -p "$archived"
    if mv "$ongoing/$docname" "$archived/$docname"; then
      echo "  archived doc: docs/$sub/ongoing/$docname -> docs/$sub/archived/$docname"
    fi
  else
    echo "  (no ongoing doc docs/$sub/ongoing/$docname to archive)"
  fi

  # 2) drop the work-items.md line carrying [branch: <src>] (pinned 📌 reminders
  #    don't carry that tag, so they're safe).
  if [ -f "$items" ] && grep -q "\[branch: $src\]" "$items"; then
    local tmp; tmp="$(mktemp)"
    grep -v "\[branch: $src\]" "$items" > "$tmp" && mv "$tmp" "$items"
    echo "  removed work item: [branch: $src] from docs/work-items.md"
  fi
}

# Parse a leading -y/--yes (skip the irreversible-merge confirmation).
assume_yes=0
case "${1:-}" in -y|--yes) assume_yes=1; shift ;; esac
# Accept "ship into <target>" as well as "ship <target>".
[ "${1:-}" = "into" ] && shift
target="${1:-}"
if [ -z "$target" ]; then
  echo "usage: scripts/ship.sh [-y] [into] <dev|stage|master>"
  exit 1
fi
case "$target" in
  dev|stage|master) ;;
  *) echo "ship target must be 'dev', 'stage' or 'master' (got '$target')"; exit 1 ;;
esac

# Source = current branch. Both code repos must be on the same branch (use switch
# first if they have drifted), so a ship is always coherent across repos.
src=""
for dir in "${SOURCE_DIRS[@]}"; do
  [ -d "$dir/.git" ] || continue
  b="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
  if [ -z "$src" ]; then
    src="$b"
  elif [ "$b" != "$src" ]; then
    echo "code repos are on different branches ($src vs $b) — run 'switch' first. Aborting."
    exit 1
  fi
done
[ -z "$src" ] && { echo "no code repos found. Aborting."; exit 1; }

if [ "$src" = "$target" ]; then
  echo "already on '$target' — nothing to ship."
  exit 1
fi

# Validate the transition.
ok=0
case "$target" in
  dev)    case "$src" in feature/*|fix/*)     ok=1 ;; esac ;;
  stage)  case "$src" in feature/*|fix/*|dev) ok=1 ;; esac ;;
  master) case "$src" in dev)                 ok=1 ;; esac ;;
esac
if [ "$ok" != 1 ]; then
  echo "illegal ship: $src -> $target"
  echo "allowed: feature/*|fix/* -> dev ;  feature/*|fix/*|dev -> stage ;  dev -> master"
  exit 1
fi

# A feature shipped into dev → minor bump. (fix -> dev does not bump.)
bump=0
case "$target/$src" in dev/feature/*) bump=1 ;; esac

# Integrating a feature/fix INTO dev is IRREVERSIBLE — confirm unless -y was given.
if [ "$target" = "dev" ] && [ "$assume_yes" != 1 ]; then
  warn="⚠  Shipping $src -> dev is IRREVERSIBLE: once integrated it cannot be reverted"
  [ "$bump" = 1 ] && warn="$warn, and it bumps the minor version on dev"
  echo "$warn."
  # Probe by actually OPENING the device, not with [ -r /dev/tty ]. That test only
  # stats the node: in a session with no controlling terminal (CI, an agent run) the
  # node exists and looks readable, the test passes, and the read below then dies on
  # "No such device or address" — taking the script down with an unbound $reply
  # instead of printing the -y hint. Opening it for a throwaway command is the only
  # check that tells the truth, and a failed redirection there is contained.
  reply=""
  if { true < /dev/tty; } 2>/dev/null; then
    printf "   Continue? [y/N] "
    read -r reply < /dev/tty || true
    case "$reply" in y|Y|yes|YES) ;; *) echo "Aborted."; exit 1 ;; esac
  else
    echo "   No terminal to confirm on. Re-run with -y to proceed: scripts/ship.sh -y $target"
    exit 1
  fi
fi

echo "### save current work before shipping (save.sh) ###"
bash "$ROOT/scripts/save.sh" --scope workspace
echo

conflicted=()
for repo in "${REPOS[@]}"; do
  dir="$ROOT/$repo"
  [ -d "$dir/.git" ] || { echo "skip $repo (not a git repo)"; continue; }
  echo "======== $repo : $src -> $target ========"
  restore_branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"

  git -C "$dir" fetch origin --prune --quiet 2>/dev/null

  # Check out the target: local branch -> use it; else origin -> tracking copy;
  # else report and skip (never invent a branch).
  if git -C "$dir" show-ref --verify --quiet "refs/heads/$target"; then
    git -C "$dir" checkout --quiet "$target"
  elif git -C "$dir" show-ref --verify --quiet "refs/remotes/origin/$target"; then
    git -C "$dir" checkout --quiet -b "$target" --track "origin/$target"
  else
    echo "  target '$target' not found locally or on origin — skipped"
    git -C "$dir" checkout --quiet "$restore_branch"
    echo
    continue
  fi

  # Merge onto the latest target (ff to origin first; harmless if already current).
  git -C "$dir" merge --ff-only "origin/$target" >/dev/null 2>&1

  echo "  merging $src into $target..."
  if git -C "$dir" merge --no-edit "$src" >/dev/null 2>&1; then
    if [ "$bump" = 1 ]; then
      nv="$(bump_minor "$dir/package.json")" \
        && git -C "$dir" commit --quiet -am "chore: bump minor to $nv ($src shipped to dev)" \
        && echo "    minor bump -> $nv"
    fi
    if git -C "$dir" push origin "$target" >/dev/null 2>&1; then
      echo "    merged + pushed $target -> origin/$target ($(git -C "$dir" rev-parse --short HEAD))"
      # For feature/* | fix/* -> dev, close the matching GitHub PR.
      # We already pushed the merge commit, so GitHub may auto-detect it, but
      # calling gh pr merge explicitly ensures the PR is marked "Merged" (not
      # just "Closed") and handles draft PRs that GitHub won't auto-close.
      if [ "$target" = "dev" ]; then
        remote_url="$(git -C "$dir" remote get-url origin 2>/dev/null)"
        if [ -n "$remote_url" ]; then
          echo "    closing PR for $src..."
          # Draft PRs can't be merged directly — mark ready first, then merge.
          gh pr ready "$src" --repo "$remote_url" 2>/dev/null || true
          gh pr merge "$src" \
            --repo "$remote_url" \
            --merge \
            2>&1 | sed 's/^/    /' \
          || echo "    (no open PR found or already merged — skipping)"
        fi
      fi
    else
      echo "    merged locally, but PUSH FAILED (resolve $target vs origin and retry)"
    fi
  else
    echo "    CONFLICT — aborting, resolve manually"
    git -C "$dir" merge --abort
    conflicted+=("$repo:$src->$target")
  fi

  git -C "$dir" checkout --quiet "$restore_branch"
  echo
done

if [ "${#conflicted[@]}" -gt 0 ]; then
  echo "==== needs manual merge ===="
  printf '  %s\n' "${conflicted[@]}"
  echo
  echo "(work item kept — not archived until the ship completes cleanly)"
else
  echo "Shipped $src -> $target."
  # A clean feature/* | fix/* -> dev integration finishes the work item: archive
  # its ongoing doc and drop its work-items entry, then publish the doc cleanup.
  case "$target/$src" in
    dev/feature/*|dev/fix/*)
      echo
      echo "### retire shipped work item (archive doc + drop work-items entry) ###"
      retire_work_item "$src"
      echo
      echo "### publish doc cleanup (save.sh) ###"
      bash "$ROOT/scripts/save.sh" --scope umbrella "chore: archive $src after shipping to dev"
      ;;
  esac
fi

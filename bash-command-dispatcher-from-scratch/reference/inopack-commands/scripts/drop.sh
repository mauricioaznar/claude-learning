#!/usr/bin/env bash
# drop.sh — remove a feature/ or fix/ branch from both code repos (local +
# origin), close its GitHub PR (if open), archive its work-item and matching
# plan docs, drop its entry from docs/work-items.md, and verify the cleanup.
#
# Use this when:
#   • You shipped the branch and want to clean up the remote (PR is already
#     merged, so `gh pr close` will be a no-op and that's fine).
#   • You're abandoning a branch without shipping it.
#
# It does NOT merge anything. Use `ship into dev` to integrate work; use `drop`
# only to clean up afterward (or to discard).
#
# On remote branches: yes, you should delete them. Origin accumulates branches
# forever otherwise; a merged or abandoned branch has no value on remote once
# the code is in dev (or discarded). Local branches can be pruned manually with
# `git fetch --prune`, but drop cleans the local copy too.
#
# Usage:
#   scripts/drop.sh              # drops the current branch in both code repos
#   scripts/drop.sh feature/foo  # drops an explicit branch
#
# Pass -y / --yes to skip the confirmation prompt (automated runs).

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/workspace.sh"
inopack_workspace_resolve
REPOS=("nestjs-inopack-graphql" "react-inopack")

# ── args ──────────────────────────────────────────────────────────────────────
assume_yes=0
branch_arg=""

for arg in "$@"; do
  case "$arg" in
    -y|--yes) assume_yes=1 ;;
    *)        branch_arg="$arg" ;;
  esac
done

# Resolve target branch: explicit arg → use it; else current branch in first repo.
if [ -n "$branch_arg" ]; then
  branch="$branch_arg"
else
  if [ "$INOPACK_WORKSPACE_KIND" = "worktree" ]; then
    branch="$(git -C "${INOPACK_CODE_DIRS[0]}" rev-parse --abbrev-ref HEAD)"
  else
    for repo in "${REPOS[@]}"; do
      dir="$ROOT/$repo"; [ -d "$dir/.git" ] || continue
      branch="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"; break
    done
  fi
fi

[ -z "${branch:-}" ] && { echo "could not determine branch — pass it explicitly"; exit 1; }

# Only feature/* and fix/* branches can be dropped.
case "$branch" in
  feature/*|fix/*) ;;
  *) echo "drop only works on feature/* or fix/* branches (got '$branch')."; exit 1 ;;
esac

# ── confirmation ──────────────────────────────────────────────────────────────
if [ "$assume_yes" != 1 ]; then
  echo "⚠  Dropping '$branch':"
  echo "     • GitHub PR closed (if open)"
  echo "     • local + remote branch deleted in both code repos"
  echo "     • work-item doc moved to archived/"
  echo "     • entry removed from docs/work-items.md"
  echo "   This cannot be undone."
  # Probe by actually OPENING the device — see the matching note in ship.sh.
  # [ -r /dev/tty ] only stats the node, which passes in a session with no
  # controlling terminal and leaves the read below to die on an unbound $reply.
  reply=""
  if { true < /dev/tty; } 2>/dev/null; then
    printf "   Continue? [y/N] "
    read -r reply < /dev/tty || true
    case "$reply" in y|Y|yes|YES) ;; *) echo "Aborted."; exit 1 ;; esac
  else
    echo "   No terminal. Re-run with -y to proceed: scripts/drop.sh -y $branch"
    exit 1
  fi
fi

echo
echo "### save current work before dropping (save.sh) ###"
bash "$ROOT/scripts/save.sh" --scope workspace
echo

echo "### remove paired worktrees ###"
inopack_remove_branch_worktrees "$branch" || { echo "could not remove worktrees; branch left intact"; exit 1; }
echo

# ── per-repo: close PR, delete local + remote ─────────────────────────────────
for repo in "${REPOS[@]}"; do
  dir="$ROOT/$repo"
  [ -d "$dir/.git" ] || { echo "skip $repo (not a git repo)"; continue; }
  echo "======== $repo : drop $branch ========"

  git -C "$dir" fetch origin --prune --quiet 2>/dev/null
  remote_url="$(git -C "$dir" remote get-url origin 2>/dev/null)"

  # 1) Close GitHub PR (if open). Use `gh pr close` — marks it Closed, not
  #    Merged, which is the honest state for an abandoned branch. If the PR
  #    was already merged (post-ship cleanup) gh will report it; that's fine.
  if [ -n "$remote_url" ]; then
    echo "  closing GitHub PR for $branch..."
    gh pr close "$branch" \
      --repo "$remote_url" \
      --comment "Branch dropped via \`drop\` command." \
      2>&1 | sed 's/^/  /' \
    || echo "  (no open PR or already merged — skipping)"
  fi

  # 2) Switch off the branch onto dev so it can be deleted.
  current="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
  if [ "$current" = "$branch" ]; then
    if git -C "$dir" show-ref --verify --quiet "refs/heads/dev"; then
      git -C "$dir" checkout --quiet dev
    elif git -C "$dir" show-ref --verify --quiet "refs/remotes/origin/dev"; then
      git -C "$dir" checkout --quiet -b dev --track origin/dev
    else
      echo "  cannot find dev to check out — skipping branch deletion for $repo"
      echo
      continue
    fi
    echo "  switched to dev"
  fi

  # 3) Delete local branch.
  if git -C "$dir" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$dir" branch -D "$branch" \
      && echo "  deleted local branch $branch" \
      || echo "  WARNING: could not delete local branch $branch"
  else
    echo "  (no local branch $branch — skipped)"
  fi

  # 4) Delete remote branch.
  if git -C "$dir" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    git -C "$dir" push origin --delete "$branch" \
      && echo "  deleted origin/$branch" \
      || echo "  WARNING: could not delete origin/$branch"
  else
    echo "  (no remote branch origin/$branch — skipped)"
  fi

  echo
done

# ── archive work-item doc + drop work-items.md entry ──────────────────────────
case "$branch" in
  feature/*) sub="features" ;;
  fix/*)     sub="fixes" ;;
esac

items="$ROOT/docs/work-items.md"
ongoing="$ROOT/docs/$sub/ongoing"
archived="$ROOT/docs/$sub/archived"
docname="${branch//\//-}.md"

echo "### retire work item ###"

if [ -f "$ongoing/$docname" ]; then
  mkdir -p "$archived"
  mv "$ongoing/$docname" "$archived/$docname" \
    && echo "  archived: docs/$sub/ongoing/$docname -> docs/$sub/archived/$docname" \
    || echo "  WARNING: could not archive $docname"
else
  echo "  (no ongoing doc docs/$sub/ongoing/$docname — skipped)"
fi

if [ -f "$items" ] && grep -q "\[branch: $branch\]" "$items"; then
  tmp="$(mktemp)"
  grep -v "\[branch: $branch\]" "$items" > "$tmp" && mv "$tmp" "$items"
  echo "  removed [branch: $branch] from docs/work-items.md"
else
  echo "  (no work-items.md entry for $branch — skipped)"
fi

# Plans use the same branch-derived filename but live under docs/plans rather
# than docs/{features,fixes}. A retired feature must not remain listed as an
# ongoing plan after its branch is removed.
plan_ongoing="$ROOT/docs/plans/ongoing/$docname"
plan_archived="$ROOT/docs/plans/archived/$docname"
plan_slug="${docname%.md}"
if [ -f "$plan_ongoing" ]; then
  mkdir -p "$(dirname "$plan_archived")"
  mv "$plan_ongoing" "$plan_archived" \
    && echo "  archived plan: docs/plans/ongoing/$docname -> docs/plans/archived/$docname" \
    || echo "  WARNING: could not archive plan $docname"
elif [ -f "$plan_archived" ]; then
  echo "  plan already archived: docs/plans/archived/$docname"
else
  echo "  (no ongoing or archived plan for $branch — skipped)"
fi

# Archiving the plan is the whole cleanup: summary.sh lists docs/plans/ongoing/
# directly, so a plan disappears from the summary the moment it leaves that folder.

echo
echo "### verify branch and documentation cleanup ###"
verification_failed=0
for repo in "${REPOS[@]}"; do
  dir="$ROOT/$repo"
  [ -d "$dir/.git" ] || continue
  if git -C "$dir" show-ref --verify --quiet "refs/heads/$branch"; then
    echo "  ERROR: local branch remains in $repo: $branch"
    verification_failed=1
  fi
  if git -C "$dir" show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    echo "  ERROR: stale origin/$branch ref remains locally in $repo"
    verification_failed=1
  fi
  if git -C "$dir" ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
    echo "  ERROR: remote branch remains in origin/$repo: $branch"
    verification_failed=1
  fi
done

# Only "still ongoing" is a failure. A branch need not have a plan document at
# all, and one that grew out of a differently-named plan (feature/activities-audit
# superseded activity-changeset.md) archives that plan under its own name — so a
# missing docs/plans/archived/$docname is normal, not a cleanup error.
if [ -f "$plan_ongoing" ]; then
  echo "  ERROR: plan remains ongoing: docs/plans/ongoing/$docname"
  verification_failed=1
elif [ -f "$plan_archived" ]; then
  echo "  verified archived plan: docs/plans/archived/$docname"
else
  echo "  no plan document for $branch — nothing to archive"
fi

if [ -f "$ongoing/$docname" ]; then
  echo "  ERROR: feature work-item doc remains ongoing: docs/$sub/ongoing/$docname"
  verification_failed=1
elif [ -f "$archived/$docname" ]; then
  echo "  verified archived work-item doc: docs/$sub/archived/$docname"
else
  echo "  ERROR: archived work-item doc is missing: docs/$sub/archived/$docname"
  verification_failed=1
fi

if grep -q "\[branch: $branch\]" "$items" 2>/dev/null; then
  echo "  ERROR: work-items registration remains for $branch"
  verification_failed=1
else
  echo "  verified work-items registration removed"
fi

# Priority is embedded in the plan file — archiving it is sufficient.

echo
echo "### publish doc cleanup (save.sh) ###"
bash "$ROOT/scripts/save.sh" --scope umbrella "chore: drop $branch"

if [ "$verification_failed" != 0 ]; then
  echo "drop verification failed; inspect the errors above."
  exit 1
fi

echo "drop verification passed: local/remote branches removed and plan archived."

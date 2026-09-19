#!/usr/bin/env bash
# summary.sh — startup orientation (SessionStart hook + "summary" command). In order:
#   - features (docs/features/ongoing/)
#   - fixes    (docs/fixes/ongoing/)
#   - todos    (docs/work-items.md ## Todos)
#   - plans    (docs/plans/ongoing/, grouped by their `Category:` marker)
#   - per-repo status: current branch, dirty count, unpushed/behind warnings, last commit
#   - command vocabulary (see docs/commands.md)
#   - working preferences
# Uses local refs only (no network) so startup stays fast; status.sh fetches for the
# authoritative table. Keep output short.
set -u

# Read-only orientation: never let a `git status` refresh write .git/index.lock.
# Without this, this hook and the per-prompt statusline (both run `git status`
# across all three repos) race on the lock on Windows, where file locks are
# mandatory — intermittently stalling past the 30s SessionStart hook timeout.
export GIT_OPTIONAL_LOCKS=0

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ITEMS="$ROOT/docs/work-items.md"
CODE_REPOS=("nestjs-inopack-graphql" "react-inopack")

echo "── INOPACK session orientation ──"

# ---- Features (docs/features/ongoing/) ----
list_docs() { # $1 = dir
  local dir="$1"
  [ -d "$dir" ] || return 0
  local files; files="$(ls "$dir"/*.md 2>/dev/null)"
  [ -z "$files" ] && return 0
  for f in $files; do
    # First non-empty line that isn't a heading (#), blockquote (>), frontmatter
    # (---), bold (**), or a markdown table row (|). Table rows are excluded because
    # a generated doc that opens with a table otherwise reports "| code | product ids |"
    # as its description. Marker lines (Category:/Entry:/Summary:) are metadata, not prose.
    local desc; desc="$(grep -v '^\(Category\|Entry\|Summary\): ' "$f" 2>/dev/null \
      | grep -m1 '^[^#>*|[:space:]-]' | head -c80)"
    local name; name="$(basename "$f" .md)"
    if [ -n "$desc" ]; then echo "$name — $desc"
    else echo "$name"; fi
  done
}
print_doc_section() { # $1 label, $2 dir
  local items; items="$(list_docs "$2")"
  local n; n="$(printf '%s' "$items" | grep -c .)"
  [ "$n" = "0" ] && n=0
  echo "$1 ($n):"
  if [ -n "$items" ]; then printf '%s\n' "$items" | sed 's/^/  • /'; else echo "  (none)"; fi
}

print_doc_section "Features" "$ROOT/docs/features/ongoing"
print_doc_section "Fixes"    "$ROOT/docs/fixes/ongoing"

# ---- Todos (still from work-items.md) ----
section_items() {
  [ -f "$ITEMS" ] || return 0
  awk -v sec="$1" '
    $0 == sec { grab=1; next }
    /^## /    { grab=0 }
    grab && /^- / { sub(/^- /,""); print }
  ' "$ITEMS"
}
todos="$(section_items "## Todos")"
ntodos="$(printf '%s' "$todos" | grep -c .)"
echo "Todos ($ntodos):"
if [ -n "$todos" ]; then printf '%s\n' "$todos" | sed 's/^/  • /'; else echo "  (none)"; fi

# ---- Plans (docs/plans/ongoing/ — the only source of truth, same as features/fixes) ----
# Plans are grouped by an optional `Category:` marker line so a program of related work
# reads as one block instead of N unranked siblings. Optional companion markers:
#   Entry:   <anything>  — pins this plan first inside its category (the doc to read first)
#   Summary: <one line>  — used verbatim in this listing instead of the first prose line
# A plan with no `Category:` lands in "Uncategorized", printed last, so a new plan is
# visibly un-filed rather than silently absorbed.
PLAN_CATEGORY_ORDER=("COGS program" "Reporting & analytics" "Product catalog" "Platform")

plan_meta() { # $1 = file, $2 = marker key -> value ("" if absent)
  sed -n "s/^$2: //p" "$1" 2>/dev/null | head -1
}

# The COGS program is in discovery, so its category header carries the answered/open
# count from the checklist in its entry-point document rather than a plan count alone.
cogs_discovery_status() {
  local f="$ROOT/docs/plans/ongoing/inventory-and-cogs-sequence.md"
  [ -f "$f" ] || return 0
  local items answered total
  items="$(awk '/^## Discovery checklist/{g=1;next} /^## /{g=0} g' "$f")"
  answered="$(printf '%s\n' "$items" | grep -c '^- \[x\]')"
  total="$(printf '%s\n' "$items" | grep -c '^- \[[ x]\]')"
  [ "${total:-0}" = "0" ] && return 0
  printf ' — DISCOVERY %s/%s answered' "$answered" "$total"
}

print_plans_section() {
  local dir="$ROOT/docs/plans/ongoing"
  local tmp; tmp="$(mktemp)"
  local total=0
  if [ -d "$dir" ]; then
    for f in "$dir"/*.md; do
      [ -e "$f" ] || continue
      local name cat rank desc
      name="$(basename "$f" .md)"
      cat="$(plan_meta "$f" Category)"; [ -z "$cat" ] && cat="Uncategorized"
      if [ -n "$(plan_meta "$f" Entry)" ]; then rank=0; else rank=1; fi
      desc="$(plan_meta "$f" Summary)"
      [ -z "$desc" ] && desc="$(grep -v '^\(Category\|Entry\|Summary\): ' "$f" 2>/dev/null \
        | grep -m1 '^[^#>*|[:space:]-]')"
      desc="$(printf '%s' "$desc" | head -c80)"
      printf '%s\t%s\t%s\t%s\n' "$cat" "$rank" "$name" "$desc" >> "$tmp"
      total=$((total + 1))
    done
  fi

  local ncats; ncats="$(cut -f1 "$tmp" | sort -u | grep -c .)"
  echo "Plans ($total in $ncats categories):"

  print_plan_category() { # $1 = category name
    local n; n="$(awk -F'\t' -v c="$1" '$1==c' "$tmp" | grep -c .)"
    [ "$n" = "0" ] && return 0
    local extra=""
    [ "$1" = "COGS program" ] && extra="$(cogs_discovery_status)"
    echo "  ▸ $1 ($n)$extra"
    awk -F'\t' -v c="$1" '$1==c {print $2"\t"$3"\t"$4}' "$tmp" | sort \
      | awk -F'\t' '{ if ($3 != "") printf "      • %s — %s\n", $2, $3; else printf "      • %s\n", $2 }'
  }
  is_ordered_category() { # $1 = category name
    local c
    for c in "${PLAN_CATEGORY_ORDER[@]}"; do [ "$c" = "$1" ] && return 0; done
    return 1
  }

  for c in "${PLAN_CATEGORY_ORDER[@]}"; do print_plan_category "$c"; done
  # Any category not in the declared order, alphabetically, then Uncategorized last.
  while IFS= read -r c; do
    [ -z "$c" ] && continue
    [ "$c" = "Uncategorized" ] && continue
    is_ordered_category "$c" && continue
    print_plan_category "$c"
  done < <(cut -f1 "$tmp" | sort -u)
  print_plan_category "Uncategorized"

  rm -f "$tmp"
}
print_plans_section

# ---- Per-repo status: branch · dirty · sync · last commit ----
echo "Repos:"
repo_line() { # $1 = path (rel to ROOT), $2 = display name, $3 = baseline branch
  local dir="$ROOT/$1"
  [ -d "$dir/.git" ] || { printf "  %-16s (not a git repo)\n" "$2"; return; }
  local cur sha dirty last warn=""
  cur="$(git -C "$dir" rev-parse --abbrev-ref HEAD)"
  sha="$(git -C "$dir" rev-parse --short HEAD)"
  dirty="$(git -C "$dir" status --porcelain | grep -c .)"
  [ "$dirty" = "0" ] && dirty="clean" || dirty="$dirty uncommitted"
  last="$(git -C "$dir" log -1 --format='%s (%cr)' 2>/dev/null | cut -c1-48)"
  # unpushed: current branch ahead of its upstream
  local up ahead
  up="$(git -C "$dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [ -n "$up" ]; then
    ahead="$(git -C "$dir" rev-list --count "${up}..HEAD" 2>/dev/null || echo 0)"
    [ "$ahead" != "0" ] && warn="${warn} ↑${ahead} unpushed"
  fi
  # behind baseline (code repos)
  if [ -n "$3" ] && git -C "$dir" rev-parse --verify --quiet "origin/$3" >/dev/null; then
    local behind; behind="$(git -C "$dir" rev-list --count "HEAD..origin/$3" 2>/dev/null || echo 0)"
    [ "$behind" != "0" ] && [ "$cur" != "$3" ] && warn="${warn} ↓${behind} behind $3"
  fi
  printf "  %-16s %-26s %-7s %-16s | %s\n" "$2" "$cur ($sha)" "" "[$dirty]${warn}" "$last"
}
repo_line "."                      "inopack-claude" "master"
repo_line "nestjs-inopack-graphql" "graphql"        "dev"
repo_line "react-inopack"          "react"          "dev"

echo "Worktrees:"
canonical_graphql="$(git -C "$ROOT/nestjs-inopack-graphql" rev-parse --show-toplevel)"
worktree_lines="$(git -C "$ROOT/nestjs-inopack-graphql" worktree list --porcelain 2>/dev/null || true)"
current_path=""; current_branch=""
while IFS= read -r line; do
  case "$line" in
    "worktree "*) current_path="${line#worktree }" ;;
    "branch refs/heads/"*) current_branch="${line#branch refs/heads/}" ;;
    "")
      if [ -n "$current_path" ] && [ "$current_path" != "$canonical_graphql" ]; then
        slug="$(basename "$(dirname "$current_path")")"
        react_path="$ROOT/worktrees/$slug/react-inopack"
        gd="$(git -C "$current_path" status --porcelain 2>/dev/null | grep -c . || true)"
        rd="$(git -C "$react_path" status --porcelain 2>/dev/null | grep -c . || true)"
        echo "  $current_branch -> worktrees/$slug [graphql:$gd dirty react:$rd dirty]"
      fi
      current_path=""; current_branch=""
      ;;
  esac
done <<< "$worktree_lines"
[ -n "$current_path" ] && [ "$current_path" != "$canonical_graphql" ] && echo "  $current_branch -> $current_path"

todo_count="$(grep -c 'TODO' "$ROOT/CLAUDE.md" 2>/dev/null)"
echo "CLAUDE.md TODO markers: ${todo_count:-0}"

echo "Commands: save · load/pull · status · summary · switch <branch> · new-branch <feature|fix> <name> · ship [into] <dev|stage|master> · drop [branch]   (only path for commit/push, pull, checkout, branch, merge — see docs/commands.md)"
echo "Prefs: teach-while-coding · drop unused imports · save→save.sh · show files after push · status table after push · Git Bash/POSIX paths · text cols left-aligned"

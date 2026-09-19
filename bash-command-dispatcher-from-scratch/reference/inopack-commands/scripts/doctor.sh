#!/usr/bin/env bash
# doctor.sh - read-only machine readiness report. Always exits zero: findings are
# instructions for the user, not failures that should block an agent unexpectedly.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAST=0
[ "${1:-}" = "--fast" ] && FAST=1
note() { printf '  %-32s %s\n' "$1" "$2"; }
check_deps() {
  local dir="$1" label="$2"
  if [ ! -d "$dir/node_modules" ]; then note "$label dependencies" "MISSING - run npm ci"; return; fi
  if [ -f "$dir/node_modules/.package-lock.json" ] && cmp -s "$dir/package-lock.json" "$dir/node_modules/.package-lock.json"; then
    note "$label dependencies" "ready"
  else
    note "$label dependencies" "possibly stale - run npm ci"
  fi
}
check_env() { [ -f "$1/.env" ] && note "$2 .env" "present" || note "$2 .env" "MISSING"; }

# The `inopack` shorthand is a machine-local shell function/alias, so it must be read
# from the rc files rather than from this shell: doctor runs non-interactively and
# never inherits it, so `command -v inopack` would report MISSING even when it works.
#
# Three things can be wrong, and only the first is obvious:
#   1. no definition anywhere;
#   2. a definition pointing at a different umbrella (the drive letter differs per
#      machine — D: here, E: there — so a copied rc file silently drives the wrong repo);
#   3. a definition in ~/.bashrc that no login shell ever sources. Git Bash starts a
#      LOGIN shell, and neither /etc/profile nor /etc/bash.bashrc reads ~/.bashrc, so
#      without a ~/.bash_profile (or ~/.bash_login / ~/.profile) sourcing it, the
#      shorthand is defined in a file nothing opens.
check_shorthand() {
  local rc def="" src="" f
  for rc in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
    [ -f "$rc" ] || continue
    def="$(grep -m1 -E '^[[:space:]]*(alias[[:space:]]+inopack=|inopack[[:space:]]*\(\))' "$rc" 2>/dev/null)" || def=""
    if [ -n "$def" ]; then src="$rc"; break; fi
  done

  if [ -z "$def" ]; then
    note "inopack shorthand" "not defined - optional; install it with:"
    note "" "bash $ROOT/scripts/install-shorthand.sh"
    return
  fi

  # Does it drive THIS umbrella? Pull the dispatcher path back out of the definition.
  local target
  target="$(printf '%s' "$def" | sed -nE "s#.*[\"' ]([^\"' ]*inopack\.sh).*#\1#p")"
  if [ -n "$target" ] && [ "$target" != "$ROOT/scripts/inopack.sh" ]; then
    note "inopack shorthand" "points at $target, NOT this umbrella ($ROOT)"
    note "" "bash $ROOT/scripts/install-shorthand.sh --force"
    return
  fi

  # Defined only in ~/.bashrc? Confirm a login shell actually reaches it.
  if [ "$src" = "$HOME/.bashrc" ]; then
    local sourced=0
    for f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
      [ -f "$f" ] || continue
      grep -qE '(^|[^#[:alnum:]_])\.[[:space:]]+~?/?\.?bashrc|source[[:space:]]+~?/?\.?bashrc' "$f" 2>/dev/null && sourced=1
      break   # bash reads only the FIRST of these three that exists
    done
    if [ "$sourced" = 0 ]; then
      note "inopack shorthand" "in ~/.bashrc but no login shell sources it"
      note "" "bash $ROOT/scripts/install-shorthand.sh"
      return
    fi
  fi

  # The \~ is escaped because a replacement string is tilde-expanded — a bare ~ here
  # expands right back to $HOME and prints the full path it was meant to shorten.
  note "inopack shorthand" "defined in ${src/#$HOME/\~}"
}

echo "== INOPACK doctor =="
echo "This command is report-only; it makes no changes."
check_deps "$ROOT/nestjs-inopack-graphql" "graphql"
check_deps "$ROOT/react-inopack" "react"
check_env "$ROOT/nestjs-inopack-graphql" "graphql"
check_env "$ROOT/react-inopack" "react"

schema="$ROOT/nestjs-inopack-graphql/prisma/schema.prisma"
client="$ROOT/nestjs-inopack-graphql/node_modules/.prisma/client/index.js"
if [ -f "$schema" ] && [ -f "$client" ] && [ "$schema" -nt "$client" ]; then
  note "Prisma client" "STALE - run npm run db:generate"
elif [ -f "$client" ]; then
  note "Prisma client" "ready"
else
  note "Prisma client" "not found - run npm ci then npm run db:generate"
fi

for repo in nestjs-inopack-graphql react-inopack; do
  out="$(git -C "$ROOT/$repo" worktree prune --dry-run 2>&1 || true)"
  [ -n "$out" ] && note "$repo worktrees" "stale entries detected - review: $out" || note "$repo worktrees" "no stale registrations"
done

check_shorthand

if command -v gh >/dev/null 2>&1; then
  gh auth status >/dev/null 2>&1 && note "GitHub CLI" "authenticated" || note "GitHub CLI" "not authenticated - run gh auth login"
else
  note "GitHub CLI" "not installed"
fi

if [ "$FAST" = 1 ]; then
  note "Database checks" "skipped (--fast)"
else
  if command -v mysqladmin >/dev/null 2>&1; then
    note "Database checks" "manual - run migration command only after reviewing pending migrations"
  else
    note "Database checks" "mysql client unavailable; DB reachability not checked"
  fi
fi

echo "Doctor complete. Resolve only the findings that apply to this machine."
exit 0

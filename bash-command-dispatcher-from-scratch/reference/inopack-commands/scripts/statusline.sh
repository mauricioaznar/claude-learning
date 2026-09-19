#!/usr/bin/env bash
# statusline.sh — custom Claude Code status line, heavy on GIT STATUS across all
# INOPACK repos. Wired via settings.json "statusLine". Receives session JSON on stdin
# (ignored). Outputs ONE line with ANSI emphasis. Local-only git (no fetch) to stay fast.
#
# Per repo it shows:  <repo>@<version> ⎇<branch> <dirty> <ahead>
#   dirty:  green ✓ if clean, bold-red ●N if N uncommitted files
#   ahead:  yellow ↑N if N commits are unpushed vs the branch's upstream
set -u

# Runs on every prompt across all three repos. GIT_OPTIONAL_LOCKS=0 keeps these
# read-only `git status` calls from writing .git/index.lock, so back-to-back
# prompts (and the SessionStart summary hook) don't race on the lock — the
# recommended setting for any git-polling status line.
export GIT_OPTIONAL_LOCKS=0

cat >/dev/null 2>&1 || true   # drain stdin

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

B=$'\e[1m'; DIM=$'\e[2m'; R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; C=$'\e[36m'; X=$'\e[0m'

pkg_version() { # $1 = repo dir -> top-level package.json version (fast, no node)
  grep -m1 '"version"' "$1/package.json" 2>/dev/null \
    | sed -E 's/.*"version"[^"]*"([^"]+)".*/\1/'
}

seg() { # $1 = dir, $2 = label
  local dir="$1" label="$2"
  [ -d "$dir/.git" ] || return
  local br dirty up ahead ver dseg aseg vseg
  br="$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  dirty="$(git -C "$dir" status --porcelain 2>/dev/null | grep -c .)"
  up="$(git -C "$dir" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"
  ahead=0; [ -n "$up" ] && ahead="$(git -C "$dir" rev-list --count "${up}..HEAD" 2>/dev/null || echo 0)"
  ver="$(pkg_version "$dir")"

  if [ "$dirty" = "0" ]; then dseg="${G}✓${X}"; else dseg="${R}${B}●${dirty}${X}"; fi
  aseg=""; [ "$ahead" != "0" ] && aseg=" ${Y}↑${ahead}${X}"
  vseg=""; [ -n "$ver" ] && vseg="${DIM}@${ver}${X}"

  printf '%s%s%s%s %s⎇%s%s %s%s' "$B" "$label" "$X" "$vseg" "$C" "$br" "$X" "$dseg" "$aseg"
}

printf '%b %s·%s %b %s·%s %b\n' \
  "$(seg "$ROOT/react-inopack" react)" "$DIM" "$X" \
  "$(seg "$ROOT/nestjs-inopack-graphql" server)" "$DIM" "$X" \
  "$(seg "$ROOT" inopack-claude)"

#!/usr/bin/env bash
# install-shorthand.sh - define the machine-local `inopack` shell function.
#
# The shorthand must name an absolute path: it is called from anywhere, so there is no
# BASH_SOURCE and no repository to ask. That one fact cannot be derived away — but it
# can stop being hand-typed, which is the only reason it was ever wrong. This script
# interpolates its own $ROOT, so the definition it writes always drives THIS umbrella
# on THIS machine. Never document a literal path for a human to copy; point at this.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DISPATCH="$ROOT/scripts/inopack.sh"
CANON="inopack() { bash $DISPATCH \"\$@\"; }"
MARKER="# INOPACK umbrella dispatcher shorthand (written by inopack install-shorthand)"
BRIDGE='[ -f ~/.bashrc ] && . ~/.bashrc'

FORCE=0; DRY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --force)   FORCE=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help) echo "usage: install-shorthand.sh [--force] [--dry-run]"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

short() { printf '%s' "${1/#$HOME/\~}"; }   # \~ escaped: a replacement is tilde-expanded
say()   { printf '  %s\n' "$1"; }
run()   { [ "$DRY" = 1 ] && { say "would: $1"; return; }; return 1; }

backup() {
  local f="$1"
  [ -f "$f" ] || return 0
  cp -p "$f" "$f.inopack.bak" && say "backed up $(short "$f") -> $(short "$f").inopack.bak"
}

echo "== INOPACK install-shorthand =="
say "umbrella: $ROOT"
[ "$DRY" = 1 ] && say "dry run - no file is written"

# --- 1. locate any existing definition -------------------------------------------
# Same scan order doctor uses, so the two commands always agree about what is installed.
def=""; src=""
for rc in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  [ -f "$rc" ] || continue
  def="$(grep -m1 -E '^[[:space:]]*(alias[[:space:]]+inopack=|inopack[[:space:]]*\(\))' "$rc" 2>/dev/null)" || def=""
  if [ -n "$def" ]; then src="$rc"; break; fi
done

target=""
[ -n "$def" ] && target="$(printf '%s' "$def" | sed -nE "s#.*[\"' ]([^\"' ]*inopack\.sh).*#\1#p")"

# --- 2. write or repair the definition --------------------------------------------
if [ -n "$def" ] && [ "$target" = "$DISPATCH" ]; then
  say "definition already correct in $(short "$src")"
elif [ -n "$def" ]; then
  # A definition exists but drives a different umbrella. That is exactly the silent
  # failure doctor warns about, so it is never overwritten without being asked.
  if [ "$FORCE" = 0 ]; then
    echo "  definition in $(short "$src") points at ${target:-an unrecognized target}," >&2
    echo "  not $DISPATCH" >&2
    echo "  refusing to overwrite it; re-run with --force to replace it." >&2
    exit 1
  fi
  if ! run "replace the definition in $(short "$src")"; then
    backup "$src"
    tmp="$(mktemp)"
    # Rewrite the FIRST matching line only; a later duplicate is reported, not silently
    # merged, because two definitions mean the rc file has a history worth reading.
    awk -v canon="$CANON" '
      !done && /^[[:space:]]*(alias[[:space:]]+inopack=|inopack[[:space:]]*\(\))/ { print canon; done=1; next }
      { print }
    ' "$src" > "$tmp" && mv "$tmp" "$src"
    say "replaced the definition in $(short "$src")"
  fi
  extra="$(grep -cE '^[[:space:]]*(alias[[:space:]]+inopack=|inopack[[:space:]]*\(\))' "$src" 2>/dev/null || echo 0)"
  [ "${extra:-0}" -gt 1 ] && say "NOTE: $(short "$src") still holds another inopack definition - review it by hand"
else
  src="$HOME/.bashrc"
  if ! run "append the definition to $(short "$src")"; then
    backup "$src"
    { [ -s "$src" ] && printf '\n'; printf '%s\n%s\n' "$MARKER" "$CANON"; } >> "$src"
    say "wrote the definition to $(short "$src")"
  fi
fi

# --- 3. make sure a login shell reaches ~/.bashrc ----------------------------------
# Git Bash opens a LOGIN shell, which reads only the FIRST of bash_profile/bash_login/
# profile that exists — and none of them read ~/.bashrc on their own. Without this
# bridge the function is defined in a file nothing ever opens.
if [ "$src" = "$HOME/.bashrc" ]; then
  login_rc=""
  for f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
    [ -f "$f" ] && { login_rc="$f"; break; }
  done
  if [ -z "$login_rc" ]; then
    login_rc="$HOME/.bash_profile"
    if ! run "create $(short "$login_rc") with the ~/.bashrc bridge"; then
      printf '%s\n%s\n' "# Git Bash opens a login shell, which does not read ~/.bashrc on its own." "$BRIDGE" > "$login_rc"
      say "created $(short "$login_rc") with the ~/.bashrc bridge"
    fi
  elif grep -qE '(^|[^#[:alnum:]_])\.[[:space:]]+~?/?\.?bashrc|source[[:space:]]+~?/?\.?bashrc' "$login_rc" 2>/dev/null; then
    say "$(short "$login_rc") already sources ~/.bashrc"
  else
    if ! run "add the ~/.bashrc bridge to $(short "$login_rc")"; then
      backup "$login_rc"
      printf '\n%s\n%s\n' "# Git Bash opens a login shell, which does not read ~/.bashrc on its own." "$BRIDGE" >> "$login_rc"
      say "added the ~/.bashrc bridge to $(short "$login_rc")"
    fi
  fi
fi

# --- 4. define the function for zsh too --------------------------------------------
# zsh (the macOS default shell) reads none of the bash rc files, so the same function
# must be written to ~/.zshrc. zsh function syntax is identical, so CANON is reused
# verbatim. Only touched when zsh is actually in play - a Git Bash machine has no zsh
# and should not grow a stray ~/.zshrc.
if [ -f "$HOME/.zshrc" ] || command -v zsh >/dev/null 2>&1; then
  zrc="$HOME/.zshrc"
  zdef=""
  [ -f "$zrc" ] && zdef="$(grep -m1 -E '^[[:space:]]*(alias[[:space:]]+inopack=|inopack[[:space:]]*\(\))' "$zrc" 2>/dev/null)" || zdef="$zdef"
  ztarget=""
  [ -n "$zdef" ] && ztarget="$(printf '%s' "$zdef" | sed -nE "s#.*[\"' ]([^\"' ]*inopack\.sh).*#\1#p")"

  if [ -n "$zdef" ] && [ "$ztarget" = "$DISPATCH" ]; then
    say "definition already correct in $(short "$zrc")"
  elif [ -n "$zdef" ]; then
    if [ "$FORCE" = 0 ]; then
      echo "  definition in $(short "$zrc") points at ${ztarget:-an unrecognized target}," >&2
      echo "  not $DISPATCH" >&2
      echo "  refusing to overwrite it; re-run with --force to replace it." >&2
      exit 1
    fi
    if ! run "replace the definition in $(short "$zrc")"; then
      backup "$zrc"
      tmp="$(mktemp)"
      awk -v canon="$CANON" '
        !done && /^[[:space:]]*(alias[[:space:]]+inopack=|inopack[[:space:]]*\(\))/ { print canon; done=1; next }
        { print }
      ' "$zrc" > "$tmp" && mv "$tmp" "$zrc"
      say "replaced the definition in $(short "$zrc")"
    fi
    extra="$(grep -cE '^[[:space:]]*(alias[[:space:]]+inopack=|inopack[[:space:]]*\(\))' "$zrc" 2>/dev/null || echo 0)"
    [ "${extra:-0}" -gt 1 ] && say "NOTE: $(short "$zrc") still holds another inopack definition - review it by hand"
  else
    if ! run "append the definition to $(short "$zrc")"; then
      backup "$zrc"
      { [ -f "$zrc" ] && [ -s "$zrc" ] && printf '\n'; printf '%s\n%s\n' "$MARKER" "$CANON"; } >> "$zrc"
      say "wrote the definition to $(short "$zrc")"
    fi
  fi
fi

echo "Done. Open a new terminal, or run: . ~/.bashrc (bash) or . ~/.zshrc (zsh)"
exit 0

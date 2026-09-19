#!/usr/bin/env bash
# inopack.sh - provider-neutral INOPACK command dispatcher.
#
# This file is the public command surface. Provider adapters and machine-local shell
# aliases invoke it; business behavior remains in the focused scripts beside it.

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command_name="${1:-help}"
[ "$#" -gt 0 ] && shift

usage() {
  cat <<'EOF'
Usage: inopack <command> [args]

Session:
  start | summary                 Print the read-only session orientation.
  status [features|fixes]         Show repository status.
  load | pull                     Fast-forward shared branches without switching.
  doctor [--fast]                 Report machine and worktree readiness.
  install-shorthand [--force] [--dry-run]
                                  Define the machine-local `inopack` shell function.

Local database:
  db-restore [-y] [--dry-run]     Drop, recreate and load the local inopack
                                  database from inopack.sql. DESTRUCTIVE.

Git workflow:
  save [message]                  Commit and push all dirty repos on their current branches.
  switch [--worktree] <branch>    Switch canonical repos; worktrees are opt-in.
  new-branch <feature|fix> [--worktree] <name> [description]
  new-feature [--worktree] <name> [description]
  new-fix [--worktree] <name> [description]
  ship [-y] [into] <target>
  drop [-y] [branch]
  worktree-init <branch-slug>     Initialize a paired worktree.

See docs/commands.md for the authoritative contract.
EOF
}

case "$command_name" in
  start|summary) exec bash "$ROOT/scripts/summary.sh" "$@" ;;
  status)        exec bash "$ROOT/scripts/status.sh" "$@" ;;
  load|pull)     exec bash "$ROOT/scripts/load.sh" "$@" ;;
  doctor)        exec bash "$ROOT/scripts/doctor.sh" "$@" ;;
  install-shorthand) exec bash "$ROOT/scripts/install-shorthand.sh" "$@" ;;
  db-restore)    exec bash "$ROOT/scripts/db-restore.sh" "$@" ;;
  save)          exec bash "$ROOT/scripts/save.sh" "$@" ;;
  switch)        exec bash "$ROOT/scripts/switch.sh" "$@" ;;
  new-branch)    exec bash "$ROOT/scripts/new-branch.sh" "$@" ;;
  new-feature)   exec bash "$ROOT/scripts/new-feature.sh" "$@" ;;
  new-fix)       exec bash "$ROOT/scripts/new-fix.sh" "$@" ;;
  ship)          exec bash "$ROOT/scripts/ship.sh" "$@" ;;
  drop)          exec bash "$ROOT/scripts/drop.sh" "$@" ;;
  worktree-init) exec bash "$ROOT/scripts/worktree-init.sh" "$@" ;;
  help|-h|--help) usage ;;
  *) echo "Unknown INOPACK command: $command_name" >&2; usage >&2; exit 2 ;;
esac

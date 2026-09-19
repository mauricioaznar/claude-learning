#!/usr/bin/env bash
# new-fix.sh — thin wrapper around `new-branch.sh fix`.
# Exists only to shorten `new-branch fix <name> [desc]` to
# `new-fix <name> [desc]`. All real behavior lives in new-branch.sh.
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/new-branch.sh" fix "$@"

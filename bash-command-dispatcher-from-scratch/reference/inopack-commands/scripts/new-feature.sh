#!/usr/bin/env bash
# new-feature.sh — thin wrapper around `new-branch.sh feature`.
# Exists only to shorten `new-branch feature <name> [desc]` to
# `new-feature <name> [desc]`. All real behavior lives in new-branch.sh.
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/new-branch.sh" feature "$@"

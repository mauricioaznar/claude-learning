#!/usr/bin/env bash
# Drill 4 — case
#
# Write a script that takes one argument (a "command name") and uses a case
# statement to print a different message for at least three different values,
# plus a fallback branch for anything else (an "unknown command" message).
#
# This is the shape the real dispatcher will use to route to the right
# command — here just print a message per branch, no routing to other files
# yet.
command=${1:-help}

case "$command" in
  command-1) exec echo "1";;
  command-2) exec echo "2";;
  command-3) exec echo "3";;
  help) echo 'help' ; exit 0;;
  *) echo "failure: unknown command" 1>&2; exit 1;
esac
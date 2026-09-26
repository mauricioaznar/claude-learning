#!/usr/bin/env bash
# Drill 1 — positional arguments ($1, $#, $@)
#
# Write a script that, given any number of arguments, prints:
#   - how many arguments it received
#   - each argument on its own line, with its position number
#
# Try it with zero args, one arg, and three args — see what changes at each
# count.

echo "arguments received: $#"

count=1
for word in "$@"; do
  echo "$count: $word"
  count=$((count + 1))
done
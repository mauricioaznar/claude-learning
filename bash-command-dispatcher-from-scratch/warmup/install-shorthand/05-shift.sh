#!/usr/bin/env bash

set -u

# Drill 5 — shift
#
# Write a script that treats its first argument as a "command name" and every
# argument after that as the command's own arguments. Print the command name,
# then use `shift` to drop it, then print the remaining arguments (via $@) as
# what would be "handed off" to that command.
#
# Try it with just a command name and no extra args, and with a command name
# plus several extra args.
cmd=${1:-"help"};

if [[ "$cmd" == "help" ]]
 then
    echo "shift example, please pass at least one arg";
    exit 0;
fi

shift 1;

args=""
for word in "$@"; do
    args="$args <$word>"
done

echo "$cmd$args"

cmd "$@"


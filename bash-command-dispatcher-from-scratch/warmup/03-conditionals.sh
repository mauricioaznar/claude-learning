#!/usr/bin/env bash
# Drill 3 — conditionals and exit codes
#
# Write a script that takes one argument and:
#   - if it's the literal string "ok", print "success" and exit 0
#   - otherwise, print "failure" to stderr and exit 1
#
# Use [[ ]] for the comparison. After running it, check $? (the exit code of
# the last command) in your shell for both cases — run `echo $?` immediately
# after each invocation.

#!/usr/bin/env bash
# Drill 7 — where am I?
#
# Write a script that prints the directory it lives in, using
# ${BASH_SOURCE[0]} (not $0 — look up why they can differ). It should print
# the SAME directory regardless of what directory you're standing in when you
# run it.
#
# Test this: run it once from inside this warmup/ folder, then `cd` somewhere
# else entirely and run it again via its relative or full path. The printed
# directory should not change.

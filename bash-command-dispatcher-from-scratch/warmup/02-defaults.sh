#!/usr/bin/env bash
# Drill 2 — defaults for missing arguments, and set -u
#
# Part A: write a script that reads its first argument, but falls back to a
# default value ("world") if none was given, and prints "Hello, <value>".
# Use the ${1:-default} form rather than an if-check.
#
# Part B: add `set -u` at the top, then deliberately reference a variable you
# never set (e.g. a typo'd name). Run it and see what happens. Then remove
# `set -u` and run the same script again — compare the two outcomes.

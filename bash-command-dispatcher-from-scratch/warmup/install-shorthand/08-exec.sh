#!/usr/bin/env bash
# Drill 8 — exec vs. a plain call
#
# Create two tiny scripts: a caller and a callee (e.g. 08-exec-caller.sh and
# 08-exec-callee.sh). The callee should print its own process id ($$) and
# exit with a distinct exit code (e.g. exit 7).
#
# Version A: have the caller invoke the callee normally (`bash callee.sh`),
# then print its OWN $$ and $? right after.
# Version B: have the caller invoke the callee with `exec bash callee.sh`
# instead, with nothing after that line.
#
# Compare: in version A, does anything print after the callee runs? In
# version B? What's the caller's $$ vs the callee's $$ in each case? What
# exit code does the whole invocation end with in each case?

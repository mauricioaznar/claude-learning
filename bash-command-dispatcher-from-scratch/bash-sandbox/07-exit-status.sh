# S7 — $?, && and ||
#
# Idea: every command ends with an exit status, a number from 0 to 255.
# 0 means success; anything else means failure. $? holds the status of the
# most recent command, and it is overwritten by the very next one.
#   A && B   run B only if A succeeded (status 0)
#   A || B   run B only if A failed (status not 0)
# Bash reads these left to right, one pair at a time.
# `true` and `false` are commands that do nothing except exit 0 and 1.

# 1. false; echo $?; echo $?
#    Why do the two echoes print different numbers?
# predict:
# actual:

# 2. true && ./args yes        and        false && ./args yes
# predict:
# actual:

# 3. false || ./args fallback        and        true || ./args fallback
# predict:
# actual:

# 4. false && ./args a || ./args b
#    Which ones run? Then try:   true && false || ./args c
#    This is why `A && B || C` is NOT a safe if/else. Why?
# predict:
# actual:

# 5. ls missing-file; echo $?
#    and     ls missing-file 2>/dev/null || echo "not there"
#    What is the status number? What did 2>/dev/null hide?
# predict:
# actual:

# 6. bash -c 'exit 7'; echo $?
#    Where does the number come from?
# predict:
# actual:

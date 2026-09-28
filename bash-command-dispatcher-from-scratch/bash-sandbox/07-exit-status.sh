# S7 — $?, && and ||
#
# Reading a case: type the command exactly as written, including ; && > |.
# Only a spaced-out `and` / `vs` separates two commands, so run each side on its own.
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
# predict: first echo prints 1, second echo prints 0. They print differnt numbers because of the result of the previous ran command. echo $? exit status is 0 so next time echo $? prints it will print 0
# actual: false. echo $? -> 1. echo $? -> 0.

# 2. true && ./args yes        and        false && ./args yes
# predict: only the first case will ran ./args yes. Since && only runs the right command if the left command exit status is 0
# actual 1st: args count 1: <yes>
# actual 2nd": nothing
# $ false && ./args yes; echo $?: shows 1. Which means that false was the last command to be ran.

# 3. false || ./args fallback        and        true || ./args fallback
# predict: false || ./args fallback runs the ./args fallback since || means if exit status is differnt than 0. true || ./args fallback doesnt run ./args fallback
# actual: ./args was run on the first case. echo $? -> 0. last command ran was ./args.  true || ./args fallback ddidnt print anytying since the operator doesnt move the run flow to the command on the right since the left comand returned exit status 0. echo $? -> 0. last command ran was true

# 4. false && ./args a || ./args b
#    Which ones run? Then try:   true && false || ./args c
#    This is why `A && B || C` is NOT a safe if/else. Why?
# predict: false && ./args a || ./args b doesnt run anything, since the operator && ends the running flow. second case true && false || ./args c runs c and displays args count: 1 <c>
# actual: false && ./args a || ./args b -> args count 1: <b>. true && false || ./args c -> args count 1: <c>
# A && B || C` is NOT a safe if/else. Why?, because c can run depending on if a OR b failed.

# 5. ls missing-file; echo $?
#    and     ls missing-file 2>/dev/null || echo "not there"
#    What is the status number? What did 2>/dev/null hide?
# predict:
# actual:

# 6. bash -c 'exit 7'; echo $?
#    Where does the number come from?
# predict:
# actual:

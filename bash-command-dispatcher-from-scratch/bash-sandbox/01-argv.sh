# S1 — argv: a command receives a list, not a line
#
# Worksheet, not a script. For each case: write your prediction on the
# `# predict:` line FIRST, then type the command in a terminal (from this
# folder) and write what really happened on `# actual:`. A wrong prediction
# with a clear "because" is worth more than a lucky right one.
#
# Idea: when you run `prog a b c`, the program never sees the text you typed.
# Bash hands it an array of strings (argv). Everything in S2–S6 is about how
# bash builds that array from your line.
#
# Step 0: implement ./args (see the file). Then:

# 1. ./args one two three
#    How many args?
# predict: 3
# actual: 3

# 2. ./args "one two" three
#    How many args? What are they?
# predict: 2
# actual: <one two> <three>. two separate arguments. Quoted text doesnt get split?

# 3. ./args ""        and        ./args
#    How many args in each? Are these the same thing?
# predict: 1 and 0
# actual: 1 and 0. First argument is empty but assigned. set -u complains when unset and used somewhere.

# 4. echo "one two" three        vs        echo one two three
#    Does the output differ? Then run both through ./args instead.
#    Why can't echo tell you how many arguments it received?
# predict: single argument, ignore quotes
# actual: same output different internal flow. "one two" doesnt get split but has coincidentlly one space. Each argument get passed as a single parameter no spaces (preserver spaces in quotes). second case recieves three argumetns ang get joined with an space.


#set -u complains about unset variables.
#${1:-"fallback"} treats empty and unset. so $1 = "" will fallback
#${1-"fallback"} treats only unset, so $1 = "" wont fallback
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
# predict:
# actual:

# 2. ./args "one two" three
#    How many args? What are they?
# predict:
# actual:

# 3. ./args ""        and        ./args
#    How many args in each? Are these the same thing?
# predict:
# actual:

# 4. echo "one two" three        vs        echo one two three
#    Does the output differ? Then run both through ./args instead.
#    Why can't echo tell you how many arguments it received?
# predict:
# actual:

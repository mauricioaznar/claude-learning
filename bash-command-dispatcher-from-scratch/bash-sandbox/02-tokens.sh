# S2 — tokenizing: words vs operators
#
# Reading a case: type the command exactly as written, including ; && > |.
# Only a spaced-out `and` / `vs` separates two commands, so run each side on its own.
#
# Idea: the very first thing bash does with your line — before looking at any
# $variables — is cut it into WORDS and OPERATORS. Operators are characters
# like  ;  &&  ||  |  <  >  and they are instructions to bash itself. They are
# never passed to the program as arguments (unless quoted or escaped, which
# turns them back into ordinary characters).
#
# Same format as S1: predict, run, record. Run from this folder.

# 1. ./args a ; ./args b
#    How many times does ./args run? How many args does each run get?
# predict: i though ./args a ; ran with two commands. The instrucion was not clear. I never  though to run it
# actual: ./args ran twice. ; is a separator, sort of like \n. Each command run got a single argument.

# 2. ./args a>out.txt
#    What appears on screen? How many args did ./args get? What's in out.txt?
#    (then: rm out.txt)
# predict: from what I have seen, > is an operator that sends the result from the command into a file called out.txt
# actual: What appeared on screen? nothing. Standard output was written in out.txt.
# How many arguments did ./args get, and what exactly was in out.txt? ne argument. The echo result. Which is another way of sayuing all output that was sent to stdout
# extra two kinds of output streams: stdout stderr
# extra 2:it didnt treat it as a single text since its not quoted and it contains an operator (>). It saw the > operator and cut according to the rule

# 3. ./args "a>out.txt"        and        ./args a\>out.txt
#    Is a file created? How many args?
# predict:
# actual:

# 4. ./args x < missing-file
#    (there is no file called missing-file)
#    Does ./args run at all? Who prints the error — bash or ./args?
# predict:
# actual:

# 5. ./args a && ./args b
#    Is && an argument to the first ./args? Who decides whether the second runs?
# predict:
# actual:

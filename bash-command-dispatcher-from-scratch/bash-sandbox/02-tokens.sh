# S2 — tokenizing: words vs operators
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
# predict:
# actual:

# 2. ./args a>out.txt
#    What appears on screen? How many args did ./args get? What's in out.txt?
#    (then: rm out.txt)
# predict:
# actual:

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

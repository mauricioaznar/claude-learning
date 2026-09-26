# S4 — word splitting
#
# Reading a case: type the command exactly as written, including ; && > |.
# Only a spaced-out `and` / `vs` separates two commands, so run each side on its own.
#
# Idea: after bash expands an UNQUOTED $x, it cuts the result into separate
# words wherever there is whitespace (technically: characters in $IFS).
# If the result is empty, it produces ZERO words, not one empty word.
# Inside "...", no splitting happens: the result stays exactly one word.
#
# Important distinction: splitting only applies to text that came OUT of an
# expansion. Spaces you type directly on the line were already handled by
# tokenizing (S2).

# 1. x="one   two   three"
#    ./args $x        vs        ./args "$x"
# predict:
# actual:

# 2. ./args one   two        vs        x="one   two"; ./args $x
#    Same count? Which STEP did the splitting in each case (S2 or S4)?
# predict:
# actual:

# 3. y=""
#    ./args $y        vs        ./args "$y"        vs        ./args a$y
# predict:
# actual:

# 4. z="  padded  "
#    ./args $z        vs        ./args "$z"
#    Do the leading/trailing spaces survive in either?
# predict:
# actual:

# 5. (bonus) ( IFS=,; list="a,b,c"; ./args $list )
#    What changed? (The outer parentheses run it in a subshell so your
#    terminal's IFS stays normal.)
# predict:
# actual:

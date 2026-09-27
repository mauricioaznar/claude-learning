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
# predict: args count 3 on the first. args count 1 on the second. second preserves spacing
# actual: second <one    two    three>, first as predicted, <one>, <two>, <three>. thanks teacher ;)

# 2. ./args one   two        vs        x="one   two"; ./args $x
#    Same count? Which STEP did the splitting in each case (S2 or S4)?
# predict: first case bash sees two words. removes the spacing and pass them as args. secnd case $x is not quotes so splitting happens before the program runs.
# actual: both showed: <one> <two>
# typed spaces are handled at tokenizing (first case)
# word splitting happens after expansion (second case)

# 3. y=""
#    ./args $y        vs        ./args "$y"        vs        ./args a$y
# predict: first empty, args 0. second empty string <"">, third <> token (a$y) => expansion (a) -> run args 0
# actual: first args 0, second <>, third <a>

# 4. z="  padded  "
#    ./args $z        vs        ./args "$z"
#    Do the leading/trailing spaces survive in either?
# predict: yes second case. first case gets lobotomized by the whole bash pipeline. though I dont know which step, but I think it is tokenizing
# actual:<padded> and <  padded  >
# word splitting removes whitespaces on ./args $z and keeps only words

# 5. (bonus) ( IFS=,; list="a,b,c"; ./args $list )
#    What changed? (The outer parentheses run it in a subshell so your
#    terminal's IFS stays normal.)
# predict: IFS doest run on ./args so output will only show 3 args <a> <b> <c>
# actual: <a> <b> <c>
# IFS is shell variable that specifies on which character to cut. on this case we are cutting on commas. Therefore we are getting three separate arguments (even though they dont have whitespace & the argument is not quoted)

# 6. (bonus) ( IFS=" "; list="a b c"; ./args $list )
#    What changed? (The outer parentheses run it in a subshell so your
#    terminal's IFS stays normal.)
# predict:IFS cuts on whitespace
# actual: <a> <b> <c>


# 7. (bonus) ( IFS=""; list="a $someunsetvar c"; ./args $list )
#    What changed? (The outer parentheses run it in a subshell so your
#    terminal's IFS stays normal.)
# predict:IFS cuts on unset variables. so <a> <c>.
# actual: <a  c>. after expansion word is "a  c" so nothing gets cut
# S6 — [ vs [[
#
# Idea: `[` is an ordinary command (another name for `test`). Bash runs every
# step from S2–S5 on the line first, then hands `[` the finished argv.
# `]` is just its required last argument. `[` then reports true/false through
# its exit status (0 = true).
# `[[` is part of bash's grammar (a keyword). Bash sees it while parsing, BEFORE
# expansion, so it can change the rules inside it.
#
# Check $? after each test with:   echo $?

# 1. type [      type test      type [[
#    What does bash call each one?
# predict:
# actual:

# 2. [a = a]        and        [ a = a]
#    What error does each give? What does that tell you about the spaces?
# predict:
# actual:

# 3. x="hello world"
#    [ $x = "hello world" ]        vs        [[ $x = "hello world" ]]
#    Run ./args $x = "hello world" ] to see what [ receives.
# predict:
# actual:

# 4. y=""
#    [ $y = "" ]        vs        [ "$y" = "" ]        vs        [[ $y = "" ]]
# predict:
# actual:

# 5. [[ notes.txt == *.txt ]]        vs        [[ notes.txt == "*.txt" ]]
#    Inside [[ ]], what does quoting the right side change?
# predict:
# actual:

# 6. Do this one in a throwaway folder:   cd "$(mktemp -d)"
#    [ b > a ]; echo $?; ls
#    [[ b > a ]]; echo $?; ls
#    What did each one do? Which one touched the filesystem?
# predict:
# actual:

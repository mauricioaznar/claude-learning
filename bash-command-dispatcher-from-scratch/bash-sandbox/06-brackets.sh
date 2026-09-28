# S6 — [ vs [[
#
# Reading a case: type the command exactly as written, including ; && > |.
# Only a spaced-out `and` / `vs` separates two commands, so run each side on its own.
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
# predict: first are sh builtin functions, second is bash specific language.
# actual: type [ -> [ is a shell builtin, type test -> test is a shell builtin, type [[ -> [[ is a shell keyword

# 2. [a = a]        and        [ a = a]
#    What error does each give? What does that tell you about the spaces?
# predict: <[a> will be considered a word, same as a]. instead of a comparison it looks like a] is being assigned to [a. second case fails because <[> expects <]>.
# actual: first -> bash: [a: command not found. Meaning [a words are not composed of keywords. first word is considered a command. <=> <a]> its arguments. Since no command was found, it threw an error.
# actual: second -> bash: [: missing `]'. prediction was correct
# What does that tell you about the spaces?. Spaces need to be between each [ and ] for them to be recognized by bash as the test command. [ and ] are ordinary characters

# 3. x="hello world"
#    [ $x = "hello world" ]        vs        [[ $x = "hello world" ]]
#    Run ./args $x = "hello world" ] to see what [ receives.
# predict: first case (builtin command) will do expansion. the second case the shell keyword wont, since im guessing it skips the expansion step.
# actual: first shows  [ $x = "hello world" ]; bash: [: too many arguments. second shows [[ $x = "hello world" ]];
# [ $x -> gets expanded and split
# [ "$x" -> gets expanded but not split (double quoting)
# [ '$x' -> doesnt get expanded, gets taken as literal text
# [[ $x -> gets expanded but not split (keyword grammar)


# 4. y=""
#    [ $y = "" ]        vs        [ "$y" = "" ]        vs        [[ $y = "" ]]
# predict: all three get expanded but not split, since its an empty variable. all return 0 since its a true comparison
# actual 1st: first shows -> bash: [: =: unary operator expected. echo $? -> 2. after quoting phase only <=> <> <]> remain which means 1 argument is missing for [
# actual 2nd:  [ "$y" = "" ]; echo $? -> 0. no failure. meaning that on the first case, $y gets dropped since it is a unquoted empty variable.
# actual 3rd: doesnt fail like the first one, which means word slitting is skipped. echo $? -> 0. Dropping an empty variable is part of word slipping but this step gets skipped on [[
# quoting keeps the word, unquoted empty variables get dropped

# 5. [[ notes.txt == *.txt ]]        vs        [[ notes.txt == "*.txt" ]]
#    Inside [[ ]], what does quoting the right side change?
# predict: globbing is after expansion and we stablished word splitting and globbing get skipped after expansion. So no globbing in both cases. quoting on the right side keeps the text as is, no pattern matching, alas literal string
# actual: first echo $? -> 0. Which means true or that the string matched the pattern. second is false, echo $? -> 1. string didnt match text

# 6. Do this one in a throwaway folder:   cd "$(mktemp -d)"
#    [ b > a ]; echo $?; ls
#    [[ b > a ]]; echo $?; ls
#    What did each one do? Which one touched the filesystem?
# predict:
# actual:

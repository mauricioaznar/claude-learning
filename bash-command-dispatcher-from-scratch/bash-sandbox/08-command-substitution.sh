# S8 — $(...) command substitution
#
# Reading a case: type the command exactly as written, including ; && > |.
# Only a spaced-out `and` / `vs` separates two commands, so run each side on its own.
#
# Idea: $(cmd) runs cmd, captures what it printed to stdout, and puts that
# text into the line in its place. Trailing newlines are removed. Like $x,
# the result is word-split and globbed unless it is inside "...".
# It captures stdout only: the exit status goes to $?, not into the text.

# 1. ./args "$(echo hello)"        and        now="$(date +%H:%M)"; ./args "$now"
# predict #1: ./args "$(echo hello)" will runn echo inside of the parenthesis before the bash pipeline prepares the arguments for ./arg. output: args count: 1 <hello>.
# predict #2: the inner command substitution runs. now="08:11" -> ./args "08:11" -> args count: 1 <08:11>
# actual #1: args count 1: <hello>
# actual #2: args count 1: <20:13>


# 2. ./args $(echo one two)        vs        ./args "$(echo one two)"
# predict: first one will see args count 2: <one> <two>. second one will see args count 1: <one two>. The difference is that after the child process run the final result on the second one is "one two". which gets passed as a single argument to ./args
# actual 1st: args count 2: <one> <two>
# actual 2nd: args count 1: <one two>

# 3. ./args "$(printf 'a\nb\n\n\n')"
#    How many lines end up inside the one argument? What happened to the rest?
# predict: 5 lines. <a> <b> <> <> <>
# actual:args count 1: <a
# b>

# 4. cd glob-playground
#    ../args $(echo '*.txt')        vs        ../args "$(echo '*.txt')"
#    (then: cd ..)
# predict:
# actual:

# 5. out="$(ls missing-file)"; echo "status=$? out=<$out>"
#    Where did the error message go? What's in $out?
# predict:
# actual:

# 6. ./args "you are in $(basename "$(pwd)")"
#    Quotes inside $(...) inside quotes: how many args, and does the inner
#    "..." end the outer one?
# predict:
# actual:

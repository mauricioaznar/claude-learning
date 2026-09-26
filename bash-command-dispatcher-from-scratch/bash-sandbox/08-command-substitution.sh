# S8 — $(...) command substitution
#
# Idea: $(cmd) runs cmd, captures what it printed to stdout, and puts that
# text into the line in its place. Trailing newlines are removed. Like $x,
# the result is word-split and globbed unless it is inside "...".
# It captures stdout only: the exit status goes to $?, not into the text.

# 1. ./args "$(echo hello)"        and        now="$(date +%H:%M)"; ./args "$now"
# predict:
# actual:

# 2. ./args $(echo one two)        vs        ./args "$(echo one two)"
# predict:
# actual:

# 3. ./args "$(printf 'a\nb\n\n\n')"
#    How many lines end up inside the one argument? What happened to the rest?
# predict:
# actual:

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

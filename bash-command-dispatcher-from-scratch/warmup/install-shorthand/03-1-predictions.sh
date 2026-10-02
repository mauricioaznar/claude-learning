#!/usr/bin/env bash
# Drill 3.1 — predictions: expansion vs quoting, [ ] vs [[ ]]
#
# No code to write. For each case, predict the answer and write it (with a
# one-line "because") on the `# answer:` line. Reason from the pipeline:
#   tokenize → expand → word-split → glob → quote removal → run with argv
# and from the fact that `[` is a command (sees only the final argv) while
# `[[` is grammar (parsed before expansion).

# 1. x="a b"
#    echo $x      vs      echo "$x"
#    How many arguments does echo receive in each case?
#    Why is echo a bad tool for seeing the difference?
# answer: on the first case it receives two arguments. since after expansion, it gets word splitted. On the second it gets expanded, but word splitting doesnt happen inside quotes so 1 argument
# why is echo a bad tool for seeing the difference: mostly because on the terminal the results will look the same. Creating a tool that spots each arg and prints it with delimitators will be provide an easy solution.
# echo joins its args with a space

# 2. x=""
#    [ -n $x ]
#    How many arguments does [ receive (not counting the closing ])?
#    True or false? (With exactly one argument, [ tests "is it non-empty?")
# answer:  after expansion the final command looks like this [ -n ], -n is treated as text not a variable or operator, a text is never empty (except for "") and the final result is true
# a fix would be to quote $x so after expansion there an empty word survives and the commnd [ can see two argument and treat -n as an operator and not a text

# 3. x=abc
#    [[ $x == a* ]]      vs      [[ $x == "a*" ]]
#    True or false for each?
# answer: first one without quotes is treated as pattern matching (right side). $x gets expandd into abc and a* is a pattern that seeks to match anything that starts with a and has any number of characters afterwards. So first one is ture
# the second one avoids pattern matching by using quotes. $x seeks to match the literal string a*. returns false since they dont match
# [[ skips globbing, a* only serves to pattern match against a string.

# 4. [ $1 = ok ] && echo yes
#    Is && part of the test or not? Why?
# answer: && is not part of the test, && is an operator, ] ends the test. && operator only runs the right command if the left command return with exit status 0

# 5. x="*"   (run from a directory that contains files)
#    echo $x      vs      echo "$x"
#    What does each print?
# answer: first one globs. second one doesnt. The assignement to x doesnt glob. but quote removal already happend there. next time it can glob if it doesnt get handled with quotes
# second one prints *. first one prints all the file in current directory

# 6. [ a < b ]      vs      [[ a < b ]]
#    What does each one do? Which one might touch the filesystem?
# answer: first one might touch the file systme and write a file named b. second one is comparison by default
# first one means read input from a and write it down in b


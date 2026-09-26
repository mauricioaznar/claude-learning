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
# answer:

# 2. x=""
#    [ -n $x ]
#    How many arguments does [ receive (not counting the closing ])?
#    True or false? (With exactly one argument, [ tests "is it non-empty?")
# answer:

# 3. x=abc
#    [[ $x == a* ]]      vs      [[ $x == "a*" ]]
#    True or false for each?
# answer:

# 4. [ $1 = ok ] && echo yes
#    Is && part of the test or not? Why?
# answer:

# 5. x="*"   (run from a directory that contains files)
#    echo $x      vs      echo "$x"
#    What does each print?
# answer:

# 6. [ a < b ]      vs      [[ a < b ]]
#    What does each one do? Which one might touch the filesystem?
# answer:

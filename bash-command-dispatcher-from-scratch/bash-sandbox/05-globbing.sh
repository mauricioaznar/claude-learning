# S5 — globbing (pathname expansion)
#
# Reading a case: type the command exactly as written, including ; && > |.
# Only a spaced-out `and` / `vs` separates two commands, so run each side on its own.
#
# Idea: after splitting, any UNQUOTED word containing * ? or [...] is treated
# as a filename pattern. Bash replaces it with the list of matching filenames
# in the current directory. The program never sees the *.
#
# Run these from inside glob-playground/:
#   cd glob-playground
# It contains: apple.txt  banana.txt  cherry.log  "d e.txt"  (note the space)

# 1. ../args *.txt
#    How many args? Is "d e.txt" one arg or two?
# predict:
# actual:

# 2. ../args "*.txt"
# predict:
# actual:

# 3. ../args *.md
#    Nothing matches. Does bash pass zero args, or something else?
# predict:
# actual:

# 4. p="*.log"
#    ../args $p        vs        ../args "$p"
#    The * came out of a variable. Does globbing still happen?
# predict:
# actual:

# 5. ../args ?????.txt
#    (five question marks) Which files match?
# predict:
# actual:

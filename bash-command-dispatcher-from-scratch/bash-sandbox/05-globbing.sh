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
# predict: i think it is two, since the globbing doesnt quote and it will return <d e.txt> instead of <"d e.txt">. Just as a reminder the model we have for bash processing before running a program is token -> expansion -> word splitting -> globbing -> quote removal ->run
# actual: args 3, <apple.txt> <banana.txt> <d e.txt>

# 2. ../args "*.txt"
# predict: one arg. globbing is expanded into the quotes. <apple.txt banana.txt d e.txt>
# actual: one arg <*.txt>. globbing doesnt happen inside quotes. characters that are special that work on quotes are: ${}, \,
# globbing doesnt happen inside quotes.

# 3. ../args *.md
#    Nothing matches. Does bash pass zero args, or something else?
# predict: nothing. since it is an empty result
# actual: args count 1 <*.md>

# 4. p="*.log"
#    ../args $p        vs        ../args "$p"
#    The * came out of a variable. Does globbing still happen?
# predict: both show <*.log>
# actual: 1st shows args count 1: <cherry.log>. 2nd shows args count 1: <*.log>
# p="*.log" is a command on its own, it goes through the pipeline including quote removal. ../args sees p=*.log and globbing takes place.

# 5. ../args ?????.txt
#    (five question marks) Which files match?
# predict: args count 1: <apple.txt>
# actual: args count 1: <apple.txt>


#6. ../args "d "*.txt
# predict: glob happens, get joined each time with "d ". so <d e.txt> <d banana.txt> <d apple.txt>
# actual: args count 1 <d e.txt>
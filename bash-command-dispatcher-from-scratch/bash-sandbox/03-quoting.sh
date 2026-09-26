# S3 — quoting: single, double, none
#
# Reading a case: type the command exactly as written, including ; && > |.
# Only a spaced-out `and` / `vs` separates two commands, so run each side on its own.
#
# Idea: quotes don't become part of the argument. They are instructions that
# say which later processing steps may touch the text inside:
#   '...'   nothing happens inside. Not even $x. Fully literal.
#   "..."   $x and $(...) still expand, but the result is NOT split on spaces
#           and NOT treated as a filename pattern.
#   none    everything happens: expansion, splitting, globbing.
# After all processing, bash deletes the quote characters themselves
# ("quote removal") — that's why ./args never sees them.
#
# Setup in your terminal first:   x=hello

# 1. ./args '$x'  "$x"  $x
#    How many args, and what is each one?
# predict:
# actual:

# 2. ./args "a"'b'c
#    One argument or three? What is its text?
# predict:
# actual:

# 3. ./args "${x}world"  "$xworld"
#    Why are these different? (Hint: where does bash think the name ends?)
# predict:
# actual:

# --- quotes inside quotes ---

# 4. ./args "it's"        and        ./args 'say "hi"'
#    Does the inner quote end anything, or is it just a character?
# predict:
# actual:

# 5. ./args 'it's'
#    What happens? (If bash shows a `>` prompt and waits, press Ctrl+C.)
#    Why?
# predict:
# actual:

# 6. ./args "say \"hi\" to $x"        and        ./args 'say \"hi\"'
#    Does the backslash work the same way in both kinds of quote?
# predict:
# actual:

# 7. ./args "'$x'"
#    Single quotes inside double quotes: does $x still expand?
# predict:
# actual:

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
# predict: 3 args. first is fully literal will be shown as '$x'. second as hello, and third as hello
# actual: 3 args, prediction matched reality. Except the first case. I thought it was going to be shown as literallly $x. Without quote removal.

# 2. ./args "a"'b'c
#    One argument or three? What is its text?
# predict:one argument. bash does quoteremoval last, categorization happens first. so everyting gets read as a single word since nothing coudl be expanded. I've missed the text prediction, that was the whole point of the excercise.
# actual: one argument. <abc>
# tokenization . the tokenizer only ends a word at unquoted whitespace or an operator

# 3. ./args "${x}world"  "$xworld"
#    Why are these different? (Hint: where does bash think the name ends?)
# predict: given the tokenizer, on the second case it doesnt stop until finding a whitespace or operator. so the token would end up being xworld. empty.
# ${x} gets replaced by the expander since its inside braces operators. and the final expaned value would be helloworld
# actual: first is <helloworld>. second is args 1, <>.
# when setting $ everything after it letterwise, numberwise and _ becomes the variable


# --- quotes inside quotes ---

# 4. ./args "it's"        and        ./args 'say "hi"'
#    Does the inner quote end anything, or is it just a character?
# predict: i think the first case will throw since it expecting a second ' character. the second wont since everything inside '' is full text no tokenization, expansion or any other of the buzzwords
# actual: first printed <it's>. my prediction was wrong. prediction was right on the second example. inside quotes only a few characters are special. so single quoting inside doublequote is treated as a character only
# shell doesnt raise an error when quote is left ope. it show continuaion promtp

# 5. ./args 'it's'
#    What happens? (If bash shows a `>` prompt and waits, press Ctrl+C.)
#    Why?
# predict: the previous exercise was insightful. since the third appeareance of ' doesnt have a matching quote, bash prompts for continuation
# actual: bash prompts for end of quote. The first third quote was left without its pair

# 6. ./args "say \"hi\" to $x"        and        ./args 'say \"hi\"'
#    Does the backslash work the same way in both kinds of quote?
# predict: it doesnt work the same way. on the first case it gets ignored. second case does work like you would expect on a jascript string.
# actual: first: <say "hi" to hello>. second: <say \"hi\">. on the first \ quoting escapes the character and keeps it inside of the text. on the second every character gets treated as a character including the escaping character

# 7. ./args "'$x'"
#    Single quotes inside double quotes: does $x still expand?
# predict: no. single quotes inside double quotes are kept as ordinary characters. viceversa too
# actual: it expands. <'hello'>. I got some of the explantion right, but missed the end reulst. single quotes are kept as characters meaning $x is left as an expandable variable

# 8. Pass  cost $5, it's cheap  as ONE argument. $5 must stay literal, so the
#    text can't simply be double-quoted, and the apostrophe can't sit inside
#    single quotes (case 5). How? (Combine case 2's gluing with case 4.)
# answer: ./args 'cost $5,'" it's cheap"
#    (first try had a space on both sides of the join → two spaces)

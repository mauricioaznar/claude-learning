# bash-command-dispatcher-from-scratch

Learn the bash command line by rebuilding a real CLI from scratch: the `inopack`
utility, which wraps a multi-repo git workflow behind a single `inopack <command>`
dispatcher. A read-only snapshot of the original scripts lives in
`reference/inopack-commands/` — study it, then rebuild each command myself under
`scripts/`.

The rebuild is fully self-contained in this subproject. Wiring the finished
commands into the real umbrella repo is a **separate, later goal** — not part of
these exercises.

## Reference bundle

- `reference/inopack-commands/README.md` — manifest + command map.
- `reference/inopack-commands/docs/commands.md` — the authoritative behavior contract.
- `reference/inopack-commands/scripts/` — the original scripts (the answer key).

Read the contract alongside each script; several behaviors (confirmation prompts,
non-interactive handling, ff-only semantics) are specified there, not just in code.

## Sandbox — how bash builds a command's arguments

Added before drill 3.1: the predictions depend on a model of how bash turns a
typed line into the argv a program receives, which the drills hadn't taught
yet. `bash-sandbox/` holds predict-then-run worksheets (`# predict:` then
`# actual:`), measured with `./args` (Mau writes it in S1), which prints the
arg count and each arg in `<…>`. `glob-playground/` holds fixture files for S5.
S1–S6 cover everything 3.1 needs; S7–S8 were added on request.

- ✅ `01-argv.sh` — a command receives a list, not a line; why `echo` hides it
- ✅ `02-tokens.sh` — words vs operators (`;` `&&` `|` `<` `>`), tokenized first
- ✅ `03-quoting.sh` — `'…'` vs `"…"` vs none, quote removal, quotes inside quotes
- ✅ `04-splitting.sh` — word splitting of unquoted expansions; empty → zero args
- ✅ `05-globbing.sh` — pathname expansion, no-match passthrough, `*` from a variable
- 🚧 `06-brackets.sh` — `[` is a command, `[[` is grammar
- ⬜ `07-exit-status.sh` — `$?`, `&&` / `||`, why `A && B || C` isn't if/else
- ⬜ `08-command-substitution.sh` — `$(…)`: stdout capture, splitting, nesting

## Warm-up

Each reference script packs several new bash concepts into one file — too much
at once with no prior bash experience. Before rebuilding a command, work through
small standalone drills in `warmup/<command>/`, one primitive at a time, each
reviewed (statically, pasted in chat) before moving to the next. Add a new
subfolder when another command needs its own primitives.

### `warmup/install-shorthand/` — primitives for `install-shorthand.sh`

- ✅ `01-args.sh` — positional arguments (`$1`, `$#`, `$@`)
- ✅ `02-defaults.sh` — `${1:-default}` and `set -u`
- ✅ `03-conditionals.sh` — `if`/`[[ ]]` and exit codes
- ⬜ `03-1-predictions.sh` — predict-only: expansion pipeline vs quoting, `[ ]` (command) vs `[[ ]]` (grammar)
- ⬜ `04-case.sh` — `case` statement
- ⬜ `05-shift.sh` — `shift`
- ⬜ `06-functions.sh` — functions + heredoc
- ⬜ `07-location.sh` — script self-location (`${BASH_SOURCE[0]}`)
- ⬜ `08-exec.sh` — `exec` vs. a plain call

## Exercises

Priority path first (the daily-driver reads + install), then the git-workflow
commands, then bonus commands. Rebuild each under `scripts/`, then diff against
`reference/inopack-commands/scripts/` and note what differed.

- ⬜ **E1 — dispatcher** (`inopack.sh`). Route a subcommand to a sibling script.
  Teaches: `set -u`, deriving `ROOT` from `${BASH_SOURCE[0]}`, `${1:-help}`,
  `shift`, `case`, `exec`, quoted `"$@"`, `usage()` heredoc, exit codes.
- ⬜ **E2 — install-shorthand** (`install-shorthand.sh`). Define the machine-local
  `inopack` shell function idempotently. Teaches: `while/case/shift` arg parsing,
  deferred expansion (writing `\$@` literally), parameter-expansion string edits,
  idempotent rc-file editing (grep-detect → sed/awk-rewrite → append), atomic
  replace (`mktemp`+`mv`), backups (`cp -p`), login vs interactive shells,
  dry-run, writing outside the repo.
- ⬜ **E3 — summary** (`summary.sh`). Read-only session orientation. Teaches:
  arrays, `local`, `git -C`, read-only plumbing (`rev-parse`, `status --porcelain`,
  `log --format`, `rev-list --count`, upstream `@{u}`), markdown scraping with
  grep/awk/sed, `printf` column tables, `mktemp`, `$((…))`, `while read` over
  `git worktree list --porcelain`, here-strings `<<<`, process substitution,
  `GIT_OPTIONAL_LOCKS=0`.
- ⬜ **E4 — status** (`status.sh`). Branch sync status across repos. Teaches:
  ahead/behind via `rev-list --left-right --count A...B` (three-dot vs two-dot),
  `for-each-ref` branch enumeration + prefix filtering, `fetch --prune`, a
  function that sets globals, mode dispatch.
- ⬜ **E5 — load** (`load.sh`). Fast-forward shared branches without switching.
  Teaches: ff-only semantics, advancing a non-checked-out branch via fetch
  refspec (`origin b:b`) vs `merge --ff-only` in place, dirty guard, before/after
  SHA to prove real movement, `rev-parse --verify --quiet`, `${sha:0:7}`.
- ⬜ **E6 — switch** (`switch.sh` + `workspace.sh`). Switch canonical repos;
  worktrees opt-in. Teaches: `source`ing a helper and using its functions +
  globals, calling another command as a step, `checkout` vs `checkout -b --track`,
  ff-to-origin then `merge origin/dev`, worktree lifecycle, subshell `( cd … )`.
- ⬜ **E7 — save** (`save.sh`). Commit + push dirty repos on their current
  branches. Teaches: scope arg parsing with `shift 2`, default message via
  `$(date …)`, version bump through an embedded `node -e`, `add -A`/`commit`/
  `push HEAD:branch`, `$?` handling, canonical (`.git` dir) vs worktree (`.git` file).
- ⬜ **E8 — db-restore** (`db-restore.sh`). Drop/recreate/load the local DB.
  DESTRUCTIVE. Teaches: destructive-command safety, pure-bash URL parsing with
  parameter expansion, `urldecode` via `printf %b`, localhost-only guard, external
  tool discovery + version parse (`sed -nE`, `sort -Vr`), probe-to-connect loop,
  `MYSQL_PWD`, `/dev/tty` confirmation (+ no-terminal fallback), piping a dump in,
  `$SECONDS` timer.

Bonus (after the priority path): ⬜ doctor, ⬜ ship, ⬜ drop, ⬜ new-branch /
new-feature / new-fix, ⬜ worktree-init, ⬜ statusline.

## Failures

*symptom → cause → fix. Record bugs as they happen while rebuilding.*

- **`01-args.sh` only printed the enumerated list, not the total count** →
  the spec asks for two outputs (how many args, and each one numbered) →
  missed the first half → added an explicit line reporting the total before
  the loop.
- **`01-args.sh` computed the total by looping over `"$@"` twice** — once
  just to count, once to print — instead of using `$#`, which already holds
  the count with no loop needed. Two loops doing the job of one builtin +
  one loop.
- **`${$1:-fallback}` → `bad substitution`** → wrote the `$` inside the
  braces, treating it as part of the name; `$` is the expand operator and the
  opening `${` already supplies it, so bash read `$$` (PID) then choked on
  `1` → write the bare name: `${1:-...}`.
- **`fallback="world"` + `${1:-fallback}` always printed the text
  "fallback"** → the word after `:-` is literal text, so it never read the
  variable (line 1 was dead code, masked because value and text were the same
  word) → `${1:-$fallback}`.
- **`03`: non-"ok" input exited 0** → first draft had only an `if … then
  exit 0; fi`, no `else`; an `if` where no branch runs returns 0, so the script
  fell off the end reporting success → explicit `else` with `exit 1`.
- **`03`: `echo "" exit 1` never exited** → no `;`/newline between them, so
  `exit` and `1` were just more arguments to `echo` (and it printed to stdout,
  not stderr) → separate commands, `echo "failure" >&2; exit 1`.
- **`03`: no-arg run crashed under `set -u`** → `"$1"` unguarded, script died
  on the `[[ ]]` line with `$1: unbound variable` before either branch →
  `"${1:-}"`.
- **S1: `args` again printed only the list, no count** — the same miss as
  `01-args.sh` (spec gives two outputs; only the loop got written) → added
  `echo "args count $#"` before the loop. Recurred: re-read the spec's
  example output before calling it done.
- **S1: every `./args` call printed two extra `one two three` lines** →
  scratch `echo` experiments were typed into the `args` file instead of the
  terminal, so they became part of the measuring tool → deleted them. A tool
  that prints extra lines makes every later measurement misleading.
- **S1 case 3: `./args "" and ./args` reported 3 args** → typed the whole
  worksheet line, so `and` and `./args` were just more arguments (accidentally
  proving S1's point) → run each side of an `and`/`vs` separately.
- **S1 case 4: predicted echo "gets a single argument and ignores quotes"** →
  identical output looked like identical input → `./args` showed 2 vs 3 args;
  echo joins its arguments with one space, which hides the boundaries. echo
  never sees quotes — bash removes them before the program runs.
- **S2 case 3: recorded that `./args a\>out.txt` overwrote `out.txt`** →
  the file was left over from case 2 (the `rm out.txt` step was skipped); its
  timestamp and contents (`<a>`, case 2's output) showed nothing had touched
  it → deleted it, re-ran, no file. Clean up fixtures between cases, and check
  a file's contents/mtime before crediting a command with writing it.
- **S2 case 6: predicted `&&` checks whether stderr is empty** → confused
  "what got printed" with "how the command ended" → `&&`/`||` look only at the
  exit status (0 = success). The shell never inspects output.
- **S2 case 6: "actual" line was a copy of case 5's** → claimed both commands
  printed, though case 4 had just shown a failed redirection means the command
  never starts → re-ran and recorded only the shell's error. An "actual" must
  come from the run, not from the previous answer.
- **S3 case 3: `"$xworld"` recorded as 0 args** → it was typed unquoted; an
  unquoted empty expansion vanishes, a quoted one stays as one empty arg
  (`<>`) → re-ran as written: `args count 1`.
- **S3 case 7: right rule, wrong conclusion** → knew `'` is ordinary inside
  `"…"`, still predicted `"'$x'"` wouldn't expand → the *outer* quote sets the
  rules; inner quote chars are just data, so `$x` still expands → `<'hello'>`.
- **S3 quiz: `'cost $5, '" it's cheap"` gave two spaces** → both glued pieces
  carried a space at the join → keep it on one side only.
- **S4 case 2: said splitting happens "inside the program"** → the program
  only ever receives a finished argv → both tokenizing (typed spaces) and word
  splitting (spaces from an expansion) are done by the shell, before exec.
- **S4 case 4: guessed tokenizing trimmed `"  padded  "`** → the spaces came
  out of `$z`, so it was word splitting → name the step by where the text came
  from: typed → tokenizing, expanded → word splitting.
- **S4 cases 1/4: recorded 4 spaces where the value had 2–3** → copied from
  memory, not from the output. In a worksheet about whitespace, the count *is*
  the result — copy it from the terminal.
- **S4 case 6: `IFS=" "` gave `<a b c>` (no split)** → run in zsh, which
  doesn't split unquoted expansions → re-ran inside `bash` → `<a> <b> <c>`.
  Check the prompt (`bash-3.2$`) before any S4/S5 case.
- **S4 case 6 (first draft): a test whose outcomes looked identical** →
  `IFS=` vs whitespace on `a,b,c` both print `<a,b,c>`, so it proved nothing →
  pick input where the competing hypotheses produce different output.
- **S4 case 7: predicted "IFS cuts on unset variables"** → IFS is a set of
  *characters*; expansion finishes (unset → nothing) before splitting runs →
  `"a $unset c"` → `a  c`, and empty IFS cuts nothing → `<a  c>`.
- **Claimed `set -u` treats empty as unset** → mixed it up with the colon in
  `${1:-x}` → `set -u` errors only on *unset*; set-but-empty passes.
- **S5 case 1: predicted `*.txt` splits `d e.txt` into two args** → reasoned
  "globbing doesn't add quotes", as if a later step would re-split the result
  → globbing runs *after* splitting and nothing re-splits after it, so each
  match is one arg. The pipeline written in the same prediction already
  answered it — check the step order before reasoning about quotes.
- **S5 case 2: predicted `"*.txt"` globs "into the quotes" → one arg holding
  all matches** → treated quotes as a container for results → quotes mark the
  typed characters as ordinary, so a quoted `*` is a literal asterisk and
  globbing never runs → `<*.txt>`. Special inside `"…"` is exactly `$` `` ` ``
  `"` `\` (not `${}` — the `$` is the special char).
- **S5 extra case: predicted `"d "*.txt` → `d apple.txt`, `d banana.txt`, …**
  → thought the glob expands first, then the prefix is glued onto each match
  (that's how brace expansion behaves) → the whole word is *one pattern*
  matched against existing names: quoted chars are literal, the unquoted `*`
  is the wildcard → only `d e.txt`. A glob filters; it never invents names.
- **S5 case 3: predicted `*.md` (no match) → zero args** → reused S4's
  empty-word rule, which is about expansions that produce empty text → a
  no-match glob produces the *unchanged word*, so `args` got `<*.md>`.
- **S5 case 4: predicted unquoted `$p` (p="*.log") stays `<*.log>`** → as if
  the assignment's quotes stayed attached to the value → quotes are consumed
  by the assignment command; `p` stores bare characters. Each use re-runs the
  pipeline, and unquoted `$p` is split *and globbed* → `<cherry.log>`.
- **`args` one-line rewrite: an `[[ -n $word ]]` guard hid empty args** →
  aimed a "zero args" guard at the wrong thing (a `for` over zero args already
  prints nothing; only `printf fmt "$@"` needs a guard) → then patched it with
  an `else` printing `<>`, which is what `"<$word>"` already gives for an empty
  word → deleted the `if`. Substitute the edge value by hand before adding a
  branch for it; quoting already handles empty.
- **S6 case 1: "actual" said `type test` → `[ is a shell builtin`, and
  `type [[` → `is a shell keyword` (no name)** → written from memory, not
  copied; `type` always echoes the name it was asked about → re-copy from the
  terminal. Same miss as S4 cases 1/4.
- **S6 case 2: predicted `[a = a]` would assign `a]` to `[a`** → saw an `=`
  and read it as assignment → assignment is recognized only by shape
  (`name=value`, no spaces, valid name); a spaced `=` is just an argument, and
  the first word `[a` is the command name → `[a: command not found`. Same
  rule as `count = 1` in Learnings.
- **S6 case 3: predicted `[[` "skips expansion"** → blamed the whole
  expansion step for `[`'s failure → `[[ $x = "hello world" ]]` exited 0, and
  that's only possible if `$x` *was* expanded (literal `$x` ≠ `hello world`).
  `[[` expands but skips word splitting (and globbing); splitting is what
  turned one value into `<hello> <world>` and gave `[` 5 args instead of 4.
- **S6 case 4: predicted `[ $y = "" ]` (y empty) "expands, isn't split" →
  true** → forgot S4's empty-word rule: an unquoted expansion that yields
  nothing vanishes (0 args) → `[` got `<=> <> <]>`, one operand short →
  `unary operator expected`.

## Learnings

*concepts that stuck, in plain words, for a cold reader.*

- **`"$@"` vs `$@`.** Quoted, each positional parameter expands as its own
  intact word — an argument containing a space stays one item. Unquoted,
  bash concatenates them and then word-splits the result on `IFS`
  (whitespace, by default), so an argument like `"foo bar"` gets split back
  into two separate words. Quote it essentially always. `"$*"` is a third,
  different form: it joins every argument into one single string.
- **`$#` is the argument count, `$@` is the argument list — different
  variables, don't loop to compute what `$#` already gives you.**
- **Bash variable assignment has no declaration keyword — it's recognized by
  shape.** `name=value`, with **no space** on either side of the `=`, at the
  start of a simple command, is what makes bash treat it as an assignment
  instead of trying to run a command. `count = 1` (with spaces) is NOT an
  assignment — it's three words, and bash tries to run a command literally
  named `count`, passing it `=` and `1` as arguments, which fails with
  "command not found." Reading and writing use different syntax on purpose:
  `name=value` to set, `$name` to expand.

- **`${name:-default}` has two slots.** The *name* slot (before the
  operator) is a bare variable name — never a `$`. The *word* slot (after) is
  ordinary text, expanded like a double-quoted string: `$var` inside it is a
  variable, plain letters are literal. The word is only expanded when the
  default is actually used.
- **`:-` vs `-`.** With the colon, empty (`""`) is treated like unset → the
  default kicks in. Without it, only unset triggers the default; an explicit
  empty argument is kept.
- **`set -u` (nounset).** Reading an *unset* variable becomes an error
  (`x: unbound variable` on stderr, script exits non-zero at that line).
  Without it, bash silently expands the typo to an empty string and keeps
  going. Set-but-empty passes. Default expansions (`${x:-..}` etc.) guard the
  name slot only — an unset variable in the word slot still trips it. Under
  `set -u` a bare `$1` with no args fails, which is why the dispatcher uses
  `${1:-help}`. Careful: `set - u` (with a space) is different — it sets `$1`
  to `u`.
- **Exit codes: 0 = success, non-zero = failure.** `$?` holds the last
  command's code; `exit N` sets the script's. With no explicit `exit`, a
  script returns its last command's code — fragile, so be explicit.
- **`if` runs a command and branches on its exit code** — it doesn't evaluate
  a boolean. `[[ … ]]` / `[ … ]` are just commands that exit 0 (true) or 1.
- **`[ ]` vs `[[ ]]`.** `[` is a command (= `test`, POSIX): its arguments are
  expanded normally, so unquoted `$x` gets word-split and globbed → "unary
  operator expected" / "too many arguments". `[[` is a bash keyword: no
  splitting/globbing inside, supports `&&`, `||`, `=~`. Inside both, `=` is
  comparison, never assignment.
- **Why `[` and `[[` exist at all.** Bash has no boolean expressions — every
  decision is "run a command, check its exit status". To ask "is x equal to
  hello?" you need a *program* that answers via exit status: that's `test`,
  and `[` is the same program under another name (it just demands a closing
  `]` so `if [ … ]` looks familiar). Being a command, it gets arguments only
  after the full pipeline has run — splitting, globbing, `>` as a redirect —
  which is why it's easy to break. `[[` was added later as grammar, so bash
  knows up front it's a condition and skips the dangerous steps. JS analogy:
  `[` is a function call, `test(x, "=", "hello", "]")` — arguments are
  evaluated before it runs, so it can't protect you; `[[` is an operator like
  `typeof`, which is syntax and can therefore get special rules
  (`typeof undeclaredVar` doesn't throw; passing it to a function does). Not a
  closure — a closure is a function keeping access to variables from where it
  was defined; "arguments evaluated first, then passed in" is just how every
  call works.
- **Expansion vs quoting.** Expansion = bash replacing `$x`, `$(cmd)`,
  `$((…))`, `*`, `~` with values *before* the command runs. Quotes don't make
  "strings" (everything is text); they control which characters are special and
  where a word ends. `'…'`: nothing special. `"…"`: `$` still expands, but the
  result isn't split or globbed. Default (`${1:-}`) handles *unset*; quotes
  handle *splitting* — separate problems, use both: `"${1:-}"`.
- **A program receives an array of strings (argv), never your typed line.**
  Unquoted whitespace is where bash cuts the line into arguments, and then
  it's discarded — one space or five, same single boundary. Quoted spaces are
  kept as ordinary characters inside one argument. `echo` prints its
  arguments joined by one space, so `echo "one two" three` (2 args) and
  `echo one two three` (3 args) look identical. To see real boundaries, print
  each argument in brackets (`bash-sandbox/args`).
- **`""` vs no argument.** `./args ""` → `$#` is 1 and `$1` is *set* to the
  empty string. `./args` → `$#` is 0 and `$1` is *unset*. Bash's terms are
  set/unset, not assigned/unassigned.
- **stderr:** `>&2` redirects a command's stdout to fd 2. Errors go there.
- **macOS `/bin/bash` is 3.2.** Unbound-variable exit code differs (127 vs 1),
  and `"$@"` with no args errors under `set -u` there (fixed in 4.0).
- **Tokenizing happens first.** Before any `$` or `*` expansion, the shell
  cuts the line into words and operators (`;` `&&` `||` `|` `<` `>`).
  Operators need no surrounding spaces (`a>out.txt` is 3 tokens) and are never
  passed to the program. Quoting (`"…"`, `'…'`, or `\` for one character)
  turns an operator character back into an ordinary one; the quotes are removed
  before the program runs, so `./args "a>b"` and `./args a\>b` both receive
  `a>b`.
- **Redirections are set up by the shell before the program starts.** `>`
  opens (creates/truncates) the file and wires it to stdout; `<` wires a file
  to stdin. The program never sees them in argv. If setting one up fails
  (`< missing-file`), the shell prints its own error, the command's status is
  non-zero, and the program is never started.
- **Three standard streams:** stdin (fd 0, `<`), stdout (fd 1, `>`), stderr
  (fd 2, `2>`). `>>` appends instead of truncating.
- **List operators decide on exit status only:** `;`/newline → always run the
  next; `&&` → only if the previous exited 0; `||` → only if non-zero.
- **Terminal is zsh, worksheets target bash.** Tokenizing/redirection behave
  the same; splitting (S4) and globbing (S5) don't — run those with `bash`.
- **Quotes are rules for the text inside, then deleted.** `'…'`: nothing
  special, not even `\`. `"…"`: only `$`, `` ` ``, `"`, `\` are special;
  expansions happen but the result isn't split or globbed. The *outer* quote
  decides: `'` inside `"…"` (and `"` inside `'…'`) is an ordinary character.
  Quote removal happens last, so the program never sees quote characters.
- **Adjacent pieces glue into one word.** A word only ends at unquoted
  whitespace or an operator, so `"a"'b'c` → `abc`, and quoting styles can be
  mixed inside one argument: `'cost $5,'" it's cheap"`. A `'` can't appear
  inside `'…'` at all — close, add it, reopen: `'it'\''s'` (the idiom), or use
  `"…"` with `\$`.
- **Backslash inside `"…"`** escapes only `$` `` ` `` `"` `\` newline and is
  then removed (`"\$x"` → `$x`); before anything else it stays (`"a\b"` →
  `a\b`). Inside `'…'` it's just a character.
- **Variable-name boundaries.** After a bare `$`, the name is the longest run
  of letters/digits/`_`: `$xworld` is the variable `xworld`. `${x}world`
  delimits it explicitly — use braces whenever a name is followed by
  name-like characters.
- **Shell vs environment variables.** `x=hello` lives only in that shell
  process. `./args $x` works without `export` because the shell substitutes the
  text before starting the program. `export` matters only when the program
  itself reads the variable.
- **Unquoted empty expansion → zero args; quoted → one empty arg.**
- **Word splitting** (after expansion, unquoted only): the shell cuts the
  expanded text at characters in `IFS` (default: space, tab, newline). Runs of
  IFS *whitespace* count as one separator, and leading/trailing whitespace is
  dropped (`"  padded  "` → `padded`). Typed spaces are a different step —
  tokenizing — and only quoting at the keyboard stops those.
- **Empty word rule:** a word vanishes only if the *whole* word expands to
  nothing unquoted: `$y` → 0 args, `"$y"` → 1 empty arg, `a$y` → `a`.
- **`IFS` is a variable the splitting step reads**, not something the program
  sees. `IFS=,` cuts on commas; `IFS=` (empty) turns splitting off entirely —
  same effect as quoting, for every unquoted expansion (idiom: `IFS= read -r
  line`). Change it inside `( … )` so the subshell's change doesn't leak.
- **zsh doesn't word-split unquoted `$x`.** Run S4/S5 inside `bash`
  (`/bin/bash` is 3.2 on macOS; fine for the sandbox).
- **The full order:** tokenizing → expansion → word splitting → globbing →
  quote removal → run. Quote removal only deletes typed quote characters; it
  never cuts a word.
- **Glob characters:** `?` = exactly one char (a space counts), `*` = zero or
  more, `[ab]` / `[!a]` = one char from / not from a set. `*` and `?` skip a
  leading `.` (dotfiles) unless the pattern starts with `.`.
- **Each glob match is exactly one arg, spaces included.** No step after
  globbing re-splits, so `for f in *.txt` / `./args *.txt` are safe with
  spaced filenames. Filenames only break once stored as text and expanded
  again unquoted (S4 splitting). Quotes are never "added" to results — the
  question is always whether a later step re-reads the text.
- **A glob word is one pattern, quoted per character.** `"d "*.txt` matches
  names starting `d ` and ending `.txt`: quoted chars are literal parts of the
  pattern, unquoted `* ? [` are wildcards. The word globs if any wildcard is
  unquoted. Globs filter existing names; brace expansion (`d{1,2}.txt`)
  generates text without looking at the disk.
- **No match → the word passes through unchanged** (bash default). So
  `for f in *.log` with no logs loops once with `f='*.log'`. `shopt -s
  nullglob` makes it vanish instead; `shopt -s failglob` makes it an error;
  zsh errors by default (`no matches found`). Guard loops with nullglob or
  `[[ -e $f ]] || continue`.
- **Variables store characters, not quoting.** `p="*.log"` stores `*.log`;
  its quotes belonged to that assignment and are gone. Globbing only asks
  whether a char is quoted *in the current command*, not where it came from,
  so unquoted `$p` globs. Unquoted expansion = split + glob; that's the full
  reason to write `"$var"` (e.g. `rm $file` with `file='report*.txt'`).
- **`printf` vs `echo`.** `printf` adds no newline unless the format has
  `\n`, and repeats its format once per remaining argument (`printf '<%s> '
  "$@"`) — but with zero args still prints it once (`<> `). Keep data out of
  the format string (a `%` in data would be read as a directive). `%d` for
  numbers, `%s` for strings. Plain `echo` = just a newline.
- **Comparison operators in `[[ ]]`:** strings `==` `!=` `-z` (empty) `-n`
  (non-empty); numbers `-eq -ne -lt -le -gt -ge`, or `(( a > b ))` with the
  usual symbols. `<`/`>` inside `[[ ]]` compare *strings*: `[[ 10 < 9 ]]` is
  true. To tell "no args" from "one empty arg", test `$#`, never `$1`.
- **When the pipeline runs: per command, right before it runs.** Bash reads
  one complete command (a line, or a whole `if…fi` / `for…done` / function
  block), tokenizes it once, then — as each simple command inside is about to
  execute — does expansion → splitting → globbing → quote removal and runs it.
  So `x=hi; echo $x` works on one line, loops re-expand every iteration, and a
  syntax error on line 50 doesn't stop lines 1–49 from running (unlike JS,
  which parses the whole file first).
- **Debugging:** `echo "[$x]"` (brackets show empty), `"${1-UNSET}"` (unset vs
  empty), `set -x` / `bash -x script` (prints each command after expansion).

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
- **Expansion vs quoting.** Expansion = bash replacing `$x`, `$(cmd)`,
  `$((…))`, `*`, `~` with values *before* the command runs. Quotes don't make
  "strings" (everything is text); they control which characters are special and
  where a word ends. `'…'`: nothing special. `"…"`: `$` still expands, but the
  result isn't split or globbed. Default (`${1:-}`) handles *unset*; quotes
  handle *splitting* — separate problems, use both: `"${1:-}"`.
- **stderr:** `>&2` redirects a command's stdout to fd 2. Errors go there.
- **macOS `/bin/bash` is 3.2.** Unbound-variable exit code differs (127 vs 1),
  and `"$@"` with no args errors under `set -u` there (fixed in 4.0).

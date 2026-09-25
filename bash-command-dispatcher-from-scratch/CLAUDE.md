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

## Warm-up (pre-E1)

E1 packs eight new bash concepts into one script with no prior bash experience
— too much at once. Before attempting E1, work through small standalone drills
in `warmup/`, one primitive at a time, each reviewed before moving to the next:

- ✅ `01-args.sh` — positional arguments (`$1`, `$#`, `$@`)
- ⬜ `02-defaults.sh` — `${1:-default}` and `set -u`
- ⬜ `03-conditionals.sh` — `if`/`[[ ]]` and exit codes
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

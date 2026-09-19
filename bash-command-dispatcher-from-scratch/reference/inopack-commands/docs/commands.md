# INOPACK command reference

The tracked scripts in `scripts/` are the workflow implementation. Invoke them
through the provider-neutral dispatcher:

```bash
inopack <command> [args]
# or, from the umbrella directory:
bash scripts/inopack.sh <command> [args]
```

The `inopack` name is a machine-local shell alias or function that delegates to the
tracked dispatcher. It is convenience only; the fallback command is portable.

`doctor` reports whether this machine has it, since it is per-machine and untracked.
Install it from a checkout of this umbrella — the script writes the definition from its
own location, so it is always correct for this machine:

```bash
bash scripts/install-shorthand.sh
```

⚠️ **Do not write the definition by hand, and this document deliberately does not print
one to copy.** The absolute path is the only drive-dependent value in the workflow (every
tracked script derives its own `ROOT` from `BASH_SOURCE`), and a hand-copied definition is
the one way it goes wrong: the drive letter differs per machine, so a pasted rc line
silently drives a *different* umbrella. `doctor` detects that case and prints the repair
command; it never edits anything itself.

⚠️ **Git Bash starts a login shell, and a login shell does not read `~/.bashrc`** —
neither `/etc/profile` nor `/etc/bash.bashrc` sources it. Without a `~/.bash_profile`
holding `[ -f ~/.bashrc ] && . ~/.bashrc`, the shorthand is defined in a file nothing
opens, and the symptom is simply `inopack: command not found`. `install-shorthand` writes
that bridge too; `doctor` checks for its absence.

## Session orientation

| Command | Behavior |
|---|---|
| `start` / `summary` | Read-only orientation: active features, fixes, todos, plans, repository state, dirty files, and command vocabulary. It does not pull, switch, save, install, or modify a worktree. Every provider starts here. |
| `status [features\|fixes]` | Read-only branch and synchronization status. |
| `load` / `pull` | The only sanctioned pull. Fast-forwards eligible shared branches without deliberately changing the active branch; reports dirty or diverged branches instead of overwriting them. `load --reconcile-current` explicitly merges origin into a clean, diverged currently checked-out shared branch and stops visibly on conflicts. |
| `doctor [--fast]` | Read-only machine readiness report: dependencies, `.env` presence, Prisma client freshness, stale worktree registrations, the `inopack` shorthand, GitHub CLI authentication, and available database checks. It never installs, generates, migrates, saves, or changes Git state. |
| `install-shorthand [--force] [--dry-run]` | Defines the machine-local `inopack` shell function in `~/.bashrc`, interpolating the umbrella path from the script's own location, and adds the `~/.bashrc` bridge to whichever login file Git Bash actually reads. Idempotent. Refuses to overwrite a definition pointing at a *different* umbrella unless `--force`, backs up any file it modifies to `<file>.inopack.bak`, and reports rather than merges a second definition it finds. This is the only command that writes outside the repository — it touches shell rc files in `$HOME` and nothing else. |

## Local database

| Command | Behavior |
|---|---|
| `db-restore [-y] [--dry-run] [--dump <file>] [--db <name>]` | Drops, recreates and repopulates the **local** `inopack` database from the gitignored `inopack.sql` dump. **Destructive** — it prompts for the database name unless `-y` is passed, and refuses any host that is not `localhost`. Connection details come from `MYSQL_URL` in `nestjs-inopack-graphql/.env`; the MySQL client is discovered (PATH, then each installed `MySQL Server <ver>`, newest first, preferring one matching the running server) so machines on different versions need no configuration. Override with `INOPACK_MYSQL`. Nothing else in the workflow calls it. |

A restore is only half of a rebuild: the dump is a snapshot, so tables added by later
migrations are missing until `npm run build && npm run migration:run` runs in
`nestjs-inopack-graphql`. This is unrelated to the test database, which has its own
commands in [workflow.md](workflow.md).

## Git workflow

Use these commands rather than raw `git commit`, `git push`, `git pull`, `git
checkout`, `git branch`, or `git merge`.

| Command | Current behavior |
|---|---|
| `save [--scope workspace\|umbrella\|all] [message]` | Deliberately stages, commits, version-bumps changed code repositories, and pushes each dirty repository's currently checked-out branch. Default `all` saves the paired code workspace plus the umbrella; `workspace` and `umbrella` are explicit narrower ownership scopes used by internal workflows and targeted saves. Every run reports excluded repositories. |
| `save --wip [--scope ...] [message]` | Explicit unfinished-work snapshot for handoff or another machine. It commits and pushes the chosen scope but does not bump package versions and does not require a changelog entry. |
| `switch [--worktree] <branch>` | By default, saves and switches the paired canonical repositories. Feature/fix entry also integrates current `origin/dev`; if that branch has a clean paired worktree, the worktree is removed first, while a dirty one is refused. With `--worktree`, a feature/fix instead creates or reuses its paired isolated worktree and prints its path; integration branches never use this option. |
| `new-branch <feature\|fix> [--worktree] <name> [description]` | Saves the current code workspace, creates the matching branch from `origin/dev`, checks it out in the canonical pair by default, registers and publishes the shared work item, and creates draft PRs to `dev`. `--worktree` creates an isolated paired checkout instead. `new-feature` and `new-fix` are short wrappers and accept the same option. |
| `ship [-y] [into] <target>` | The only merge command. Allowed: feature/fix -> `dev`; feature/fix/dev -> `stage`; `dev` -> `master`. Feature/fix -> `dev` is irreversible and prompts unless `-y` is passed. A shipped work item is archived. |
| `drop [-y] [branch]` | Closes the branch PR if necessary, deletes the branch locally and remotely in both code repos, archives its work-item and matching plan documents, removes its work-items registration, and verifies all of those cleanup conditions. Irreversible, so it prompts unless `-y` is passed. |

## Confirmation prompts and non-interactive sessions

`ship into dev` and `drop` are the two commands that ask for confirmation. `ship into
stage` and `ship into master` do **not** prompt — the guard covers integration into
`dev`, not promotion out of it, so a `dev -> master` ship goes through unattended.

Both prompts read from `/dev/tty`, which some environments do not provide: CI, a piped
or redirected shell, and agent sessions that are not attached to a terminal. In those
sessions the command detects the missing terminal, prints the hint below, and exits 1
before touching any repository — so nothing is ever left half-done:

```
   No terminal to confirm on. Re-run with -y to proceed: scripts/ship.sh -y dev
```

Both scripts probe the terminal by *opening* it (`{ true < /dev/tty; } 2>/dev/null`)
rather than testing it with `[ -r /dev/tty ]`. The stat-based test is not reliable
here: where there is no controlling terminal the device node still exists and still
looks readable, so the test passes and the subsequent read fails instead — which used
to abort the script on an unbound variable rather than printing the hint. Keep the
open-probe form if this block is ever edited.

Re-run with `-y`. The two scripts differ on where it may go:

- `ship` parses only a **leading** flag: `ship -y into dev` works, `ship into dev -y`
  silently ignores it and prompts anyway.
- `drop` scans every argument, so `drop -y <branch>` and `drop <branch> -y` are
  equivalent.

Passing `-y` is a substitute for the human answering the prompt, not for the decision
behind it. Automation should only use it when a person has already asked for that
specific ship or drop.

## Versioning and documentation

- Never edit `package.json` versions by hand. `save` bumps the patch of each changed
  code repository; a feature ship to `dev` bumps the minor. New branch creation is
  version-neutral.
- Before a normal save that completes meaningful work, update the relevant ongoing
  feature/fix document and append a dated entry to `docs/changelog.md`.
- Do not create a changelog entry for trivial metadata saves or a future explicit WIP
  snapshot.

## Provider adapters

No provider event may automatically save, pull, switch a branch, install packages,
or alter worktrees. Claude's optional SessionStart adapter invokes only `inopack
summary`; other providers may do the same, but the workflow does not depend on it.

## Later commands

No additional workflow commands are currently planned in this migration set.
`worktree-init <branch-slug>` explicitly bootstraps a paired worktree with GraphQL
`npm ci` + `npm run db:generate`, then React `npm ci`. Before installing, it copies
missing `.env` and `.env.*` files from each canonical repository and preserves any
environment files already present in the worktree. It never starts a server or runs
tests.

Worktrees are optional parallel-development infrastructure. They isolate files,
dependencies, and checked-out branches, but not the application's MySQL database or
ports 3008/3000. Coordinate migrations and run only the branch currently under test.

## Server audit

`server-config-audit.sh` is a separate, read-only server command. It is not part of
the Git workflow.

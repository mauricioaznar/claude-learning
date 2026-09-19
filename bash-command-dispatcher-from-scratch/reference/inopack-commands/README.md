# INOPACK command scripts — reference bundle

A snapshot of the bash command line used by the **inopack** umbrella repo, exported
as a learning reference. The goal is to study these commands and eventually
**rebuild them from scratch**.

All commands go through one dispatcher, `scripts/inopack.sh`, which routes a
subcommand to a focused script beside it. Business behavior lives in the focused
scripts; the dispatcher is just the public surface.

```
inopack <command> [args]   →   scripts/inopack.sh   →   scripts/<command>.sh
```

## Priority commands (study these first)

| Command             | Script                        | What it does |
|---------------------|-------------------------------|--------------|
| dispatcher          | `scripts/inopack.sh`          | Entry point. `case` statement mapping every subcommand to its script. Start here. |
| `inopack setup`*    | `scripts/install-shorthand.sh`| **How the utility is installed.** Defines the machine-local `inopack` shell function in the login rc file, interpolating the umbrella path from the script's own location. Idempotent; the only command that writes outside the repo. |
| `inopack summary`   | `scripts/summary.sh`          | Prints the read-only session orientation (features, fixes, todos, plans, repo/branch table). Also aliased as `start`. |
| `inopack status`    | `scripts/status.sh`           | Shows repository status across the sub-repos. |
| `inopack load`      | `scripts/load.sh`             | Fast-forwards shared branches without switching. Aliased as `pull`. |
| `inopack switch`    | `scripts/switch.sh`           | Switches the canonical repos to a branch (worktrees are opt-in). |

\* There is no command literally named `setup`. Installation is done by
`install-shorthand` (`bash scripts/install-shorthand.sh`), which is what defines
the `inopack` shell function on a machine.

## Shared dependency (required)

| Script                  | Role |
|-------------------------|------|
| `scripts/workspace.sh`  | Sourced by switch, drop, worktree-init, new-branch, ship, save. Resolves whether you are in the umbrella, a canonical checkout, or a paired worktree. Not a command itself, but the others break without it. |

## Extra commands (learn as bonus steps)

| Command            | Script                  | What it does |
|--------------------|-------------------------|--------------|
| `inopack save`     | `scripts/save.sh`       | Commit + push all dirty repos on their current branches. |
| `inopack new-branch` | `scripts/new-branch.sh` | Create a feature/fix branch (worktree opt-in). |
| `inopack new-feature`| `scripts/new-feature.sh`| Thin wrapper over new-branch for features. |
| `inopack new-fix`  | `scripts/new-fix.sh`    | Thin wrapper over new-branch for fixes. |
| `inopack ship`     | `scripts/ship.sh`       | Merge a branch into dev/stage/master. |
| `inopack drop`     | `scripts/drop.sh`       | Delete/clean up a branch. |
| `inopack doctor`   | `scripts/doctor.sh`     | Report machine and worktree readiness. `--fast` for a quick check. |
| `inopack db-restore` | `scripts/db-restore.sh` | Drop, recreate and load the local DB from `inopack.sql`. DESTRUCTIVE. |
| `inopack worktree-init` | `scripts/worktree-init.sh` | Initialize a paired worktree. |
| (status line)      | `scripts/statusline.sh` | Renders the shell/status-line prompt string. |

## Reference docs

- `docs/commands.md` — the authoritative command contract (the source of truth for
  behavior and flags). Read this alongside the scripts.
- `docs/agent-instructions.md` — how an agent is expected to work in the umbrella.
- `docs/inopack-CLAUDE.md` — the umbrella's top-level CLAUDE.md.

## Suggested learning order

1. `docs/commands.md` (contract) + `scripts/inopack.sh` (dispatcher).
2. `scripts/install-shorthand.sh` — how it gets installed.
3. `scripts/summary.sh`, `status.sh`, `load.sh`, `switch.sh` — the daily-driver reads.
4. `scripts/workspace.sh` — the shared resolver they all lean on.
5. The extra commands, in whatever order is interesting.

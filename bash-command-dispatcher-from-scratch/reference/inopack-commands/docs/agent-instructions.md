# INOPACK agent instructions

This is the provider-neutral entry point for every coding agent working in
INOPACK. Provider-specific discovery files (`AGENTS.md`, `CLAUDE.md`, or a future
equivalent) must point here; they must not redefine the workflow.

## Required reading order

1. Run `inopack summary` (or `bash scripts/inopack.sh summary` from the umbrella).
2. Read [workflow.md](workflow.md) and [business-rules.md](business-rules.md) in
   full.
3. Read [commands.md](commands.md).
4. Read [memory/MEMORY.md](memory/MEMORY.md), then any memory files relevant to the
   task.
5. Read the relevant ongoing feature, fix, and plan documents before changing them.

## Non-negotiable behavior

- The user runs development servers, tests, builds, lint/typechecks, and browser
  verification. An agent does not run or drive any of them. `npm run codegen` and
  `npm run db:generate` remain allowed only when a schema change requires generated
  committed output.
- Never run or recommend `prisma migrate` / `prisma db push` in
  `nestjs-inopack-graphql`; they cannot work there. See the test-database section
  of [workflow.md](workflow.md) for the commands that replace them.
- Use the documented INOPACK commands for commit/push, pull, branch checkout,
  branch creation, merging, and branch deletion. Do not substitute raw Git for
  those operations.
- Do not rely on provider lifecycle hooks to save, switch branches, or establish
  context. Start with `inopack summary`; saving is an explicit workflow action.
- A bare user request to `save` means `inopack save`: commit and push all dirty
  repositories on their currently checked-out branches. Use `--scope workspace`
  or `--scope umbrella` only when the user or an internal workflow explicitly
  requests that narrower ownership boundary.
- Before committing, remove unused imports from modified code and update the
  applicable work-item document. Add a meaningful changelog entry before a normal
  completed-work save.
- If a repository is dirty before new work begins, surface the files and ask how to
  proceed. Never auto-commit, auto-discard, or overwrite someone else's work.

The scripts are the executable workflow source of truth. If a script and this
documentation disagree, stop and report the mismatch rather than improvising.

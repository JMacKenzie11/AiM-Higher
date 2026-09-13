# Conventions

Rules for working in this repo. Short on purpose: it is a rules file, not
documentation. The reasoning behind most of these, and the incidents that
produced them, is in `docs/failure-modes.md`.

## Branches and sessions

**One open branch, one owning session.** The session that created a branch
owns it. Another session may read it, probe it and report on it. It must not
commit to it. Additions arrive as a follow-up PR, stacked on that branch when
they need its content to edit. Worked example: #72 extends failure mode E5 by
stacking on #71 rather than committing into it.

**One worktree per concurrent session.** Branch ownership does not help while
the checkout is shared, because a `git checkout` in one session moves the
branch under the other. That is what happened between the sessions behind #71
and #72.

```sh
git worktree add "../AiMHigher-<topic>" -b <branch> main
cd "../AiMHigher-<topic>"
ln -s ../AiMHigher/.env.local .env.local
ln -s ../AiMHigher/.env.provisioning .env.provisioning
ln -s ../AiMHigher/.provisioning-state .provisioning-state
ln -s ../AiMHigher/.claude .claude    # project skills and settings, if needed
npm ci                                # skip for a docs-only change
git worktree remove "../AiMHigher-<topic>"   # when the PR merges
```

Those four are gitignored, so they do not follow the tree, and a worktree
without them fails in ways that look like broken code. Symlink rather than
copy anything holding a secret: one source of truth, and no second copy to
forget about. `node_modules/`, `.next/` and test output are per-worktree and
generated, never shared. The dev clone is shared by every worktree: harness
probes roll back and are safe to run concurrently, seed scripts are not.

## Gates

**"Gates green" means CI, and the run is linked.** A local `npm run
typecheck`, `lint` or `test` is local green. Useful while working, never
evidence that a gate passed.

## Scope

**One change in flight per surface.** A surface is a table's policies, a
route, a server action, a document. A second change to one already in flight
waits for it, or stacks on it.

**Fleet migrations and spine-touching merges go through Jason.** Anything
that runs against provisioned instances, and any merge into shared structure
the rest of the app hangs off, is his call and his timing.

**Fleet migrations and any write to a live database are executed by Jason,
or on his explicit per-run instruction. Never inferred from prior
approval.** Not from an identical command approved an hour ago, not from a
clean dry run, not from a settled pattern. The rule holds hardest where
running it looks obviously fine, because obviously-fine is where this
project's incidents have lived, and a rule that relaxes on convenience is a
convention rather than a rule.

## Migrations

**A migration reaches a database only through `migrate:instances`,
`migrate:dev`, the provisioning CLI, or the RLS harness's rolled-back
application.** Never raw SQL, never a direct `supabase db push`, and
dev counts as a live database. If you need an unlanded migration
present to develop against, that is `rls:hazards -- --pending
<file>.sql`, which applies it inside a transaction and rolls it back.
Anything else leaves a database whose state no file describes. Failure
mode E2.

## Permissions

**A role widening ships with its RLS change and a harness probe in the same
PR.** App guards are courtesy; RLS is the boundary. The probe runs as the
granted role, asserts both the write that must now succeed and a write the
same role must still be refused, and is shown failing against the pre-fix
schema before its green is believed. Failure mode E5.

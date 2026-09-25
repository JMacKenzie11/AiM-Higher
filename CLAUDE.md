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

**Work in the main checkout by default.** `git checkout -b <branch>` in
`AiMHigher` itself. Jason's editor is open on that folder, and a branch
living in a sibling directory means the file he is asking about is not
where he looks for it.

**One worktree per CONCURRENT session.** Branch ownership does not help
while the checkout is shared, because a `git checkout` in one session
moves the branch under the other. That is what happened between the
sessions behind #71 and #72, and it is still the hazard.

So the rule is conditional rather than blanket: **before checking a
branch out in the main folder, establish that no other session is
mid-task on this repo.** `git status`, `git worktree list`, and
`gh pr list` for a branch this session did not create. If another
session is working, take a worktree and say so. If you cannot tell,
ask rather than moving somebody's checkout.

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

`git worktree remove` refuses a directory holding `node_modules`, and
leaves the tree deregistered but still on disk. `git worktree prune`
then `rm -rf` it; check first that nothing untracked is in there.

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

## Documentation

**A PR that changes user-visible behaviour, permissions, or operational
procedure updates the affected documentation in the same PR.** Not the
next one, and not a follow-up issue. Three destinations, each with its
own trigger:

**`docs/product-spec.md`** — behaviour, roles, permissions, data model,
architecture. The spec describes what IS. A PR that leaves it describing
what WAS is incomplete, and the next person to read it is misled by a
document that looks current.

**`docs/help/*.md`** — **only what a user does in the application.** A
new surface, a moved control, changed wording, a role gaining or losing
a capability they would try to use. These are served in-app by the `?`
widget (`src/lib/help/loader.ts`), matched to the route and filtered by
the `roles:` frontmatter, so a stale one is read by the person it is
wrong for, standing on the page it is wrong about.

**Nothing about how it works underneath belongs here.** RLS policies,
migrations, query plans, the harness, instance resolution, tooling: a
user has no use for any of it and cannot act on it. That material goes
to the product spec, or to the operational docs, or nowhere. A help
page that explains the implementation is worse than one that says
nothing, because it costs the reader time to discover it was not for
them.

The test is not "did this change touch something users can reach". It
is "would a user, on that page, do something differently because of
it". Most permissions work fails that test and still belongs in the
spec; a renamed button passes it.

`npm run check:help` proves a route HAS a doc; nothing proves the doc
is TRUE, which is what this rule is for. Two more places carry the same
kind of copy and are easy to forget: `src/lib/email.ts` (invite and
reset emails, read outside the app where nobody can check them against
the UI) and the `InfoTip` / `TermTooltip` strings beside the controls
they describe.

**`docs/deployment.md`, `docs/failure-modes.md`, `docs/e2e.md`** —
rituals, tooling, recovery procedures, fixtures. Largely habit already;
the rule makes it uniform.

**Exempt is a claim, not a default.** A PR touching `src/` with no
documentation change must say `Docs-exempt: <reason>` in its
description, and CI fails without one. Real reasons are narrow: a pure
refactor with no behaviour change, test-only work, internal tooling a
user never meets. "Nothing to say" is not one of them — if a change is
genuinely invisible, saying which kind of invisible takes four words.

**Every report carries a Docs line**, beside the gates and the probes,
so the documentation status is as visible as the test status:

    Gates: CI green, <run link>
    Probes: 6 pass, 0 fail (timezone lock red first)
    Docs:  spec §1 (Tenancy & Roles) updated; help portfolio.md updated

or, where nothing needed saying:

    Docs:  exempt — pure refactor, no behaviour change

The same line shapes `.github/pull_request_template.md`. The exemption
also goes in the PR body as `Docs-exempt: <reason>` on its own line,
which is the form `npm run check:docs` reads.

## Permissions

**portfolio_admin may hold a write policy only on `companies`,
`company_features`, `profiles` and `portfolio_admin_events`.** The list is
closed. `npm run rls:hazards` fails on a write policy naming the role
anywhere else, in either spelling, and plants a deliberately wrong one on
every run so a clean result is never a broken matcher. Reads are wide on
purpose; writes are four tables.

**A role widening ships with its RLS change and a harness probe in the same
PR.** App guards are courtesy; RLS is the boundary. The probe runs as the
granted role, asserts both the write that must now succeed and a write the
same role must still be refused, and is shown failing against the pre-fix
schema before its green is believed. Failure mode E5.

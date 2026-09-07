# The instance seed

`instance-seed.sql` is the reference data a new instance needs on day
one. `npm run provision` runs it against a freshly migrated project,
and it is safe to rerun against an existing one.

## The maintenance rule

**Reference data changes go in `instance-seed.sql`, as part of the
feature change that needs them. Never as a direct insert into a live
database.**

New instances are born from this file. Anything added straight to
production is silently missing from every instance provisioned
afterwards — and silently is the word that matters. Nothing fails. The
new instance simply has an empty dropdown, or a Classroom with no
categories, or a lookup that returns nothing, and the person who hits
it has no reason to connect it to a row someone inserted by hand months
earlier.

Each piece of reference data lives in exactly one place — a migration
or this seed, never both — and which one is decided when the data is
introduced, not later; `strengths_items` is the example to keep in
mind, because the failure mode is not "missing" but "added in both
places and drifted", where two sources of truth disagree and neither
looks wrong on its own.

Because every statement is idempotent, the file doubles as the way to
roll reference data out to instances that already exist: add the rows
here, then run the seed against each instance.

## Adding to it

- One `insert … on conflict … do update` per row set. The conflict
  target must be a real unique constraint, not a guess.
- `do update` rather than `do nothing`, so a correction to an existing
  row propagates on the next run. `do nothing` would make this file
  create-only and quietly stale.
- Do not add anything that depends on a company existing. There are no
  companies when this runs.

## What does not belong here

**Company data.** Companies, profiles, commitments, priorities,
meetings, scorecards. A new instance starts empty and its first company
is created through the app.

**User accounts.** The first admin is created by the provisioning step
that follows, from the `--admin-email` flag.

**The `public.instances` registry row.** That row is what makes a
hostname resolve at all, so it is written last, to the *control plane*,
by its own provisioning step. Every project has an `instances` table
because the migrations create one, but only the control plane's copy is
ever read.

## Already handled elsewhere — do not duplicate

**`strengths_items`.** 38 rows, shipped in
`supabase/migrations/0103_strengths_items_seed.sql`, so they arrive
with `supabase db push`. Reference data, but already versioned as a
migration; copying it here would create two sources of truth that would
eventually disagree.

**The practices registry.** Code, not data —
`src/lib/practices/registry.ts`. Nothing to seed.

**Default leadership functions.** Created when a company is created
(`createCompanyAction`), not per instance.

## The known exception: Classroom

Classroom **content** — lessons and trainings — is authored inside the
product, not in this repo, so it is not covered by this seed. A new
instance gets the category structure and no lessons.

Syncing that content from production into a new instance is a separate
problem, deferred and tracked separately. Do not solve it by pasting
lesson rows into this file: they are long, they carry image references,
and they change through the product rather than through a deploy.

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

## One dataset, one owner

**Every dataset is owned by exactly one tool: this seed, or
`scripts/sync-content.ts`. Never both.**

The test for which: reference data that ships with the code and is
identical on every instance belongs here. Content authored in the
product on the primary instance belongs to sync. Content authored
anywhere else belongs to neither and should not be propagated.

Classroom was briefly owned by both, and the overlap was not benign.
This seed inserted a "Phase 1" category with no explicit id, so every
instance minted its own UUID for the same logical row. Sync matches by
primary key, so it read production's category and the instance's
category as two different rows: one to insert, one to delete. Both
held the unique slug `build-the-team`, so the write order decided
whether it violated a constraint.

The deeper problem was not the constraint, it was the loop. Every
`npm run migrate:instances -- --seed` would have re-minted a divergent
row for the next `npm run sync:content` to delete, forever, with each
tool correctly doing its job.

That is why the rule is about ownership rather than ordering. Two
tools writing the same table cannot be made safe by sequencing them,
because there is no sequence in which both are authoritative.

### Consequence for provisioning

A newly provisioned instance now has **no Classroom content at all**
until sync runs. That is the correct state, not a gap:

```bash
npm run provision -- --subdomain acme --name "Acme" --admin-email ours@aims-institute.com
npm run sync:content -- --instance acme
```

See `scripts/README.md` for the sync tool.

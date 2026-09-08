# Deployment: environments and the instance registry

Which database a request talks to is decided once, in middleware, by
resolving the hostname. Everything downstream reads that decision
rather than reading environment variables at the point of use. See
`src/lib/instances/` for the code and `supabase/migrations/0169_instances.sql`
for the table.

The practical consequence is the thing to internalise before deploying:

> A hostname that resolves to no instance is rewritten to
> `/instance-not-found` **before** anything touches Supabase. Not the
> marketing page, not `/sign-in`, not an app route. The whole site on
> that hostname serves one page saying nobody lives here, with a 200.

So a misconfigured environment does not throw and does not page you. It
serves a polite empty building. Both halves below have to be in place.

## The two halves

**A row in `public.instances`.** Maps a subdomain to an `env_prefix`.
Written by `npm run seed:instances`, which is idempotent and safe to
rerun. The production row is a literal in that script, so running it
with no configuration writes exactly the row production needs.

**Variables named by that prefix.** A row with `env_prefix` `PROD`
sends the resolver to `PROD_SUPABASE_URL`, `PROD_SUPABASE_ANON_KEY`
and `PROD_SUPABASE_SERVICE_KEY`. Keys are never stored in the table: a
service-role key in a row is a service-role key in every backup and
every exported query result.

The two are joined by nothing but a string. Break the join and the
request resolves to null, which is the empty building above.
`src/lib/instances/production-parity.test.ts` covers that join.

## Hostnames

| Hostname | Resolves as | Notes |
|---|---|---|
| `aims-hq.com` | `@` | Apex. 308s to www today, but must not 404. |
| `www.aims-hq.com` | `@` | `www` is decoration, stripped before lookup. |
| `acme.aims-hq.com` | `acme` | A future customer instance. Needs its own row. |
| `*.vercel.app` | preview | Never hits the registry. Uses `PREVIEW_INSTANCE_*`. |
| `localhost` | nothing | Single label, no apex row. Use `LOCAL_INSTANCE_*`. |

`@` is borrowed from DNS zone files, where it has meant "the zone's own
name" for decades. It is a row like any other, not a fallback: if
nobody seeded it, the live domain resolves to nothing. That is
deliberate. Falling back to a default database is how one customer ends
up reading another customer's rows.

## Vercel environment variables

Set these in **Project → Settings → Environment Variables**, scoped to
the environment named in each section.

### Production

| Variable | Points at |
|---|---|
| `CONTROL_PLANE_SUPABASE_URL` | The project holding `public.instances` |
| `CONTROL_PLANE_SUPABASE_SERVICE_KEY` | Service-role key for that project |
| `PROD_SUPABASE_URL` | The production database |
| `PROD_SUPABASE_ANON_KEY` | Production anon key |
| `PROD_SUPABASE_SERVICE_KEY` | Production service-role key |

The control plane lives in the production project today, so
`CONTROL_PLANE_SUPABASE_URL` and `PROD_SUPABASE_URL` currently hold the
same value. They are named separately on purpose: nothing in the
registry code may reference the app's variables, so moving the registry
to its own project later is an environment change rather than a code
change.

`PROD_*` has a second job. The cron routes are excluded from instance
resolution entirely, because a scheduled invocation has no visitor and
no meaningful hostname. They read `PROD_*` through
`getCurrentInstanceConfig()`'s fallback, which throws by name rather
than guessing. See `src/lib/instances/current.ts`.

### Preview

| Variable | Points at |
|---|---|
| `PREVIEW_INSTANCE_SUPABASE_URL` | **The dev database, never production** |
| `PREVIEW_INSTANCE_SUPABASE_ANON_KEY` | Dev anon key |
| `PREVIEW_INSTANCE_SUPABASE_SERVICE_KEY` | Dev service-role key |

Preview does not need `CONTROL_PLANE_*`. A `*.vercel.app` hostname is
matched before the registry lookup, so a preview never reads the
registry and never needs to reach the control plane.

Preview URLs are generated per deployment, so they can never be
registered as instances and all share one database. Pointing them at
the dev project is what isolates preview deploys from live customer
data: a branch that drops a column or rewrites a table cannot reach
production from a preview.

A partial set here resolves to null rather than throwing. A preview is
a deployed environment, and a half-configured one should fail the
request, not take the process down. The symptom is the empty building,
so if a preview shows "no instance at this address", check that all
three are set on the Preview environment specifically.

Do **not** set `PROD_SUPABASE_*` on Preview. A preview cannot reach a
registry row anyway, but leaving production keys out of that
environment removes the question.

### Development (local)

Not Vercel. `.env.local`, and `LOCAL_INSTANCE_SUPABASE_URL` /
`_ANON_KEY` / `_SERVICE_KEY` pointed at the dev project. When those are
set the hostname is ignored entirely and every request goes to that
database, which is how a developer pins their machine. All three or
none: a partial set throws, naming what is missing.

Define them **once**. A dotenv file lets a later assignment win, so a
second copy further down the file silently overrides the first.

## Instance-prefixed variables belong to the provisioning tool

`{PREFIX}_SUPABASE_URL`, `{PREFIX}_SUPABASE_ANON_KEY` and
`{PREFIX}_SUPABASE_SERVICE_KEY` — `ACME_SUPABASE_URL` and so on — are
written by `npm run provision` and owned by it.

**Never edit one by hand in the Vercel dashboard.**

Not a style preference. Vercel returns no readable value for any
environment variable: a `sensitive` one comes back as an empty string,
and an `encrypted` one comes back as ciphertext, with `?decrypt=true`
making no difference. So provisioning cannot compare what is there
against what it wants. It compares a fingerprint of what it last wrote,
recorded per key in `.provisioning-state/{subdomain}.json`.

That works, and it has one blind spot: a value changed in the dashboard
still matches the recorded fingerprint, so provisioning sees no drift
and skips. The variable stays wrong until somebody notices an instance
behaving oddly, and nothing connects the two.

**If one of these has to change**, do it one of these two ways:

1. Change it through the tool — update the value in the state file and
   rerun `npm run provision`. Preferred: the fingerprint stays true.
2. If it has already been edited by hand, delete that key from
   `envFingerprints` in `.provisioning-state/{subdomain}.json`. The
   next run finds no fingerprint, rewrites the variable, and records a
   correct one.

Variables that are not instance-prefixed — `PROD_*`, `CONTROL_PLANE_*`,
`PREVIEW_INSTANCE_*` — are not touched by provisioning and are yours to
edit normally.

## Connecting to a provisioned project

Measured while building `npm run provision`, and durable because the
next thing that needs a database connection will hit all of it again.

**A new project has no dedicated IPv4 address.** The direct database
host, `db.{ref}.supabase.co`, resolves to IPv6 only. From an IPv4-only
machine or CI runner it does not time out, it is refused outright:

```
dial error (connect ECONNREFUSED 2600:1f18:5e38:3f00:…:5432)
```

The dashboard still shows that host, and the Supabase CLI still
defaults toward it, so this reads as a credentials or firewall problem
and is neither.

**Migrations connect through the session pooler on port 5432.** Not
6543. The pooler advertises 6543 and `pool_mode: transaction`, and
transaction pooling cannot run what migrations need — prepared
statements, `SET`, advisory locks. Session mode on 5432 behaves like a
direct connection and is IPv4-reachable.

**The pooler host comes from the Management API**, not from the region
string:

```
GET /v1/projects/{ref}/config/database/pooler → db_host
```

`us-east-1` happens to map to `aws-0-us-east-1.pooler.supabase.com`
today. Deriving the host from the region bakes in a naming scheme that
is Supabase's to change, and the API already answers the question.

The construction lives in `migrationConnectionUrl()` in
`scripts/lib/provisioning/supabase-management.ts`, which also
percent-encodes the password because the CLI requires the URL to be.

> **Phase 4:** the migration runner that applies a release to every
> instance must reuse `migrationConnectionUrl()` and the same pooler
> lookup rather than rebuilding a connection string. Two
> implementations of this will not stay in agreement, and the way they
> disagree is a migration that silently skips an instance.

## The Edge runtime and Sensitive variables

Middleware runs on the Edge runtime, and instance resolution runs in
middleware, so the question was whether a variable marked **Sensitive**
in Vercel reaches it. Sensitive variables cannot be read back after
creation, and Next inlines what an edge bundle can see at build time.

**Answered, on the 2026-09-06 deploy of PR #49.** All five production
variables are Sensitive, and resolution worked: `www.aims-hq.com`
resolved through the registry and a session minted against
`PROD_SUPABASE_URL` was accepted. Sensitive variables do reach edge
middleware at runtime.

Worth knowing because it is not obvious, and because the code reads
these dynamically. `resolveInstance` takes `process.env` as an argument
and `registry.ts` builds names from a row's `env_prefix`, so nothing
here is a literal `process.env.NAME` the inliner could have seen. It
relies on the runtime environment being populated, and it is.

## Instance status: taking an instance offline

`public.instances.status` is the switch that takes an instance on and
offline. Flipping that one column is the whole procedure. No DNS
change, no Vercel change, no environment variable touched, nothing
deleted.

Use it for non-payment, for trouble part-way through a migration, and
for a teardown in progress.

### What each value means

| | `active` | `suspended` |
|---|---|---|
| Middleware | serves the app | serves `/instance-suspended` on every path, including `/sign-in`, with HTTP **503** |
| Session refresh | yes | no, and the instance's database is never opened |
| Cron fan-out | included | omitted; its jobs do not run |
| Migration runner | migrated | skipped, and named in the summary as skipped |
| Data and keys | untouched | untouched |

503 rather than 404 or 200 is deliberate. 200 would tell an uptime
monitor a paused instance is healthy. 404 would tell a crawler the
customer's site no longer exists and should be deindexed, which is a
lasting consequence for a temporary state. 503 is the only status that
says "come back later", and it is what a billing pause or a migration
window actually means.

**Any other value is treated as `suspended`,** and reported to Sentry
as a warning naming the instance and the value. Migration 0169
constrains the column to those two, so a third one means the
constraint was dropped or something wrote past it. Of the two possible
mistakes, an instance wrongly offline is a phone call; an instance
served on the strength of a value we do not understand is a data
question.

The definition lives in `src/lib/instances/types.ts`. Every consumer
asks `isServable()` rather than comparing to a string, so there is one
definition of what counts as active.

### To suspend an instance

```sql
update public.instances set status = 'suspended' where subdomain = 'acme';
```

Against the CONTROL PLANE database, which is the production project
today. Takes effect within one registry cache TTL: 60 seconds
(`CACHE_TTL_MS` in `src/lib/instances/registry.ts`). Suspension is
deliberately not instant. If an instance has to be cut off this
second, that is an infrastructure action, not a registry one.

### To restore it

```sql
update public.instances set status = 'active' where subdomain = 'acme';
```

Also within one TTL. Nothing else is needed: no key was rotated, no
row was deleted, no environment variable changed.

### What suspension does not do

It does not stop anyone who is already signed in from holding a valid
session token until it expires. It stops every request through
middleware, which is every page and every API route under the matcher,
so there is nothing for that token to be used against. It is an access
switch, not a revocation. If credentials themselves are the problem,
rotate the instance's keys.

## Delivering reference data to existing instances

Migrations carry schema. The seed carries reference data, and it is
NOT replayed by a migration, so a row added to
`supabase/seed/instance-seed.sql` after an instance was provisioned
never reaches that instance on its own.

```bash
npm run migrate:instances -- --seed
```

Migrates each active instance and then runs the seed against it. The
seed is idempotent by construction: every insert carries an
`ON CONFLICT`, which is what makes running it against a live instance
safe. See `supabase/seed/README.md` for the maintenance rule.

Off by default because reference data changes far less often than
schema does. The seed result prints under each instance in the same
summary, so a green migration with a failed seed cannot be read as a
green instance, and a failed seed exits nonzero like any other
problem.

Order matters and is enforced: migrations first, then the seed. The
seed writes into tables the migrations create, so seeding an instance
that is behind would fail on a table that does not exist yet. An
instance whose migrations were blocked or failed is not seeded at all.

## How we know multi-instance operations work

Run on **2026-09-07** against live infrastructure, deliberately, before
any client depended on the fleet behaving correctly. Three instances
were in the registry at the time: `@` (production, the primary),
`promiseone` (a real client), and `phase4test` (provisioned for this
exercise and torn down after it).

The purpose was not to test the code — unit tests do that. It was to
test the LOOP: that a migration authored in this repository reaches
every registered database through the runner and nothing else, that a
scheduled job does its work on every instance, that one instance
failing does not take the others with it, and that suspension is a
switch rather than a hope. Each of those is a claim about
infrastructure, and infrastructure claims are not settled by tests.

### What was run, and what it showed

**A probe migration reached every instance.** Migration 0171 created
`public.phase4_probe`, one table with one row, expand-safe by
construction because no running code reads it. `--dry-run` reported it
pending on all three instances with the connection verified on each.
The real run applied it to all three, exit 0. Confirmed afterwards by
querying each database's `supabase_migrations.schema_migrations`
directly rather than trusting the runner's own summary.

**The probe also proved migration 0170 fires fleet-wide.** No RLS
policy was written for `phase4_probe`, so row level security could
only be enabled on it by 0170's `ensure_rls` event trigger. It was
enabled on all three, including production — the instance that was
missing that trigger entirely until earlier the same day (see E2 in
`docs/failure-modes.md`). A hand-applied safety net that had drifted
out of the files was demonstrably back and working everywhere.

**One cron cycle did real work on every instance.**

```
13:32:10.704  [transcripts] @: checked 5 sources, ingested 0, analyzed 0
13:32:11.053  [transcripts] phase4test: checked 0 sources, ingested 0, analyzed 0
13:32:11.379  [transcripts] promiseone: checked 0 sources, ingested 0, analyzed 0
13:32:11.379  [transcripts] 3 instances: 3 ok, 0 failed
```

Corroborated independently of the log: all five of production's active
transcript sources carried a `last_checked_at` at or after 13:32:00Z,
the newest stamped 13:32:10.605 — a tenth of a second before the `@`
line was written. Two records, same event.

**A failing instance did not stop the others.** A registry row
`phase4bogus` was inserted with `env_prefix` `PHASE4BOGUS`, for which
no environment variables exist. This is the missing-env-vars path: a
row that is registered and active but resolves to nothing.

```
13:33:23.612  [transcripts] @: checked 5 sources, ingested 0, analyzed 0
13:33:23.669  [instances] "phase4bogus" is registered with env_prefix
              "PHASE4BOGUS" but PHASE4BOGUS_SUPABASE_URL,
              PHASE4BOGUS_SUPABASE_ANON_KEY,
              PHASE4BOGUS_SUPABASE_SERVICE_KEY are not set.
              Refusing to resolve it.
13:33:23.669  [transcripts] phase4bogus: FAILED: registered with
              env_prefix "PHASE4BOGUS" but ... are not all set
13:33:23.927  [transcripts] phase4test: checked 0 sources, ...
13:33:24.191  [transcripts] promiseone: checked 0 sources, ...
13:33:24.191  [transcripts] 4 instances: 3 ok, 1 failed
```

The timestamps are the evidence, not the counts. The failure landed at
**position 2 of 4**, and positions 3 and 4 ran anyway. A loop that
aborted on error would have stopped at two lines. Production's five
sources were all stamped during this same failed run, so the primary
completed its full ingest pass while another instance was failing.

The run returned 500, which is the point: a partial failure is visibly
red in Vercel's cron history rather than buried in a 200 body. Removing
the row returned the next run to `3 instances: 3 ok, 0 failed` with no
lingering state.

Sentry received one event for it, carrying the tag `instance =
phase4bogus`. That tag is the reason `forEachActiveInstance` wraps each
instance's work in `Sentry.withIsolationScope` rather than a plain
scope: the tag has to apply to anything captured anywhere inside that
instance's turn, including from code several awaits deep that has no
idea the fan-out exists. Without it an error from the Drive provider
arrives with no way to tell whose Drive it was. Confirmed by reading
the issue's tag panel, not inferred from the message text — the message
happens to name the prefix because the error string says so, which is a
different thing from being filterable by instance.

**Suspension took an instance offline and brought it back.**
`phase4test` was flipped to `suspended` at 13:35:36Z. Within 71 seconds
its hostname served `/instance-suspended` on `/`, `/sign-in` and
`/dashboard`, all 200, with no session cookie set on any of them —
`/dashboard` in particular stopped issuing its 307 to `/sign-in`, which
is what shows the rewrite lands ahead of the session check rather than
after it. It stayed suspended for just under four hours. The cron
omitted it entirely:

```
17:30:23.751  [transcripts] 2 instances: 2 ok, 0 failed
```

Flipped back to `active` at 17:32:15Z, it served the app again within
71 seconds, `/dashboard` back to its 307. Nothing else was touched: no
key rotated, no variable changed, no redeploy. One column.

**The contract step closed the cycle.** Migration 0172 dropped the
probe table. Applied through the runner to all three instances, exit 0,
confirmed absent from each database afterwards. 0171 and 0172 together
are one complete expand-and-contract cycle, run on production during
business hours, which is the whole argument for splitting changes that
way: neither half has a window in which any running deployment can
observe an inconsistency.

### What this did NOT prove

Stated because a proof document that overstates itself is worse than
none.

**Only one of the two failure shapes was exercised.** `phase4bogus`
fails at RESOLUTION, before the job starts — the helper never gets a
client. A failure INSIDE an instance's work (a valid-looking but wrong
key, a query error mid-pass) takes a different branch, the generic
`catch` around the job body. Both produce a red run and a tagged Sentry
event, and the second is covered by unit tests, but it has not been
driven live. If a future run wants it, a second bogus row pointing at a
syntactically valid but wrong Supabase URL is the cheapest way.

**The weekend jobs were not exercised live.** Only `/api/cron/
transcripts` was run. `scorecard` and `performance` use the same
`forEachActiveInstance` helper and the same summary machinery, so the
fan-out is shared, but their per-company bodies did not run against
multiple instances on this date. The first full-fleet weekend is the
real test of those.

**`phase4test` and `promiseone` both had zero transcript sources**, so
their per-instance lines read `checked 0 sources` throughout. That
proves they were REACHED and returned cleanly. It does not prove the
ingest pipeline works on a non-primary instance, because there was
nothing on them to ingest. Production is the only instance where the
pipeline itself was exercised.

### Things this run taught us

**Author migrations before provisioning, not during.** Migration 0171
was written while `supabase db push` was already applying 91
migrations to the new project. The Supabase CLI enumerates the
migrations directory when it runs, so 0171 could have been swept into
the provisioning push, which would have left it already applied on the
instance it was supposed to be pending on. It was not — `phase4test`
landed on 0170 with 91 applied, and the probe was genuinely pending
everywhere. That was luck, not design.

**A manual cron trigger makes this exercise cheap.** Vercel's Run
button on a cron job fires the same authenticated request the scheduler
does. Waiting for scheduled ticks would have made the failure-injection
step a half-hour of wall clock; triggering on demand made the whole
sequence minutes. `CRON_SECRET` is stored `sensitive`, so its value
cannot be read back from the Vercel API — the dashboard button is the
only way to trigger a run by hand, and it needs a person.

### Repeating this

Worth re-running after any change to `forEachActiveInstance`, the
migration runner, or middleware's instance resolution. The sequence:
provision a disposable instance, add a trivial expand migration, dry
run, real run, verify from the databases, one cron cycle, insert a
bogus registry row and trigger the cron, remove it and trigger again,
suspend and restore, contract migration, tear the instance down per
`scripts/README.md`.

The disposable instance matters. Every destructive step in that list
ran against `phase4test` and never against `promiseone`, which is a
client. A test that has to be careful about which instance it breaks is
a test that will eventually break the wrong one.

## Order of operations for a deploy

1. Set the Production and Preview variables above.
2. Run `npm run seed:instances` against the control plane. Idempotent,
   so rerunning is free.
3. Confirm the row: `subdomain` `@`, `env_prefix` `PROD`, `status`
   `active`.
4. Open a preview deployment and sign in.
5. Merge.
6. Check `www.aims-hq.com` and `aims-hq.com` both load, and that a cron
   route is not returning the not-found page.
7. **If the release carried a migration, catch up the dev clone:**
   `npm run migrate:instances -- --db-url "<clone session pooler url>"`.

### The dev clone is not migrated by the fleet, and that is deliberate

`migrate:instances` walks the registry, and the clone has no registry
row — a registry row is the switch that makes a hostname serve
customers, and the clone is disposable tooling. Giving it one to get it
migrated would make it look like an instance to every other fleet tool,
including `sync:content`. So it stays out, and catching it up is step 7
above rather than something the runner does.

The consequence, stated so nobody has to rediscover it: **after a
migration lands on the fleet, the clone is behind until somebody runs
step 7.** Local dev and the Playwright suite both point at the clone, so
the symptom is a feature that works in production and looks broken on a
laptop. On 2026-09-08 that was `/admin/companies` rendering every
Follow-Through rate as an em-dash, because the view in migration 0174
existed on both instances and not on the clone.

Two things make that survivable. The read logs an error naming the
consequence rather than failing silently, so the browser console says
what happened. And `npm run seed:e2e` is only needed after a *refresh*
from production, not after step 7 — a migration does not wipe the e2e
fixtures, so catching the clone up costs one command and nothing else.

Refreshing the clone from production is the other cure and a blunter
one: it replaces the schema wholesale, wipes every fixture, and needs
`npm run seed:e2e` afterwards. Use it when the clone's DATA is stale.
Use step 7 when only its SCHEMA is behind. See `docs/e2e.md`.

### What a preview does and does not prove

A green preview proves `PREVIEW_INSTANCE_*` is set and that resolution,
the middleware header and the app all work end to end. That is worth
having.

It does **not** exercise the registry. `*.vercel.app` is matched in
`resolveInstance` before the registry lookup, so a preview never reads
`CONTROL_PLANE_*` and never reads `PROD_*`. The first request that
exercises those is the first production request after the merge.

Nor can you force the registry path on a preview from outside. Vercel
overwrites `x-forwarded-host` at its edge, so a spoofed header is
discarded and the request still takes the preview branch. Confirmed on
PR #49: `x-forwarded-host: nobody.example.com` resolved anyway, which it
must not have done had the header been honoured.

So the production variables have to be verified by looking at them in
the Vercel dashboard. There is no deployed check that covers them
first. Verify, then merge, then check step 6 immediately.

### The production deployment's own .vercel.app alias

A production deployment is reachable both at `www.aims-hq.com` and at
its Vercel alias, `aims-higher.vercel.app`. The alias ends in
`.vercel.app`, so it matches the preview branch of `resolveInstance`
before the registry ever gets a say.

**The alias serving `/instance-not-found` is the expected, correct
state**, and it is now a `404`.

That is worth stating as a permanent smoke test rather than a curiosity,
because the two ways it can go wrong look nothing like each other:

| Hostname | Expected | What another answer means |
|---|---|---|
| `www.aims-hq.com` and the other real domains | `200`, the app | A 404 here means the registry lost its `@` row, or the apex stopped resolving |
| `aims-higher.vercel.app` | `404`, the not-found page | A **200 with the app** means `PREVIEW_INSTANCE_*` has been widened to Production again and the alias is serving a database |
| any nonsense subdomain | `404`, the not-found page | A 200 means resolution is falling back to a default, which it must never do |

### How it got here

`PREVIEW_INSTANCE_*` was once scoped to **Production and Preview**. On
that scoping the alias resolved to the **dev** database and served the
app: fail-safe in that it could not reach customer data, but hazardous
the other way round, because someone who bookmarked the alias thinking
it was production would be doing admin work against dev and never be
told.

Measured on 2026-09-06, same deployment, same moment, under the old
scoping:

| Hostname | Session from prod DB | Session from dev DB |
|---|---|---|
| `www.aims-hq.com` | 200 | redirected to sign-in |
| `aims-higher.vercel.app` | redirected to sign-in | 200 |

The variables are now scoped to **Preview** only, verified against the
Vercel API on 2026-09-07, so the preview branch finds nothing on a
production deployment and `resolveInstance` returns null. Real previews
keep their variables; `www.aims-hq.com` never took this branch anyway.

The 404 is what makes the smoke test honest. Until 2026-09-07 the alias
answered `200` while showing "there is no instance here", so a monitor
watching the alias reported a healthy hostname and a crawler saw a page
worth keeping. The body was right and the status was wrong.

### If production comes up empty

The symptom is every path on `www.aims-hq.com` serving the
"no AiMS Higher instance at this address" page with a 200.

Revert the merge commit and push. Vercel redeploys the previous
production build, which does not resolve hostnames at all and therefore
cannot hit this. Then fix the variables and re-merge. Nothing in this
change writes to a database on a failed resolution, so there is no data
to clean up.

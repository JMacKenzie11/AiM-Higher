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
| Middleware | serves the app | serves `/instance-suspended` on every path, including `/sign-in` |
| Session refresh | yes | no, and the instance's database is never opened |
| Cron fan-out | included | omitted; its jobs do not run |
| Migration runner | migrated | skipped, and named in the summary as skipped |
| Data and keys | untouched | untouched |

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

`PREVIEW_INSTANCE_*` is currently scoped to **Production and Preview**,
not Preview alone. That has a consequence worth knowing about.

A production deployment is reachable both at `www.aims-hq.com` and at
its Vercel alias, `aims-higher.vercel.app`. The alias ends in
`.vercel.app`, so it matches the preview branch of `resolveInstance`
before the registry, and serves the **dev** database.

Measured on 2026-09-06, same deployment, same moment:

| Hostname | Session from prod DB | Session from dev DB |
|---|---|---|
| `www.aims-hq.com` | 200 | redirected to sign-in |
| `aims-higher.vercel.app` | redirected to sign-in | 200 |

Fail-safe in that the alias cannot reach customer data. The hazard runs
the other way: someone who bookmarks the alias thinking it is
production is doing admin work against dev and will not be told.

To close it, scope `PREVIEW_INSTANCE_*` to **Preview** only. The alias
then resolves to nothing and serves `/instance-not-found`, which is
unambiguous. Nothing else changes: real previews keep their variables,
and `www.aims-hq.com` never took this branch anyway.

### If production comes up empty

The symptom is every path on `www.aims-hq.com` serving the
"no AiMS Higher instance at this address" page with a 200.

Revert the merge commit and push. Vercel redeploys the previous
production build, which does not resolve hostnames at all and therefore
cannot hit this. Then fix the variables and re-merge. Nothing in this
change writes to a database on a failed resolution, so there is no data
to clean up.

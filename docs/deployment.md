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
| `CONTROL_PLANE_SUPABASE_URL` | Same as production |
| `CONTROL_PLANE_SUPABASE_SERVICE_KEY` | Same as production |
| `PREVIEW_INSTANCE_SUPABASE_URL` | **The dev database, never production** |
| `PREVIEW_INSTANCE_SUPABASE_ANON_KEY` | Dev anon key |
| `PREVIEW_INSTANCE_SUPABASE_SERVICE_KEY` | Dev service-role key |

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

## One caution about the Edge runtime

Middleware runs on the Edge runtime, and instance resolution runs in
middleware. If a variable is marked **Sensitive** in Vercel it may not
be available at build time, which is when Next inlines what the edge
bundle can see. Confirm a preview deployment actually resolves before
merging anything that depends on this.

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

### If production comes up empty

The symptom is every path on `www.aims-hq.com` serving the
"no AiMS Higher instance at this address" page with a 200.

Revert the merge commit and push. Vercel redeploys the previous
production build, which does not resolve hostnames at all and therefore
cannot hit this. Then fix the variables and re-merge. Nothing in this
change writes to a database on a failed resolution, so there is no data
to clean up.

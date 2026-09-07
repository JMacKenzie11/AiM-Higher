# Provisioning an instance

```bash
npm run provision -- --subdomain acmecapital --name "Acme Capital" \
  --admin-email jeff@acmecapital.com [--region us-east-1] [--dry-run] [--yes]
```

Nine steps, in this order and for a reason. Configuration comes from
`.env.provisioning` and nowhere else — see `.env.provisioning.example`,
and `docs/deployment.md` for what each variable is.

| # | Step | |
|---|---|---|
| 1 | check-preconditions | *(still a stub)* |
| 2 | create-supabase-project | creates or adopts `aims-higher-{subdomain}` |
| 3 | apply-migrations | `supabase db push` through the session pooler |
| 4 | seed-data | `supabase/seed/instance-seed.sql` |
| 5 | write-vercel-env | `{PREFIX}_SUPABASE_*` on Production |
| 6 | trigger-redeploy | env vars only take effect on a new deployment |
| 7 | insert-registry-row | **the switch** — the hostname goes live here |
| 8 | create-admin | the first company, and a `system_admin` invited to it |
| 9 | verify-instance | polls until the subdomain serves the sign-in page |

## Who `--admin-email` is

**For a real client instance, `--admin-email` is always one of ours,
never the client's.**

The account it creates is a `system_admin`, and system_admin is our
role: it sees across every company on the instance and is not scoped to
any of them. Handing that to a client hands them a level of access the
role was never meant to give them, on their own instance, on day one,
before anyone has looked at it.

The client's own people are invited afterwards, from inside the app,
into the roles we intend for them — starting with company admin of
their first company. That invitation is an ordinary one through
`/people`, not a provisioning concern.

So the flag names whoever on our side is standing up the instance. If
that person should not have cross-company access to it long-term,
remove them once the client's own admins are in.

Every step is idempotent: rerunning reports `skipped` for work already
done. State lives in `.provisioning-state/{subdomain}.json`, which is
gitignored and holds the database password and the service-role key.

The database password is shown once, at creation, and cannot be
retrieved from Supabase afterwards. It is written to the state file
before the project is created, so a crash mid-flight cannot lose it.

# Migrating every instance

```bash
npm run migrate:instances -- --dry-run   # what would be applied, touching nothing
npm run migrate:instances                # apply
```

Reads every `status = 'active'` row from the control plane registry and
applies pending migrations to each, in sequence. One status line per
instance, then a summary. Any failure or blockage exits nonzero.

A failure on one instance does not stop the loop. Every instance is
attempted and every result reported, because stopping early leaves the
rest in an unknown state — and an operator then has to work out where
the loop stopped before they can work out what to do.

Passwords come from `.provisioning-state/{subdomain}.json`. An instance
with no state file is reported **BLOCKED**, never skipped: silently
skipping is how an instance ends up a release behind with nothing
saying so, which is the exact failure this tool exists to prevent. The
primary instance has no state file — it predates provisioning — so its
password comes from `PROD_DATABASE_PASSWORD` in `.env.provisioning`.

## There is one way to migrate production

`npm run db:push:prod` is gone, and `scripts/db-push.sh prod` now
refuses with a pointer here.

It only ever knew about one database. Using it would migrate production
and leave every other registered instance a release behind, silently —
the exact failure the runner exists to prevent. Two ways to migrate
production is one too many when only one of them checks that every
instance was reached.

`npm run db:push:dev` stays. The dev clone is not an instance: it is
not in the registry and the runner has no way to reach it.

## Adopting a database that predates migration tracking

The runner **refuses** an instance whose database has tables but no
`supabase_migrations.schema_migrations` table, and the refusal is the
feature.

With no history, every migration reads as pending. A push would then
try to apply all of them to a database that already has the schema —
and our migrations are not replay-safe: 20 create tables without
`if not exists`, and 44 contain drops or destructive alters. It would
fail partway, having already run some of them, over live data.

### Verify by diff BEFORE you repair

`migration repair` does not check anything. It stamps a claim: *this
database is what migrations 0001…N produce.* If the database has
drifted — and a database that predates tracking usually has — repair
does not remove the drift. It makes the drift invisible, and every
later run reports the instance up to date while it is not.

So the order is verification first, repair second:

1. **Provision a throwaway instance from the current migrations.** It
   is a clean reference schema by construction: born from the files,
   at the version they produce.
2. **Diff the un-baselined database against it** — relations, columns
   with types and nullability and defaults, constraints, indexes, RLS
   policies including their expressions, functions, triggers.
3. **Account for every difference.** Each one is either a migration
   the database never received, in which case apply it, or a
   deliberate production-only artifact, in which case document it and
   decide whether it should become a migration.
4. **Only then repair**, with the versions the database genuinely has.

Two categories of noise are expected and should be labelled rather
than chased:

- **OID-named NOT NULL constraints.** Postgres names these
  `2200_17746_10_not_null`, embedding the table OID, which differs
  between any two databases. Compare check-constraint *definitions*
  instead of constraint names.
- **Row counts and generated ids.** Structure is the subject; data is
  not.

The fix is then to record the history rather than replay it:

```bash
supabase migration repair --status applied <version> --db-url "<session pooler url>"
```

Pass every version the database already has. The versions are the
numeric prefixes of the files in `supabase/migrations/` — `0001`,
`0002`, … `0169`. `migration repair` writes the history table without
running anything.

Then `npm run migrate:instances -- --dry-run` should report the
instance up to date, and it is managed like any other from then on.

## The deploy order rule

**Run `migrate:instances` first. Confirm every instance is green. Only
then promote the code deploy.**

This is not a preference, it follows from the architecture. There is
**one app deployment serving every instance**, and it reads
`{PREFIX}_SUPABASE_*` at runtime to decide which database a request
belongs to. But the databases migrate **one at a time**, over minutes.

So between the first instance being migrated and the last, the single
running app is talking to databases in two different shapes. There is
no version of this where they change together.

### Expand and contract is therefore mandatory

Every migration must be compatible with **both the app version before
it and the app version after it**. No exceptions, and not because it is
tidier — because a migration that only the new code can live with
breaks every instance that has not been reached yet, and a migration
that only the old code can live with breaks every instance that has.

In practice that means a change lands across at least two releases:

| | Migration | App |
|---|---|---|
| **Expand** | add the new column/table, nullable or defaulted; backfill; keep the old one | writes both, reads the old |
| *(deploy)* | | reads the new, still writes both |
| **Contract** | drop the old column/table | stops writing the old |

Things that are never safe in one step: renaming a column, dropping a
column the running app still selects, adding a `not null` without a
default, narrowing a type, or changing a check constraint the old code
can violate. Each becomes an expand and a later contract.

### The ritual

1. `npm run migrate:instances -- --dry-run` — see what will move.
2. `npm run migrate:instances` — apply. **Every instance green.**
3. Merge and let the code deploy promote.
4. Later, once every instance is on the new code, ship the contract
   migration and repeat.

If step 2 is not all green, stop. Do not promote. An instance that is
BLOCKED or FAILED is one where the new code is about to meet an old
database.

## Tearing an instance down

**Order matters, and it is the reverse of provisioning.** The registry
row goes first because it is the switch: while it exists the hostname
resolves, and deleting the database or the variables underneath a live
row leaves the subdomain serving errors to anyone who visits rather
than a clean "no instance here".

### 1. Delete the registry row

From the **control plane**, not the instance:

```sql
delete from public.instances where subdomain = 'provtest1';
```

The hostname stops resolving within 60 seconds — the registry caches
lookups for that long per process (`CACHE_TTL_MS` in
`src/lib/instances/registry.ts`). Confirm before continuing:

```bash
curl -s https://provtest1.aims-hq.com/sign-in | grep -c "no AiMS Higher instance"
```

Wait for that to return `1`. Do not skip the wait — the next step
removes the variables the running deployment is still holding.

### 2. Delete the three Vercel environment variables

`{PREFIX}_SUPABASE_URL`, `{PREFIX}_SUPABASE_ANON_KEY` and
`{PREFIX}_SUPABASE_SERVICE_KEY`, on Production. Dashboard, or the API:

```
DELETE /v9/projects/{VERCEL_PROJECT_ID}/env/{envId}
```

No redeploy is needed. Nothing reads them once the row is gone.

### 3. Delete the Supabase project

```
DELETE /v1/projects/{ref}
```

Irreversible, and it takes the database with it. This is last because
it is the only step that destroys data: if you stop after step 2 the
instance is unreachable but recoverable, and after step 3 it is not.

### 4. Clean up locally

```bash
rm .provisioning-state/{subdomain}.json
```

Keeping a state file for a project that no longer exists is how a later
run gets confusing errors about a ref that 404s.

### Why not a `deprovision` script

Deliberately manual for now. Deleting a customer's database is not a
thing to make one command away while there is exactly one test instance
and no soft-delete or export path in front of it. When there are real
instances, this becomes a script with a confirmation as heavy as
provisioning's — typing the subdomain — and a mandatory export first.

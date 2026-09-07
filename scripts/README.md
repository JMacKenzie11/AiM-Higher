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
npm run migrate:instances -- --seed      # apply, then top up reference data
```

Reads the control plane registry and applies pending migrations to
every `active` instance, in sequence. Instances with any other status
are skipped and NAMED in the summary as skipped, rather than being
filtered out of the query and silently missing: before a deploy, an
instance that vanished from the list is indistinguishable from one
that was forgotten. See "Instance status" in `docs/deployment.md`.

`--seed` also runs `supabase/seed/instance-seed.sql` against each
instance, after its migrations. Migrations carry schema; the seed
carries reference data, and a row added to the seed after an instance
was provisioned never reaches that instance otherwise. The seed is
idempotent by construction, so repeating it is safe. Off by default
because reference data changes far less often than schema. Its result
prints under the instance in the same summary, and a failed seed exits
nonzero: "migrated but not seeded" is not a state to deploy on top of.

`--dry-run` **opens a connection** to any instance that has pending
work, so a credential failure is reported as BLOCKED rather than as a
confident "would apply 3". Reading the migrations table through the
Management API alone cannot tell you whether the database can actually
be logged into, and a plan for a database you cannot reach is a claim
reported as a fact. Instances with nothing pending are not connected
to: there is nothing to honour, so nothing to verify. One status line per
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

## There is one way to migrate anything

`scripts/db-push.sh` is deleted, and with it `db:push:prod` and
`db:push:dev`. Everything goes through `migrate:instances`.

It only ever knew about one database. Using it on production would
migrate production and leave every other registered instance a release
behind, silently — the exact failure the runner exists to prevent.

### The dev clone: `--db-url`

```bash
npm run migrate:instances -- --db-url "postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres" [--dry-run]
```

The clone deliberately has **no registry row**. A registry row is a
switch that makes a hostname serve customers; the clone is disposable
tooling and is not one. `--db-url` keeps it on the same code path
rather than leaving an orphan script behind.

The other cure for dev drift is to refresh the clone from production,
which replaces its schema wholesale — see `docs/e2e.md`.

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

# Syncing content to every instance

```bash
npm run sync:content -- --dry-run              # the plan, touching nothing
npm run sync:content                           # mirror every dataset
npm run sync:content -- --dataset classroom    # one dataset
npm run sync:content -- --instance promiseone  # one instance, for onboarding
```

Mirrors declared datasets from the primary instance (`PROD`) to every
other active instance in the registry.

## The ownership rule: one way, and the primary wins

**Synced datasets are authored on the primary instance only. An edit
made on any other instance is overwritten on the next run, without
warning and without a conflict to resolve.**

This is not a limitation to work around, it is the design. Sync is a
full mirror: rows are inserted, changed rows are overwritten with the
source row in full, and rows the primary no longer has are deleted
from the target. There is no merge, because a merge would need a rule
for whose version wins and there is only one author.

The consequence worth stating plainly: **do not put a table in a
dataset if anyone on another instance may legitimately edit it.** This
tool will discard their work and report it as a successful sync.

Primary keys are preserved, UUIDs included, so a lesson has the same
id on every instance and cross-references between synced tables
survive the copy.

## Registering a new dataset

In `scripts/lib/sync/datasets.ts`:

```ts
export const myDataset: SyncDataset = {
  name: "my-dataset",
  description: "what this is",
  tables: [
    { table: "parents", primaryKey: ["id"] },
    { table: "children", primaryKey: ["id"] },
    { table: "join_table", primaryKey: ["left_id", "right_id"] },
  ],
};
```

Then add it to `DATASETS`.

**Tables are listed in dependency order.** Inserts and updates run in
that order so a child never lands before its parent; deletes run in
reverse so a parent is never removed while a child still points at it.
The order is declared rather than derived from foreign keys, because
deriving it means getting cycles wrong at runtime, and a wrong answer
here writes into a live customer database.

`primaryKey` is an array: composite keys are real
(`classroom_lesson_tags` is keyed by `(lesson_id, tag_id)` with no
surrogate id). `excludeColumns` drops columns from the sync entirely.
`created_at` and `updated_at` are copied but never counted as a
change, otherwise every run would rewrite every row.

### Two things the tool refuses to do

**A table with a `company_id` column.** That is one tenant's data, and
mirroring it to another instance would put one customer's rows in
another customer's database. Checked against the live schema rather
than the dataset declaration, so a `company_id` added by a later
migration is still caught.

**A row that references Supabase Storage.** Storage is per project. A
private path (`storage_path`) 404s on the target; a public storage URL
embedded in a body is worse, because it keeps working while serving
the primary's storage, so a client instance silently renders another
instance's files and nothing looks broken. See the storage note below.

## Run order: migrate first, sync second

A dataset's tables are schema. If a release changes their shape, the
migration has to reach an instance before the content does, or the
sync writes columns that do not exist yet.

```bash
npm run migrate:instances     # schema first, every instance
npm run sync:content          # then the content
```

This is the same ordering rule as the deploy: the thing that defines
the shape goes first. A sync that runs against a stale schema fails
loudly on the column, which is the good case; the bad case is a
migration that renames a column and a sync that faithfully mirrors the
old one into a table that no longer wants it.

## The storage caveat

Classroom has two buckets: `classroom-images` (public, for inline
images in a training body) and `classroom-attachments` (private,
signed URLs, referenced by `classroom_attachments.storage_path`).

As of 2026-09-07 **no synced row references either bucket**: production
has 25 trainings and none embeds a storage URL, and
`classroom_attachments` has zero rows. So sync carries no storage
references today and the guard has never fired.

That changes the first time someone embeds an image in a lesson or
attaches a file. At that point the sync will refuse, by design, and
the decision has to be made rather than discovered: either copy
storage objects alongside rows (a real feature, not a flag), or keep
synced content free of instance-local files.

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

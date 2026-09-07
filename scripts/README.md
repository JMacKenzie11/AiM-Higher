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

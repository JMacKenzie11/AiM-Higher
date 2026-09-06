# Browser tests (Playwright)

Vitest covers logic. These cover what a unit test structurally cannot
see: what a browser does on its own.

That distinction is not academic here. The scope-cookie incident was a
`<Link>` prefetching on hover and firing a cookie write, moving an
operator into a company nobody chose. It survived two attempted fixes
and weeks of green unit tests, because no unit test can see a browser
speculatively fetching a URL. `e2e/scope-cookie.spec.ts` is that
regression, written against the behaviour that caused it.

```bash
npm run e2e        # headless
npm run e2e:ui     # the Playwright UI, for writing and debugging
npx playwright test e2e/scope-cookie.spec.ts   # one file
npx playwright show-report                     # last run's HTML report
```

Chromium only. Adding engines multiplies runtime and maintenance for an
app with no browser-specific behaviour to speak of.

## After a dev-clone refresh, run this

**The clone refresh wipes every fixture these tests depend on.** The
test users, the fixture company, its open quarter: all of it lives in
the dev database, and refreshing that database from production destroys
all of it. Nothing warns you. The suite simply starts failing, and six
weeks later nobody remembers why.

So, immediately after any refresh:

```bash
npm run seed:e2e
```

That is the whole checklist. The script is idempotent, safe to rerun,
and prints what it created. If a spec fails with "E2E_ADMIN_EMAIL is
not set" or cannot find the composer, this is the first thing to try.

### What it creates

| Fixture | Detail |
|---|---|
| Company | "E2E Fixture Co", every feature enabled |
| Quarter | Open, spanning ±120 days around today |
| `E2E_ADMIN_EMAIL` | `system_admin`, no company, guide assignment to the fixture company |
| `E2E_MEMBER_EMAIL` | `team_member` inside the fixture company |

The quarter is deliberately wide. The commitments composer refuses to
render without one covering this week, and a narrow window would make
the suite fail on a calendar boundary rather than on a real regression.

The admin is both a `system_admin` and a guide by assignment because
the specs need both: `system_admin` exercises the cross-tenant paths,
the assignment exercises the guide caseload surfaces.

The member is a `team_member`, the least-privileged real user, which is
the right thing to test ordinary navigation and commitment creation
with.

### Credentials

Live in `.env.local` beside every other local-only value:
`E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, `E2E_MEMBER_EMAIL` /
`E2E_MEMBER_PASSWORD`. Dedicated fixtures, never a personal account: a
test that signs in as a real person will one day change that person's
data.

### The guard on the seed script

`seed:e2e` refuses to run if `LOCAL_INSTANCE_SUPABASE_URL` matches
`PROD_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` or
`CONTROL_PLANE_SUPABASE_URL`. It creates users with known passwords,
and a test user with a known password in the production auth table is
not a test user, it is a back door. The dev clone and production are
one typo apart, so the script checks rather than trusts.

## Selectors

Roles, labels and `data-testid`. **Never copy text.** The wording of
this product changes weekly, and a suite that breaks on a reworded
button teaches people to ignore it. The hooks in use:

| testid | On |
|---|---|
| `scope-into-company` | Every scope-in control, plus `data-company-id` |
| `context-pill` | The sidebar's company context |
| `exit-company-scope` | Scope-out, in the user menu |
| `user-menu-trigger` | The user menu, and a proxy for "the app rendered" |
| `commitment-add-submit` | The composer's submit |
| `commitment-row` | Each commitment in the list |
| `instance-not-found` | The no-instance heading |

Matching on *data* is fine, and the commitment spec does it: the
description it types is unique per run. Data is not copy.

## The two servers

Most specs run against `npm run dev` on 3200, where `LOCAL_INSTANCE_*`
pins every request to the dev database and the hostname is ignored.

`instance-resolution.spec.ts` needs the opposite, so a second server
runs on 3201 with those variables blanked and hostname resolution live.
It only ever exercises `localhost` — a single label, which `resolve.ts`
rejects before consulting the registry. That matters: **the registry
lives in the production project**, so a hostname with a domain under it
would reach for production. `CONTROL_PLANE_*` is blanked on that server
too, so an accidental lookup fails loudly instead of connecting.

## Why this is not in CI yet

`.github/workflows/checks.yml` runs four gates in about a minute.
Browser tests are the flakiest thing in most suites, and a gate that
goes red for no reason gets ignored, then deleted — the same reasoning
the lint gate's own comment makes about warnings.

So: run locally until this has been green across a few PRs. Then add it
as a **separate job**, so a browser flake can never block typecheck,
lint and unit tests. CI will also need `seed:e2e` to have run against
whatever database it points at, and it must not be production.

## Reusing this as a Phase 3 smoke test

The suite is deliberately free of hardcoded ids. The fixture company is
found by name, and its id is read off a `data-company-id` attribute
rather than from the database, so the specs need no service key of
their own.

That means pointing it at a freshly provisioned instance is a matter of
seeding fixtures there and changing `baseURL`. `commitment.spec.ts` is
the one that answers "can a real person actually use this instance?",
because creating a commitment exercises the whole chain: a client
component holding form state, a server action posted through it, an
authorization check, a write, a revalidate, and the result rendering
back into the list.

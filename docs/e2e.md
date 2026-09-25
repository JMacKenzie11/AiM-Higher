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
npm run scrub:dev      # delete the OAuth credentials the copy brought with it
npm run seed:e2e       # recreate the fixtures, and clear what earlier runs left
```

**The scrub is not optional and it goes first.** A clone of production
carries `oauth_credentials`, one row per company that has connected
Google Drive, each holding a refresh token that does not expire on its
own. After a refresh those are live client credentials sitting in the
database whose entire purpose is that people experiment against it.
`scrub:dev` deletes them, refuses to run anywhere that resolves to the
same project as production, the control plane or
`NEXT_PUBLIC_SUPABASE_URL`, and reads the table back afterwards rather
than trusting the delete. `npm run scrub:dev -- --dry-run` prints what
it would remove, by provider, never the tokens themselves.

Transcript sources are left alone: they carry folder ids, not secrets,
and a source with no credential simply fails to ingest, which is
correct on dev.

A refresh is also the blunt cure for dev-clone schema drift: it
replaces the clone's schema wholesale with production's. The precise
cure is `npm run migrate:dev`, which applies only what is pending and
records the history. Use the refresh when the clone's DATA is stale,
the migration run when only its SCHEMA is out of date.

In an ordinary deploy the clone should not drift at all: `migrate:dev`
is step 8 of the ritual in docs/deployment.md and runs BEFORE the fleet
apply, not after it, so the clone is the first database a migration
reaches rather than the last.

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
| `E2E_PORTFOLIO_EMAIL` | `portfolio_admin`, no company and no assignments |
| `E2E_COMPANY_ADMIN_EMAIL` | `company_admin` inside the fixture company |
| `E2E_LEAD_EMAIL` | `team_member` inside the fixture company who leads "E2E Led Function" |

The quarter is deliberately wide. The commitments composer refuses to
render without one covering this week, and a narrow window would make
the suite fail on a calendar boundary rather than on a real regression.

The admin is both a `system_admin` and a guide by assignment because
the specs need both: `system_admin` exercises the cross-tenant paths,
the assignment exercises the guide caseload surfaces.

The member is a `team_member`, the least-privileged real user, which is
the right thing to test ordinary navigation and commitment creation
with.

The portfolio admin has no company and no guide assignments, and needs
neither: the role's reach is the whole instance by construction
(migration 0190), and a database constraint forbids it from holding a
company at all. It is a real `portfolio_admin` rather than a
`system_admin` standing in for one, because the thing under test is
what that role can and cannot do — a stand-in would prove nothing.

### Credentials

Live in `.env.local` beside every other local-only value:
`E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, `E2E_MEMBER_EMAIL` /
`E2E_MEMBER_PASSWORD`, `E2E_PORTFOLIO_EMAIL` /
`E2E_PORTFOLIO_PASSWORD`, `E2E_COMPANY_ADMIN_EMAIL` /
`E2E_COMPANY_ADMIN_PASSWORD`, `E2E_LEAD_EMAIL` / `E2E_LEAD_PASSWORD`. Dedicated fixtures, never a personal account: a
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

## Running the live-credential specs

Two specs need more than a browser: they need a real model and, in one
case, they write real rows. They are listed here because "the E2E path
was never stood up" has been the reason a feature shipped unproven
twice, and the fix is a written procedure rather than a note in a PR.

| Spec | Needs | Writes |
|---|---|---|
| `coach-history.spec.ts` | `ANTHROPIC_API_KEY` | nothing |
| `coach-memory.spec.ts` | `ANTHROPIC_API_KEY` | **real `coach_memories` rows** |
| `external-measures.spec.ts` | a real Google Sheet, a connected Google account, the flag | `success_measure_entries` + `external_pull_log` on the fixture company |
| `external-measures.spec.ts` (cron case) | the above, plus `CRON_SECRET` | the same, written by the scheduler rather than a person |

### `external-measures.spec.ts`

The only spec whose fixture cannot be seeded, because it is somebody
else's spreadsheet. It **skips** when the setup is absent, naming the
missing variables, rather than failing — a red suite nobody can turn
green is a suite people stop reading. What it must never do is pass
without having run, which is why the skip names what is missing.

The setup is a genuine obstacle and worth stating plainly: **the dev
clone has no Google credentials by design.** `npm run scrub:dev`
deletes every `oauth_credentials` row after a refresh and that is not
optional, because a clone of production carries live client refresh
tokens. So a person has to connect a Google account to the fixture
company on purpose before this spec can run, and that connection dies
at the next refresh.

```bash
# 1. Copy the client's workbook STRUCTURE into a sheet of your own.
#    Never point this at the client's actual workbook.
#      - a tab with a "Week Ending" column and a numeric column,
#        filled in for the last four Fridays
#      - a second tab with one numeric value cell, dashboard style
# 2. Share it as Viewer with the account connected to "E2E Fixture Co".
# 3. Turn on the external_measures flag for that company.
# 4. Add to .env.local:
#      E2E_SHEET_ID=...
#      E2E_SHEET_TAB=Dashboard Data
#      E2E_SHEET_KEY_COLUMN=Week Ending
#      E2E_SHEET_VALUE_COLUMN=Pounds Shipped
#      E2E_SHEET_SNAPSHOT_TAB=Summary
#      E2E_SHEET_SNAPSHOT_CELL=B7

npx playwright test e2e/external-measures.spec.ts
```

The third case drives `/api/cron/external-measures` with the cron's own
bearer token rather than waiting for Saturday, so it needs
`CRON_SECRET` in `.env.local` as well. It skips separately from the
other two, so an absent secret does not hide the browser cases.

It leaves rows behind on the fixture company: pulled entries and their
receipts. The receipts are append-only by design and cannot be
deleted through the app, which is correct and means the fixture
company accumulates them. `npm run seed:e2e` clears what earlier runs
left.

### One-time setup

```bash
npm run seed:e2e                       # fixture users, company, quarter
# .env.local must carry, in addition to the E2E_* credentials:
#   ANTHROPIC_API_KEY=...              # the specs make real model calls
#   NEXT_PUBLIC_APP_URL=http://localhost:3200
```

Then, with the app running against the **dev clone** (never production):

```bash
npm run dev                            # terminal one
npx playwright test e2e/coach-memory.spec.ts   # terminal two
```

### The rules for specs that write to `coach_memories`

`coach_memories` is the most sensitive table on the platform. The first
spec that wrote to it set the pattern every later one copies, so the
pattern is written down:

1. **A synthetic fixture profile only.** `users.member()`, created by
   `seed:e2e`. Never a real account, never a real profile's id. There
   is no version of this that is fine "just to check something".
2. **Assert the subject before writing.** The spec checks it is signed
   in as the fixture *before* it says anything to the coach. A spec
   that merely intends to use a fixture is one misconfigured env var
   away from writing memory about a real person.
3. **Clean up in `afterEach`, not at the end of the test**, and clean
   up EVERYTHING the fixture has — `POST /api/coach/memory` with
   `{ all: true }`, which deletes only the caller's own rows (RLS makes
   that structural, not a promise the route is keeping).

   **Not just what the run created.** That was the first version and it
   left rows behind twice. The memory trigger deliberately summarizes
   conversations OTHER than the one open, so a run writes memory for
   threads left by *earlier* runs — rows the spec caused and did not
   create. Per-conversation cleanup misses exactly those, and the test
   goes green while they accumulate.

4. **Check the cleanup's result and fail loudly on it.** The first
   version swallowed every error, so a cleanup deleting nothing looked
   identical to one that worked. Three rows sat on the clone through
   several green runs before anyone counted.

5. **Count the rows afterwards the first time you write one of these.**
   Not forever — but a hygiene safeguard nobody has ever seen fail is
   a safeguard nobody has tested.
6. **A spec that creates CONVERSATIONS is litter too.** `seed:e2e`
   now deletes the fixture users' coaching conversations before it
   reseeds, because nothing else ever did: forty-odd threads had
   accumulated on the fixture member's account in a single day of
   work. Same gap as rule 3, one object along — cleanup that covers
   what a spec was told to create and not what it produces. If you
   add a spec that creates some other kind of row, ask which of those
   two it is.

7. **Never against production.** The specs have no service key and the
   app they drive resolves its database from the host; point them at
   the clone.

### Why these are not simply in the normal run

They cost money per run and they are slower than everything else by an
order of magnitude. Run them when the feature they cover changes, and
before shipping anything that touches coach context assembly, the
summarization prompt, or the access wall.

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

## One fixture the suite consumes: the Guide nudge

`e2e/guide-champion.spec.ts` opens a pending nudge, and opening one
moves it to `opened` for good. It is not pending again afterwards
and the spec cannot put it back: `guide_nudges` has its INSERT
revoked from `authenticated`, on purpose (failure mode E8), so no
user role can create one and neither can a browser test.

So that file needs a fresh `npm run seed:e2e` before each full run.
The seed rebuilds the meeting, the analysis, the nudge and its
notification from scratch, and empties the champion seat, which is
also the state the spec expects to start from.

Every other spec in the suite restores what it changed and does not
need this.

# Regression runs for meeting analysis

Real meetings, replayed through the current pipeline on the dev clone
and compared with what a person who was there says should come out.

**The expected values live in a private repository, never here.** They
name real people and paraphrase what those people committed to. Clone
it into `.regression/`, which this repo ignores:

```sh
gh repo clone JMacKenzie11/aimhigher-regression .regression
```

The scripts refuse to run without that clone and print the line above.
Transcripts are never in it; they stay in the dev database.

```sh
# compare the dev clone's current analysis with one expectations file
npx tsx --tsconfig scripts/tsconfig.json scripts/regression-check.ts benson-2026-09-22

# content-free invariants for any meeting, and a run record for drift
npx tsx --tsconfig scripts/tsconfig.json scripts/regression-invariants.ts <meeting-id> run1
```

A file marked `provisional` has not yet been confirmed by somebody who
was in the meeting, so a failure against it may be the file's fault.
Run records go to `.regression/runs/`, which that repository ignores:
they are one day's output, not expectations.

Replaying a meeting (`scripts/replay-meeting.ts`) writes to dev, so it
needs Jason's go per run. The two scripts above only read.

# Performance review — AiM Higher (AiMS Execution Platform)

Static, read-only review. Nothing was run: no app, no migrations, no
database, no build. Every claim below is traceable to a file and line
that is quoted or cited. Where a claim depends on a query plan or a row
count I could not observe, it says so.

Reviewed on 2026-09-07 against `main` at `eb8b92b`.

---

## Status, as of 2026-09-08

This is a **baseline**, not a live tracker. The findings below are left
exactly as written on 2026-09-07 — including the ones since fixed —
because their value is the reasoning, and reasoning edited after the
fact to match the outcome stops being evidence of anything.

**Fixed since the review:**

| Finding | Shipped in |
|---|---|
| F1 — `/scorecard` runs the whole dashboard loader for a five-item checklist | [#63](https://github.com/JMacKenzie11/AiM-Higher/pull/63) |
| F2 — `/commitments` is eleven sequential round trips | [#64](https://github.com/JMacKenzie11/AiM-Higher/pull/64) |
| F3 — `/admin/companies` fetches every commitment on the instance, unbounded | [#65](https://github.com/JMacKenzie11/AiM-Higher/pull/65) |
| F4 — `/measures` runs two near-identical five-query chains | [#63](https://github.com/JMacKenzie11/AiM-Higher/pull/63) |
| 4.1 — the weekly scorecard cron resolves feature flags without a session | [#59](https://github.com/JMacKenzie11/AiM-Higher/pull/59) |

4.1 turned out to be real and total: every feature-gated discipline had
been recorded as "not enabled" on every snapshot since 2026-08-13, and
the false `scorecard_dropped` alerts that fell out of it were fixed
separately in [#61](https://github.com/JMacKenzie11/AiM-Higher/pull/61).
The 104 affected rows were deleted via
[#60](https://github.com/JMacKenzie11/AiM-Higher/pull/60).

**Measured since, without being acted on:** F11's planner question,
which the review deliberately refused to assert without evidence, was
settled on 2026-09-08. See the addendum at the end of F11 — the
structural claim is confirmed, the case it named as worst turned out to
be the cheaper one, and the dominant cost is F8. Recommendation there
is to act on F8 first and re-measure.

**Everything else stands unfixed**, F5–F14 and 4.2–4.3. F8 in
particular — RLS helpers evaluated once per row across 266 policy
references — remains the largest raw database win on the list and the
highest-risk change on it. Its NULL-semantics writeup is the part worth
keeping: the three hazards it names are what make that rewrite a
project rather than a drive-by, and they will be just as true whenever
it is picked up.

## How to use this document

It was produced by a **cold** review: a session with no prior context
about this codebase, deliberately, so that the findings came from
reading the code rather than from remembering it.

**Rerun it quarterly, the same way — a fresh session, no context — and
diff the result against this baseline.** What matters in that diff is
not the overlap but the divergence: a finding that appears in the new
pass and not here is drift since 2026-09-07, and a finding here that
the new pass misses is worth asking about before assuming it was fixed.

Warming the reviewer up first would defeat the point. A reviewer who
has been told where the problems are will find those problems.

---

## 0. What I read first, and treated as binding

`docs/product-spec.md`, `docs/failure-modes.md`, `docs/deployment.md`,
`scripts/README.md`, `supabase/seed/README.md`, `docs/help/README.md`,
and the comment blocks in `src/middleware.ts`,
`src/lib/instances/*`, `src/lib/supabase/*`, `src/lib/auth/current-user.ts`
and every migration cited below.

Section 19 of the spec already records a performance audit dated
2026-09-02, including two items it explicitly parks as *"known and
deferred"*: RLS helpers not wrapped in `(select fn())`, and the dashboard
and layout loaders running mostly sequential awaits. Both reappear below.
I have kept them in the findings list rather than the "deliberate
decisions" section, because the spec files them as unfinished work, not
as a decision that was made and should stand.

The following were treated as settled and are **not** proposed for
reversal anywhere in this document: per-request Supabase client
construction (`src/lib/supabase/admin.ts:14-24`); the ban on
module-level caching of anything session-derived
(`src/lib/instances/registry.ts:44-55`); the AsyncLocalStorage instance
scope in cron fan-out (`src/lib/instances/for-each.ts:189-234`);
`prefetch={false}` and the server-action scope-in (spec §1, failure mode
E1); sequential rather than parallel instance processing in the fan-out
(`for-each.ts:134-138`) and fleet tools; the registry lookup in
middleware; and the sequential per-company loops inside the scorecard and
performance crons, which carry their own reasoning in-file.

---

## 1. What I reviewed and found clean

Stated so that the absence of a finding is distinguishable from the
absence of a look.

**Index coverage.** I enumerated every `create index` in
`supabase/migrations/` (120 of them) and checked them against every
query site I read. Post-0161 and 0165 the coverage is genuinely good. I
specifically confirmed a usable index for: the notification bell's two
`owner_id + company_id + status + due_date` queries
(`commitments_owner_open_due_idx`, an exact partial match including the
`deleted_at`/`parked_at` predicates); the Guide HQ follow-through window
on `completed_at` (`commitments_company_completed_idx`); the 14-day
duplicate-detection lookback on both tables; `success_measure_entries`
by `(measure_id, week_ending)`; `csf_kpi_links` in both directions (PK
plus `csf_kpi_links_kpi_idx`); `success_measures` by
`(function_id, kind) where archived = false`; `guide_assignments` by
`guide_id` (PK prefix); `company_features` by `company_id` (PK prefix —
the `getCompanyFeatures` read on every page load is covered); `meetings`
by `(company_id, status)` and by `status` alone for the unrouted queue;
`notifications` by `(recipient_id, created_at desc) where read_at is
null`; `company_discipline_snapshots` by `(company_id, snapshot_date
desc)`. **I found no table where a hot `WHERE` clause I could see has no
usable index.** The one gap I looked hardest for — an index that could
serve `similarity()` itself — is already named and deferred in
`0161_hot_path_indexes.sql:63-68`, correctly.

**Column projection on `meetings`.** The rule from spec §19 holds
everywhere it matters. `/leadership`
(`src/app/(app)/leadership/page.tsx:39-44`), the company detail panel
(`src/app/(app)/admin/companies/[id]/page.tsx:73-80`) and the unrouted
queue (`src/app/(app)/admin/companies/page.tsx:69-71`) all name six
columns and skip `transcript_text`. `/leadership` also carries a
`.limit(100)`. The only `select("*")` calls on `meetings` are the
single-row reads in the analyzer, which need the transcript.

**The dashboard data loader.** `src/lib/dashboard/service.ts:98-234` is
already restructured into two dependency waves with an early bail
between them, and the comments explain the reasoning. Thirteen queries,
two round-trip depths. This is the best-shaped loader in the codebase.

**Client bundle discipline.** This has clearly had attention and is in
good shape: Sentry's replay recorder is lazy-loaded off the critical
path with a documented trade
(`src/instrumentation-client.ts:73-124`); posthog-js resolves to the
module build rather than `module.full.js`; `src/components/tiptap/
Renderer.tsx:1` imports only a *type* from `@tiptap/react`, so the
editor never reaches a learner's bundle as the spec claims;
`react-zoom-pan-pinch` and `@dnd-kit` are confined to `/chart` and
`/issues`; `docx`, `mammoth` and `googleapis` are server-only. One
exception is finding **F6** below.

**Cron fan-out.** `forEachActiveInstance` holds no per-company state that
the inner loops re-read, dedupes by `env_prefix`, and the performance
cron's per-company body (`src/app/api/cron/performance/route.ts:121-305`)
is fully batched: four queries per company regardless of how many
measures it has, with the per-measure work done in memory. No repeated
reads inside the loop.

**Request-scope memoization.** `getCurrentSession`
(`current-user.ts:50`), `getCompanyFeatures`
(`subscriptions/service.ts:48`), `getCurrentQuarter`
(`quarters/service.ts:58`), `loadCompanyScorecardScores` and
`loadCompanyScorecard` (`maturity/service.ts:44,110`) are all wrapped in
React `cache()`, each with a comment explaining what duplication it
kills. One helper on the same hot path is *not* wrapped — finding **F9**.

**Suspense and route shells.** 26 routes carry a `loading.tsx`, and the
one genuinely slow render path (the AI weekly brief) is behind a
`Suspense` boundary at `src/app/(app)/dashboard/page.tsx:188-193` so the
rest of the dashboard streams past it.

**Pages already parallelized correctly.** `/measures` top level
(`measures/page.tsx:42-47`), `/issues` (`issues/page.tsx:54-82`),
`/plan`'s cascade fetch (`plan/service.ts:55-116`, two clean waves),
`/admin/companies/[id]` (one five-way `Promise.all`), and `/hq`'s
top-level five-way fan-out (`hq/page.tsx:43-54`).

**`use client` boundaries.** 141 client components, and I spot-checked
the large ones. They are interaction-heavy by nature (`CommitmentRow`,
`IssueCard`, `ChatView`, `MeasuresManager`, the TipTap editor). I did not
find a client component that is really a server component wearing a
directive.

**Server-action authorization checks.** `isAdminForCompany` is
synchronous because guide assignments ride on the session
(`current-user.ts:22-29`). No permission check I read costs a round trip.

---

## 2. Findings

Ranked by expected user-felt impact divided by risk of the fix, highest
first. Where the two disagree sharply, I say so in the entry.

---

### F1 — `/scorecard` runs the entire dashboard data loader to fill a five-item checklist

**Location.** `src/lib/dashboard/setup-steps.ts:43`, reached from
`src/app/(app)/scorecard/page.tsx:60`.

**What happens now.** `computeCompanySetup` opens with
`const data = await getDashboardData(companyId)`. `getDashboardData`
(`src/lib/dashboard/service.ts:87-388`) issues thirteen queries: the
company row, the open quarter, strategic focus areas, orphan goals, the
roster, all open commitments, sponsor profiles, `sfa_progress`,
open-quarter priorities, every commitment in the open quarter, this
week's commitments, a twelve-week commitment trend, and the recent-wins
block with its two follow-up lookups. Of all that, `setup-steps.ts` uses
exactly three things — `data.people` (lines 92, 100), `data.openQuarter`
(lines 112, 114) and `data.company.name` (line 167). Those are three
cheap reads. It then adds four `head: true` counts of its own
(lines 56-89), which are correctly shaped.

This runs *on top of* the live scorecard compute the page already did
at `scorecard/page.tsx:42` — `loadCompanyScorecard` →
`computeCompanyScorecard` fans out eight scorers totalling roughly
sixteen reads (`src/lib/maturity/compute.ts:43-75`) plus a snapshot
history query. So an admin loading AiMS Implementation pays somewhere
near **35 database round trips, in four sequential stages**, where the
page's actual information need is about 20.

**Why it costs.** Per page load, for every admin, company admin scoped
in, or assigned guide — which is the entire audience the checklist is
built for. It is already felt at 10 companies and 2 instances, because
the cost is per-request and per-tenant, not per-fleet. It does not get
dramatically worse at 1,000 companies; it is simply always wrong by a
factor of four.

**Direction of fix.** Give `setup-steps.ts` its own three small reads
(company name, open quarter, roster ids) instead of calling the
dashboard loader, or split a narrow `getSetupFacts(companyId)` out of
`dashboard/service.ts` that both callers share. Then run the scorecard
load, the company row and the setup payload as one `Promise.all` in
`scorecard/page.tsx` — they have no dependency on one another.

**Risk of the fix.** Low. The only trap is the roster definition: the
checklist's "Build the team" and invite-count steps depend on
`getDashboardData`'s exact roster predicate
(`company_id = X AND status <> 'inactive'`, pending users included —
`dashboard/service.ts:129-134`). Copying a subtly different predicate
would silently change when a step ticks. Nothing about tenant isolation
changes; the reads stay on the same RLS-scoped client.

---

### F2 — `/commitments` loader is eleven sequential round trips where three waves would do

**Location.** `src/lib/commitments/service.ts:287, 296, 308, 336, 341,
370, 388, 401, 435, 445, 476`.

**What happens now.** `getCommitmentsPageData` awaits, strictly in
series: the company timezone (287) → the open quarter (296) → roster and
sysadmin coaches (308, correctly paired) → open-quarter priority options
(336) → the function list (341) → the main commitment window (370) → the
stranded past-week open rows (388) → the parking lot (401) → priority
titles for enrichment (435) → function titles for enrichment (445) →
`computeQuarterKeepRate`, which is another whole commitments scan (476).

The real dependency graph is three levels deep. The company row, the
quarter, the roster, the coaches and the function list depend on nothing
but `companyId`. The three commitment queries at 370/388/401 depend only
on the timezone and the quarter start, and are entirely independent of
each other — they are three separate `await` statements that could be
one `Promise.all`. The two enrichment lookups at 435/445 are likewise
independent of each other. `computeQuarterKeepRate` at 476 needs only
the quarter and could ride in the same wave as the commitment queries.

**Why it costs.** Per page load of the single most-used surface in the
product — spec §5 calls it "the heart of the operating rhythm", and it
is where the weekly meeting is run, live, in front of a leadership team.
Eleven serialized Supabase round trips against a pooled Postgres is
where a page goes from "fast" to "there's a beat before it paints".
Hurts identically at 10 companies and at 1,000: this is latency depth,
not data volume.

**Direction of fix.** Collapse to three `Promise.all` waves matching the
real dependency graph. No query text needs to change.

**Risk of the fix.** Low. The one thing to preserve is that
`priorityOptions` is conditional on `openQuarter` being non-null
(line 335) — a naive flattening that fires the priorities query
unconditionally would pass `undefined` as a quarter id. Nothing about
RLS or scoping is touched; every query keeps its `company_id` filter and
the same client.

---

### F3 — `/admin/companies` fetches every commitment on the instance, unbounded

**Location.** `src/lib/admin/companies-service.ts:79-84`.

```
const { data: commitmentRows } = await supabase
  .from("commitments")
  .select("company_id, status, due_date")
  .in("company_id", companyIds)
  .is("deleted_at", null)
  .is("parked_at", null);
```

**What happens now.** `companyIds` is *every* company the caller can see
(line 22-29 selects all companies with no filter). There is no date
bound, no `week_ending` window and no limit. The whole live commitment
history of every tenant is pulled over the wire into Node and reduced in
memory (lines 94-103) to one follow-through percentage per company. The
comment at 90-93 records a deliberate widening from priority-linked rows
to all rows, which fixed a correctness bug and removed the only thing
that was bounding the query.

Contrast the same metric elsewhere: the dashboard computes it over the
open quarter (`dashboard/service.ts:205-218`), and Guide HQ over a
30-day window (`hq/service.ts:202-206`). This call site is the only
all-time one.

**Why it costs.** Per page load of the fleet list — the landing surface
for every system admin and every guide, and the route
`/admin/companies` that middleware and the sidebar both point at. At 10
companies with a year of history this is perhaps 20-30k rows: slow but
survivable. At 50 instances × 20 companies × three years it is the query
that takes the page down. It also gets worse with time on a *static*
customer base, which is the property that makes it a latent outage
rather than a slow page.

There is a second edge worth naming: if a PostgREST `db-max-rows` cap is
ever configured on any instance, this query silently truncates and every
company's follow-through rate becomes quietly wrong with no error. I
could not check the setting statically.

**Direction of fix.** Push the aggregation into the database — a view or
an RPC returning `(company_id, kept_on_time, kept_late, missed,
open_past_due)` — so the row set never leaves Postgres. Bounding the
window instead would be cheaper to write but changes what the number
means, and the number is already inconsistent with two other surfaces;
that is a product decision, not a performance one.

**Risk of the fix.** Medium, and specifically about isolation. A
`SECURITY DEFINER` RPC here would bypass RLS on `commitments` — the
exact hazard spec §19 flags ("RLS is not a backstop on service-role
paths") and that migration 0160 exists to contain. If this becomes an
RPC it must either be `SECURITY INVOKER` (so the caller's own policies
still scope it, which is what the current query relies on) or take the
company list as an argument and be revoked from `authenticated`, the way
`find_similar_open_commitment` is. A plain view with
`security_invoker = on`, following the pattern already established in
`0007_progress_views.sql:89-91`, carries the least risk.

---

### F4 — `/measures` runs two near-identical five-query chains side by side

**Location.** `src/lib/measures/service.ts:84-230` (`getMeasuresTree`)
and `src/lib/measures/board.ts:67-230` (`getBoardData`), both awaited in
the same `Promise.all` at `src/app/(app)/measures/page.tsx:42-47`.

**What happens now.** Both functions independently fetch: the company's
non-archived `functions`; the `success_measures` rows with
`kind = 'csf'` for those functions; the `csf_kpi_links` for those CSFs;
and the `success_measures` rows for the linked KPI ids. Four of five
queries are the same rows read twice. Only the fifth differs — the tree
reads five weeks of `success_measure_entries`
(`service.ts:214-227`), the board reads thirteen
(`board.ts:216-220`).

Each is also a five-deep serial chain in its own right: functions → CSFs
→ links → KPIs → entries, each step needing the previous step's ids.
Running the two in parallel hides the duplication in wall-clock but
doubles the query count and the RLS work.

**Why it costs.** Per page load of `/measures`, which spec §10 makes the
only place weekly values are ever entered — so every leader hits it every
week, and often with the whole team watching. Ten round trips where six
would do, and the duplicated `success_measure_entries` scan is the
expensive one: every returned entry row is evaluated against the
`success_measure_entries_select` policy, which is a two-table join plus
an `auth_profile()` call per row (see F8). Noticeable at 10 companies;
the shape does not degrade with fleet size, only with measures per
company.

**Direction of fix.** Fetch the shared spine once — functions, CSFs,
links, KPIs — and hand it to both builders, with the entries query
widened to thirteen weeks and the tree slicing the five weeks it needs
out of that. That is 10 queries down to 5, and the chain depth from 5 to
5 but paid once.

**Risk of the fix.** Low, with one real trap: `getMeasuresTree` applies a
caller-specific ordering (`includeAll` hoists the caller's own seats to
the front, `service.ts:120-131`) and computes `canLog` per function from
`lead_id`/`track_id`. The board does neither. A shared fetch must keep
the ordering and the `canLog` derivation in the tree builder, not in the
shared step, or a non-admin gets a page ordered for someone else — and
if `canLog` drifts, a read-only cell becomes an input, which
`upsertMeasureEntryAction` would then reject at the server with a raw
RLS error. The server-side check stays the boundary either way.

---

### F5 — The `(app)` layout serializes four database waves on every authenticated page

**Location.** `src/app/(app)/layout.tsx:51, 57, 108-118, 125-133`; and
inside the last of those, `src/lib/notifications/service.ts:99-127` then
`:194-201`.

**What happens now.** In order: `getEffectiveCompanyId` (which for a
system admin or guide issues a `companies` existence probe —
`admin/scope.ts:154-161`), then a `Promise.all` for the company row and
the feature list, then — sequentially — a `success_measures` count when
`performance_tracking` is off, then `getHeaderNotifications`, which
itself does a paired `Promise.all` of two commitment counts and *then* a
separate `notifications` read. On Fridays it adds three more sequential
queries (`notifications/service.ts:286-318`: functions → measures →
entries).

That is four to five serialized waves, six to nine queries, **on every
authenticated route in the product**, before the page's own loader has
started. The comment at lines 45-49 shows the first pairing was already
done deliberately for exactly this reason; the rest of the chain was not
carried through.

**Why it costs.** Per page load, everywhere. The absolute number is
small per query, but it is pure serial latency added ahead of every
page's own work, and it compounds with F1 and F2 rather than overlapping
them. Same cost at 10 companies as at 1,000.

**Direction of fix.** The `hasChartMeasures` count and the notification
computation both depend only on `effectiveCompanyId` and `features`, so
they belong in one wave after the second — except that
`getHeaderNotifications` takes `hasChartMeasures` as an argument. It uses
it for one thing only (`notifications/service.ts:164-166`: whether to run
the Friday measures check). Passing the *promise*, or restructuring so
the Friday branch resolves it itself, collapses two waves into one. The
persisted-notifications read at :194 can join the `Promise.all` at :99
unconditionally.

**Risk of the fix.** Low. The `hasChartMeasures` count is also a prop on
the Sidebar (line 174) that decides whether the `/measures` nav link
renders for a company without the entitlement — so it must still be
awaited before render, just not before the notification queries start.
Nothing about scoping changes; `effectiveCompanyId` is already resolved
and asserted by that point.

---

### F6 — `react-markdown` and `remark-gfm` ship in the shared bundle for every authenticated page

**Location.** `src/components/help/HelpWidget.tsx:1-6`, mounted at
`src/app/(app)/layout.tsx:180`.

**What happens now.** `HelpWidget` is a client component rendered in the
authenticated layout, so it is in the shared chunk for every route under
`(app)`. It statically imports `ReactMarkdown` and `remarkGfm` at module
scope. The component itself is careful — the comment at lines 11-14
notes that no help *content* is preloaded and the fetch happens on open
— but the renderer needed to display that content is loaded eagerly for
every user on every page, whether or not they ever click the `?`.

`react-markdown` plus `remark-gfm` pulls in the unified/remark/micromark
stack. I have not measured the built chunk (no build was run), but this
family of packages is conventionally in the low hundreds of kilobytes
raw, and it is the single largest thing in this app's shared client
graph that has a trivially deferrable trigger.

**Why it costs.** Per page load, for every user, as parse-and-execute
time on the main thread during hydration. It does not touch the server
at all and does not scale with tenants — it is a flat tax on
time-to-interactive everywhere.

**Direction of fix.** `next/dynamic` (with `ssr: false`) around the
markdown renderer inside `HelpWidget`, so the chunk is fetched when the
panel opens — the same moment the `fetch` already fires. There is no use
of `next/dynamic` anywhere in the codebase today, so this would be the
first.

**Risk of the fix.** Very low. Nothing security-relevant; the help
content is already fetched from an auth-gated route
(`src/app/api/help/route.ts:20`). The only user-visible consequence is a
brief loading state inside the panel the first time it opens, which is
already the shape of that panel.

---

### F7 — The person scorecard reads a person's entire commitment history, all columns, forever

**Location.** `src/lib/people/service.ts:204-209` (and 192-198,
175-181).

**What happens now.**

```
const { data: historyRows } = await supabase
  .from("commitments")
  .select("*")
  .eq("owner_id", personId)
  .neq("status", "open")
  .order("week_ending", { ascending: false })
  .order("created_at", { ascending: true });
```

No date floor, no limit, all columns — including `missed_reason`, which
is free text. Every resolved commitment the person has ever had is
fetched and then rendered, grouped by week, into the page
(`getPersonScorecard` returns them all as `history`). Alongside it,
`openRows` at :192 is another `select("*")`, and `trendRows` at :175
re-reads a twelve-week slice of the same table that `historyRows` will
also cover.

The whole function is seven sequential round trips: profile → company →
quarter → quarter stats → trend → open → history → priority titles.

**Why it costs.** Per page load of `/people/[id]`, which spec §8 makes
the surface a manager opens before a one-to-one. In year one this is
maybe 60 rows and nobody notices. At year three, for a leader on a
weekly rhythm, it is 150+ rows of full-width records serialized into the
RSC payload and shipped to the browser to render a page whose useful
content is the last few weeks plus a rate. The failure is gradual and
correlates exactly with a customer being successful and long-tenured,
which is the worst time for it to show up.

**Direction of fix.** Bound the history to a window (a year, or the last
N weeks) with a "show earlier" affordance, name the columns the row
actually renders, and merge the trend query into the history read since
one is a subset of the other. Collapse the four independent commitment
queries into one wave.

**Risk of the fix.** Low. The one thing to keep is that the quarter
stats block (:148-160) is the number-of-record for the page's
Follow-Through Rate and already filters `deleted_at`/`parked_at`
correctly — the display list must not become the source of the metric.
See the note in §4 about those filters missing from the history and open
queries today, which a rewrite should fix rather than preserve.

---

### F8 — RLS helper functions are evaluated once per row, across 266 policy references

**Location.** `supabase/migrations/0004_rls.sql:9-19` defines
`auth_profile()`; it is referenced 266 times across the migration set,
in policies of the form

```
using ( exists ( select 1 from public.auth_profile() ap
                 where ap.role = 'system_admin'
                    or ap.company_id = public.<table>.company_id ) )
```

`is_guide_for(uuid)` (`0111_aims_guide.sql:88-103`) appears a further 164
times. Exactly one policy in the whole set uses the hoisting form —
`0164_privilege_tightening.sql:87`, `(select public.auth_profile_status())`.

**What happens now.** Because the `EXISTS` correlates to the outer row's
`company_id`, Postgres plans it as a per-row `SubPlan`, so
`auth_profile()` — a `SECURITY DEFINER` lookup on `profiles` — executes
once for every row the statement touches, not once per statement. Three
permissive `SELECT` policies are OR'd on `commitments` alone
(`commitments_select`, `commitments_select_guide`,
`commitments_select_owner` — 0006:58, 0111:227, 0141:92), so a scan that
returns 5,000 rows performs on the order of 5,000 extra index lookups
purely to answer "is this row mine".

This is exactly the item spec §19 records as *"the largest remaining
database win"*, unshipped.

**Why it costs.** Per query, on every table, for every caller — but it is
proportional to rows *scanned*, so it is felt hardest by precisely the
queries in F3, F7 and F4 that return large row sets. At 10 companies it
is a constant-factor tax nobody can see. At 1,000 companies it is the
difference between a fleet list that loads and one that times out, and
it multiplies every other finding here.

Judged on impact alone this is the top item on the list. It sits here
because the denominator is large.

**Direction of fix.** Rewrite the helper calls into the scalar
`(select ...)` form, which Postgres evaluates as a statement-level
`InitPlan`. For `auth_profile()` that means comparing against
`(select company_id from public.auth_profile())` rather than joining the
function into a correlated `EXISTS`. `is_guide_for(company_id)` takes a
per-row argument and cannot be hoisted the same way; it is already cheap
(a two-column PK probe) and is only reached when the preceding policy
returns false.

**Risk of the fix.** High, and this is why it needs its own project
rather than a drive-by. These 359 policies *are* the tenant isolation
boundary. A rewrite has three specific hazards: (a) NULL semantics —
`ap.company_id is not null and ap.company_id = X` inside an `EXISTS`
behaves differently from a scalar subquery comparison when the caller has
no profile row, and getting that wrong turns "deny" into "allow" for an
unprofiled session; (b) the `EXISTS` returns zero rows when the caller has
no profile, whereas a scalar subquery returns NULL, and `NULL = X` is not
`false` in every surrounding expression shape; (c) migrations are not
replay-safe (`scripts/README.md`, "Adopting a database that predates
migration tracking"), and this touches nearly every policy at once, so it
must land as expand-and-contract across the fleet per the deploy-order
rule. If it is done, it should be done a handful of tables at a time,
each with a test that asserts a cross-tenant read still fails — the
`rls-privileges.test.ts` pattern already in the repo is the right shape
for that.

---

### F9 — Guide HQ recomputes a full live scorecard per caseload company, and reads every completed meeting to find the latest one

**Location.** `src/lib/hq/service.ts:207-212` and `:262-288`;
`src/lib/hq/attention.ts:153-158`, `:163-166` and `:291-316`.

**What happens now.** Three separate issues on the same page.

1. **Live scorecard per company.** `loadCompanyRollups` (`:268`) and
   `computeAttentionForCompanies` (`:294`) each call
   `loadCompanyScorecardScores(cid)` for every company in the caseload.
   `cache()` correctly makes that *one* compute per company per render
   rather than two — the comment at `maturity/service.ts:41-43` says so,
   and it is right. But each compute is still eight scorers ≈ 16 reads
   (`maturity/compute.ts:43-75`). A caseload of 10 is ~160 queries on one
   page load, for two numbers per company: `overall.score`, and its
   comparison against a snapshot.

2. **Every completed meeting, twice.** Both
   `hq/service.ts:207-212` and `attention.ts:153-158` run
   `.in("company_id", ids).eq("status","complete").order("created_at",
   desc)` with **no limit**, then take the first row per company in JS
   (`service.ts:252-260`, `attention.ts:244-248`). To get one date and
   one id per company, the page pulls the complete meeting history of the
   whole caseload — twice.

3. **The whole unrouted queue.** `attention.ts:163-166` selects every
   `meetings` row with `status = 'unrouted'` — no company filter (there
   is none to apply) and no limit — then does an
   O(unrouted × companies × aliases) substring match in JS
   (`:272-284`).

**Why it costs.** Per page load of `/hq`, which spec §17 makes the home
base and default landing page for every guide and system admin. At
today's scale (single-digit caseloads, per the comment at
`attention.ts:114-117`, which is accurate) this is slow but tolerable —
the `loading.tsx` shimmer covers it. At 50 instances with guides carrying
20-company caseloads it is 320 queries and several thousand meeting rows
per render, and it is the first thing that will fall over.

**Direction of fix.** Different fixes for the three.
(2) is nearly free: add `.limit()` per company via a lateral/RPC, or at
minimum bound by `created_at` and take the top N — the page only ever
uses one row per company. (3) wants a bound and ideally the alias match
pushed into SQL. (1) is the real one: the scorecard is already
snapshotted weekly by the cron into `company_discipline_snapshots`, so
Guide HQ could read the latest snapshot for the caseload in one query
(`loadLatestOverallSnapshots` already does exactly this at
`maturity/service.ts:61-108`) and reserve the live compute for the
company the guide actually opens.

**Risk of the fix.** For (2) and (3), low — pure query shaping. For (1),
the risk is semantic, not technical: the "scorecard dropped" trigger
(`attention.ts:294-311`) compares the *live* score against the *snapshot*
score. If both sides become snapshots the trigger can never fire. The
attention queue would need a different definition — e.g. the newest
snapshot against the one before it — and that changes when a guide is
told to pay attention. That is a product call, and the spec's insistence
on live compute ("Live compute + weekly snapshot", §7) is about the
`/scorecard` page specifically, not about Guide HQ's rollup column.

---

### F10 — The meeting summary fires two similarity RPCs per extracted item

**Location.** `src/app/(app)/leadership/meetings/[id]/page.tsx:293-325`,
calling `src/lib/transcripts/similarity.ts:28-53`.

**What happens now.** The page maps over every extracted issue (:293)
and every extracted commitment (:303), calling `findSimilarOpenItem` for
each. Each call builds its own admin client (`similarity.ts:35`) and
fires two RPCs in parallel (`:40-53`). A meeting yielding 10 commitments
and 5 issues therefore issues **30 concurrent PostgREST calls** on one
page render — the exact arithmetic `0161_hot_path_indexes.sql:59-61`
already wrote down.

0161 made the 14-day window indexable, which collapsed the candidate set
per call. It explicitly did *not* make `similarity()` itself indexable
(`:63-68`), so each of the 30 calls still evaluates trigram similarity
over every open row in the window.

**Why it costs.** Per page load of a meeting detail — the surface an
admin opens after every weekly meeting, which is once a week per company
but is also the moment they are most likely to be sitting in front of it
waiting. Concurrency is the specific hazard: 30 simultaneous
service-role connections from one request is real pressure on a Supabase
pooler, and it happens per viewer, not per meeting. At 10 companies this
is fine. At fleet scale, several admins opening meeting summaries on a
Monday morning is a connection spike with no backpressure.

**Direction of fix.** One RPC taking an array of texts and returning the
best match per input, replacing 2N calls with 2. The admin client should
be built once by the caller and passed in, rather than per invocation.

**Risk of the fix.** Medium, and it is about the grant, not the query.
`find_similar_open_commitment` / `find_similar_open_issue` are
`SECURITY DEFINER`, take a company id as a parameter, do no membership
check of their own, and are granted to `service_role` only with
`public`/`anon`/`authenticated` revoked — spec §19 says a test replays
the grant history across migrations so a re-grant fails CI
(`0160_similarity_rpc_service_role_only.sql`). A new batched RPC must
inherit exactly that grant posture and be added to that test, or the fix
opens a cross-tenant read on a function whose only protection is who can
call it. The page-level membership check
(`meetings/[id]/page.tsx:63-72`) stays the boundary.

---

### F11 — The plan progress views are nested unfiltered aggregates, materialized three times per `/plan` load

**Location.** `supabase/migrations/0007_progress_views.sql:18-83`
(rewritten for `priority_progress` by
`0163_fix_priority_progress_statuses.sql:39-89`); consumed at
`src/lib/plan/service.ts:100-116` (three at once), `:212`, `:261`,
`:366`, and `src/lib/dashboard/service.ts:184-190`.

**What happens now.** `sfa_progress` aggregates over
`annual_goal_progress`, which aggregates over `priority_progress`, which
is `priorities LEFT JOIN commitments GROUP BY p.id`. None of the three
carries a company predicate; the comment at `plan/service.ts:95` states
the situation plainly — *"Progress views cover the whole company; filter
to what's on screen."*

Two consequences follow, and I want to be careful about how confident I
am in each.

The first I am confident about: `plan/service.ts:100-116` queries all
three views in one `Promise.all`. Since each of the upper two contains
the lower ones, `priority_progress` is computed **three times** on a
single `/plan` render, in three concurrent statements.

The second is a planner question I cannot settle without `EXPLAIN`.
Postgres generally cannot push a join qualifier through a `GROUP BY` into
an aggregating subquery, so `.in("sfa_id", ids)` on `sfa_progress` very
likely materializes the full nested aggregate before filtering. If that
is what happens, then for a **`system_admin`** — whose
`commitments_select` and `priorities_select` policies admit every row on
the instance — `/plan` and `/dashboard` each aggregate every priority
joined to every commitment across every tenant, to produce five
percentages. For company users and guides, RLS bounds it to their own
tenant(s), which is why this has not shown up. I could not verify the
plan, and it is possible the planner is smarter here than I expect. It
is cheap to check with one `EXPLAIN ANALYZE` as a scoped system admin.

**Why it costs.** Per page load of `/plan` and `/dashboard`. If the
pushdown does not happen, the cost for a system admin scales with total
instance volume rather than tenant volume — meaning it is invisible at 10
companies and 2 instances, and severe at 1,000 and 50, with no warning in
between. That discontinuity is what makes it worth measuring now rather
than later.

**Direction of fix.** Measure first. If the aggregate is being
materialized, the fix is to add `company_id` as a filterable column at
every level (it is already projected) and make the callers filter on it
as well as on the id list, so the predicate lands on the base tables; or
to replace the nesting with one flat view that aggregates commitments
once and rolls up in a single pass.

**Risk of the fix.** Medium. `security_invoker = on` must be re-asserted
after any `CREATE OR REPLACE VIEW` — `0163:85-89` records that this does
not survive a replace, and that losing it "would be a cross-tenant read,
not a cosmetic regression". Also, `priority_progress`'s column *types*
are pinned by the replace rule (`0163:54-61` explains the `0::bigint`
cast), so a restructure that changes a column type needs a
`DROP ... CASCADE` and takes the rollups with it — which means
expand-and-contract across the fleet, not one migration.

#### Addendum, 2026-09-08 — measured

F11 above declined to assert the planner's behaviour without evidence.
Here is the evidence. `EXPLAIN (ANALYZE, BUFFERS, COSTS)` run against
the **dev clone** (`AiMS IHQ Dev`, never production) at its real
volume: 12 companies, 16 focus areas, 48 annual goals, 141 priorities,
464 commitments (408 live). That is production-like — the clone is a
refresh of it.

**The question was: does the planner materialize the nested views, or
flatten them? The answer is both, depending on depth.**

**One level flattens.** `priority_progress` filtered to 45 priority ids
pushes the restriction straight into the base table:

```
GroupAggregate  (cost=0.29..33.44 rows=45) (actual time=0.065..0.307 rows=45)
  ->  Merge Left Join
        ->  Index Scan using priorities_pkey on priorities p
              Index Cond: (p.id = ANY ('{...45 uuids...}'::uuid[]))
Execution Time: 0.460 ms
```

No sequential scan of anything. The review's concern does not apply to
the single-level view.

**Two and three levels materialize.** `sfa_progress` filtered to one
company's 3 focus areas, run without RLS:

```
GroupAggregate  (cost=63.53..63.67 rows=3) (actual time=0.946..0.953 rows=3)
  ->  ...
        ->  HashAggregate  Group Key: g_1.id   (actual rows=48)      <- ALL goals
              ->  ...
                    ->  HashAggregate  Group Key: p_1.id  (actual rows=141)  <- ALL priorities
                          ->  Hash Right Join
                                ->  Seq Scan on commitments c  (actual rows=408)  <- ALL commitments
                                ->  Seq Scan on priorities p_1  (actual rows=141)
        ->  Seq Scan on strategic_focus_areas s   (actual rows=3)
              Filter: (id = ANY ('{3 uuids}'::uuid[]))
              Rows Removed by Filter: 13
Execution Time: 1.335 ms
```

The outer filter is applied — and applied **last**, after the inner
aggregates have been computed over everything. The clinching comparison
is the same query with no filter at all:

| query | cost | execution | commitments scanned | priorities scanned |
|---|---|---|---|---|
| `sfa_progress` WHERE `sfa_id IN` (3 ids) | 63.53..63.67 | 1.335 ms | 408 | 141 + 138 |
| `sfa_progress`, unfiltered (16 rows) | 64.19..64.55 | 1.328 ms | 408 | 141 + 138 |

**Asking for one company's three numbers costs the same as asking for
all sixteen.** F11's hypothesis is confirmed for the nested case.

**But the cost that matters is not the one F11 predicted.** Those plans
ran as `postgres`, with RLS skipped. Re-run through
`security_invoker` as real callers, the same three-row query:

| caller | planning | execution |
|---|---|---|
| `postgres` (no RLS) | 2.784 ms | **1.335 ms** |
| `system_admin` (RLS on, every row admitted) | 3.348 ms | **16.679 ms** |
| company member (RLS on, tenant-filtered) | 12.119 ms | **35.060 ms** |

Two things in that table were not what the review expected.

First, **the system_admin is not the worst case — the ordinary company
user is**, by 2×. The reason is visible in the plan: for a
`system_admin` the RLS predicate short-circuits on the first branch
(`ap.role = 'system_admin'`), while a company member's has to evaluate
`is_guide_for()` and then compare `company_id`, per row. F11 named the
system_admin as the degrading case. On today's data it is the cheaper
one.

Second, and the real finding: **the dominant cost is F8, not the view
nesting.** The RLS-scoped plan carries six separate `auth_profile()`
subplans, and their loop counts are the whole story:

```
SubPlan 1  ->  Function Scan on auth_profile ap    (loops=3)
SubPlan 2  ->  Function Scan on auth_profile ap_1  (loops=38)
SubPlan 3  ->  Function Scan on auth_profile ap_2  (loops=48)
SubPlan 4  ->  Function Scan on auth_profile ap_3  (loops=138)
SubPlan 5  ->  Function Scan on auth_profile ap_4  (loops=141)
SubPlan 6  ->  Function Scan on auth_profile ap_5  (loops=270)
```

**638 executions of `auth_profile()` to return three rows.** That is
F8, caught in the act, inside F11's query. The jump from 1.3 ms to
35 ms between the no-RLS and RLS-scoped runs is almost entirely those
calls — the aggregate nesting is the same work in both.

**Recommendation: do not act on F11 as written. Act on F8 first, then
re-measure this.** The structural claim is confirmed — nested progress
views are materialized in full and the filter is applied at the end —
but at 464 commitments that costs about 1.3 ms, and the surrounding
35 ms is per-row RLS helper evaluation. Restructuring the views is a
`DROP ... CASCADE` on a three-view dependency chain plus an
expand-and-contract across the fleet, and it would leave the term that
actually dominates untouched. Hoisting `auth_profile()` into a
statement-level `InitPlan` removes ~638 function calls from this one
query without touching the views at all. The scale at which F11 becomes
worth revisiting on its own is roughly **10× current per-tenant volume
— about 4,000–5,000 live commitments in a single company**, where the
materialised scan reaches the tens of milliseconds and stops being
hidden by the RLS overhead above it; a 150-person company on a weekly
rhythm reaches that in five to seven years, sooner if a larger tenant
lands. Re-measure then, and re-measure immediately after F8 ships,
because F8 is what is currently masking it.

*Plans captured 2026-09-08 against `nemhsmrrqfzfudwgwzdo` (AiMS IHQ
Dev). Reproduce with `EXPLAIN (ANALYZE, BUFFERS, COSTS)` on
`select * from public.sfa_progress where sfa_id in (...)`, once as
`postgres` and once inside a transaction with `set local role
authenticated` and `set local request.jwt.claims`.*



---

### F12 — Middleware runs the full session refresh on Sentry's tunnel route and on the icon routes

**Location.** `src/middleware.ts:157-162` (the matcher) and
`next.config.ts:75` (`tunnelRoute: "/monitoring"`).

**What happens now.** The matcher excludes `_next/static`,
`_next/image`, `favicon.ico` and `brand/*.{png,jpg,…}` — and nothing
else. So `/monitoring`, the Sentry tunnel that every browser error,
trace and replay chunk is POSTed through, runs the whole middleware
pipeline: registry lookup, then `updateSession`, which performs
`supabase.auth.getUser()` (an HTTPS round trip to GoTrue that
revalidates the token, per the comment at `current-user.ts:41-44`) plus a
`profiles` read for the pending check. Sentry's own generated config
comment at `next.config.ts:72-74` warns about exactly this: *"Check that
the configured route will not match with your Next.js middleware."*

The same applies to `/icon.svg` and `/apple-icon.png`, which App Router
serves from `src/app/` and which are not in the exclusion list — so a
browser fetching the tab icon pays a registry lookup and a session
refresh.

Note this is *narrower* than the documented registry lookup, which I am
not questioning: the registry read is cached for 60s per process
(`registry.ts:37`) and is cheap. The expensive part on these paths is
`updateSession`, and these paths have no session to refresh and no scope
to enforce.

**Why it costs.** Per Sentry event and per replay chunk, which for a
session with replay attached is a steady background stream, not a
one-off. Each one costs an outbound HTTPS call to the auth server plus a
Postgres round trip that nothing reads. Same at any fleet size; scales
with user activity rather than tenants.

**Direction of fix.** Add `/monitoring` (and the icon routes) to the
matcher's negative lookahead, or route them through the existing
`isInstanceExemptPath` mechanism in
`src/lib/instances/middleware-decision.ts:115-117`, which already exists
for precisely this class of path.

**Risk of the fix.** Low, but not zero and worth stating. That
exemption list is deliberately closed — its comment says *"Nothing else
belongs in this list"* — because a path that skips resolution also skips
the suspension gate. For `/monitoring` that is acceptable and arguably
correct (a suspended instance's browser errors should still reach
Sentry, and the route touches no tenant database), but it is a
conscious widening of a boundary the codebase has kept deliberately
narrow, and it should be written down where the list is defined. Adding
paths to the matcher's regex instead avoids touching that list at all
and is the safer of the two.

---

### F13 — `getEffectiveCompanyId` is not request-memoized, so cross-tenant roles pay a `companies` probe per caller

**Location.** `src/lib/admin/scope.ts:104-110`, and `companyIsLive` at
`:154-161`.

**What happens now.** Every company-scoped page calls
`getEffectiveCompanyId(session)` — 23 call sites across `src/app` plus
several server actions. For a `company_admin` or `team_member` it
returns `profile.company_id` immediately with no query (`:115`). For a
`system_admin` or `aims_guide` it runs `companyIsLive`, a `companies`
select, on every call. The layout calls it (`layout.tsx:51`), the page
calls it again (e.g. `dashboard/page.tsx:27`,
`commitments/page.tsx:28`), and a server action adds a third as the tree
re-renders — the same triple-call pattern that `getCurrentSession` was
wrapped in `cache()` to solve, described in `current-user.ts:37-49`.

**Why it costs.** Two to three redundant round trips per page load, for
cross-tenant roles only. Small in absolute terms, and it sits at the
head of the request so it is pure serial latency ahead of everything
else. Constant with fleet size.

**Direction of fix.** Wrap `getEffectiveCompanyId` in React `cache()`,
exactly as its three sibling helpers already are.

**Risk of the fix.** Very low, and the reasoning is already written down
in `registry.ts:44-55`: React `cache()` is per-request and per-render,
so unlike a module-level memo it cannot leak one tenant's scope to
another request. The one thing to preserve is that the memo key must be
the session (or the profile id), not nothing — `cache()` on a function
taking `session` handles that by identity, but a refactor to a
zero-argument form would be a cross-request leak. Worth a comment
pointing at the registry note.

---

### F14 — Coach context assembly repeats overlapping commitment reads on every turn

**Location.** `src/lib/coach/context.ts:269-280` and `:466-535`, called
from `src/app/api/coach/route.ts:240`.

**What happens now.** Per chat turn, `loadSubjectBundle` computes a keep
rate for the open quarter and the two prior quarters by issuing one
`commitments` query per quarter (`:270-280`) — three parallel queries
over three windows of the same owner's rows. In parallel,
`loadSubjectCommitments` (`:466`) issues three more, and these are
*sequential*: the open-quarter detail rows (`:472`), the all-time open
rows (`:517`), and a parked count (`:531`). The open-quarter query at
`:472` covers the same owner and the same window as one of the three keep
rate queries at `:270`, with a superset of columns.

So roughly 12-14 queries at three levels of depth run before the model
call starts, with two of them reading the same rows.

**Why it costs.** Per user message, on a streaming surface where
time-to-first-token is the whole experience. In fairness the Anthropic
call dominates by an order of magnitude, so this is tens to low hundreds
of milliseconds against several seconds. It is on the list because it is
per-action rather than per-page and because the fix is small, not
because it is currently painful. Same at any scale.

**Direction of fix.** Fetch the subject's commitments once over the
widest window needed (oldest prior quarter → now) and derive all four
quarter keep rates plus the detail lists in memory; make the three
queries in `loadSubjectCommitments` a single `Promise.all`.

**Risk of the fix.** Low but non-trivially subtle. The two overlapping
queries do **not** use the same filters today:
`computeQuarterKeepRateForSubject` (`:415-430`) does *not* filter
`deleted_at` or `parked_at`, while `loadSubjectCommitments` (`:472-480`)
does. Unifying them silently changes the keep rate the coach is told
about. Given failure mode #3 ("Parked commitment leaking into a metric")
the filtered version is almost certainly the correct one — but that is a
metric change, and it should be made as a deliberate fix with a test,
not as a side effect of a performance refactor.

---

## 3. Deliberate decisions worth re-measuring

Nothing in this section is a recommendation to reverse anything. Each is
a decision I believe is correctly reasoned, where the cost has a plausible
path to outgrowing the reason, and where a measurement would settle it.

### 3.1 Live scorecard compute on every `/scorecard` load

`maturity/service.ts:19-23` says the live compute is *"a handful of small
reads — cheap enough to run on every page load"*, and names the exact
condition for revisiting: *"If that ever becomes a bottleneck we can
memoize via a 'current' cache row."* The product reason is strong (spec
§7: behaviour changes show up immediately, not next Sunday) and I would
not trade it away.

What has changed since that comment was written is the count. Eight
scorers, not six (`compute.ts:43-75` plus `solution_seeking` and
`positive_framing`), totalling roughly sixteen reads, and `scorePlanning`
adds a second round-trip level of its own (`scorers/planning.ts:32`
then `:60`). Then F1 stacks the dashboard loader on top of it on the same
page. "A handful of small reads" is now about 35.

Worth measuring: the wall-clock of `computeCompanyScorecard` for the
largest real tenant. If it is under ~150ms the comment is still true and
this should stay exactly as it is. Note that fixing F1 removes most of
the page's cost without touching this decision at all, so this is second
in line behind that.

### 3.2 `commitments_select_owner` as a third permissive policy

Migration `0141_guide_hq.sql:92-94` adds `owner_id = auth.uid()` as a
supplementary `SELECT` policy so a guide's own commitments across every
tenant surface on `/hq` without special routing. Spec §5 defends this
clearly, and the reasoning is right: it is additive, and harmless for
team members whose own rows are already in scope.

The cost is that `commitments` now carries three permissive `SELECT`
policies OR'd per row, on the single largest and most-scanned table in
the schema. Combined with F8, every commitment row scanned by anyone
evaluates `auth_profile()` and, when that fails, `is_guide_for()`.

Worth measuring: whether the OR chain short-circuits in the order that
helps. Postgres does not guarantee evaluation order for OR'd policy
quals, and if `commitments_select_guide` is evaluated before
`commitments_select` for company users, every company user's every query
is paying a `guide_assignments` probe per row for a policy that can
never be true for them. One `EXPLAIN (ANALYZE, VERBOSE)` as a
`company_admin` answers it. If the order is unhelpful, the fix is a
cheaper guard inside `is_guide_for` (an early `role = 'aims_guide'`
check on the caller, which it already has at `0111:100` — so this may
well already be fine), not a change to the policy set.

### 3.3 The 60-second registry cache TTL

`registry.ts:33-37` sets `CACHE_TTL_MS = 60_000`, and both
`docs/deployment.md` ("Suspension is deliberately not instant") and
`scripts/README.md` ("The hostname stops resolving within 60 seconds")
depend on that number being what it is. It is a correctness contract,
not a tuning knob, and I am not proposing changing it.

The thing worth knowing rather than assuming: on Vercel, each cold
serverless instance starts with an empty `Map`, so the *first* request to
each new instance pays a control-plane round trip in middleware, ahead of
everything else in the request. At low traffic per tenant — which the
brief states is the case — cold starts are the common case, not the rare
one, so the cache may be hitting far less often than "one query per
minute per process" suggests.

Worth measuring: the actual hit rate. If it is low, the answer is not a
longer TTL (that would break the suspension contract) but possibly a
negative-lookup fast path or accepting the cost as the price of the
architecture. Measurement first; there may be nothing here.

---

## 4. Adjacent, not performance

Three things I noticed while reading that are correctness observations,
not performance findings. I am flagging them because they were directly
in the path of what I was reviewing and because two of them are silent
failures. I have not verified any of them against a running system.

**4.1 The weekly scorecard cron may be snapshotting four disciplines as
"not enabled" for every company.** `computeCompanyScorecard` takes an
`admin` client for its scorers, but resolves feature flags through
`companyHasFeature` (`maturity/compute.ts:49-50`), which goes to
`getCompanyFeatures` (`subscriptions/service.ts:48-59`) and builds a
`createSupabaseServerClient` — the cookie-scoped **anon** client. In the
cron there is no session, and `company_features_select`
(`0016_company_features.sql:29-37`) is granted `to authenticated`. If
that reads back empty, then `measuresEnabled` and `meetingsEnabled` are
both false for every company, and `measures`, `meetings`,
`solution_seeking` and `positive_framing` are written as `score: null,
notEnabled: true` into `company_discipline_snapshots` every Sunday. This
would be invisible on `/scorecard` itself, because that page computes
live through a client that *does* carry a session — which matches the
design note that the snapshot table "only powers the historical trend
line". The symptom would be sparklines with permanent gaps on those four
tiles, and a distorted `overall` in the trend. Passing the `admin`
client (or an explicit feature read) into `computeCompanyScorecard` would
settle it. Worth one query against a real snapshot table to confirm
before acting.

**4.2 The person scorecard's list queries do not filter soft-deleted or
parked rows.** `people/service.ts:192-198` (open commitments) and
`:204-209` (history) filter neither `deleted_at` nor `parked_at`; the
trend query at `:175-181` filters neither either. The quarter-stats query
at `:148-155` filters both, correctly. `docs/failure-modes.md` #3 names
`src/lib/people/service.ts` in its list of "every service query filters
`parked_at IS NULL`", and #7 says a soft-deleted row "disappears from
every UI and metric". A team member who soft-deletes an open commitment
would still see it on their own scorecard. This overlaps F7, and a
bounded rewrite there should fix it rather than carry it forward.

**4.3 Two definitions of a person's Follow-Through Rate.** The dashboard
and the person scorecard derive it from `week_ending` inside the open
quarter; `getPeopleRoster` (`people/service.ts:60-71`) derives it only
from commitments linked to a priority in the open quarter
(`.in("priority_id", priorityIds)`), so operational commitments do not
count on `/people`. That is the same class of bug
`admin/companies-service.ts:90-93` records having already fixed for the
fleet list. Purely a correctness note; it has no bearing on any finding
above.

---

## 5. Where I am uncertain

Stated plainly, because a review that hides its limits is worth less than
a shorter one.

- **No query plans.** F8 and F11 both rest on how Postgres plans
  correlated subqueries and aggregating views. My reading of both is
  conventional, but a planner can surprise you, and `EXPLAIN (ANALYZE,
  BUFFERS)` on one real tenant would either confirm or kill both in
  about ten minutes. F11 in particular I would not act on before
  measuring.
- **No row counts.** The severity of F3, F7 and F9 depends entirely on
  how much history exists. All three are shape problems that are certain
  to grow; whether they are already felt today, I cannot say.
- **No bundle measurement.** F6's size claim is from package
  reputation, not from a build. The *structural* claim — that the import
  is eager and in the layout — is verified from the source and stands
  regardless.
- **PostgREST row caps.** The truncation edge in F3 depends on a
  `db-max-rows` setting I cannot see from the repository.
- **What I did not review in depth.** The Strengths module
  (`src/lib/strengths`, `src/components/strengths`,
  `src/app/(app)/strengths`) — the spec excludes it as separately scoped,
  so I read it only far enough to confirm its query shapes resemble the
  rest and found nothing that would have changed the ranking. Also
  skimmed rather than read: the provisioning and fleet scripts under
  `scripts/`, which run out-of-band and whose sequential behaviour is
  documented as deliberate; the e2e suite; and the marketing routes.

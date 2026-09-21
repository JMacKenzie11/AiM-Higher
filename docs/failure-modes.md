# Failure modes

Living catalogue of edge cases the AiMS platform is designed to survive.
Each entry: the situation, what the system does today, and (where
relevant) the test that pins the behaviour so a future refactor
doesn't silently drift.

The list is intentionally short — most bugs don't belong here. Add
an entry only when the failure mode is:

- **User-visible** in a way that would confuse or mislead if handled
  wrong ("I marked it kept but the score didn't move");
- **Cross-cutting** enough that the fix touches multiple files
  (schema + action + UI + math);
- Or a **contract** — a rule that reads obviously right in isolation
  but subtly wrong in aggregate ("late keeps count in Follow-Through").

One section breaks that pattern on purpose: **Engineering practice** at
the end catalogues failure signatures in how we build rather than in
what we built. An entry earns a place there only after it has happened
twice — with one exception: an entry that exposes a credential is
admitted on the first occurrence. Waiting for a second breach to write
down the rule is not a bar worth holding.

Everything else lives in the relevant PR description + test file.

---

## Commitments

### 1. Late keep dragging Follow-Through as a "miss"

**Situation.** Someone marks an overdue commitment kept. They did the
work, just after the due date.

**Rule.** Follow-Through's discipline signal is "on time," not "at
all." Late keeps show as a success everywhere the row is displayed
(green check + clock badge, never X, never red) but do not count in
the Follow-Through numerator. They DO count in the denominator, so
chronic-lateness shows up as a low rate with a full late-keep column.

**Pinned by.** `src/lib/utils.test.ts` — `computeRateFromCounts`,
`summarizeKeepRate` cases for the on-time-only numerator; the
"counts late keeps in the denominator even with zero on-time" case.

### 2. Admin resolving during the weekly meeting with no reason

**Situation.** A company_admin is running the weekly meeting and
resolves several missed / kept-late commitments on their team's
behalf. Owners aren't clicking themselves — the admin is.

**Rule.** Owners must supply a reason on missed / reschedule.
System admins, company admins, and AiMS guides on their assigned
companies are **exempt from all reason requirements** and may
change any date including past-due. Every admin-driven resolution
stamps `resolved_by_role = 'admin'` (or `'guide'`) + the resolving
profile id on the row so downstream (coaching context, later
reporting) can distinguish "no reason given by owner" from "admin
resolved during the meeting on their behalf."

**Pinned by.** `src/lib/commitments/actions.test.ts` — the
"admin marking a past-due commitment kept-late succeeds in ONE
action, no reason" and "admin marks missed with no reason in one
action" and "admin can change a past-due date with no reason in
one action" cases.

### 3. Parked commitment leaking into a metric

**Situation.** Someone parks a commitment to set it aside. Later a
dashboard shows a stale Follow-Through Rate or an inflated Needs
Attention count that still includes the parked row.

**Rule.** Parked rows (`parked_at IS NOT NULL`) are excluded from
every list, count, overdue check, Needs Attention grouping,
Follow-Through calculation, and coaching-context resolved list.
The coaching context DOES surface a `parkedCount` when nonzero so
a coach can see how much has been set aside — but not on any
numeric scoreboard. Bringing back a parked row nulls `parked_at`
and sets a fresh `due_date`.

**Pinned by.** Every service query filters `parked_at IS NULL`:
`src/lib/commitments/service.ts` (main page loader, prior weeks,
`computeQuarterKeepRate`), `src/lib/people/service.ts`,
`src/lib/people/quick-view-action.ts`, `src/lib/coach/context.ts`.
Also `src/lib/commitments/actions.test.ts` — the "refuses to mark
a parked commitment" case.

### 4. Ongoing weekly commitment resolved three weeks running

**Situation.** A commitment is set to `is_ongoing = true`
(repeats weekly). Over three weeks the owner resolves it: kept,
kept-late, missed. What ends up in the database?

**Rule.** Exactly one row in `commitments` (the parent). Three
rows in `commitment_occurrences` — one per week_ending, each with
its own status. Follow-Through math iterates both tables so all
three occurrences count individually (one in the on-time
numerator, two in the denominator only). The parent row's
`due_date` and `week_ending` roll forward 7 days on each
resolution; its `status` stays `open` the whole time. Missing a
week (no resolution before the next week arrives) leaves the
parent showing overdue in the UI — resolving it late records the
occurrence for the week the due_date currently points to, then
rolls forward.

**Pinned by.** `src/lib/commitments/actions.test.ts` — the
"ongoing commitment: writes an occurrence + rolls due_date +7
days" case. `src/lib/utils.test.ts` — the "three weeks of
resolutions produces three entries in Follow-Through math" case.

### 5. Historical missed row that was actually completed later

**Situation.** Migration 0139 introduced the on-time / late split.
Legacy rows with `status = 'missed'` and a `completed_at`
timestamp may represent "did the work, just late" instead of "not
done." We can't reliably distinguish the two after the fact.

**Rule.** The migration best-effort maps `missed AND completed_at
IS NOT NULL` to `kept_late`; `missed WITHOUT completed_at` stays
`missed`. This is an accepted false-positive for legacy rows —
new resolutions record the on-time-vs-late split explicitly at
mark time, so drift stops after 0139 lands.

**Pinned by.** The migration file itself
(`supabase/migrations/0139_commitments_resolution_refactor.sql`)
carries the SQL rule. A before / after row-count sanity check
against production is expected on migration rollout (see the PR
that ships this change).

### 6. Transcript extraction guessing a nearer date than agreed

**Situation.** A meeting transcript says "I'll aim for Wednesday"
without an explicit deadline commitment. The extractor guesses
`due_date = <this Wednesday>` — three days out — turning a soft
intent into a firm deadline.

**Rule.** When a transcript doesn't state an explicit deadline
(`clarity_timeline !== true`), the extracted commitment's due date
is floored to `meeting_date + 7 days`. Any nearer guess is
ADJUSTED up (row is kept, date is corrected), not dropped.
Explicit dates (`clarity_timeline === true`) pass through as-is
even if below the floor — the participants agreed to it. The
prompt tells the model to prefer emitting `null` when unsure so
it stops guessing to be helpful.

**Pinned by.** `src/lib/transcripts/analyze.test.ts` — the
"malformed due_dates default to meeting + 7," "date earlier than
meeting+7 is adjusted UP," and "explicitly stated date is trusted
as-is" cases.

### 7. Deleting a resolved commitment as a non-admin

**Situation.** A team member tries to delete their own kept
commitment from last month to hide a pattern.

**Rule.** Non-admin owners may only delete their own OPEN
commitments; resolved rows are protected. Admins may
soft-delete anything. Deletion is a **soft delete** — the row
sets `deleted_at` and disappears from every UI and metric, but
the data is retained internally for potential future
coaching-signal work. INTENTIONALLY REVERSIBLE.

**Pinned by.** `src/lib/commitments/actions.test.ts` — the
"non-admin cannot soft-delete a resolved commitment" and "admin
can soft-delete a RESOLVED commitment" cases.

---

## Practices

### 8. Malformed chart_proposal JSON from the Functional Chart Builder

**Situation.** The model emits a `chart_proposal` fenced block
that isn't valid JSON, or is valid JSON in the wrong shape
(missing `functions`, a function with no `responsibilities`, a
top-seat with a non-string `note`, an empty responsibility
string). The card would either crash on parse or render an
empty preview if we naively passed the JSON through.

**Rule.** `parseChartProposal` returns null for any structural
mismatch. The card renders a muted fallback with a "Fix the
proposal" action that seeds a canned nudge into the composer —
the model regenerates a fresh, full block on the next turn. The
Apply server action re-validates through the same parser; a
call from a tampered client with malformed JSON is rejected
before touching the chart. During streaming, the same fallback
reads as "Assembling your chart…" so a partial JSON payload
doesn't flash a scary error.

**Pinned by.** `src/lib/practices/parse-chart-proposal.test.ts`
(the malformed cases + the empty-responsibility rejection);
`src/lib/chart/apply-proposal-action.test.ts` (the "rejects
malformed proposal JSON with no writes" case).

### 9. Apply-to-Chart called by a caller without edit rights

**Situation.** A team member (or a guide off the caseload) hits
the Apply button on a ChartProposalCard. The card is only
mounted inside a role-gated practice, but the server action is
the security boundary — a hand-crafted request could still get
here.

**Rule.** `applyChartProposalAction` calls `isAdminForCompany`
against the scoped tenant AFTER parsing the proposal, and
returns a friendly error result if the caller isn't a
company_admin, system_admin, or an aims_guide assigned to this
company. No writes happen. Writes use the admin Supabase client
so RLS isn't the enforcement layer for this action; the
app-layer check IS.

**Pinned by.** `src/lib/chart/apply-proposal-action.test.ts` —
the "denies a team_member caller even with valid JSON" and
"denies an aims_guide off caseload" cases; the "is idempotent"
case guarantees that even a repeat successful call doesn't
double-write.

### 10. Second Apply of a revised proposal after the first was applied

**Situation.** The leader applied v1 of a chart_proposal, then
went back to the coach for a revision and got v2. They press
Apply on v2. Some functions from v1 are now on the chart; v2
adds a few new ones and enriches the responsibilities of the
existing ones.

**Rule.** Apply is additive-only:
- **Function name match (case-insensitive):** skip the function
  itself, but MERGE any missing responsibilities into it
  (add-only, case-insensitive on title text). Never delete or
  modify existing responsibilities.
- **New functions:** create.
- **Top seats:** skip entirely when the chart already has ≥ 2
  top-level functions (universal case; Visionary + Integrator
  are seeded on every company). Kept-vs-proposed names surface
  in the summary line.

The idempotency guarantee: applying the same JSON payload twice
in a row creates nothing the second time — the summary reports
zero created, zero added, and any kept-top-seats note.

**Pinned by.** `src/lib/chart/apply-proposal-action.test.ts` —
the "skips a function whose title matches an existing one …
but merges missing responsibilities" and "is idempotent"
cases.

### 11. Direct-launch URL for a role-gated practice hit by a team member

**Situation.** A shared link to `/ask-aimee/new?practice=
functional-chart-builder` lands in a Slack channel, and a team
member follows it.

**Rule.** The launch route runs `practiceRoleGate` against the
scoped company before any DB write. Denials render a friendly
"Practice not available" page with a back link, not an error
boundary. Guides on off-caseload companies fall through the
same path (role passes, `isAdminForCompany` fails). The
practice card is also hidden from the /ask-aimee landing list
for ineligible callers as UX polish, but the launcher is the
security boundary.

**Pinned by.** `src/lib/practices/gate.test.ts` — role-not-in-
list and guide-off-caseload cases; `src/lib/practices/
actions.test.ts` — the "denies a team_member on a role-gated
practice" and "denies an aims_guide on a company they aren't
assigned to" cases through the action layer.

---

## Engineering practice

Failure signatures in how we build. These are here because each one has
now happened twice, in unrelated parts of the system, which is what
makes it a pattern rather than a bug.

### E1. Trusting an assumed response shape from an external API

**Situation.** Code is written against a mental model of what an
external API or framework does. Unit tests are written against the same
mental model, with mocks shaped by the assumption. Everything is green.
The behaviour is wrong, and nothing says so.

**Rule.** **Any assumption about an external API's response shape must
be probed against the real API at least once before logic depending on
it is trusted.** Unit tests asserting the assumed shape do not count as
evidence — they confirm the assumption, not the reality. One real call,
with the response printed, is the whole cost.

This applies to browsers and frameworks as much as to REST APIs:
"which headers arrive at middleware" is a response shape.

**Where it has bitten us.**

*The prefetch guard.* Middleware skipped its scope-cookie write when a
request carried `next-router-prefetch: 1`. Next strips that header
before middleware sees it, so the guard never fired, and a `<Link>`
prefetching on hover moved the operator into a company nobody chose.
The unit tests passed for weeks: they constructed a `Headers` object
containing the header and asserted the guard fired, which it does — on
a request that never exists. Caught only by driving a real dev server
with each header in turn.

*The Vercel env comparison.* `write-vercel-env` decided whether to
rewrite a variable by comparing the value Vercel returns against the
value we want. Vercel returns no readable value for any variable:
`sensitive` comes back as `""`, and `encrypted` comes back as
~1100 characters of ciphertext, with `?decrypt=true` making no
difference. The comparison could never match, so the step would have
rewritten three production variables on every run while reporting it as
normal. The unit tests passed, because their mocks returned plaintext.
Caught by listing the variables through the real API after the first
live run.

**Pinned by.** Nothing can pin a practice. What is pinned is each
instance: `e2e/scope-cookie.spec.ts` drives a real browser rather than
a synthetic `Headers` object, and
`scripts/lib/provisioning/vercel-steps.test.ts` has a case asserting
that a ciphertext value is never compared against a plaintext one.

### E2. Hand-applied SQL against a live database

**Situation.** Something needs changing on a database now — a policy, a
column, a safety trigger. The SQL editor is right there, the change is
small and obviously correct, and it works. Nothing is written down.

**Rule.** **No hand-applied SQL against any instance, ever.** Schema
goes through `supabase/migrations/`. Reference data goes through
`supabase/seed/instance-seed.sql`. There is no third path.

Not because hand-applied SQL is wrong in the moment — it is usually
right, which is what makes it tempting — but because it applies to
**one** database. Every instance provisioned afterwards is born from
the files and silently lacks it, and nothing ever reports the
difference. The change becomes invisible the moment the tab is closed.

**The example that settles it.** `rls_auto_enable()` and the
`ensure_rls` event trigger existed on production and in no migration
file. They auto-enable row level security on any newly created public
table: a genuine safety net, applied by hand, almost certainly after a
security-advisor recommendation. It was right.

But every instance provisioned since was missing it. A new customer's
database — the one that most needs a backstop against a table shipped
without RLS — was the one least likely to have it, and the gap was
invisible until production was diffed against a freshly provisioned
reference during migration adoption. It is now migration 0170.

The same diff found production missing migrations 0116 and 0168
entirely, which is the other half of the same failure: a database
maintained by hand drifts in both directions at once.

**Why the rule is stated rather than assumed.** This drift was found
because it was bounded — one database, a reference to compare against,
and a reason to look. The rule exists so it stays bounded. A second
episode of hand-applied SQL across several instances would not be
diffable against anything, because there would be no clean reference
left.

**Pinned by.** Nothing can pin a practice. What exists is the
verification procedure in `scripts/README.md` — diff against a cleanly
provisioned instance before stamping migration history — and migration
0170, which carries the story of where it came from.

### E3. A credential transiting a shell command

**Situation.** A script needs to act as a signed-in user, or to
authenticate to something, and the credential is put where the shell
can see it: pasted inline into the command, or printed to stdout so a
later command in the pipeline can reuse it. It works. The credential is
now in the session log, permanently, in plaintext.

**Rule.** **A secret must never appear in a shell command's arguments
or in its output.** Not a password, not a session cookie, not a token,
not a service key. Read it from a file or an environment variable
inside the process that needs it, and pass a PATH between commands
rather than a value. When a value has to persist between steps, write
it to a file created under `umask 077` and delete it afterwards. For
anything driving a browser, Playwright's `storageState` already does
this correctly and is the reference implementation.

Printing an environment variable's NAME is fine and often necessary —
`echo "PROD_SUPABASE_URL is set"` is a useful diagnostic. Printing its
value is not.

**Where it has bitten us.** One incident, both directions at once, on
2026-09-07. A throwaway probe script verified production after
migration 0168 by signing in as a real system admin and then curling
several authenticated routes. It carried the production password
INLINE as a string literal, and it printed the resulting Supabase
session cookie to stdout so the next command could pass it to
`curl -H "Cookie: $C"`.

Both halves landed in the session transcript in plaintext: the password
as part of the command, the session as part of its output. The session
blob contained a live refresh token, which does not expire on its own
and can mint access tokens until the session is revoked; the access
token inside it was still valid for another hour. Fifteen further
copies of session material accumulated in scratchpad files across two
sessions, because saved page dumps and cookie jars are just files and
nobody was thinking of them as secrets.

The remediation was a password rotation and a `delete from
auth.sessions` for that user. Neither is expensive. Both were entirely
avoidable, and neither would have been noticed at all if the leak had
not been spotted and stated at the time — which is the actual reason
this entry exists. A credential in a log is not self-announcing.

**Why the rule is absolute rather than judged case by case.** The
tempting version is "don't print PRODUCTION credentials". That fails
the moment a dev credential turns out to be shared, or a log is pasted
into an issue, or a transcript is used to reconstruct what happened.
The value of a secret is not knowable at the moment it is printed. A
rule with no exception needs no judgement at 2am.

**Pinned by.** Nothing can pin a practice, and no test can see a
credential in a log. What exists is the alternative: `e2e/fixtures.ts`
authenticates through Playwright's own storage rather than by moving
cookies through the shell, and the provisioning tooling reads every
secret from `.env.provisioning` inside the process that uses it rather
than passing values on a command line.

### E4. A check that was never shown it could fail

**Situation.** A test is written, or a measurement is taken, and it
returns the expected answer. Everything is green. Nobody establishes
that the check was capable of returning anything else, so "green"
carries no information: a test that cannot fail and a test that passes
look identical from the outside.

**Rule.** **Every check must be shown to go red before its green is
believed.** For a regression test, that means running it against the
unfixed code and watching it fail. For a measurement, it means
measuring a case whose answer is already known to be different. For a
guard that compares a right shape against a wrong one, it means
reporting BOTH outcomes, every time, so a wrong shape that quietly
stops being wrong is visible rather than silently converting the check
into decoration.

**The zero case, stated separately because it hides.** A check whose
pass condition is "0 rows" must also show that a nonzero was available
to it. A zero from a working boundary and a zero from an empty set are
the same zero, and only one of them is evidence. So: a control beside
every zero, in the same run, isolation included.

This is E1's sibling and not the same rule. E1 says do not trust an
assumed response shape; this says do not trust your own instrument.

**Where it has bitten us.**

*The session-less entitlement test.* The weekly scorecard cron resolved
feature flags through a cookie-scoped client and got an empty list
instead of an error, recording four disciplines as "not enabled" on
every snapshot for three weeks. Unit tests were green throughout,
because they were written against the same mental model as the code.
The fix's test was therefore run against the pre-fix resolution first
and watched to fail — 6 of 12 cases, including all four behavioural
ones — before its passing on the new code was taken to mean anything.

*The simplified predicate.* The measurement deciding F8's hoist shape
first used a cut-down policy predicate, dropping an `OR` branch as
noise. Postgres turned the simplified `EXISTS` into a hashed semi-join
and reported `auth_profile loops=1` — that is, "the problem does not
exist". The real predicate reports `loops=5000`. The simplification was
caught only because the number disagreed with production plans already
in hand; nothing about the measurement itself looked wrong. A
green-looking instrument had been pointed at a different query.

*The write policies nobody wrote through.* F8 batch 2 rewrote eight
write policies on `commitments` and `commitment_occurrences` and
measured only reads: deleted-user counts, isolation counts, and
`select count(*)` plans. The browser pass meant to cover it ran as a
scoped-in admin, whose DELETE goes through `commitments_delete_admin`,
which carries no `status` clause — so the owner rule it was supposed
to exercise, failure mode 7, was checked by nothing at all. The
database-level enforcement was confirmed only when write probes were
run as a member: the resolved commitment is refused, the open one is
not. Nothing had moved, but nothing had established that either.

*The isolation check that passed against an empty set.* The harness's
tenant-boundary acceptance asserted that a member of company A sees N
of A and 0 of B. It never established that B had rows in the table.
For `commitment_occurrences` in F8 batch 2, B had none, so the zero was
arithmetic and the check would have passed with every policy on the
table dropped. It had already passed twice, on a batch that shipped to
production. The fix picks an "other company" that has rows in the
table under test, reports how many were denied, and calls a table
where no such company exists NOT PROVEN. Batch 1 was re-measured
through the corrected check before batch 2 opened: its zeros were
real, denying 1, 7 and 3 existing rows.

**The case that earned the whole apparatus.** F8's deleted-user case
was written in batch 1, against a hazard nobody had hit, and passed
for four batches in which it could not have failed — the classic
profile of a check somebody eventually deletes as noise. In batch 6c
it caught a live deny-becomes-allow on its first exposure to the
shape: a hoisted `strengths_items` policy that would have let a caller
with no profile row read the entire item bank, because
`auth_profile()` returning no rows makes `exists` false while the
scalar helper returns NULL and `NULL is null` is true. One line, on
the first run, before the migration left the branch. The before, the
naive hoist and the shipped form are written out under Hazard 2 in
`docs/f8-rls-hoist.md`.

**And one it did not introduce.** Batch 6e found
`company_discipline_snapshots` comparing `company_id` against a bare
scalar subquery over `auth_profile()` — hazard 3's exact shape, sitting
in the schema since before the series began, one predicate change away
from a fleet-wide 500 on every read of that table. Nothing in F8 put
it there; F8 found it by visiting every table.

So the ledger reads: one hazard introduced by the rewrite and caught
before it left a branch, one hazard already in the schema and found
because the work was finished rather than stopped when the plans
looked good enough. Those two lines are the argument for keeping the
harness, and for finishing a migration series rather than declaring
the interesting part done.

The conclusion is about what the harness IS. It is not campaign
tooling for F8 that gets deleted when the batches finish: it is the
only instrument that can ask a real Postgres whether a policy still
denies, and the value of a case is not knowable while it is green.
Four batches of "this passed again" bought one catch that would
otherwise have been a production incident found by a customer, or not
found at all.

**Pinned by.** Nothing can pin a practice. What exists is the shape:
`scripts/rls-harness.ts` reports the wrong shape and the right shape on
every case, declares a case broken if the wrong one stops leaking, and
names the size of the set each zero was measured against;
`docs/f8-rls-hoist.md` states all three rules with the near-misses
written out and Hazard 2's worked example in full.

### E5. A role widening that never reached the database

**Situation.** A server action's `requireRole` list is widened to admit
another role. The UI starts rendering the control for that role. The
RLS policy on the table is not touched, because the change looked like
an application-layer decision and the policy lives in a different
directory, a different language, and a different deploy step. The two
now disagree, and the disagreement is silent: RLS refuses an UPDATE by
matching zero rows, not by raising, so the action takes its ordinary
"couldn't save" branch and reports a generic failure.

**Rule.** **App guards are courtesy. RLS is the boundary.** A role
widening in a server action ships with its matching RLS change in the
same PR, and every granted write gets a probe in
`scripts/rls-harness.ts` that exercises it AS THAT ROLE. **A rewritten
write policy is covered by the same rule**: the batch that rewrites it
probes it as each role it governs, before and after, in that batch.
A read plan says nothing about who may write. A probe
asserts both halves: the write the role is supposed to make, which must
actually change a row, and a write the same role must still be refused.
The second is what makes the first mean anything, because "the update
succeeded" is equally true of a correct narrow grant and of a policy
that admits everything.

The probe is required because nothing else can see this. Unit tests do
not run Postgres — `src/lib/auth/rls-privileges.test.ts` reads
migration text for exactly that reason — so a permission that exists in
TypeScript and not in the database is green everywhere except in front
of a user.

**Where it has bitten us.**

*The industry field.* Commit `5f43059`, "Company admins: open Industry,
Transcripts, Planning-cycle actions", widened
`setCompanyIndustryAction` from `system_admin` to also admit
`company_admin` and `aims_guide`. It changed four TypeScript files and
no migration. `companies_update` had admitted `system_admin` and nobody
else since `0004_rls.sql:56`. For the entire life of the feature the
field rendered for company admins, accepted typing, and failed on every
save with "Couldn't update the industry." — `.select("*").single()`
returning empty after RLS refused the write. It was found by an
unrelated audit of write paths, not by a user report, which is its own
evidence about how visible this failure is: a control nobody could use
produced no complaints.

Fixed in `0176_company_industry_grant.sql`. The probe that now stands
over it was run against the live schema first and watched to fail — `0
rows (refused by RLS)` for both roles — before the migration was
applied inside the transaction and it turned green. Per E4.

**A grant on one column needs more than a policy.** RLS decides which
ROWS a statement may touch and has no column dimension, and `WITH
CHECK` cannot compare the new row against the old one. Column-level
`GRANT`s do not close the gap either: privileges attach to the Postgres
role, and every signed-in user of this app is `authenticated`, so
restricting that role to one column takes the others away from
`system_admin` at the same time. The shape that works is a policy for
the rows plus a `BEFORE UPDATE` trigger for the columns, scoped to the
roles the policy newly admits.

*The transcript sources, with the symptom inverted.* The same commit
widened `transcriptSourcesAllowed` to admit `company_admin`, and those
controls work. The database refuses every write behind them. Probed
against the real policies, with a source seeded inside the transaction
so the control is not an empty table: pause/resume updates 0 rows as a
company admin and 1 as a system admin, remove deletes 0 and 1, and
connect-folder raises `42501 new row violates row-level security
policy`. `transcript_sources_update`, `_insert` and `_delete` admit
`system_admin` and carry a `_guide` mirror; the only `company_admin`
branch anywhere on that table is on SELECT.

They work because every database call in
`src/lib/transcripts/actions.ts` goes through `createSupabaseAdminClient`,
the service-role client, which the file constructs in fourteen places
and which does not consult RLS at all. The
disagreement is real, the feature is fine, and `guardForSource` and
`guardForCompany` are the entire boundary. The same commit says of the
routing and alias actions that "RLS on meetings backstops that if
anyone hits the action directly" — those four actions use the same
service-role client, so there is no backstop to be had.

This is the harder half of the failure mode to see. A control nobody
can use eventually gets reported by somebody. A control that works,
guarded only by application code, reports nothing ever.

**The disagreement has two disguises.** Industry was findable because
`setCompanyIndustryAction` ends in `.select("*").single()`, and
`.single()` errors on the empty result an RLS refusal produces. Almost
nothing else on this pattern does. `bulkResetPlanAction` issues four
`.update().eq()` calls and checks only `error`, which RLS never sets: a
refusal matches zero rows, and zero rows is a successful update of
nothing. That path is in fact correct — probed on the clone, a company
admin archives exactly what a system admin does, 3 SFAs, 9 goals, 14
priorities and 8 open commitments, while a company admin from another
company gets zero — but had it been wrong it would have returned
`ok: true` with four zero counts and archived nothing. The same action
scope-checks `company_admin` and not `aims_guide`, so an unassigned
guide already takes that branch today: RLS denies it 0 of 14 priorities
and the caller is told the reset succeeded.

Quiet failure and false success are one bug in different clothes. Only
a probe tells them apart, which is why the rule asks for one per
granted write rather than for a test of the action.

**Pinned by.** `scripts/rls-harness.ts` grant probes, which run on
every invocation rather than behind a flag, and fail loudly when a
granted write stops working or starts working too widely.

Nothing pins the transcripts path, because there is nothing there to
pin: its writes never reach a policy, so no probe can exercise one.
Bringing those actions back inside RLS — real policies for
`company_admin` and guides, the service-role client retired from those
fourteen call sites, the routing and alias actions given the backstop their
commit message claims, and the `aims_guide` scope check added to
`bulkResetPlanAction` — is queued behind F8 so the policies are born in
form D. The app guards hold in the meantime. They are still only
guards.

### E6. A structural argument standing in for a measurement

**Situation.** A claim about how this system behaves is reasoned out
from how it is built. The reasoning is sound, it survives review, and
it is used to decide something. The command that would have settled it
takes one invocation and nobody runs it, because the argument already
feels like knowing.

**Rule.** **When a claim about this system can be settled by running
something, run it before the claim decides anything.** A structural
argument explains *why* a thing behaves as it does. It is not evidence
*that* it does. The two are easy to confuse precisely when the argument
is good.

This is E1's other sibling. E1 says do not trust an assumed shape from
an external API. E4 says do not trust your own instrument's green until
you have seen it red. E6 says do not trust your own correct-sounding
account of your own code.

**Where it has bitten us.**

*The guard that guarded the wrong thing.* `migrate:dev` shipped with a
refusal for the case its author reasoned about — a dev URL that is also
production — and no check for the case that was actually true of the
machine it shipped on: a clone with a full schema and no migration
history, where `db push` replays from 0001. The PR argued at length
that a one-word command must not be able to reach production. It was
right about that and it had built a one-word command that could replay
97 migrations, 20 of which create tables without `IF NOT EXISTS`, over
twelve companies of data. One `--dry-run` printed all 97 filenames and
ended the argument.

*The clone that was "two migrations behind".* Everyone held that
belief, it was written in a deploy doc, and it was the premise of a
catch-up plan. The probe found no `supabase_migrations` schema at all,
and separately found 0175 and 0176 present while 0173 and 0174 were
absent — a state no supported path produces. The belief was close
enough to true to survive any amount of discussion and wrong in the way
that mattered.

**The counter-example, because the rule is not "never reason".** The
weekly scorecard cron runs as `service_role`, which carries
`rolbypassrls`, so no policy is evaluated for it and an RLS rewrite
cannot change its behaviour. That argument is correct and it was still
not treated as evidence: the next Sunday summary is read against a
known number anyway. Reasoning chooses what to measure. It does not
replace the measurement.

**Pinned by.** Nothing can pin a practice. What exists is the shape of
the deploy ritual: every applying command has a `--dry-run` beside it,
the applying half is gated on a person, and the dry run is treated as
the thing that decides rather than as a formality before the real run.

### E7. A protection that lives only in RLS

**Situation.** A rule about which rows exist is implemented once, in
the database, as an RLS policy — deliberately, and for a good reason:
one policy beats sweeping dozens of query sites, and it cannot be
forgotten at a new call site the way a `where` clause can. The
migration says so in its own comment. Then the same table is read by
something holding the service-role key, which bypasses RLS by design,
and the rule silently does not apply there.

**Specimen.** Migration 0148 hid soft-deleted companies behind a
restrictive policy, `companies_hide_deleted`, reasoning in its header
that "we don't have to sweep dozens of query sites app-wide — the row
simply disappears everywhere". True of every caller holding a user's
session. False of `src/lib/admin/dashboard-service.ts`, where all four
`companies` reads run as service role: deleted tenants were listed on
the platform dashboard for a year, including in *Needs attention*,
which reported a company nobody could reach as having no coach
conversations on record. Two other service-role readers had been fixed
by hand along the way — `coaching-insights-service.ts` filters
`deleted_at` in all three of its reads — which is the tell: somebody
had already met this and patched the instance rather than the class.

**Rule.** **A row-visibility rule enforced in RLS covers the caller's
client and nothing else. Every service-role read of that table
restates it, and a source guard proves they all do.** The service role
exists to bypass RLS; that is not a loophole to be closed but the
reason it is used, so the obligation moves to the caller. The guard
has to read the source, because the offending file is always the next
one somebody writes and it will look exactly as correct as the four
that shipped the bug.

**Not a rule.** Restating the filter on the caller's client too.
Demanding a redundant `is("deleted_at", null)` where RLS is already
doing the work teaches people the policy cannot be trusted, and a
codebase that half-trusts its own policies ends up with the filter
everywhere except the one place it was load-bearing.

**Pinned by.** `src/lib/admin/companies-deleted.test.ts`, which walks
`src/`, selects files that obtain a service-role client, and fails on
any `from("companies")` read without the filter. Lookups pinned to a
single id are exempt: the caller already holds the id and has to
handle a null either way. Shown failing against the unfixed
`dashboard-service.ts` before its green was believed — and its first
run produced a false positive on a query whose filter was present but
pushed out of the match window by a comment, which is why it strips
comments before measuring.

### E8. The absence of a policy read as the absence of a privilege

**Situation.** A table is locked down by writing exactly the policies
it should have and no others. The reasoning is that RLS decides who
may do what, so a verb with no policy is a verb nobody can perform.
The verb is in fact grantable separately, the platform has already
granted it, and the policy-shaped hole hides a privilege-shaped one.

**Specimen.** `coach_memories` (0194) is append-only: no UPDATE policy
exists, deliberately, and the migration said so at length. Supabase
ships `alter default privileges in schema public grant all on tables
to anon, authenticated, service_role`, so the table arrived with
UPDATE already granted to `authenticated`. The migration's `revoke
all` named `public`, `anon` and `service_role` — and not the one role
that actually had a session. An UPDATE therefore ran, RLS filtered
every row because no policy admitted any, and it reported **0 rows
affected**: indistinguishable from a refusal, and one policy away from
being a rewrite.

Caught because the probe demanded a **statement-level refusal**
(`42501`) rather than an empty result. A probe asserting "0 rows" would
have passed on the broken migration and gone on passing.

**Rule.** **On a table whose protection is the point, assert the
PRIVILEGE, not the policy.** `has_table_privilege` answers the
question a policy count cannot: policies decide which rows a verb
touches, grants decide whether the verb runs at all, and only the
second one is still true when someone adds a permissive policy later.
Revoke from every role by name — the pseudo-role `public` is not a
superset of `authenticated` — then grant back exactly the verbs
intended.

**Corollary for zeroes.** An empty result and a refusal look alike and
are not alike. Where the claim is "nobody can", the probe should be
able to tell which one it got; where it cannot, it is measuring the
data rather than the wall.

**Pinned by.** The permanent `coach_memories access wall` check in
`scripts/rls-harness.ts`, which asserts `authenticated` holds neither
UPDATE nor INSERT and `service_role` holds no SELECT, alongside the
policy-text assertions — plus the batch probes expecting `42501` from
both the subject and a system_admin.

### E9. A queue whose skip path does not advance its cursor

**Situation.** Work is processed from a queue, newest first, with a
cap on how much is done per pass. Some items are not eligible and are
skipped. The skip is written as an early `continue`, and the statement
that records progress sits at the *end* of the loop body — so a
skipped item is never marked as seen. If the window the queue is read
through is sized to the same number as the work cap, a run of
ineligible items at the head walls off everything behind them,
permanently.

**Specimen.** The coach-memory sweep (0194 era) ordered conversations
by `updated_at`, fetched `MAX_PER_RUN + 1` of them — four — and
skipped any with fewer than two user turns via a `continue` that
jumped past the watermark update. The owner's four newest general
conversations had **0, 0, 1 and 0** user turns: empty shells left
behind by `/ask-aimee/new`, which creates a row before the first
message, every time somebody opens a thread and backs out.

Every sweep examined the same three empty conversations, skipped all
three, and returned `0/0/0`. The real conversations sat at positions
seven and eight with nine and ten user turns and were **never once
reached**. 48 conversations produced zero memories for the entire
life of the feature.

It could not self-correct, either. An empty conversation has no
message timestamp, so there is nothing to write a watermark from: it
cannot be marked as seen even in principle.

**Rule.** **How many items you LOOK at is not how many you WORK on,
and sizing the first to the second guarantees head-of-line blocking.**
Looking is cheap; make the window wide enough to get past any
plausible run of ineligible items. Working is expensive; keep that
capped. And check every early `continue` against the statement that
records progress — if the cursor lives at the bottom of the loop, a
skip silently means "try this again forever".

**Corollary, on why nobody noticed.** Every failure mode of that
feature rendered as the same screen: "Aimee hasn't noted anything
yet." A sweep that never ran, a write the database refused, and a read
that failed were one indistinguishable empty page, because the
candidate query discarded its error, three failure paths logged to
`console` and continued, and the read path discarded its error and
returned `[]`. Diagnosis from outside was impossible, and the access
wall correctly refused the service-role key the inside view would have
needed. **A feature whose failure modes all render as its empty state
has no failure modes you can see.** Route them somewhere a person
looks, and make the empty state say which kind of empty it is.

**Corollary, on why the tests passed.** The E2E exercised the real
page and the real trigger and was green throughout, because its
fixture creates a conversation *with content* at the head of the
queue. The bug needs ineligible items at the head, and a test that
constructs the happy precondition cannot see a bug that lives in the
unhappy one.

**Pinned by.** `selectSweepCandidates` in `src/lib/coach/memory-shape.ts`,
extracted from the action precisely so the selection rule is testable
without a database, and its tests in `memory-shape.test.ts` — which
demonstrate the old shape rather than asserting about it: the same
fixture sliced to four rows returns `[]`, which is what production did
on every page entry.

### E10. An instruction reverted in one layer while its twin lived on in another

**Situation.** A behaviour is enforced in two places at once — a
system prompt and an instruction assembled at request time, or a
policy and the code that assumes it. The behaviour is later reversed.
The obvious copy is found and rewritten; the second one is not, and
the two halves now say opposite things. The model, or the next
reader, splits the difference, and the result looks like the *new*
rule being followed badly rather than the *old* rule still being
enforced somewhere.

**Specimen.** #144 shipped the participant-frame rule for coach
memory: an about-mode conversation could be summarized, but never with
a claim about the team member. It was enforced in
`prompts/coach-memory.md` **and** by a sentence prepended to the
summarizer's user turn in `memory-actions.ts`: *"Write the memory
about the leader, never about `<name>`."*

#145 reversed the decision. The prompt section was rewritten, the
deterministic filter removed, the SHA guard regenerated, the spec and
help amended. The runtime sentence was missed, and it sits directly
beside the transcript.

The model hedged. A leader's own statement — "Marcus keeps missing the
Thursday handoff" — came back as `inferred`, phrased *"believes X, but
this belief is not yet validated"*. That is not a provenance error so
much as an obedience compromise between two contradictory
instructions, and it put the model's assessment of a claim into the
record where the leader's words belonged.

Two fix attempts went into strengthening the prompt, which was already
correct.

**Rule.** **Before reverting a behaviour, inventory every layer that
states it, then revert them together.** Grep for the behaviour, not
for the file you remember editing. A rule worth stating twice is worth
un-stating twice.

**Corollary, on proximity.** When a model disobeys a rule you have
just strengthened, suspect a contradicting instruction *closer to the
content* before suspecting the rule. An instruction adjacent to the
material being processed outweighs a paragraph deep in a long system
prompt, so the layer nearest the data is the first place to look and
the last place people think of.

**Pinned by.** The two-half prompt guard in `memory-prompt.test.ts`
— SHA plus line-level assertions on the operative sentences, so a
softening edit fails even with a regenerated SHA — and the about-mode
E2E, which asserts provenance on the row's own `data-kind` attribute
rather than on page text. Matching on text passed while the row was
labelled an inference; only the attribute could tell the difference.

### E10b. The scope cookie, and the fourth door

**A postscript to the incident already recorded above**, added
2026-09-16 because the same class produced a fourth instance and the
count is the point.

The scope cookie is `path=/` with an eight-hour life. Only certain
code paths clear it, and every session-creating path that does not is
a door through which a previous scope walks into a new session:

```
signInAction              clears
signOutAction             clears
completeAcceptInviteAction clears   ← the one that found the bug
completeResetPasswordAction  DID NOT
```

`completeResetPasswordAction` calls `verifyOtp`, which creates a
session in whatever browser opened the reset link, and never dropped
the scope that browser was already carrying.

**Why the binding did not cover it.** The fix for the original
incident was to bind the cookie to the profile it was issued for —
`<profileId>:<companyId>` — so a cookie belonging to somebody else
cannot resolve. That closes the class where the NEXT session is a
different person. A password reset is almost always the SAME person,
and for them the binding is silent by design.

**The general shape.** A cookie with a lifetime longer than a session
needs an explicit list of everything that ends a session, and that
list has to be maintained by hand every time an auth path is added.
Three were found by incident, one by review. The structural answer is
to make the lifetime the session — no `maxAge` — so the browser does
the forgetting and no future auth path can forget for it.

**Related.** E10 is the original incident. E14 is the same family one
layer down: something that fails where nothing is listening.

### E11. A write policy that is correct and unreachable

**Situation.** A role is widened by writing exactly the policy the
widening needs. The policy is correct: it names the right role, tests
the right company, and reads as a faithful transcription of the
decision it implements. The write still does nothing, because the
rows it would act on are hidden from the caller by a policy for a
different verb. The two produce the same observable result — zero
rows affected, no error — so the investigation starts at the policy
that was just written and stays there.

**The rule underneath it.** A `DELETE ... WHERE` or `UPDATE ... WHERE`
has to read the columns it filters on. Postgres therefore applies the
SELECT policies to find candidate rows, and applies the write policy
only to what survives that. The SELECT policy is part of the write
path, and a write policy can only ever admit a subset of what SELECT
already shows the caller.

**Specimen.** Migration 0201 gives a `company_admin` the right to end
a guide's engagement (spec §1a, decision 7). The first version widened
`guide_assignments_delete` and nothing else:

```sql
create policy guide_assignments_delete on public.guide_assignments
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or ((select public.auth_role()) = 'company_admin'
      and (select public.auth_company_id()) = public.guide_assignments.company_id)
);
```

`guide_assignments_select` admitted the `system_admin` and the guide
themselves. A company admin could not see the row, so there was
nothing for the new DELETE policy to be asked about. Measured against
the clone, with everything else identical:

```
delete policy only        rows remaining = 1
delete + select policy    rows remaining = 0
```

**How it was found, and what nearly hid it.** The harness probe, which
was written before the migration and shown failing first. That is the
only reason it surfaced at all — the SQL reads correctly and no amount
of re-reading it would have helped.

Two wrong turns on the way, both worth naming:

- **The first version of the probe read zero for every claim**,
  including three whose whole point is that a row *survives*. It
  counted the table as the caller, and `guide_assignments_select` hides
  those rows from a company admin, so the count could only ever answer
  zero whether the delete was refused or not. Every claim passed
  through a read that could not distinguish them. The fix is `reset
  role` before counting: run the write as the caller, measure the
  table as the connection.
- **E8 was the first suspect** and was innocent here.
  `has_table_privilege('authenticated', 'public.guide_assignments',
  'delete')` was already true. That check is now a permanent claim on
  the case, because ruling it out took a round trip and should not
  need a second one.

**The guard.** `guide-assignment-revocation` asserts the visibility
directly, as its own claim, ahead of the deletes:

```
visible-to-company-admin 1 (want 1; a delete cannot reach a row the
SELECT policy hides)
```

A future narrowing of `guide_assignments_select` now breaks a claim
that says what it broke, instead of silently disarming the revocation
underneath it. This is the same shape as E4: the probe that is never
shown failing is not evidence, and here the probe had to be shown
failing for the *right reason* before the green meant anything.

**Related.** E8 is its twin — a policy that is correct and a privilege
that was never granted, with the identical symptom. Whenever a write
affects zero rows with no error, there are now three candidates and
they are cheap to separate: the write policy, the table privilege, and
the SELECT policy standing in front of both.


### E12. A boundary enforced at render time, behind gates that never render

**Situation.** A Server Component passes something to a Client
Component that React does not allow across that boundary. Every gate
agrees the code is fine, because every gate inspects the code rather
than running it: typecheck sees compatible types, lint sees valid
JSX, `next build` compiles it, and the preview deploy builds and goes
green. The page throws on its first real render, in production, for
every visitor.

**Specimen.** `/admin/companies` gained drag-to-reorder (#172). The
cells stayed server-rendered — they carry links, chips and a progress
bar — so the table took a `renderRow` callback and the server kept
owning them. That is a function crossing into a Client Component:

```
Functions cannot be passed directly to Client Components unless you
explicitly expose it by marking it with "use server".
  <... companies={[...]} canReorder=... header=... renderRow={function renderRow}>
```

Typecheck, lint, unit tests, `next build` and the Vercel preview were
all green on the broken code. It reached production and every load of
that route hit the error boundary.

**Why the gates could not see it.** They do not render pages. The
whole gate set is static analysis plus unit tests of modules; nothing
in it mounts a route. The one thing that would have caught it — an
e2e that signs in and loads the page — exists but sits outside CI by
deliberate choice (`playwright.config.ts` explains the trade), so it
only fails when somebody runs it.

**What a ReactNode does and a function does not.** A rendered node is
already part of the RSC payload and crosses freely. The fix is to
build the cells on the server and hand them over as data:

```tsx
rows={companies.map((company) => ({ id, name, cells: (<>…</>) }))}
```

**The guard, and the guard's own bug.** A source-level test now
asserts the Client Component accepts no function-typed prop. Its first
version read the `<CompaniesTable …/>` JSX at the call site and sliced
the props at the first `"/>"` — which is inside `</>`, the fragment
closing an adjacent prop. It inspected 415 characters, none of them
the prop that mattered, and **passed against the broken code** when
that was checked deliberately. Rewritten to read the component's props
TYPE, which is one declaration with no nested JSX to trip over, and
carrying its own falsification inline so it cannot rot back into a
guard that passes vacuously.

**The lesson that is not about React.** For a change that restructures
how a route renders, load the route. The verification here was a
throwaway script that signed in and fetched the page; it took about a
minute, reported `HTTP 200, error boundary shown: false`, and when run
against the stashed broken version reproduced the production error
verbatim. Cheap, and the only check in this list that was actually
capable of failing.

**Related.** E4 — a check that was never shown it could fail. Both
guards here were shown failing first, and the second one had to be,
because it was wrong.


### E13. Forgiving normalization that manufactures a complete-looking row

**Situation.** A model's structured output is normalized defensively:
a missing field becomes a null, a missing object becomes a record of
nulls, a missing aggregate is derived from whatever survived. Each
step is individually reasonable and none of them fails. Together they
turn "the model did not answer" into a stored row that is
syntactically complete and semantically empty, and every surface then
decides for itself whether that row counts.

**Specimen.** Meeting facilitation reviews. `dimensions` is in the
tool schema's `required` list; a model omitted it anyway. Then:

- `normalizeDimensionScore(undefined)` returns
  `{ score: null, notes: "" }`, four times.
- `overall` falls back to the rounded mean of the dimensions that
  scored. None did, so it is null.
- `insufficient_transcript` stays false, because the model never said
  it had too little to work with.

The row stored a rich `executive_summary` and no scores at all.
**Three surfaces disagreed about whether a review existed**: the
meetings list showed an empty Facilitation cell, the meeting page
rendered "How the meeting was run" with a dash in every score chip,
and the database held a row that read as present. **3 of 29 stored
reviews on production were in this state** — not a one-off.

**What made it invisible.** Nothing threw. The pipeline logs a
failure when the review errors, and this was not an error; it was a
successful call whose result meant nothing. The only evidence was a
blank cell in a list, which reads as "no review ran yet".

**The guard.** One predicate, `isScoredReview`, used in three places
for the same reason a single choke point beats three copies:

```ts
if (review.insufficient_transcript) return true;  // declining is an answer
return review.overall !== null;
```

The analyzer refuses to persist an unscored review, which stops new
ones. The meeting page and the meetings list both refuse to render
one, which handles the rows already stored without re-analysing them
and makes the two agree. The analyzer logs the keys the model
actually sent, because the cause is upstream of anything we can
assert.

**The general shape.** Defensive normalization is right at the edges
and wrong at the centre. Filling in a missing field is a kindness;
deriving an aggregate from nothing and storing the result is an
invention. Where a normalizer cannot distinguish "absent" from
"zero", something downstream has to ask whether the whole answer is
usable — and that question belongs in one function, not in each
surface's rendering condition.

**Related.** E1, trusting an assumed response shape from an external
API — the same trust, one layer further in: the shape was checked and
the content was not.


### E14. A fire-and-forget write whose failures nobody can hear

**Situation.** A write is deliberately not awaited, so that a slow or
failing side-effect cannot hold up the thing the user asked for.
Telemetry, usage logging, audit breadcrumbs. The decision is correct.
The consequence is that the write has no reader: if it starts failing
for every row, the application behaves exactly as it did when the
write worked.

**Specimen.** `logCoachTokenUsage` is called as `void
logCoachTokenUsage(...)` from every model call site, so a coaching
turn never waits on cost accounting. `coach_token_usage.purpose`
carries a CHECK constraint listing the allowed values. `memory` was
added to `CoachUsagePurpose` in TypeScript when coach memory shipped
and never added to the constraint, so every one of those inserts
violated the check and vanished.

Measured on production while investigating something else:

```
681 usage rows
clarity 267 · brief 113 · analyzer 80 · turn 64
insights_analysis 53 · facilitation 44 · themes 35
title 14 · rd 11 · memory 0
```

Every other purpose represented; `memory` at zero. The cost of
distilling a conversation had never reached the dashboard, for as
long as the feature had existed, and nothing anywhere said so.

**Why the usual guards missed it.** Typecheck was satisfied — the
union is the type, and the constraint is a string in a `.sql` file.
The RLS harness probes policies, not CHECK constraints. Unit tests
mock the logger. The one place the two lists have to agree was a
place nothing looked.

**The guard.** A source-level test parses the union out of `usage.ts`
and the allowed values out of the most recent migration that rewrites
the constraint, and asserts the two sets are equal. It reads both
lists rather than restating them, because a test that restates a list
is a third copy to forget, and it carries its own falsification
because comparing two parsed lists is exactly the shape that passes by
parsing nothing.

**The general shape.** Not-awaiting a write is a latency decision, and
it silently becomes a correctness decision the moment the write can
fail for a reason that is not transient. Where a fire-and-forget write
has a schema-level contract — a CHECK, an enum, a NOT NULL — something
has to compare the two ends, because the running system never will.

**Related.** E13 sits one step away: there, a forgiving normalizer
manufactured a complete-looking row; here, a deliberate silence let a
row never arrive at all. Both were found by counting rows in
production rather than by reading code.

### E15. Three broken probes, and a conclusion drawn from their silence

**What happened.** Every issue on Benson's `/issues` page rendered its
"add a commitment" form as a vertical stripe of single letters on a
phone. Reported from production, on a real phone, on every card.

The form composes `row rowNoPriority` from `commitments.module.css`,
and at ≤1024px that stylesheet places a row's cells by position:

```css
.row > :nth-child(1) { grid-area: circle }   /* … through (8) */
```

Safe only if you know the child count. Both stylesheets carried a
comment saying the form has three hidden inputs before its first real
cell — `issue_id`, `owner_id`, `due_date`. It has **seven**: React
adds its own to a `<form action={serverAction}>` to encode the
server-action reference. Every `nth-child` rule then landed on a
hidden input, the textarea fell through to `:nth-child(8)` and took
`grid-area: status`, and the select, date and button fell off the end
of the rules entirely, keeping their desktop `grid-column: 5 / 6 / 7`
— columns a four-column grid does not have:

```
grid-template-columns: 40px 40px 40px 0px 2px 0px 51px
textarea  w=18  h=565   "What will we do this week?"
select    w=2
```

**How it survived.** Four separate probes reported it clean before it
was reproduced once, and every one of them was measuring something
other than the app:

1. **The probe never reached the page.** It set the scope cookie by
   hand. The cookie is owner-bound (`<user>:<company>`), so a raw
   company id is ignored; the run measured `/admin/companies` and
   reported zero. Nothing asserted where it had landed.
2. **A `next build` run under a live `next dev` clobbered `.next`**,
   so every JS chunk 400'd, React never hydrated, and the probe
   measured a page with no JavaScript.
3. **`reuseExistingServer: true` reused a stale `next-server`** —
   a *production* server left over from an earlier build — while the
   spec believed it was talking to `next dev`.
4. **And then it reproduced on the production build**, so the
   conclusion drawn was "this is a dev-versus-production difference:
   three hidden inputs in dev, seven in the build."

**That conclusion was wrong, and it stood in this document for a
day.** Re-measured on 2026-09-21 while building the production-build
e2e project: the form carries **seven hidden inputs in `next dev`
too**, and the same collapse reproduces there — `w=18, h=461`,
identical to the build. The count was never measured in dev; it was
*inferred* from counting the three written in the JSX, and the three
broken probes above were taken as evidence that dev rendered it
correctly.

So the failure mode is not "dev and production differ". It is
**three harness faults in a row, and a conclusion drawn from their
silence.** Every one of them reported a clean zero, and a zero was
accepted from a probe that had never been shown capable of returning
anything else. The empty-set rule, missed three times.

**The rules.**

- **A probe asserts where it landed before it measures anything.**
  `expect(new URL(page.url()).pathname).toBe(path)`. A redirect
  counted as coverage is how a page goes unchecked while the suite
  looks thorough. Same shape as the `→ landed` line in
  `mobile-sideways-scroll.spec.ts`.
- **A probe fails loudly when the app did not load.** A 4xx on any
  `/_next/` asset means nothing below it is meaningful. Report that,
  never a confident zero.
- **Never run `next build` while a dev server is up.** They share
  `.next` and the build wins, leaving a server whose chunks 404 or
  400. Kill it first.
- **`reuseExistingServer` is only safe if you know what is listening.**
  `lsof -nP -iTCP:3200 -sTCP:LISTEN`, then `ps -o command= -p <pid>`.
- **Layout that depends on a child count is a defect even when it
  renders correctly.** The count is not yours: the framework adds
  children to a form, a conditional adds one more. Place by class.
  Both stylesheets already carried a comment about a *previous*
  instance of this same bug, fixed by counting more carefully rather
  than by not counting.
- **Where a browser gate cannot reach, guard the source.**
  `src/lib/issues/add-line-placement.test.ts` asserts that as long as
  `commitments.module.css` places row cells by `:nth-child`,
  `issues.module.css` releases `.addLine`'s children from it, at the
  same width and with the specificity to win. It runs in CI, which the
  browser check for this could not.

**Built since.** `npm run e2e:prod` runs the phone-width checks
against `next build && next start` in its own dist directory
(`playwright.config.ts`, project `production-build`, opt in with
`@prod` in a test's title). It is worth having — CI builds the app
and then never renders it, and dev and production genuinely can
differ in CSS-module ordering and minification — but it is **not**
what would have caught this bug. This bug was visible in dev all
along. What would have caught it is a probe that had been shown
failing before its zero was believed.

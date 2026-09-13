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

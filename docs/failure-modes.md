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

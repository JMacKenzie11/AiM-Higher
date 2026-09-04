# AiM Higher (AiMS Execution Platform) — Product Build Spec

*Current state of the product: what each surface is and what it does.
Reasoning, history and superseded designs live in commit messages and
pull requests, not here.*

**One-liner:** Multi-tenant SaaS operating system for small-to-mid company leaders who run their business by the AiMS methodology — turns strategic plan → weekly commitments → follow-through data into one operating rhythm, layered with meeting-transcript intelligence, an AI coach, an AI reflection companion, and a shared training library.

**Target customer:** Owner-led companies, $2M–$50M revenue, 10–150 employees. Bought by the CEO/owner or COO. Delivered through the AiMS advisor network.

**Stack signals:** Next.js 15 App Router (server components + server actions), Supabase (Postgres + auth + Storage + RLS), Anthropic Claude for AI (Sonnet 4.6 for reasoning-heavy tasks, Haiku 4.5 for lightweight quality-check passes), Resend for transactional email, Google Drive for transcript ingest. Multi-tenant on shared Postgres with row-level security. SSE streaming for chat + AI briefs.

**This document intentionally excludes the Strengths module and any strengths-related surfaces** — Strengths ships alongside the platform but is scoped separately for research purposes. Where it intersects the coach (as a tool), that intersection is noted so a competitive analysis can factor it in.

---

## 1. Tenancy & Roles

- **Tenant** = Company. Everything below is company-scoped via RLS.
- **Roles:**
  - `system_admin` — vendor staff, cross-tenant scope; only role that can author Classroom content. May *also* hold `guide_assignments` rows as a caseload marker (see Guide HQ); those rows never grant new access (sysadmin scope is already unrestricted) and unassigning never reduces access.
  - `company_admin` — owner/leaders, full write on their company.
  - `aims_guide` — external AiMS coach assigned to one or more companies; admin-like within assigned companies, no cross-tenant privileges beyond assignments. For an aims_guide, a `guide_assignments` row IS their access grant to the company.
  - `team_member` — read + self-write.
- **Scope-in (system_admin + aims_guide):** clicking a company on `/admin/companies` (or navigating to `/admin/companies/[id]`) auto-scopes them into that company via a signed cookie set by middleware on both the incoming request (so the current render sees it) and the response (so subsequent navigations resolve to the right tenant). The Sidebar renders a persistent "SYSTEM ADMIN · COMPANY NAME" (or "AIMS GUIDE · COMPANY NAME") context pill under the logo with an *Exit company* affordance in the user menu at the bottom of the rail.
  - **Prefetch exclusion.** Scope-in fires only on a real navigation. Middleware ignores any request carrying `Next-Router-Prefetch`, `Purpose: prefetch`, or `Sec-Purpose: prefetch`. Decision logic is pure and unit-tested in `src/lib/admin/scope-request.ts`.
  - **Role restriction.** The response cookie persists only for `system_admin` and `aims_guide`. Company users never read it; the resolver returns `profile.company_id` first.
  - **Guide HQ keeps the cookie.** `/hq` hides company-scoped links by pathname in `Sidebar.tsx`, so Week in Review and Functional Org Chart still resolve to the last-scoped company when reached directly.
- **Root URL routing:** middleware sends authenticated `/` to `/hq` for cross-tenant roles (`system_admin` and `aims_guide`), and to `/dashboard` for everyone else. Deliberately ignores the scope cookie so typing the bare domain doesn't strand a sysadmin inside whichever company they last scoped into.
- **Managers:** `profiles.reports_to` establishes a direct manager, unlocking manager-level affordances (e.g., coach *about* a direct report) without granting admin.
- **Invitations:** email invite flow with expiry; role assigned at invite time. Admins can pre-stage the roster (create as pending, send invite later).

---

## 2. Company Feature Flags

Per-tenant entitlements gate module visibility everywhere (nav, dashboards, coach tools, AI passes). Set by system_admin on the company settings page. Canonical list lives in `src/lib/companies/features.ts`; the DB column is open-schema (no CHECK constraint) so new modules can ship without a migration.

| Flag | Turns on |
| --- | --- |
| `execution` | Core: commitments, plan cascade, chart, coaching, dashboard |
| `performance_tracking` (labelled **Success Tracking**) | Requires a target on every KPI (a critical success factor may go without one); turns on the tracking columns (recent pills, this-week input or read-only value, status dot, filter chips) on `/measures`; enables the Board view; enables the AI target-quality check on measure creation, the AI measure-draft critique panel, and the four generative dashboard insight cards. When off, `/measures` collapses to a pure authoring surface |
| `meeting_facilitation_review` | Second LLM pass on every ingested meeting scoring how the meeting was run against the AiMS Weekly Leadership Meeting framework; renders as a coaching-tone panel on the meeting detail page + a signal chip on the Leadership list |
| `automated_commitment_tracking` (default ON at create) | Auto-create commitments extracted from meeting transcripts as rows on `/commitments`. When OFF, the analyzer + facilitation review still run but the team authors commitments manually — extractions surface only in the meeting analysis, not on the Commitments board |
| `classroom` | Adds the shared training library (top-level nav item, consumer surfaces at `/classroom`) + a `search_classroom` tool for the coach + Ask Aimee |
| `role_descriptions` | Adds Decision Rights + Competency Indicators to functions, a per-section *Suggest…* helper, and the assembled Role Description document at `/chart/function/[id]/role-description` with publish + version history + `.docx` export |
| `strengths` | *(out of scope for this spec — noted for completeness only)* |

---

## 3. Foundation Module (One-Page Plan)

The "why we exist, where we're going, who we serve, and how we'll know it's working" layer. Single-tenant per company. Full-width single-column layout: sections stack in AiMS narrative order, and lists inside each section spread horizontally via a shared numbered-card grid so a 5-item list reads as one row of 4 + 1 rather than a 5-tall stack.

**Section order (top to bottom, mirrored by the chip nav):**

1. **Purpose** — statement + short context line.
2. **Vision** — single free-form body (3-year horizon).
3. **Core values** — titled + body, ordered, admin-writable.
4. **Strengths & Differentiators** — titled + body, numbered, admin-writable.
5. **Ideal Customer Profile** — two sub-lists (best-fit clients/projects and psychographics). Each entry is a single line with delete-only management; `AddSnippetForm` per sub-list.
6. **Strategic Focus Areas** — read-only preview here; write side lives on `/plan`. Falls through the same numbered-card grid.
7. **Key Success Metrics** — titled + body, admin-writable.

**Visual system:**

- Every section wrapper is a white `cardAccent` (soft sky-tint corner accent shape).
- Every list item inside a section renders as a **numbered card** (`.numberedCard`) — cobalt "01/02/03" number on a grey/bordered tile with a title, optional body, and Edit/Delete actions in a footer row. ICP snippets render the same shell but the content sits as body-weight text (no title) since snippets are single statements.
- Singleton statement sections (Purpose, Vision) wrap their content in the same grey `.sectionBody` tile so the whole page reads as one "grey content tile inside white section card" pattern.
- **Sticky chip nav** at the top of `.content`, `position: sticky; top: 0; z-index: 15`, styled as a card (cobalt-text-on-bordered-pill chips matching the app's ghost/edit button vocabulary). Overlaps the bottom of the hero band via `-32px` margin on `.content`. Anchors on section h2 IDs with `scroll-margin-top: 96px` so jumps clear the sticky bar. Global `scroll-behavior: smooth` on `html` (respects `prefers-reduced-motion`) makes chip clicks glide.
- `.grid2` uses `repeat(auto-fill, minmax(320px, 1fr))` — `auto-fill` keeps ghost tracks so a lone card stays 320-420px wide.

All items admin-writable. Consumed by the AI coach, meeting analyzer, and marketing surfaces. Every card has a first-run empty state that teaches ("Add the purpose statement to give the whole company a shared north star.").

---

## 4. Planning Cascade

Three-level strategic plan tied to quarters. Progressive add reveal — each level's "+ Add" only appears once the parent level exists, so a first-run admin can't build orphans by accident.

- **Strategic Focus Areas (SFAs)** — long-lived themes (often multi-year), sponsor assigned, sortable, archivable, future-perfect narrative body. Detail page hero: status + progress on their own row underneath identity metadata.
- **Annual Goals** — belong to an SFA (or orphan), owner assigned, per-year. Independent archive / *Mark complete* — an admin can close a Goal while its parent SFA stays open (common because SFAs span multiple years).
- **Quarterly Priorities** — belong to an Annual Goal (or orphan), owner assigned, per-quarter, status: `not_started` / `on_track` / `behind` / `complete` / `ongoing`.
- **Quarters** — start/end dates, status: `open` / `closed`, one open per company. `/quarters` admin page lets an admin roll a new quarter, adjust ranges, or close the current one.
- Progress rolls up: priorities → goals → SFAs → company-level **Strategic Progress %**.
- **Start a new planning cycle** — collapsed *danger zone* panel at the bottom of the plan page (admins only). Archives every active SFA / Goal / Priority in the company; nothing is deleted (records remain on file). Open commitments that were linked to now-archived priorities become Operational (their `priority_id` nulls out); resolved commitments keep their historical link so past-quarter priority progress stays intact.

---

## 5. Commitments (Weekly Rhythm)

The heart of the operating rhythm.

- **Resolution model** — every commitment sits in one of four states: `open`, `kept_on_time`, `kept_late`, `missed`. Kept-late is the same "did the work" signal as kept-on-time but distinct in the UI (green check + clock badge, never X, never danger colour) and NOT counted in the Follow-Through numerator.
- **Columns of note**: owner, description, due_date, week_ending (Friday), optional priority link (strategic vs operational), status, missed_reason (verbatim text, optional now), completed_at, resolved_by_role (`owner` / `admin` / `guide`), resolved_by_profile_id, source_meeting_id (nullable), `is_ongoing` (weekly cycle), `parked_at` (parking lot), `deleted_at` (soft delete).
- **Week ends Friday** — hardcoded assumption; commitments always belong to a Fri-ending week.
- **Owner-visibility RLS clause** (migration 0141): a supplementary SELECT policy admits any caller to see rows where `owner_id = auth.uid()`, regardless of company scope. Additive to the existing company / sysadmin / guide policies — lets a guide's own commitments across many tenants surface in one place on `/hq` without special routing. Harmless for team members since their own commitments already live inside their single company.
- **Follow-Through Rate** = `kept_on_time / (kept_on_time + kept_late + missed + open-past-due)`, computed across any window by the single definition in `src/lib/commitments/follow-through.ts` (`summarizeFollowThrough`). Late keeps and misses count in the denominator only — the discipline signal is "on time," not "at all." An open commitment past its due date counts in the denominator. Deleted and parked rows are excluded everywhere. `rate` is `null` when there is nothing to judge, never `0`. Title-cased consistently across the app.
- **Ongoing (weekly) commitments** — `is_ongoing = true` rows always sit at status `open` and always carry a current due date. Each resolution (kept-on-time, kept-late, or missed) writes a row to `commitment_occurrences` for that week and rolls the parent's `due_date` + `week_ending` forward 7 days. One row in `commitments`, many weeks of history. Follow-Through math iterates BOTH tables so per-week resolutions all count individually. *Stop repeating* converts the row to a normal commitment due at its current date.
- **Parking lot** — rows with `parked_at IS NOT NULL` are excluded from every metric, overdue count, and Needs Attention grouping. Rendered in a muted section at the bottom of `/commitments` with a *Bring back* action that clears `parked_at` and sets a fresh due date. No reason required for park or bring-back.
- **Soft delete** — `delete` sets `deleted_at`; the row hides from every UI + metric but is retained internally. INTENTIONALLY REVERSIBLE — no user-facing recovery UI in this build, but the data is there for future coaching-signal work (churn / abandonment patterns).
- **Reason requirements by role** — owners resolving missed or rescheduling must supply a reason; owners marking kept-late get an OPTIONAL reason prompt with a ghost Skip button. System admins, company admins, and AiMS guides on their assigned companies are **exempt from every reason requirement** and may change past-due dates or mark any resolution in one click. `resolved_by_role` records who did the resolving so the coaching context can distinguish "no reason from owner" from "resolved by admin in the meeting."
- **Row layout** — resolve circle | clarity dot | description (+ Ongoing / From-meeting chips) | owner name | priority link | due date | status chip | delete (hover-revealed on the far right).
- **Resolve interaction (safety-hardened)** — 28px resolve circle at the left triggers a menu with the available actions (never resolves directly). "Marked kept · Undo" chip appears for 30 seconds after each resolve so misclicks reverse in one gesture. Delete lives at the far right, hover-revealed, styled as a trash glyph.
- **Owner click → inline reassign dropdown.** Clicking an owner name opens the same inline picker used on `/issues`: choose a new owner, `reassignCommitmentAction` fires, the row rerenders. Read-only rows render the owner name as a plain span.
- **Column headers above every row group** — `Commitment / Assigned to / Priority / Due date / Status` render as a labelled header above each group on `/commitments` (matches `/issues`). Hidden on mobile, where the row grid collapses to a stacked layout.
- **Full-width editor strips** for reschedule / missed-with-reason / late-keep-optional-reason / clarity review / unpark-with-date — direct grid children of the row so they span all columns and drop in as clean sub-rows.
- **AI clarity scoring** — background Anthropic Haiku call (`src/lib/commitments/clarity.ts`, model `ANTHROPIC_CLARITY_MODEL`) scores two boolean criteria (`clarity_timeline`, `clarity_success`) + optional `clarity_note` at creation time. Best-effort. Rendered as a coloured dot beside the resolve circle.
- **Priority linking** — searchable picker; frozen once a commitment resolves.
- **Filter pills** at the top: All / Me / specific person + status (Open / Kept / Kept late / Missed) + strategic vs operational. State lives in URL search params.
- **Groups on the page:** *Needs attention* (past-week still-open items, red group title) pinned above *This week* (which has the always-live inline add row with an *Ongoing (weekly)* toggle). Prior weeks collapse into per-week summary rows that break out kept-on-time / kept-late / missed counts. *Parking lot* renders at the bottom when non-empty.
- **"From meeting" chip** on rows extracted by the transcript analyzer. Admin-clickable → jumps back to the source meeting analysis.
- **Transcript-extraction date floor** — when a transcript doesn't state an explicit deadline, the extracted commitment's due date defaults to `meeting_date + 7 days`. Nearer-than-floor guesses without explicit statements are adjusted up (not dropped). Explicitly stated dates (`clarity_timeline === true`) pass through as-is. Rule enforced in `validateExtracted` so the creator step has a single source of truth.

---

## 6. Company Dashboard

Real-time single-page view for admins + members.

- **Hero band** (--grad-brand navy gradient) — company name, current quarter label, and a row of stat pills. Each pill: big value + label + short caption underneath naming what it measures. On admin: five stats — **Strategic Progress**, **Follow-Through Rate**, **On Track**, **Open This Week**, **Commitment Clarity**. Hover tooltip carries the fuller explanation; caption ensures the meaning is legible under projection without hover.
- **Setup Checklist** lives at the top of AiMS Implementation (Section 7), not on the dashboard.
- **Week in review** (admin-only, streamed) — AI brief summarising what's worth knowing right now. Streams via Suspense + a light typewriter reveal on first view of a fresh brief; instant on revisits (localStorage-tracked, respects `prefers-reduced-motion`). Cached with a prompt-hash so identical inputs don't regenerate. Uses `ANTHROPIC_COACH_MODEL` (Sonnet 4.6 default).
- **Success Tracking generative cards** (Success Tracking on, with data) — four coaching-tone cards, each staggered-animated in:
  - **Gaining ground this quarter** — measures moving in the right direction across 6 weeks. Rows show an SVG sparkline (stroke-drawn on load, chartreuse endpoint dot) + a coloured delta chip.
  - **Streaks in flight** — measures at or above target for 3+ consecutive weeks.
  - **Wins this week** — measures that hit target for the week just ended. Rows show a check-badge that pops in + a target-vs-actual meter that scales from the left with a tick at the target.
  - **Where a conversation could help** — measures that have dipped over 3+ weeks. Amber, coaching-framed — never red.
- **Strategic Focus Areas** — status + progress bar per SFA, links to the SFA detail page.
- **Follow-Through Rate Trend** — 12-week keep-rate bar chart.
- **People table — "Where to lend support"** — sorted by follow-through ascending, per-person open count + rate. Admins + managers can jump to Coach for people they're allowed to coach.
- **Recent wins** (admin-only) — 5 most recent kept commitments this quarter.

---

## 7. AiMS Implementation (discipline maturity)

Company-wide "how are we doing at running the AiMS disciplines?" view at `/scorecard`. Visible to **everyone in the company** (transparency by design — team members see the same view leaders do). Nav label: **AiMS Implementation**; internal scorer/API names retain `scorecard` for stability.

- **Setup Checklist at the top** — a *Set up {company}* card renders above the discipline tiles for anyone with admin authority on this company (system_admin, company_admin scoped here, or an aims_guide assigned to it). It stays visible after every step ticks off. Five ordered steps: **Build the team** (add people + build the chart), **Invite the team** (send invitations to the roster), **Open a quarter** (the wrapper every commitment lives in), **Start the weekly rhythm** (a commitment logged in the last 14 days), **Track Issues / Solutions** (an issue logged in the last 14 days). Each step auto-checks as its condition becomes true. Assembly lives in `src/lib/dashboard/setup-steps.ts`; the component is `src/components/setup/SetupChecklist.tsx`.

- **Eight disciplines, each rated 0–10.** Foundation, Accountability Chart, Strategic Plan, Execution, Success Tracking (feature-gated on `performance_tracking`), Weekly Leadership Meeting, Solution Seeking (aggregate 4Ws closure), and Appreciative Practice (positive-framing signal) — the last three feature-gated on `meeting_facilitation_review`. Feature-gated disciplines whose feature is OFF render as a muted "Not enabled" tile and are dropped from the overall average — the weight redistributes across the ones that scored, so a company without Success Tracking isn't dinged for not having it.
- **Overall score** — weighted average across scored disciplines. Planning and Execution weight 2× (the two the whole system is oriented around); the others weight 1×.
- **State vs behavior disciplines.** Foundation and Accountability Chart are state-based (either filled in or not) and render **without** a trend chip or sparkline — history adds noise where the signal is done-or-not. The other four (Planning, Execution, Success Tracking, Meetings) fluctuate over time, so they carry the trend arrow + 26-week sparkline.
- **Strategic Plan = cascade + closure.** Populated cascade (SFAs + goals + priorities) is a 2-point baseline; annual goal closure by target_date and priority closure by due_date each contribute up to 4 points. Fresh plans with nothing past due yet receive full credit on the closure halves so a new company isn't dragged down.
- **Execution scoring.** Follow-through over rolling 30 days = 7 pts; aging opens (>14 days past due) = 3 pts. Priority linkage is not scored.
- **Rolling by construction.** Behavior-based scorers use recent-window aggregates (Execution = 30 days, Measures = 7 days, Meetings = 8 weeks). If meeting cadence drops off, the Meetings score falls the following week without any manual intervention.
- **Trajectory arrow vs 90 days ago.** Behavior-based cards (and the overall number) show ↑ / ↓ / flat vs the oldest snapshot inside the 90-day window. Absolute score AND trajectory both live on the card so "low but climbing" reads distinctly from "high but sliding."
- **26-week sparkline** under each behavior-based score using hand-rolled SVG — nulls (feature-was-off periods) render as gaps, not fake zeros.
- **Live compute + weekly snapshot.** The current score is computed **live** on every page load (six small reads, no cache) so behavior changes show up immediately. A weekly Sunday cron (`/api/cron/scorecard`) writes one row per (company, snapshot_date, discipline) to `company_discipline_snapshots` for the historical trend line.
- **Score breakdowns** — each card shows evidence lines pulled from the scorer's `breakdown_json` (e.g., "74% follow-through, 3 open more than 14 days past due"). Discipline-specific rendering lives alongside the page. The Accountability Chart card also surfaces a collapsed per-function issue list ("Ops — missing Track, critical success factor") so you can see which functions are dragging the score.
- **Drill-down affordance.** Every card ends with a "Go to X →" link that jumps to the surface where a user would actually work on that discipline (Foundation → `/foundation`, Execution → `/commitments`, etc). Copy lives on the DisciplineConfig alongside the blurb.
- **Solution Seeking tile** aggregates the `fourws_audit[]` rows across every reviewed meeting in the rolling 8-week window; closure rate (Ws closed ÷ Ws surfaced) maps to 0–10. When no issues have come up in the window, the tile isn't scored (avoids reading as a zero for a period of quiet meetings).
- **Appreciative Practice tile** rolls up the facilitation review's new `positive_framing` dimension (v2 prompt) across the rolling 8-week window, plus running counts of `appreciation_moments`, `generative_questions`, and `reframes`. Not scored until the v2 review has run at least once — pre-v2 rows carry no positive_framing dimension.
- **Info tooltip per tile.** Every card has a `?` icon next to the title with a hover/long-press tooltip explaining exactly how that discipline is scored. Rubric copy lives on the DisciplineConfig `scoringNote` field so tuning the wording is a one-line change per discipline.
- **Leader attendance is not scored.** Meeting quality surfaces via the facilitation-review `overall` score.

Scoring code lives in `src/lib/maturity/` (config in `disciplines.ts`, one file per discipline in `scorers/`, orchestrator in `compute.ts`, read helpers in `service.ts`). Adding a new discipline is a three-file change: add the key to `disciplines.ts` + `DISCIPLINES` array, extend the `discipline` CHECK constraint on `company_discipline_snapshots`, add a scorer, wire it into `compute.ts`, and add an evidence case to `evidenceLines` on the page.

---

## 8. People / Person Scorecard

- **Roster** (`/people`) — everyone in the company, with role, status, open count, Follow-Through Rate. Team members read-only; admin actions column hidden.
- **Person scorecard** (`/people/[id]`) — per person: Follow-Through Rate for the open quarter, Kept / Missed counts, 12-week trend chart, open commitments, resolved-commitment history grouped by week (with missed reasons visible verbatim).
- **Person edit** (`/people/[id]/edit`, admin) — role, manager assignment (`reports_to`), status.
- **Privacy note on the scorecard** — self view: "Your numbers are visible to system admins, your company admins, and your direct manager. Admins and your direct manager can each keep private coaching notes about your development; every note is visible only to whoever wrote it, never to you." Other view: "This scorecard is visible to system admins, company admins, and their direct manager. They can see their own scorecard too."
- **Manager access:** direct manager (`profiles.reports_to`) can view and coach about their reports without being an admin.
- **People status toggle** (admin) — active/inactive; branded confirmation.
- **Profile avatar** (`/profile`) — self-serve photo upload with a Facebook-style pan+zoom crop modal (circular mask over the source image, drag to reposition, wheel/slider to zoom). Client-side canvas renders the visible circle to a 512×512 PNG blob before upload so the original photo never leaves the browser. Storage: public `profile-avatars` bucket, layout `profile-avatars/<user_id>/<uuid>.<ext>`; write RLS gates the folder prefix to `auth.uid()` (sysadmin bypass for cleanup). The URL is persisted on `profiles.avatar_url` and rendered wherever the user's name appears — the sidebar user badge falls back to initials if no photo is set.

---

## 9. Functional Org Chart

The functional org chart at `/chart` (nav label: **Functional Org Chart**). Distinct from the reporting hierarchy in `profiles.reports_to`.

- **Function nodes** — hierarchical (parent → child), each with title, description, and one seat holder (`lead_id`). Rendered on a pan-and-zoom canvas (react-zoom-pan-pinch): auto-fits the full tree to the viewport on load and on container resize, scroll-wheel or ±/fit-to-view buttons to zoom, drag on empty canvas to pan. Cards keep a fixed 220px minimum width so the tree stays legible at every zoom level.
- **LTD model** — Lead / Track / Decide are three responsibilities of the *one* seat holder, not three assignees.
- **Function roles** — beyond LTD, function nodes carry named leadership archetypes (Visionary, Integrator, etc.) via `function_roles` for the strategic top of the chart.
- **Critical Success Factors** — the results each function is accountable for. Lagging measures. A `success_measures` row with `kind = 'csf'`, carrying a target, `value_type`, `target_direction` and weekly entries. Reaches its company through `function_id` (NOT NULL; every RLS policy on the table is keyed on it). TypeScript type `SuccessMeasure`. The chart renders it through the `FunctionOutcome` shape via `src/lib/measures/csf-as-outcome.ts`.
- **Key Performance Indicators** — leading measures that drive a CSF. Same row type, `kind = 'kpi'`. Fields: description, target, `value_type` (`number` / `percent` / `text`), `target_direction` (`higher_is_better` / `lower_is_better`), `update_frequency` (`weekly` / `biweekly` / `monthly`), `auto_track` (labelled *Remind the owner when this is due*).
- **Targets** — required on a KPI whenever Success Tracking is on; optional on a CSF. A CSF without one still collects values and reads *no target set* rather than on or off.
- **CSF ↔ KPI link** — `csf_kpi_links`, many-to-many in the data model. The UI attaches one CSF per KPI.
- **KPI count** — the manager shows an advisory note past three KPIs on one CSF. Not enforced.
- **Archiving** — archiving a CSF archives its KPIs (`cascadeArchiveKpis`). Restoring a CSF does not restore them. Nothing hard-deletes; weekly entries are retained.
- **Authoring lives on `/measures`**, not the function page. The function page shows a read-only summary and a link to `/measures#fn-<id>`. Server actions revalidate both routes.
- **AI measure-draft critique** (Success Tracking on) — background Anthropic Haiku call (`src/lib/measures/critique.ts`, model `ANTHROPIC_CLARITY_MODEL`) scoring description clarity, target quality, and fit to the parent CSF. Renders as an amber panel beside the form. Best-effort; the measure saves regardless.
- **Weekly value entries** — `success_measure_entries` keyed on measure + week_ending Friday.
- Drag-to-reorder functions within a parent (admin-only) via `@dnd-kit/sortable`; drag handle on hover, opts out of pan via a `chart-no-pan` class so dnd-kit gets clean pointer events.
- **Delete function** — hard delete with a branded confirmation that spells out the cascade (sub-functions, critical success factors, KPIs, and recorded values go with it).

*(The `/scorecard` route on this module redirects to `/chart`.)*

---

## 10. Critical Success Factors (`/measures`)

Two levels on one page. A **critical success factor** is a result a function is accountable for (lagging). A **key performance indicator** is a leading measure that drives it. Data model in Section 9.

Nav label: **Critical Success Factors**, under *Workspace*. The tracking columns are gated by `performance_tracking`; the authoring surface is always on.

**Access**

- Everyone in the company reads every function.
- Writing is per function. `getMeasuresTree` returns `canLog` on each one: `isAdmin || lead_id === me || track_id === me`, matching what `upsertMeasureEntryAction` enforces.
- Read-only cells render the value, not a disabled input. The save button and the outstanding line follow `canLog`.
- Authoring controls (add, edit, archive) render for admins, company admins scoped here, and guides assigned to the company.

**Layout**

- One card per function. Function order is depth-first pre-order over the parent tree, Visionary first and Integrator second at root level; a non-admin gets the same order with their own seats hoisted to the front. Anchors are `#fn-<id>`.
- Inside a card: the CSF is the first row of the table, its KPIs follow. Both render through `ManagedMeasureRow` (`kind="csf"` / `"kpi"`). The CSF row carries an eyebrow and the card's tint separates it from the KPIs.
- Columns: name (unlabelled) | Target | Recent | This week | status dot | actions. Rows are `display: contents`, so every row must emit a cell per track; the trailing actions cell is rendered unconditionally and is empty when not authoring. `grid-alignment.test.ts` guards this.
- `.measureGridAuthor` drops the grid to two tracks when tracking is off.
- Editing a CSF renames it: a CSF's name is its `description` column.

**Saving**

- One save button per function card, shown only on functions the caller can write to. `MeasuresManager` tracks which function is saving so only that card shows a spinner.
- **Outstanding line** — "2 of 6 still to log for the week ending 4 Sep." Counts both kinds across functions the caller can log, read from the live inputs. Silent when there is nothing to log. Adds "on your functions" when the page shows functions the caller cannot log.

**Board** (`BoardView`, top of the page)

- 13 weeks across every function. Hidden when Success Tracking is off.
- Collapsed by default behind a summary line ("3 functions off target this week"). The open/closed choice persists per person in `localStorage` (`measures-board-open`).
- Opens on **Timeline**; **Grid** is the second view.
- Plots both kinds. A CSF is a row grouped under itself, ordered ahead of its KPIs, so the Timeline's per-function rollup includes it. Rows carry `kind`; the Grid marks CSF rows.

**Filter chips** — *On target / Off / Not yet logged*, multi-select, in the function list's header. Rendered when Success Tracking is on and at least one measure has a target. They count and filter both kinds. `counts-agree.test.ts` pins the chips and the outstanding line to one population.

**Saturday cron** (`src/app/api/cron/performance/route.ts`, 15:00 UTC, `{ "path": "/api/cron/performance", "schedule": "0 15 * * 6" }`)

- Sweeps both kinds where `auto_track = true`, respecting `update_frequency` via `isDueForWeek`. The cycle is anchored to the measure's creation date, not the calendar.
- **Missing value → a commitment**: *"Log this week's value for '{measure}'"*, due the just-closed Friday.
- **Off target → an issue**: *"Off target: '{measure}'"*. The rule lives in `src/lib/measures/off-target.ts`, outside the cron handler, so integrations raise the same issue.
- UTC-fixed so one run covers every tenant.

**AI target-quality check** — on measure creation, a background Haiku call (`src/lib/measures/target-check.ts`, model `ANTHROPIC_CLARITY_MODEL`) validates the target against `value_type` + `target_direction`. Advisory; never blocks the save.

**`/measures` is the only place values are entered.** There is no dashboard card and no single-measure page.

**Permissions.** Authoring actions in `src/lib/chart/actions.ts` admit `system_admin`, `company_admin`, and `aims_guide`. Weekly value writes (`upsertMeasureEntryAction`, `logMeasureEntriesAction`) admit those three or the function's Lead / Track holder. App-layer checks go through `isAdminForCompany`. RLS on `success_measures` and `success_measure_entries` is keyed on `function_id`, with `_guide` mirrors.

---

## 11. Meeting Analysis Pipeline

Ingest → analyse → extract commitments → optionally review facilitation → email participants — all from meeting transcripts dropped in a Google Drive folder.

- **Google Drive per company** (`transcript_sources`) — each company connects its own Google account via OAuth (`0110_oauth_per_company`), so folders can live under different Workspaces. Multiple folders per company. Statuses: `active` / `paused` / `revoked`.
- **Transcript aliases** (`transcript_aliases`) — case-insensitive substring on the filename that routes a meeting to a specific company when a shared folder serves multiple clients.
- **Unrouted queue** — meetings whose filename doesn't match any alias sit in an admin queue (`/admin/transcripts`, detail at `/admin/transcripts/meetings/[id]`) for manual routing (Assign, Route + analyze, Dismiss).
- **Ingest cron** (`/api/cron/transcripts`, Vercel every 15 min) — polls each active source's folder, hashes file contents, avoids re-ingesting duplicates.
- **Two-call analysis pipeline** (`src/lib/transcripts/analyze.ts`) using Anthropic Claude:
  - **Call 1 — Analysis:** feeds the transcript + a `<company_context>` block (foundation, roster + AiMS coaches, open-quarter priorities) into the AiMS meeting-analyzer prompt (`prompts/meeting-analyzer.md`). Uses `ANTHROPIC_SUMMARY_MODEL` (Sonnet 4.6 default). Output is a structured markdown write-up stored in `meeting_analyses.analysis_markdown`.
  - **Call 2 — Extraction:** JSON-strict extraction of commitments, validated against the roster + priority whitelist. Each extracted commitment includes clarity scoring (timeline + success criteria) + a refinement note when unclear. Due-date resolution rules: prefer stated over fallback ("ideally by X, worst case by Y" → X); handle day-of-week vs numerical date mismatch by preferring the number and flagging in clarity_note.
- **Commitments creation** — gated on the `automated_commitment_tracking` feature (default ON). When enabled, validated extractions become real `commitments` rows carrying `source_meeting_id` (renders as the *From meeting* chip on `/commitments`). When disabled, the extractions still surface in the meeting analysis so the team can author commitments manually — the summary + facilitation review run either way.
- **Post-analysis email** — after commitments are extracted, a branded transactional email (Resend, via `src/lib/email.ts`) is sent to meeting participants listing each commitment by owner with a CTA back to `/commitments`. Best-effort — skipped silently if `RESEND_API_KEY` is not configured.
- **Leadership surface** (`/leadership`) — table of every ingested meeting for the scoped company (title, received date, status, Facilitation chip if the feature is on, View link). Rows show `pending` / `analyzing` / `complete` / `failed` — failed rows surface the error verbatim.
- **Meeting detail** (`/leadership/meetings/[id]`) — analysis markdown, list of commitments the meeting created, facilitation review (when feature on). PrivacyNote at the top: "Meeting analyses and facilitation reviews are visible to system admins, company admins, and AiMS Guides for this company only. Meeting participants don't see this page."
- **Issues identified — dual promotion path** — every extracted issue on the meeting summary has two admin/guide-only shortcuts:
  - *Add to open issues* → creates an `issues` row with `status='open'`, ranked at the tail of the open list. Standard backlog flow — desired outcome, commitment, and owner are added later on `/issues`. Post-action chip: *Added as issue*.
  - *Resolved in meeting* → creates an `issues` row with `status='resolved'`, `resolved_at=now()`, no desired outcome / commitment / owner. For questions the team already talked through in the meeting; lands in the resolved list immediately. Post-action chip: *Resolved in meeting*.
  Both paths idempotency-check on `(source_meeting_id, title)` so double-clicks and reanalyses don't spawn twins. First click wins between the two paths (the second becomes a no-op). The chip label survives a page refresh — the extracted-issue row seeds its post-action state from the persisted `issues.status`, not just an in-memory flag, so a reader coming back to the meeting summary later sees WHICH path was taken.
  - **Read-side consequence** on `/issues`: a *Resolved in meeting* row has no commitment by design, so two columns fill in for one:
    - *Due date* falls back to `issues.resolved_at` instead of an em-dash. The button does not create a commitment, so it never writes `commitments.due_date`.
    - *Commitment* reads **"Resolved in meeting"**, driven by `issues.resolved_in_meeting` (migration 0162), a boolean stamped at insert by the shortcut and never toggled afterwards. Before that column existed the cell was a bare em-dash, indistinguishable from an issue resolved by any other route with nothing attached.
    Provenance is recorded at write time rather than inferred at read time. The tempting display-time heuristic — *resolved + came from a meeting + no commitment* — is wrong for a real case: an issue added **open** from a meeting and later resolved without a commitment would claim the button was used when it wasn't. Migration 0162 backfills history on timestamp proximity (the shortcut stamps `resolved_at` in the same insert as `created_at`, so they land milliseconds apart; a later resolution leaves a real gap), scoped to meeting-sourced resolved rows so hand-entered issues are untouched. The rule itself lives in `src/lib/issues/resolved-row.ts` as a pure function so it carries test cover.

---

## 12. Meeting Facilitation Review

Feature-gated (`meeting_facilitation_review`) opt-in second LLM pass on every ingested meeting. Scores how the meeting was run against the AiMS Weekly Leadership Meeting framework + the 4Ws Solution Framework.

- **Prompt** — versioned on disk (current: `src/lib/leadership/facilitation/prompt.v2.md`). Includes explicit generative-tone guardrails: lead with what's working, depersonalize gaps, forward-looking recommendations, growth-edges not weaknesses. v2 adds a fourth dimension (`positive_framing`) plus three moment arrays (`appreciation_moments`, `generative_questions`, `reframes`) so appreciative-inquiry practice is measured, not just rhythm/accountability/alignment. v2 also tightens the scoring contract: `overall` is REQUIRED whenever `insufficient_transcript` is false.
- **Structured output** via Anthropic tool-use — `record_facilitation_review` tool with typed JSON schema, forced via `tool_choice`; normalized against `FacilitationReview` type (`src/lib/leadership/facilitation/types.ts`) before persisting. Uses `ANTHROPIC_FACILITATION_MODEL` (Sonnet 4.6 default). Normalizer falls back to the mean of scored dimensions when `overall` comes back null and `insufficient_transcript` is false, so a dimension-scored meeting never silently displays as ungraded.
- **Storage** — JSONB column `meeting_analyses.facilitation_review_json` (migration 0119). Version-tagged so future breaking shape changes can be handled per-row.
- **Best-effort pipeline hook** — runs after the primary summary + extraction; failures never block the primary write.
- **UI panel** (`components/leadership/FacilitationReview.tsx`) on the meeting detail page:
  - Overall "Facilitation signal" (0–10) on a warm cobalt→chartreuse scale — never red.
  - Dimension chips: Agenda sections (X/5), Rhythm, Accountability, Alignment. (Positive Framing renders inside the Growth edges grouping when scored.)
  - **What worked** first (green, prominent).
  - **Growth edges** grouped by dimension (amber, coaching-framed) — includes the new *Appreciative practice* column when v2 surfaces one.
  - **What to try next week** — 3–5 forward-looking experiments.
  - **4Ws audit** — filled check for "landed", hollow circle for "worth a beat next time" (never ✗).
  - Handles `insufficient_transcript` gracefully.
- **Re-run affordance** — a *Re-run facilitation review* button appears on the meeting detail page ONLY when the feature is on AND the facilitation didn't land (no review, or review present with `overall == null` AND not flagged insufficient). Once a real score is present, or the transcript was honestly marked insufficient, the button is hidden — a truly-insufficient transcript won't score any better on re-run.
- **List chip** on `/leadership` — compact Facilitation N/10 pill on complete rows, warm-scale coloured. Distinguishes three states: coloured chip with a number (real score), muted *Insufficient* chip (review ran, transcript wasn't scoreable), nothing rendered (no review yet).

---

## 13. Coaching Module (AI)

Streaming AI coach modeled on the AiMS methodology. Same backend powers both directed coaching (`about` mode) and personal reflection (`general` mode, aka Ask Aimee).

- **Modes:**
  - `about` — leader/manager thinks through someone specific. Access: system_admin anywhere, company_admin within the subject's company, or the subject's direct manager. Self-coaching via `/coach/{me}` is redirected to Ask Aimee (self-mode is retired at the entry-point level).
  - `general` — Ask Aimee (see Section 14). Same request path (`/api/coach`), same backend, same tool loop; distinguished by absent `subjectProfileId` and a `GENERAL_MODE_PREAMBLE` prepended to the system prompt.
- **Context kinds:** `execution` (default — commitments, keep rates, priorities, missed reasons). Other kinds gate on the corresponding company features.
- **Prompt selection** — single system prompt in `prompts/leadership-coach.md` reused for both modes.
- **Injected context per turn:** company block (purpose, values, differentiators), person block (role, keep rates across quarters, kept/missed counts, missed reasons *verbatim*, open + chronic commitments, plan items owned), coaching mode metadata.
- **Prompt caching:** static system prompt gets an `ephemeral` cache breakpoint; dynamic per-turn context rides on the latest user message so it never displaces the cached prefix. Coach chat is the only surface using prompt caching in v1.
- **Model:** `ANTHROPIC_COACH_MODEL` (Sonnet 4.6 default).
- **Tool use (max 4 tool loops per turn):**
  - `get_strengths_profile` — *(strengths module, excluded from this spec; gated on `strengths` feature, `about` mode only)*
  - `search_classroom` (Classroom on) — queries lessons + trainings by keyword so the coach can recommend a training in conversation. Returns matches with title, description, category, and a stable URL. Available in both `about` and `general` modes.
- **Streaming:** SSE to the client, error-tolerant (user message persists on API failure — retry path reuses it).
- **Auto-title:** after the first exchange, the model generates a short conversation label.
- **Message cap:** thread history capped at last 200 messages (no cross-conversation compression in v1).
- **Privacy** (verified against migrations 0021_coaching_platform.sql and 0150_coaching_conversation_shares.sql) — `coaching_conversations` SELECT is `created_by = auth.uid() OR EXISTS (share row)`; `coaching_messages` SELECT follows the same visibility, and INSERT requires either ownership OR a `write` share row. **Every thread is private to its creator by default.** Another admin or the person's direct manager can create their own separate threads about the same person; each thread stays private to its author unless they explicitly share it. The subject cannot see a thread written about them unless the owner shares it with the subject — there is no auto-share. See Section 13a below for the sharing model.

### 13a. Conversation Sharing

Sharing is an overlay on ownership, added in migration 0150. It lets the owner of any coaching thread (about or general/Ask Aimee/practice) invite specific people from the same company to read the transcript or reply in it, without giving up ownership rights.

- **Data model** — `coaching_conversation_shares` `(conversation_id, profile_id, access, created_by, created_at)` with composite PK; both FKs `ON DELETE CASCADE` (unshare on profile removal or conversation deletion). `access` is `'read' | 'write'`.
- **Cross-tenant safety, three layers:**
  1. `shareConversationAction` in `src/lib/coach/actions.ts` checks `sharee.company_id === conversation.company_id` and returns a friendly denial ("You can only share with people in the same company").
  2. The RLS INSERT policy re-checks the same join so a hand-crafted request fails with a policy denial.
  3. A `BEFORE INSERT OR UPDATE` trigger (`assert_coaching_share_same_company`, SECURITY DEFINER) raises `coaching_share_cross_tenant` if the two company_ids ever diverge — the last-mile guarantee.
- **Extended RLS on conversations + messages** — `coaching_conversations` SELECT admits owner OR any share row for the caller; UPDATE stays owner-only (rename, archive). `coaching_messages` SELECT follows conversation visibility; INSERT requires `created_by = auth.uid()` AND (owner OR `access = 'write'` share row).
- **Server actions** — `shareConversationAction`, `updateShareAccessAction`, `unshareConversationAction` (owner-only), `leaveSharedConversationAction` (self-remove for sharees), `listShareCandidatesAction` (owner-only; returns active same-company profiles minus already-shared and the owner). All go through `getAccessForConversation` for the auth check where relevant.
- **API route** — `/api/coach/route.ts` swaps the old `created_by === session.profile.id` gate for `getAccessForConversation` and rejects unless the caller is `owner` or `write`; read-share callers get 403.
- **Auto-title** — remains owner-only. `generateConversationTitleAction` refuses non-owners; the client skips the call when `access !== 'owner'` so a sharee's fourth message doesn't trigger a wasted round trip.
- **Practice launcher gate is unchanged** — `allowedRoles` still gates *who can create* a practice thread (e.g. Functional Chart Builder = admin-only). Once a thread exists, a company_admin can share it with a team_member as `write`; the sharee can chat inside the thread.
- **Practice side-effect gates are unchanged** — `applyChartProposalAction` still enforces `isAdminForCompany`, so a non-admin write-sharee in a chart-builder thread can converse but cannot push proposals into the Functional Chart.
- **UI surface** — chat header carries a **Share** button (owner) or a muted **Shared with N** badge (sharee); both open the same modal. Modal search is scoped to same-company active profiles; per-row access dropdown + remove for the owner; a **Leave this chat** button for sharees. Read-access callers see the composer replaced by a "Read-only. Ask the owner for write access to reply." helper line.
- **Attribution** — when a thread has any sharees, user bubbles render a small (avatar + name) row above the bubble for messages authored by someone other than the current viewer. Own bubbles stay unlabeled — the right-aligned position already reads as "you". Assistant bubbles are uniformly labeled Aimee/Coach; the caller's session id is stamped on `coaching_messages.created_by` on every send so attribution is durable across sessions.
- **Landing surface** — `/ask-aimee` renders a second card, **Shared with you**, below the primary Recent conversations list when the caller has any share rows in their current company scope. Rows show the owner's name and the sharee's access level (Read/Write) in the meta line.
- **Notification on share** — `shareConversationAction` fires an event-based notification (`kind: 'chat_shared'`) into the sharee's notification bell (see Section 16a). One-shot: the row is persisted in `public.notifications` and dismissed when the sharee clicks it or clears the tray. Best-effort — a notification write failure never rolls back the share.
- **No auto-share, ever** — about-mode threads about a specific subject and practices with a partner_profile_id do NOT auto-share with those people. Every share is an explicit act by the owner.
- **RLS recursion fix (migration 0151)** — 0150 introduced cross-referencing SELECT policies (`coaching_conversations` calls `EXISTS(shares)` and vice versa). Semantically each pair terminates, but Postgres refuses to plan `.insert(...).select("*")` under that shape and the practice launcher's read-back tripped RLS with a generic "Couldn't start that practice." Fix: three `SECURITY DEFINER` helpers (`is_coaching_conversation_owner`, `has_coaching_share`, `has_coaching_write_share`) do the row lookup with RLS bypassed; policies call the helpers instead of nesting subqueries into the other table, so no cross-policy reference remains. Access rules unchanged.

---

## 14. Ask Aimee (Personal Reflection AI)

Top-level nav item, always visible to any active member.

- Same coaching backend as coach threads; runs in `general` mode with no subject on file.
- **Unified single-surface layout.** `/ask-aimee` renders the Recent conversations card + (when non-empty) a Shared with you card. The former "Practice Coaches" tab is retired — agents attach to a chat via the composer's Agent picker rather than a separate entry surface. `AskAimeeTabs` and `PracticeCards` were deleted as part of this change; the picker modal lives in `src/components/practices/AgentPicker.tsx`.
- **Privacy** — same RLS spine as `about` threads (Section 13a): the creator is the only viewer by default, and access can be extended per-thread via same-company `read` or `write` shares. No admin, manager, or guide sees an Ask Aimee thread unless the owner explicitly invites them. The subtitle on `/ask-aimee` describes both halves plainly ("Conversations are private to you by default; you can invite specific people from your company as collaborators, and pick a guided agent from inside any chat.").
- **Classroom recommendations** — when Classroom is on for the company, Aimee has the `search_classroom` tool and will link a stable training URL when a user's question aligns with library content.
- **Company context is still injected** (purpose, values, focus areas) — Aimee is grounded in the company Q&A even in general mode. She's explicitly told not to invent per-person data in general mode.

### 14a. Guided Agents (Practices)

Agents are prompt-narrowed variants of the Ask Aimee coach. Every general conversation has a single `coaching_conversations.practice_id` slot; `null` runs plain Aimee, any registered id runs that agent's prompt + output-card wiring for the life of the thread.

- **Registry** — `src/lib/practices/registry.ts`. Adding an agent is a registry entry plus a prompt file at `prompts/practices/<id>.md`; no other code change unless the agent needs a new output card component. Each entry declares:
  - `basePromptMode` (`full_coach` or `voice_only`). `full_coach` splices `prompts/aims-voice.md` into `prompts/leadership-coach.md` (the current three communication + facilitation agents); `voice_only` loads `aims-voice.md` alone as the base — no coaching spine, no diagnostic modes, no patterns-to-watch-for. Used by structural agents (Functional Chart Builder) where the agent prompt IS the flow.
  - `chips` — starter phrases rendered as clickable pills on the empty-state card. Every agent uses this pattern: click a chip → it becomes the first user turn → the agent responds. Single source of first-turn text for the whole product.
  - `skipSetup` — when true, the partner picker step is bypassed; the conversation opens directly on the empty state. All shipping agents use `false` today.
  - `scriptedOpener` / `firstTurn` — optional plumbing for agents that want to auto-insert or auto-stream an opening assistant turn instead of waiting for the leader to click a chip. `firstTurn: "scripted"` persists `scriptedOpener` as the first assistant message with zero API calls; `firstTurn: "generate"` fires `/api/coach` with `generateOpener: true` right after attach and streams a dynamic opener into a fresh bubble. **No live agent uses either today** — the chip pattern turned out to be simpler and more predictable. Both fields are preserved so a future agent that needs an opening turn (e.g., one that must front-load a legal disclaimer or a personalized greeting) can opt in without client changes.
  - `allowedRoles` — optional role list; the agent is hidden from the picker and the launch URL rejects anyone outside the list. For aims_guide the launcher additionally requires an assignment to the scoped company (`isAdminForCompany`). Absent means all members.
  - `outputCard` — optional `{ fenced-tag → card-name }` mapping. `ChatView`'s markdown renderer intercepts matching fenced blocks and dispatches to the named card component (JSON-friendly string identifiers, resolved to React components via a local lookup so registry entries stay serializable).
- **Voice split** — `prompts/leadership-coach.md` carries a `{{AIMS_VOICE}}` sentinel; the full-coach base recomposes byte-equivalent to the pre-split file. `src/lib/coach/leadership-coach-compose.test.ts` locks the SHA-256 so voice or coach-spine edits stay deliberate acts.
- **Two paths to attach an agent:**
  1. **In-thread AgentPicker** — the chat header's Agent pill on any owner-general chat opens `AgentPicker` (branded gradient header, chartreuse-accented category groups, row-per-agent list). Selecting an agent fires `setConversationAgentAction`, which validates ownership, refuses if any user-role message exists (lock), wipes any prior assistant opener, and sets `practice_id`. The action returns `{ openerContent, practiceId, runGenerateOpener }`; the picker hands that to `ChatView` via an `onAgentAttached` callback so the client-side message state updates directly. (A prior implementation relied on `router.refresh()` alone but useState only reads its initial value once, so a scripted opener persisted server-side wouldn't appear in the client until a full page reload.)
  2. **Deep-link URL** — `/ask-aimee/new?agent={id}` (alias: `?practice={id}` for Classroom back-compat) creates the conversation server-side, honors `firstTurn` via `createPracticeConversation`, and redirects to `/ask-aimee/{conversationId}`. Denials render a friendly page (never an error boundary) so a shared link that lands on an ineligible caller degrades gracefully.
- **Lock semantic.** The agent slot is freely settable up until the leader sends their first user-role message. After that, `setConversationAgentAction` refuses with "This conversation is already underway — the agent is locked." This preserves the guarantee downstream code relies on: `practice_id` is stable from turn one forward, so prompt selection, output-card rendering, and cached responses don't need to handle mid-thread agent changes. The `AgentPicker` trigger renders as a static "You're chatting with X" label after the lock so the leader still knows what they're talking to.
- **Existing agents** (all `full_coach`, chip pattern, no role gate): *Prepare a hard conversation* (LEAD-adjacent, emits a `script` block → ScriptCard); *Navigate an emotionally charged conversation* (LEAD, emits a `script` block → ScriptCard); *Ask great questions* (facilitation, no structured output).
- **Functional Chart Builder** — `voice_only` base, chip pattern (`chips: ["I need to create my functional chart"]`), role-gated to `company_admin`/`system_admin`/`aims_guide`. Emits a `chart_proposal` fenced block → **ChartProposalCard**: previews top seats + functions + sub-functions (LMA visually emphasized as the first responsibility on every function), Apply + Copy actions. Malformed JSON falls back with a "Fix the proposal" nudge that seeds a canned regeneration request into the composer. Regenerating from a coach revision produces a fresh card; the disabled done-state is scoped to that card's Apply, never global.
- **Apply-to-Chart** (`src/lib/chart/apply-proposal-action.ts`) — additive-only writes into the existing chart tables (`functions` + `function_roles`) via the admin Supabase client (guides don't hold RLS insert rights on `function_roles`, so the app-layer `isAdminForCompany` check is the security boundary). Semantics:
  - Top-level functions matched by case-insensitive title → **skip** (never modify).
  - Missing responsibilities on an existing function → **merge in** (add-only, case-insensitive on title). Never deletes or modifies existing responsibilities.
  - Sub-functions same skip/merge; parent resolved to whichever function (existing or just-created) has the matching name.
  - Top seats are **skipped entirely** when the chart already has ≥ 2 top-level functions (universal case since migration 0112 seeds Visionary + Integrator on every company). Kept-vs-proposed names surface in the summary line so the leader knows the coached names weren't lost silently.
  - Idempotent by name-collision skip — pressing Apply twice on the same JSON creates nothing the second time.

---

## 15. Classroom (Shared Training Library)

Feature-gated (`classroom`). Content is authored centrally by system admins and shared across every enabled company — one library, many audiences.

- **Consumer surface** — `/classroom` landing (categories on top, lesson cards per category with a cobalt accent stripe + hover chevron), `/classroom/lessons/[slug]` (lesson detail, lands on the first section), `/classroom/lessons/[slug]/[sectionSlug]` (deep-linkable per-section URL). Slugs are stable — coaching references and shared links survive lesson re-orgs. The old `/classroom/trainings/[slug]` route remains as a permanent redirect to the new lesson/section scheme.
- **Section rail** — every lesson page renders a sticky left rail listing all sibling sections; clicking a rail item updates the URL and swaps the section body without a full navigation. Same shape appears on the admin edit surface so a sysadmin can walk between sibling sections while authoring.
- **Rich text body** — TipTap v3 editor (StarterKit + custom nodes). Editor runs client-side only on admin pages; consumer pages render server-side via an **in-repo JSON walker** (`src/components/tiptap/Renderer.tsx`) so the editor bundle never ships to learners and custom nodes render as real React components without a hydration hop.
- **Inline video embeds** — custom `videoEmbed` Tiptap node stores `{ provider, videoId, caption }` in the body JSON. YouTube and Vimeo. Two authoring entry points: toolbar ▶ button (prompts for a share URL) or paste-a-URL-on-a-blank-line auto-detect. Editor never loads the player — thumbnail-only, so a section with 10 videos stays cheap. Reader path renders a `VideoEmbedPlayer` (thumbnail with click-to-play iframe overlay). No dedicated video field on the section row; migration 0145 dropped the legacy `video_provider` / `video_id` / `video_url` / `thumbnail_url` columns from `classroom_trainings`.
- **Inline images** — custom `image` Tiptap node with attrs `{ src, alt, width, align }`. Toolbar 🖼 button opens a file picker; clipboard-paste of an image and drag-and-drop onto the editor also work. Images upload to the public `classroom-images` bucket via `uploadClassroomImageAction`; the returned public URL is written into the node so the reader's `<img src="...">` is durable (signed URLs would expire mid-session). In-editor NodeView renders the actual image + a bottom-right resize handle (drag preserves aspect ratio) plus S/M/L presets (33 / 66 / 100 % of container). Width persists as a percentage attr; reader matches by emitting inline `width: X%; height: auto;`.
- **Text and image alignment** — in-repo `TextAlign` extension adds a `textAlign` attribute to paragraph and heading nodes; the `image` node has a parallel `align` attr. Toolbar `⇤ ⇔ ⇥` buttons route based on selection (text caret → text-align; image selected → image align). Kept as an in-repo extension rather than pulling `@tiptap/extension-text-align` to keep the Vercel build memory-tight.
- **Attachments** — Supabase Storage private bucket `classroom-attachments`, 25 MB per file cap. Downloads via server-generated signed URLs (1-hour TTL) so the same publication + feature-flag gate applies.
- **Admin surface** — `/admin/classroom` (categories + lessons list, drag-free up/down move; click-to-edit category name preserving slug stability), `/admin/classroom/lessons/[id]/edit` (metadata + ordered sections), `/admin/classroom/trainings/[id]/edit` (title, publish flag, TipTap body with inline media + alignment, attachments, sibling-section rail).
- **Draft / Published** — every lesson and section carries a `published` flag. Drafts are sysadmin-only; publishing pushes it live to every flag-enabled company.
- **Data model** — `classroom_categories`, `classroom_tags` (many-to-many on lessons), `classroom_lessons`, `classroom_trainings` (UI vocabulary: "Sections"; DB table name preserved for URL/data stability), `classroom_attachments`. RLS: sysadmin full write; every other authenticated user gets read on `published = true` rows only if their company has the flag.
- **v1 gaps** — no completion tracking, no curriculum paths, no drag-and-drop reorder (up/down buttons only).

---

## 16. Admin & Ops

- **Companies list** (`/admin/companies`, cross-tenant) — table of every company for system admins, filtered to assignments for guides. Create company + timezone + industry + initial features; archive / reactivate; AiMS Guides admin panel (invite, assign, unassign, delete).
- **Company soft-delete** (sysadmin only, migration 0148). Every company row has a `deleted_at` column and a RESTRICTIVE RLS policy `companies_hide_deleted` that filters non-null rows out of every authenticated SELECT — so once a company is deleted it disappears from admin lists, guide caseloads, the company picker, and every scoped surface without any query-site changes. The row and all child data (people, functions, commitments, meetings, transcripts, coaching conversations, snapshots) stay in the database; recovery is a SQL-only path (clear `deleted_at`). Two-step safety: `deleteCompanyAction` in `src/lib/companies/actions.ts` refuses unless the company is already `archived`, so an active tenant can't be soft-deleted in one click. The *Delete* pill on `/admin/companies` rows only renders for archived rows and opens a ConfirmDialog explaining that recovery is SQL-only.
- **Company settings** (`/admin/companies/[id]`) — features toggle card, transcript sources + aliases (folded into one *Meeting transcripts* panel), Google Drive account connection.
  - Opening this page auto-scopes the caller into the company (middleware sets the scope cookie on the request + response so the top nav flips immediately AND subsequent clicks resolve to the correct company).
- **Meeting transcripts admin** (`/admin/transcripts`) — unrouted queue for the scoped company, with detail at `/admin/transcripts/meetings/[id]` for routing a single meeting to a specific tenant.
- **Classroom authoring** (`/admin/classroom`, sysadmin only) — see Section 15.
- **AiMS Guides admin** (Guides panel on `/admin/companies`) — system admins can invite `aims_guide` profiles, assign them to companies, unassign, and delete. The panel also lists `system_admin` profiles that hold at least one guide assignment, badged "System admin," so an internal admin carrying a caseload appears alongside external guides. A separate "Give a system admin a coaching caseload" mini-form assigns an existing sysadmin to one or more companies in bulk (no invite fired — they already have an account). Row-level *View Guide HQ* action opens the sysadmin oversight surface for that guide. **Unassign semantics differ by role:** removing the last assignment from an aims_guide is refused (invariant: no zero-assignment guide); the same operation on a sysadmin is allowed (their cross-tenant access is role-based, not assignment-based). See Section 17 for the Guide HQ surface these assignments feed.
- **Dashboard AI briefs** — cached per company with prompt-hash invalidation; `AiBrief` React component types out the reveal on first view of a fresh brief, then renders instantly on revisits (localStorage-tracked, respects `prefers-reduced-motion`).

### 16a. Notifications

Two sources feed the same `NotificationItem[]` rendered by `NotificationBell` in the top nav and sidebar footer.

- **State-derived triggers** (in `src/lib/notifications/service.ts`) — recomputed per header render, nothing persists. Overdue commitments (owner), Due today commitments (owner), Friday metrics (leaders of manual measures, Friday only in company tz). These can never be "dismissed" because the underlying state IS the notification; clearing them means acting on the state.
- **Event-based notifications** (migration 0152) — persisted rows in `public.notifications` `(id, recipient_id, company_id, kind, payload jsonb, href, eyebrow, title, read_at, created_by, created_at)`. `kind` is open-schema — new event sources drop in without another migration. One-shot lifecycle: the row is created when the event fires, hidden from the bell when `read_at` is set, and never re-fires.

Boundaries:
- **RLS forbids INSERT to `authenticated` entirely.** Every write goes through `insertNotification()` using the admin client from trusted server code (e.g., `shareConversationAction`). This shuts down the user-to-user spam vector at the DB layer — even a malicious client with a valid JWT cannot fabricate a notification for another user.
- **SELECT / UPDATE / DELETE** are recipient-only (`recipient_id = auth.uid()`). No admin peek path.
- **Self-notifications** short-circuit in `insertNotification()` — pinging yourself for something you just did is always noise.
- **Company scope on read** — the bell filters persisted rows by the caller's current company scope alongside `recipient_id`, mirroring the general scoping story so a system_admin or guide switching tenants doesn't drag notifications along.

Registered kinds:
- `chat_shared` — fires from `shareConversationAction` on successful insert. Payload carries `conversation_id`, `access`, `shared_by_id`, `shared_by_name`, `mode`, `practice_id`. Best-effort — a notification failure never rolls back the share.

Client wiring:
- `NotificationBell` marks any `dismissible: true` item read on click (fire-and-forget alongside the navigation). Computed items skip the round-trip since they recompute anyway. `markNotificationReadAction` is idempotent (`.is('read_at', null)` filters already-read rows out of the update) and revalidates the layout so the badge count refreshes on the next paint.

---

## 17. Guide HQ

The home base for `aims_guide` and `system_admin` roles at `/hq`. Scoped to the caller's own `guide_assignments` rows regardless of role — a sysadmin with three assignments sees exactly those three, not every company on the platform. Zero assignments hits a distinct empty state, not a fallback to global scope (deliberate — protects the "I coach a specific caseload" mental model).

- **Route**: `/hq` (server component, `requireRole(['aims_guide','system_admin'])`). Middleware clears the scope cookie on entry so the sidebar renders unscoped — no Dashboard / Chart / Plan links while at home base. Cookie mutation is done in middleware because Next.js forbids it from a server-component render.
- **Data loaders** (`src/lib/hq/service.ts`):
  - `loadCaseload(profileId)` — the caller's assigned companies.
  - `loadMyCommitments(profileId)` — every commitment the caller owns, across every tenant. Backed by the owner-visibility RLS clause added in migration 0141.
  - `loadCompanyRollups(companyIds)` — per-company snapshot (scorecard overall, 30-day Follow-Through Rate, open quarter label, most-recent completed meeting date).
  - `loadRecentActivity(companyIds)` — 5-6 item merged feed of meeting analyses, facilitation reviews, and quarter open/close events across the caseload.
- **Sections**, top-to-bottom on the page:
  - **My commitments** — reuses the `/commitments` `CommitmentRow` client component exactly (same resolve / reschedule / park mechanics, same undo chip). A `companyLabel` prop threads the company name through as a row chip so the caller can tell which tenant a row belongs to. Priority linking and reassign are disabled here (both would need per-company rosters and priorities the surface doesn't fetch).
  - **Needs your attention** — the attention queue for the caller's assigned companies. See below.
  - **Your companies** — compact per-company rollup rows. Click the name to scope in (via `CompanyNameLink` → `/admin/companies/[id]` middleware auto-scope). Each row carries a *Prepare for {company}* button that opens the Session Brief panel.
  - **Recent activity** — thin unfiltered, unpaginated feed capped at 6 items.
- **Attention queue** (`src/lib/hq/attention.ts`): computes per-company triggers from live reads. Every trigger carries the numbers the reason line will render — the UI never re-derives them. Five triggers:
  1. **Scorecard dropped** — current live overall < most recent snapshot's overall.
  2. **Follow-Through Rate low** — 30-day FTR below the `FTR_THRESHOLD` constant (default 60%).
  3. **Follow-Through Rate declining** — 30-day FTR trending down vs the prior 30-day window (fires only when the absolute FTR is still above the low-threshold).
  4. **Facilitation review low or insufficient** — latest completed meeting's `facilitation_review_json` has `overall < FACILITATION_LOW_THRESHOLD` (default 5) OR `insufficient_transcript = true`.
  5. **Priority overdue** — one or more priorities in the open quarter more than `PRIORITY_OVERDUE_DAYS` (default 14) past due.
  6. **Unrouted transcript** — one or more unrouted meetings whose filename matches this company's `transcript_aliases`.
  Weighted severity: scorecard drop (4), FTR low + facilitation low (3), FTR declining + facilitation insufficient + priorities (2), unrouted (1). Rows ranked by severity descending, alphabetical tiebreak.
- **Session Brief** (`src/lib/hq/brief.ts` + `src/lib/hq/brief-actions.ts`): on-demand, one-Anthropic-call brief a guide reads right before a coaching session. Not scheduled — fires only when the guide clicks *Prepare for {company}*.
  - **Context assembly**: latest meeting analysis + facilitation growth edges + commitments made in or since that meeting + scorecard delta vs prior snapshot + attention triggers for the company.
  - **Prompt** (inline in `brief.ts`): produces four short Markdown H3 sections — *What happened last time* · *What's still open* · *Growth edges worth raising* · *Suggested opening question*. Warm, generative, forward-leaning voice.
  - **Storage**: `session_briefs` (migration 0141) — append-only per generation; regenerating creates a new row so the guide has a history of what they told themselves before past sessions.
  - **Panel** (`PrepareBriefPanel.tsx`, client): opens as a modal from the *Prepare for* button; shows the two most recent briefs with Copy buttons + a *Generate a new brief* action. Errors from the Anthropic call return `{ok: false, message}` and show an inline retry — the page never fails on a brief error.
  - **RLS**: `SELECT` allowed for sysadmin (any brief) OR generated_by = self AND caller holds a guide assignment for the company. `INSERT` requires the caller to be inserting a row they authored; sysadmins may insert against any company, guides against their assigned companies.
- **Sysadmin oversight view** (`/admin/guides/[guideId]/hq`, sysadmin only): renders the target guide's HQ in read-only mode. Same four sections keyed on `guideId`; `MyCommitmentsSection` receives `readOnly=true` which sets `canResolve/canLink/canReassign` all false on every row. Navigational affordances (click a company, open a meeting) stay live. Persistent banner names whose board is on screen. Session Brief remains available (no side effects; the brief author is the viewing sysadmin, not the guide).
- **Perf shape**: `loadCompanyScorecard` is wrapped in React `cache()` so within a single page render, attention + rollups share one fetch per company (was two). `loadRecentBriefsForCompanies` batches every caseload company into one query (was N). A shimmer skeleton (`src/app/(app)/hq/loading.tsx`) renders instantly on navigation so the page shell appears before the server data lands.

---

## 18. Cross-cutting UX System

- **Left Sidebar** (`components/sidebar/Sidebar.tsx`) — fixed rail at 260px expanded, 68px collapsed (icons-only). Collapse state persists in an HTTP-only cookie (`nav-collapsed`) read server-side by the app layout so first paint matches the user's preference (no post-hydration jump). Nav items grouped as flat section headers rather than dropdowns — one click to any surface. Group set is role-dependent: cross-tenant roles (`system_admin`, `aims_guide`) see **Guide HQ** at the top (Overview → `/hq`, Companies → `/admin/companies`, Week in Review → `/dashboard`) followed by **Workspace** (AiMS Implementation, One-Page Plan, Team, Functional Org Chart, Goals & Priorities, Functional Commitments, Meeting Summaries) and Critical Success Factors, then **Resources**, then **Strengths**. Company users (`company_admin`, `team_member`) get **Week in Review** prepended as a top-level link (their daily entry point stays one click) and skip Guide HQ. Inline SVG icons per item; hover slides a chartreuse left-accent bar in with a subtle white-tint bg + icon color shift on a single 200ms `--ease-out` curve. Active item keeps the accent bar and a slightly stronger bg. Context pill under the logo reads "SYSTEM ADMIN · COMPANY NAME" (or "AIMS GUIDE · COMPANY NAME") when a cross-tenant role is scoped in. Footer holds the notification bell (opens upward via `placement="up"` on `NotificationBell` so the tray doesn't fall off the bottom of the screen) and the user pill (opens a popover upward with Profile / Exit company / Sign out). Below 768px the rail slides off-canvas and a hamburger in a slim top strip opens it as a drawer with a backdrop scrim. `NavBand.module.css` is retained for `NotificationBell`; the tray's placement variant lives with the bell.
- **ConfirmDialog** (`components/ui/ConfirmDialog.tsx`) — branded replacement for native `window.confirm()`. Auto-focuses Cancel so a stray Enter can't fire destruction; Escape cancels; overlay click cancels; danger vs primary tone. Used everywhere destructive actions land — no `confirm()` or `alert()` remains in user-visible code paths.
- **PrivacyNote** (`components/ui/PrivacyNote.tsx`) — small, subtle line telling the user who can see the surrounding content. Three tones (private / managerial / shared). Placed on coaching surfaces, meeting analyses, and the personal scorecard.
- **Undo affordance on commitment resolves** — 6-second inline chip that reverses the state without needing to hunt for a reopen gesture.
- **Done chips on the meeting summary** (`DoneChip`, shared by the extracted-commitments and extracted-issues sections) — replace the pickers/buttons once an extracted row has been acted on. Three rules:
  - **Brand navy via `--text-heading`, not the functional green.** These mark a state, not a success or a pass, and green read as off-brand beside the navy section headings. `--text-heading` is used rather than `--aims-navy` directly because `--surface` resolves *to* navy in dark mode, where a hardcoded navy chip would vanish into the card it sits on. Same reason applies anywhere brand navy is used for text on a themed surface.
  - **Distinct icons per outcome.** *Resolved in meeting* takes a check in a circle (the loop closed); *Added as issue* takes a plus in a circle (on the list to work later). They share the circle so they read as a pair rather than two unrelated marks. Everything else keeps the plain check.
  - **Shared min-width so the icons align.** The actions column is right-aligned, so without a common width the two label lengths pushed their icons to different x positions and the icon column read ragged. Sized in `ch` (19ch for the longest label plus 22px for icon and gap) so it tracks the font rather than a magic pixel count. It's a floor, not a cap — longer labels in the commitments section set their own width.
- **Design tokens** (`brand/tokens.css`) — brand palette (navy/cobalt/sky/chartreuse + midnight/sand/white), functional accents, typography (Inter for headings + labels, Figtree for body), spacing scale, radii, motion. Consistent `.aims-prose`, `.aims-tabular`, `.aims-rule`.
- **Shared UI primitives.** Three consolidation passes keep the surface tight: (a) `.emptyLine` (the muted "nothing here yet" line used across every list) lives once in `src/components/ui/ui.module.css`; (b) module-local `.primaryButton` / `.ghostButton` / `.dangerButton` compose from the shared `.btnPrimary` / `.btnGhost` / `.btnDanger` there so button vocabulary stays byte-identical across surfaces; (c) hero pages (`/dashboard`, `/scorecard`, `/hq`, `/measures`, `/people`, `/foundation`, `/classroom`) render through the shared `PageShell` instead of hand-rolled headers, so the eyebrow / title / subtitle rhythm is one implementation.
- **Help widget** — every user-facing route has a corresponding markdown help doc under `docs/help/` served through `/api/help`, surfaced by a floating `?` widget. `npm run check:help` enforces coverage in CI.
- **Empty states** — every empty page carries teaching copy + a next-step link (e.g., foundation cards, plan cascade, /measures). No product tours, tooltips, or overlay onboarding — teaching happens inline via the empty states.

---

## 19. Non-Functional Characteristics

- **Auth:** Supabase Auth (email + password). Flows:
  - Sign-in at `/sign-in`.
  - Password change on `/profile`.
  - Forgot-password magic link at `/forgot-password`, verified at `/reset-password`.
  - Email invitation acceptance at `/accept-invite` (role assigned at invite time; user sets password on first login).
- **Isolation:** every table has RLS enabled + `force row level security`; company-scoped policies check both role and company match. Cross-tenant reads flow through `auth_profile()` and `company_has_feature()` helper functions.
  - **RLS is not a backstop on service-role paths.** Anything routed through `createSupabaseAdminClient()` bypasses RLS entirely, so every such call site must check company membership itself. Transcript routing/dismissal and alias create/delete (`src/lib/transcripts/actions.ts`) load the target row and run `isAdminForCompany` against its company before writing; unrouted meetings (no company yet) are system-admin only. The Google OAuth callback re-checks membership on the company id parsed from the state cookie before persisting a credential.
  - **Roster actions scope guides too.** `src/lib/auth/users.ts` funnels create / update / invite / invite-link / delete through one `canManageProfileIn()` rule. Guides are limited to their assignments and nobody below `system_admin` can grant `system_admin` or `aims_guide`. `reports_to` must resolve to a profile in the same company.
  - **`SECURITY DEFINER` RPCs need explicit grants.** `find_similar_open_commitment` / `find_similar_open_issue` take a company id as a parameter and do no membership check of their own. Execute is granted to `service_role` only; `public`, `anon` and `authenticated` are revoked. A test replays the grant history across migrations so a re-grant fails CI.
- **Timezone:** per-company (`companies.timezone`). Week-ending Friday is computed in the company's local time. AI cron jobs run on a UTC schedule but resolve week boundaries per tenant.
- **AI providers:** Anthropic Claude across the app. **Ten distinct AI callers, three model tiers:**
  - **Sonnet 4.6** (`ANTHROPIC_SUMMARY_MODEL`, `ANTHROPIC_COACH_MODEL`, `ANTHROPIC_FACILITATION_MODEL` — all default to Sonnet 4.6):
    1. Meeting analyzer (summary markdown)
    2. Meeting commitment extractor (JSON, roster-validated)
    3. Meeting facilitation review (tool-use, structured)
    4. Coach chat (streaming, tool-use, cached)
    5. Ask Aimee (same as coach, general mode)
    6. Dashboard "Week in review" brief (cached per prompt-hash)
    7. Session Brief (Guide HQ *Prepare for {company}* action; one-shot, best-effort with inline retry on error)
  - **Haiku 4.5** (`ANTHROPIC_CLARITY_MODEL`, default Haiku 4.5) — lightweight quality-check passes:
    8. Commitment clarity scoring (on every save)
    9. KPI target validation (advisory)
    10. Measure-draft critique panel (Measure / Target / Fit dimensions)
  - Each caller instantiates its own `Anthropic` client with `ANTHROPIC_API_KEY`. Model IDs are env-var overridable.
- **Streaming:** SSE for coach chat + weekly brief. Tool-use loop on coach (max 4 iterations per turn).
- **Prompt caching:** coach chat is the only caller using `cache_control: { type: "ephemeral" }` in v1.
- **Storage:** Supabase Storage — three buckets:
  - `classroom-attachments` (private, server-signed URLs, 1-hour TTL) for lesson-section PDFs / decks / worksheets.
  - `classroom-images` (public) for inline images embedded in section bodies. Public because `<img src="...">` URLs live in body JSON and must not expire mid-session; writes are still sysadmin-only via storage RLS + server-action role check.
  - `profile-avatars` (public) for user profile photos. Write RLS gates the folder prefix to the caller's `auth.uid()` so users can only touch their own avatar; sysadmin bypasses for cleanup.
- **Email:** Resend (transactional) for meeting-analysis commitment digests to participants, and for auth invitations / password reset emails via Supabase.
- **External integrations:** Google Drive (OAuth per company, `0110_oauth_per_company`) for transcript ingest. No other external integrations.
- **Cron jobs (Vercel):**
  - `/api/cron/transcripts` — every 15 min, polls all active Google Drive sources, ingests + analyzes + emails.
  - `/api/cron/performance` — Saturdays 15:00 UTC, opens "Log this week's value" commitments for missed `auto_track` measures.
  - `/api/cron/scorecard` — Sundays 07:00 UTC, writes one `company_discipline_snapshots` row per (company, discipline) so the AiMS Scorecard sparklines + trajectory arrows have history. Current score is computed live; the snapshot is only for the trend line.
- **Middleware:** three concerns per request — Supabase session refresh; `/admin/companies/[id]` auto-scope (mutates request + response cookies, skipped on prefetch requests, response cookie persisted only for cross-tenant roles — see Section 1); and root-path routing (unauthenticated → marketing landing; authenticated cross-tenant roles → `/hq`; authenticated everyone else → `/dashboard`). A pending-user check rides along on the same profile read. `updateSession` returns the profile role alongside auth/pending state so root-path routing can differentiate roles without a second DB round-trip. Guide HQ hides company links by pathname rather than clearing the scope cookie.
- **Observability:** Sentry (`sentry.server.config.ts`, `sentry.edge.config.ts`, `sentry.client.config.ts`) with a JWT-scrubbing `beforeSend` so Supabase session tokens never leave the process. Both `src/app/error.tsx` (below-root error boundary) and `src/app/global-error.tsx` (root-layout crash boundary) call `Sentry.captureException(error)` inside a `useEffect` — without this, boundary-caught errors are silent in Sentry even though the user sees the digest on-screen.
- **Request-path cost.** Deliberate choices, all from the 2026-09-02 performance audit:
  - **Session resolution is memoized per request.** `getCurrentSession` is wrapped in React's `cache()`. Middleware, the `(app)` layout and the page each call `requireProfile` independently, and a server action adds a fourth as the tree re-renders — so a single navigation was making three `auth.getUser()` calls (an HTTPS round trip that revalidates the token, not a local decode) plus three profile reads. **Never replace this with a module-level memo:** module scope is shared by every request in the container, which would make it a cross-tenant leak rather than an optimization. The dedupe is only observable inside a request scope, so the unit tests pin behaviour plus a source guard rather than asserting call counts, which vitest cannot see.
  - **List queries name their columns.** `meetings` rows carry `transcript_text` (the entire transcript), so `select("*")` on a list surface pulls megabytes to render titles and dates. `/leadership`, the company detail page and the unrouted queue select explicit column sets, typed as `MeetingListRow` / `MeetingAdminRow` (`Pick`s of `Meeting`) so a projection can't silently drift from the base type.
  - **Indexes** (migration 0161) cover the notification bell's `due_date` filter, the Guide HQ follow-through window on `completed_at`, the 14-day duplicate-detection lookback on both tables, and coaching threads by subject. Plain `CREATE INDEX`, not `CONCURRENTLY`: the CLI wraps each migration in a transaction, and at current volume each build is milliseconds.
  - **Known and deferred:** RLS policy helpers are not wrapped in the `(select fn())` form, so they evaluate per row rather than once per statement — the largest remaining database win. The dashboard and layout loaders still run mostly sequential awaits. Both are documented in the audit and unshipped.
- **Failure visibility.** `findSimilarOpenItem` logs RPC errors instead of swallowing them. It previously read only `.data`, so a missing function or a revoked grant returned "no duplicate found" — indistinguishable from a genuine miss, which is how a duplicate-detection outage could run indefinitely with no signal. Still non-fatal: the badge is an enhancement and must never block the page.
- **Idempotent seeds:** demo companies (e.g., Meridian Construction Group) rebuild in place; safe to rerun.
- **CI enforcement:** `npm run typecheck` (tsc), `npm run lint` (Next), `npm run test` (Vitest), `npm run check:help` (help doc coverage).
- **Design system:** custom CSS modules; brand palette (navy/cobalt/gradient primary); consistent card + button vocab; tabular numerics for metrics; `aims-rule` accent bars under key headings.

---

## 20. Explicit Non-Goals / Gaps

Things intentionally not built (yet):

- No native calendar integration.
- No push notifications, Slack, or mobile push. Transactional email is limited to (a) auth invitations & password reset, and (b) the per-meeting commitment digest to participants — no daily/weekly digests, no email notifications for the in-app bell. In-app notifications DO exist (see Section 16a), but stay inside the app.
- No mobile apps (responsive web only).
- No CSV / Excel import (seed scripts only). No CSV / PDF export or shareable-report surfaces.
- No external integrations beyond Google Drive (no HRIS, Notion, Salesforce, QuickBooks, HubSpot).
- No public / customer-facing portal.
- No time tracking, PTO, or performance-review workflows.
- No survey engine.
- No white-label / customer branding.
- No SSO (email + password only; no SAML, no Google Workspace SSO).
- **Classroom v1:** no completion tracking, no curriculum / prerequisite paths, no drag-and-drop reordering.
- **Coach memory:** not compressed across conversations — capped at last 200 messages per thread.
- **Meeting re-analyze:** no in-app "re-run the primary summary + extraction" button; edits to the analyzer prompt only affect future ingests. (Facilitation review is the exception — it has an admin *Re-run facilitation review* button on the meeting detail page for reviews that didn't land, see Section 12.)
- **Meeting outputs:** no participant attendance tracking, no sentiment analysis, no follow-up scheduling — commitments are the sole structured action output.

---

## 21. Competitor Scoring Rubric

When evaluating a competitor, score them on:

1. **Strategic plan cascade** — SFA / Annual Goal / Quarterly Priority levels with progress roll-up?
2. **Weekly commitment tracking with a real Follow-Through Rate metric.**
3. **Commitment clarity scoring** — do they enforce timeline + observable outcome per commitment, and *AI-score* it automatically?
4. **Person-level follow-through history** with verbatim missed reasons.
5. **Functional org chart** with critical success factors and KPIs.
6. **Weekly key-success-measure tracking** with generative "gaining ground / wins / worth a conversation" insight cards.
7. **AI target & measure-quality coaching** — do they validate that a leader-authored target is specific and observable, and coach on the draft?
8. **Meeting transcript ingest** with automatic commitment extraction into the plan cascade.
9. **AI facilitation review** grounded in a specific meeting-facilitation framework (not generic sentiment).
10. **AI coach grounded in real execution data**, with tool use — not generic chat.
11. **Personal reflection AI** (Ask-Aimee-style) with strict privacy from admins/managers.
12. **Shared training library** with per-tenant entitlement and stable content URLs the AI can recommend in conversation.
13. **Manager-of-a-report affordances** — not just admin / member binary.
14. **Multi-tenant with per-tenant feature entitlements.**
15. **External coaching role** (AiMS Guides / consultants) with cross-company scope without admin.
16. **Row-level security posture** — multi-tenant on shared DB with force RLS.
17. **Real-time streaming** UX for AI features (SSE, prompt caching).
18. **Per-tenant transcript ingest** (each customer connects their own Google Drive Workspace) versus vendor-owned ingest that forces one integration point.

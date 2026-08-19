# AiM Higher (AiMS Execution Platform) — Product Build Spec

**One-liner:** Multi-tenant SaaS operating system for small-to-mid company leaders who run their business by the AiMS methodology — turns strategic plan → weekly commitments → follow-through data into one operating rhythm, layered with meeting-transcript intelligence, an AI coach, an AI reflection companion, and a shared training library.

**Target customer:** Owner-led companies, $2M–$50M revenue, 10–150 employees. Bought by the CEO/owner or COO. Delivered through the AiMS advisor network.

**Stack signals:** Next.js 15 App Router (server components + server actions), Supabase (Postgres + auth + Storage + RLS), Anthropic Claude for AI (Sonnet 4.6 for reasoning-heavy tasks, Haiku 4.5 for lightweight quality-check passes), Resend for transactional email, Google Drive for transcript ingest. Multi-tenant on shared Postgres with row-level security. SSE streaming for chat + AI briefs.

**This document intentionally excludes the Strengths module and any strengths-related surfaces** — Strengths ships alongside the platform but is scoped separately for research purposes. Where it intersects the coach (as a tool), that intersection is noted so a competitive analysis can factor it in.

---

## 1. Tenancy & Roles

- **Tenant** = Company. Everything below is company-scoped via RLS.
- **Roles:**
  - `system_admin` — vendor staff, cross-tenant scope; only role that can author Classroom content.
  - `company_admin` — owner/leaders, full write on their company.
  - `aims_guide` — external AiMS coach assigned to one or more companies; admin-like within assigned companies, no cross-tenant privileges beyond assignments.
  - `team_member` — read + self-write.
- **Scope-in (system_admin + aims_guide):** clicking a company on `/admin/companies` (or navigating to `/admin/companies/[id]`) auto-scopes them into that company via a signed cookie set by middleware on both the incoming request (so the current render sees it) and the response (so subsequent navigations resolve to the right tenant). The Sidebar renders a persistent "SYSTEM ADMIN · COMPANY NAME" (or "AIMS GUIDE · COMPANY NAME") context pill under the logo with an *Exit company* affordance in the user menu at the bottom of the rail.
- **Managers:** `profiles.reports_to` establishes a direct manager, unlocking manager-level affordances (e.g., coach *about* a direct report) without granting admin.
- **Invitations:** email invite flow with expiry; role assigned at invite time. Admins can pre-stage the roster (create as pending, send invite later).

---

## 2. Company Feature Flags

Per-tenant entitlements gate module visibility everywhere (nav, dashboards, coach tools, AI passes). Set by system_admin on the company settings page. Canonical list lives in `src/lib/companies/features.ts`; the DB column is open-schema (no CHECK constraint) so new modules can ship without a migration.

| Flag | Turns on |
| --- | --- |
| `execution` | Core: commitments, plan cascade, chart, coaching, dashboard |
| `performance_tracking` (labelled **Success Tracking**) | Requires targets on every success measure; enables the weekly measure log page, the Saturday "log this week" nudge cron, the AI target-quality check on measure creation, the AI metric-draft critique panel, and the four generative dashboard insight cards |
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
2. **Vision** — single free-form body (3-year horizon). The legacy title/tagline/body split and vision_milestone items were consolidated in migration 0106.
3. **Core values** — titled + body, ordered, admin-writable.
4. **Strengths & Differentiators** — titled + body, numbered, admin-writable.
5. **Ideal Customer Profile** — two sub-lists (best-fit clients/projects and psychographics). Each entry is a single line with delete-only management; `AddSnippetForm` per sub-list.
6. **Strategic Focus Areas** — read-only preview here; write side lives on `/plan`. Falls through the same numbered-card grid.
7. **Key Success Metrics** — titled + body, admin-writable.

**Visual system:**

- Every section wrapper is a white `cardAccent` (soft sky-tint corner accent shape).
- Every list item inside a section renders as a **numbered card** (`.numberedCard`, formerly `.differentiatorCard`) — cobalt "01/02/03" number on a grey/bordered tile with a title, optional body, and Edit/Delete actions in a footer row. ICP snippets render the same shell but the content sits as body-weight text (no title) since snippets are single statements.
- Singleton statement sections (Purpose, Vision) wrap their content in the same grey `.sectionBody` tile so the whole page reads as one "grey content tile inside white section card" pattern.
- **Sticky chip nav** at the top of `.content`, `position: sticky; top: 0; z-index: 15`, styled as a card (cobalt-text-on-bordered-pill chips matching the app's ghost/edit button vocabulary). Overlaps the bottom of the hero band via `-32px` margin on `.content`. Anchors on section h2 IDs with `scroll-margin-top: 96px` so jumps clear the sticky bar. Global `scroll-behavior: smooth` on `html` (respects `prefers-reduced-motion`) makes chip clicks glide.
- `.grid2` uses `repeat(auto-fill, minmax(320px, 1fr))` — `auto-fill` (not `auto-fit`) keeps ghost tracks so a lone card stays 320-420px wide instead of stretching to page width.

All items admin-writable. Consumed by the AI coach, meeting analyzer, and marketing surfaces. Every card has a first-run empty state that teaches ("Add the purpose statement to give the whole company a shared north star.").

---

## 4. Planning Cascade

Three-level strategic plan tied to quarters. Progressive add reveal — each level's "+ Add" only appears once the parent level exists, so a first-run admin can't build orphans by accident.

- **Strategic Focus Areas (SFAs)** — long-lived themes (often multi-year), sponsor assigned, sortable, archivable, future-perfect narrative body. Detail page hero: status + progress on their own row underneath identity metadata.
- **Annual Goals** — belong to an SFA (or orphan), owner assigned, per-year. Independent archive / *Mark complete* — an admin can close a Goal while its parent SFA stays open (common because SFAs span multiple years).
- **Quarterly Priorities** — belong to an Annual Goal (or orphan), owner assigned, per-quarter, status: `not_started` / `on_track` / `behind` / `complete` / `ongoing`.
- **Quarters** — start/end dates, status: `open` / `closed`, one open per company. `/quarters` admin page lets an admin roll a new quarter, adjust ranges, or close the current one.
- Progress rolls up: priorities → goals → SFAs → company-level **Strategic Progress %**.
- **Start a new planning cycle** (formerly "Bulk Reset") — collapsed *danger zone* panel at the bottom of the plan page (admins only). Archives every active SFA / Goal / Priority in the company; nothing is deleted (records remain on file). Open commitments that were linked to now-archived priorities become Operational (their `priority_id` nulls out); resolved commitments keep their historical link so past-quarter priority progress stays intact.

---

## 5. Commitments (Weekly Rhythm)

The heart of the operating rhythm.

- **Resolution model** — every commitment sits in one of four states: `open`, `kept_on_time`, `kept_late`, `missed`. Kept-late is the same "did the work" signal as kept-on-time but distinct in the UI (green check + clock badge, never X, never danger colour) and NOT counted in the Follow-Through numerator. The prior `in_progress` state was retired in 0139; the prior conflated `kept`/`missed` semantics were split there too.
- **Columns of note**: owner, description, due_date, week_ending (Friday), optional priority link (strategic vs operational), status, missed_reason (verbatim text, optional now), completed_at, resolved_by_role (`owner` / `admin` / `guide`), resolved_by_profile_id, source_meeting_id (nullable), `is_ongoing` (weekly cycle), `parked_at` (parking lot), `deleted_at` (soft delete).
- **Week ends Friday** — hardcoded assumption; commitments always belong to a Fri-ending week.
- **Follow-Through Rate** = `kept_on_time / (kept_on_time + kept_late + missed)`, computed across any window. Late keeps and misses count in the denominator only — the discipline signal is "on time," not "at all." Title-cased consistently across the app.
- **Ongoing (weekly) commitments** — `is_ongoing = true` rows always sit at status `open` and always carry a current due date. Each resolution (kept-on-time, kept-late, or missed) writes a row to `commitment_occurrences` for that week and rolls the parent's `due_date` + `week_ending` forward 7 days. One row in `commitments`, many weeks of history. Follow-Through math iterates BOTH tables so per-week resolutions all count individually. *Stop repeating* converts the row to a normal commitment due at its current date.
- **Parking lot** — rows with `parked_at IS NOT NULL` are excluded from every metric, overdue count, and Needs Attention grouping. Rendered in a muted section at the bottom of `/commitments` with a *Bring back* action that clears `parked_at` and sets a fresh due date. No reason required for park or bring-back.
- **Soft delete** — `delete` sets `deleted_at`; the row hides from every UI + metric but is retained internally. INTENTIONALLY REVERSIBLE — no user-facing recovery UI in this build, but the data is there for future coaching-signal work (churn / abandonment patterns).
- **Reason requirements by role** — owners resolving missed or rescheduling must supply a reason; owners marking kept-late get an OPTIONAL reason prompt with a ghost Skip button. System admins, company admins, and AiMS guides on their assigned companies are **exempt from every reason requirement** and may change past-due dates or mark any resolution in one click. `resolved_by_role` records who did the resolving so the coaching context can distinguish "no reason from owner" from "resolved by admin in the meeting."
- **Row layout** — resolve circle | clarity dot | description (+ Ongoing / From-meeting chips) | owner name | priority link | due date | status chip | delete (hover-revealed on the far right).
- **Resolve interaction (safety-hardened)** — 28px resolve circle at the left triggers a menu with the available actions (never resolves directly). "Marked kept · Undo" chip appears for 30 seconds after each resolve so misclicks reverse in one gesture. Delete lives at the far right, hover-revealed, styled as a trash glyph — deliberately separated from the resolve circle so the two can't be confused.
- **Owner click → person quick-view drawer** — the drawer's stats now show kept-on-time / kept-late / missed / open distinctly. Reassign lives inside the drawer under "Reassign this commitment" — one gesture deeper than before so an accidental click can't change ownership.
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
- **First-run Setup Checklist** (admin-only, empty-state) — a *Set up {company}* card at the top of the dashboard renders when foundation / roster / open quarter / plan are still incomplete. Four ordered steps auto-check as each prerequisite lands; the card stops rendering once everything is done.
- **Week in review** (admin-only, streamed) — AI brief summarising what's worth knowing right now. Streams via Suspense + a light typewriter reveal on first view of a fresh brief; instant on revisits (localStorage-tracked, respects `prefers-reduced-motion`). Cached with a prompt-hash so identical inputs don't regenerate. Uses `ANTHROPIC_COACH_MODEL` (Sonnet 4.6 default).
- **This week's numbers** (Success Tracking on) — pending success-measure card with inline inputs and a *Save what I have* action; jumps to the full `/measures` batch view.
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

## 7. AiMS Scorecard (discipline maturity)

Company-wide "how are we doing at running the AiMS disciplines?" view at `/scorecard`. Visible to **everyone in the company** (transparency by design — team members see the same view leaders do).

- **Eight disciplines, each rated 0–10.** Foundation, Accountability Chart, Strategic Plan, Execution, Success Tracking (feature-gated on `performance_tracking`), Weekly Leadership Meeting, Solution Seeking (aggregate 4Ws closure), and Appreciative Practice (positive-framing signal) — the last three feature-gated on `meeting_facilitation_review`. Feature-gated disciplines whose feature is OFF render as a muted "Not enabled" tile and are dropped from the overall average — the weight redistributes across the ones that scored, so a company without Success Tracking isn't dinged for not having it.
- **Overall score** — weighted average across scored disciplines. Planning and Execution weight 2× (the two the whole system is oriented around); the others weight 1×.
- **State vs behavior disciplines.** Foundation and Accountability Chart are state-based (either filled in or not) and render **without** a trend chip or sparkline — history adds noise where the signal is done-or-not. The other four (Planning, Execution, Success Tracking, Meetings) fluctuate over time, so they carry the trend arrow + 26-week sparkline.
- **Strategic Plan = cascade + closure.** Populated cascade (SFAs + goals + priorities) is a 2-point baseline; annual goal closure by target_date and priority closure by due_date each contribute up to 4 points. Fresh plans with nothing past due yet receive full credit on the closure halves so a new company isn't dragged down.
- **Execution scoring.** Follow-through over rolling 30 days = 7 pts; aging opens (>14 days past due) = 3 pts. Priority linkage is deliberately **not** scored — some commitments are operational floaters by design, so the linked-to-priority ratio isn't a discipline signal.
- **Rolling by construction.** Behavior-based scorers use recent-window aggregates (Execution = 30 days, Measures = 7 days, Meetings = 8 weeks). If meeting cadence drops off, the Meetings score falls the following week without any manual intervention.
- **Trajectory arrow vs 90 days ago.** Behavior-based cards (and the overall number) show ↑ / ↓ / flat vs the oldest snapshot inside the 90-day window. Absolute score AND trajectory both live on the card so "low but climbing" reads distinctly from "high but sliding."
- **26-week sparkline** under each behavior-based score using hand-rolled SVG — nulls (feature-was-off periods) render as gaps, not fake zeros.
- **Live compute + weekly snapshot.** The current score is computed **live** on every page load (six small reads, no cache) so behavior changes show up immediately. A weekly Sunday cron (`/api/cron/scorecard`) writes one row per (company, snapshot_date, discipline) to `company_discipline_snapshots` for the historical trend line.
- **Score breakdowns** — each card shows evidence lines pulled from the scorer's `breakdown_json` (e.g., "74% follow-through, 3 open more than 14 days past due"). Discipline-specific rendering lives alongside the page. The Accountability Chart card also surfaces a collapsed per-function issue list ("Ops — missing Track, outcome") so you can see which functions are dragging the score.
- **Drill-down affordance.** Every card ends with a "Go to X →" link that jumps to the surface where a user would actually work on that discipline (Foundation → `/foundation`, Execution → `/commitments`, etc). Copy lives on the DisciplineConfig alongside the blurb.
- **Solution Seeking tile** aggregates the `fourws_audit[]` rows across every reviewed meeting in the rolling 8-week window; closure rate (Ws closed ÷ Ws surfaced) maps to 0–10. When no issues have come up in the window, the tile isn't scored (avoids reading as a zero for a period of quiet meetings).
- **Appreciative Practice tile** rolls up the facilitation review's new `positive_framing` dimension (v2 prompt) across the rolling 8-week window, plus running counts of `appreciation_moments`, `generative_questions`, and `reframes`. Not scored until the v2 review has run at least once — pre-v2 rows carry no positive_framing dimension.
- **Info tooltip per tile.** Every card has a `?` icon next to the title with a hover/long-press tooltip explaining exactly how that discipline is scored. Rubric copy lives on the DisciplineConfig `scoringNote` field so tuning the wording is a one-line change per discipline.
- **Explicit non-goal: leader attendance.** Transcript speaker-to-profile matching isn't reliable enough to score, so attendance is out. Meeting quality still surfaces via the facilitation-review `overall` score.

Scoring code lives in `src/lib/maturity/` (config in `disciplines.ts`, one file per discipline in `scorers/`, orchestrator in `compute.ts`, read helpers in `service.ts`). Adding a new discipline is a three-file change: add the key to `disciplines.ts` + `DISCIPLINES` array, extend the `discipline` CHECK constraint on `company_discipline_snapshots`, add a scorer, wire it into `compute.ts`, and add an evidence case to `evidenceLines` on the page.

---

## 8. People / Person Scorecard

- **Roster** (`/people`) — everyone in the company, with role, status, open count, Follow-Through Rate. Team members read-only; admin actions column hidden.
- **Person scorecard** (`/people/[id]`) — per person: Follow-Through Rate for the open quarter, Kept / Missed counts, 12-week trend chart, open commitments, resolved-commitment history grouped by week (with missed reasons visible verbatim).
- **Person edit** (`/people/[id]/edit`, admin) — role, manager assignment (`reports_to`), status.
- **Privacy note on the scorecard** — self view: "Your numbers are visible to system admins, your company admins, and your direct manager. Admins and your direct manager can each keep private coaching notes about your development; every note is visible only to whoever wrote it, never to you." Other view: "This scorecard is visible to system admins, company admins, and their direct manager. They can see their own scorecard too."
- **Manager access:** direct manager (`profiles.reports_to`) can view and coach about their reports without being an admin.
- **People status toggle** (admin) — active/inactive; branded confirmation.

---

## 9. Chart (Org Chart of Functions)

The functional org chart. Distinct from the reporting hierarchy in `profiles.reports_to`.

- **Function nodes** — hierarchical (parent → child), each with title, description, and one seat holder (`leader_id`). Rendered on a pan-and-zoom canvas (react-zoom-pan-pinch): auto-fits the full tree to the viewport on load and on container resize, scroll-wheel or ±/fit-to-view buttons to zoom, drag on empty canvas to pan. Cards keep a fixed 220px minimum width so the tree stays legible at every zoom level.
- **LTD model** — Lead / Track / Decide are three responsibilities of the *one* seat holder, not three assignees (distinguishing simplification vs traditional EOS-style Accountability Chart).
- **Function roles** — beyond LTD, function nodes carry named leadership archetypes (Visionary, Integrator, etc.) via `function_roles` for the strategic top of the chart.
- **Function Outcomes** — the 2–4 short outcomes each function is "obsessed with delivering."
- **Success Measures** — per outcome. Each carries: description, target (optional if Success Tracking off; required if on), `value_type` (`number` / `percent` / `text`), `target_direction` (`higher_is_better` / `lower_is_better`), and `auto_track` (opt out of the weekly nudge for context measures like headcount).
- **AI metric-draft critique** (Success Tracking on) — when a leader adds or edits a metric on a function, a background Anthropic Haiku call (`src/lib/measures/critique.ts`, model `ANTHROPIC_CLARITY_MODEL`) scores three dimensions (description clarity, target quality, fit to the parent Success Measure) and renders as an amber coaching panel next to the form. Best-effort — the metric saves whether the critique lands or not. Users see labelled Metric / Target / Fit rows so they know which field to sharpen.
- **Weekly value entries** — `success_measure_entries` keyed on measure + week_ending Friday.
- Drag-to-reorder functions within a parent (admin-only) via `@dnd-kit/sortable`; drag handle on hover, opts out of pan via a `chart-no-pan` class so dnd-kit gets clean pointer events.
- **Delete function** — hard delete with a branded confirmation that spells out the cascade (sub-functions, outcomes, measures, and recorded values go with it).

*(The old `/scorecard` route redirects to `/chart`; scorecard functionality was consolidated in migration 0019.)*

---

## 10. Success Measures / Success Tracking

Feature-gated (`performance_tracking`). When on:

- **Batch entry page** (`/measures`, top-level nav "Success Measures") — one row per measure the caller owns: description, target, this-week input, mini trend of the last few weeks. Save-all in a single upsert. Blank rows are skipped (partial saves are fine).
- **Individual measure detail** (`/measures/[id]`) — full weekly history + edit surface for one measure.
- **Who sees what:** leaders see measures on functions they lead; system_admin + company_admin see every measure in the company (so they can cover for a leader who's out).
- **Weekly nudge cron** (Vercel cron, `0 15 * * 6` — Saturday 15:00 UTC) — for each `auto_track` measure that missed the current week's value, opens a commitment on the leader's board (description: "Log this week's value for '{measure title}'"). Timing is intentionally UTC-fixed so a single cron run covers every tenant regardless of company timezone.
- **AI target-quality check** — on measure creation, a background Anthropic Haiku call (`src/lib/measures/target-check.ts`, model `ANTHROPIC_CLARITY_MODEL`) validates that the target is specific and consistent with `value_type` + `target_direction`; if not, surfaces a coaching hint. Advisory — never blocks the save.
- **Dashboard pending card** — inline entry for measures that don't yet have a value for the current week.
- **Dashboard generative cards** — four coaching-tone insight cards (see Section 6).
- **Nothing is deleted or overwritten** — measures marked archived stay in history.

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
- **Privacy** (verified against migration 0021_coaching_platform.sql:53-55) — `coaching_conversations` SELECT is `created_by = auth.uid()`. **Every thread is private to its creator.** Another admin or the person's direct manager can create their own separate threads about the same person; each thread stays private to its author. The subject cannot see any coaching thread written about them. PrivacyNote on the thread list surface makes this explicit.

---

## 14. Ask Aimee (Personal Reflection AI)

Top-level nav item, always visible to any active member.

- Same coaching backend as coach threads; runs in `general` mode with no subject on file.
- **Privacy** — same RLS: private to the creator only. No admin, manager, or guide sees a user's Ask Aimee thread. The subtitle on `/ask-aimee` states this plainly ("Your Ask Aimee conversations are visible only to you.").
- **Classroom recommendations** — when Classroom is on for the company, Aimee has the `search_classroom` tool and will link a stable training URL when a user's question aligns with library content.
- **Company context is still injected** (purpose, values, focus areas) — Aimee is grounded in the company Q&A even in general mode. She's explicitly told not to invent per-person data in general mode.

---

## 15. Classroom (Shared Training Library)

Feature-gated (`classroom`). Content is authored centrally by system admins and shared across every enabled company — one library, many audiences.

- **Consumer surface** — `/classroom` landing (categories on top, lesson grid per category), `/classroom/lessons/[slug]` (lesson detail with ordered training list), `/classroom/trainings/[slug]` (video embed + rich text body + downloadable attachments). Slugs are stable — coaching references and shared links survive lesson re-orgs.
- **Video providers** — YouTube or Vimeo. Paste any share URL; the ID is parsed and the thumbnail cached at save time (YouTube via `img.youtube.com`, Vimeo via one oEmbed call).
- **Rich text body** — TipTap editor (StarterKit only). Editor runs client-side only on admin pages; consumer pages render server-side via `@tiptap/html`'s `generateHTML` so the editor bundle never ships to learners.
- **Attachments** — Supabase Storage private bucket `classroom-attachments`, 25 MB per file cap. Downloads via server-generated signed URLs (1-hour TTL) so the same publication + feature-flag gate applies.
- **Admin surface** — `/admin/classroom` (categories + lessons list, drag-free up/down move), `/admin/classroom/lessons/[id]/edit` (metadata + ordered trainings), `/admin/classroom/trainings/[id]/edit` (video URL, TipTap body, publish, attachments).
- **Draft / Published** — every lesson and training carries a `published` flag. Drafts are sysadmin-only; publishing pushes it live to every flag-enabled company.
- **Data model** — `classroom_categories`, `classroom_tags` (many-to-many on lessons), `classroom_lessons`, `classroom_trainings`, `classroom_attachments`. RLS: sysadmin full write; every other authenticated user gets read on `published = true` rows only if their company has the flag.
- **v1 gaps** — no completion tracking, no curriculum paths, no drag-and-drop reorder (up/down buttons only).

---

## 16. Admin & Ops

- **Companies list** (`/admin/companies`, cross-tenant) — table of every company for system admins, filtered to assignments for guides. Create company + timezone + industry + initial features; archive / reactivate; AiMS Guides admin panel (invite, assign, unassign, delete).
- **Company settings** (`/admin/companies/[id]`) — features toggle card, transcript sources + aliases (folded into one *Meeting transcripts* panel), Google Drive account connection.
  - Opening this page auto-scopes the caller into the company (middleware sets the scope cookie on the request + response so the top nav flips immediately AND subsequent clicks resolve to the correct company).
- **Meeting transcripts admin** (`/admin/transcripts`) — unrouted queue for the scoped company, with detail at `/admin/transcripts/meetings/[id]` for routing a single meeting to a specific tenant.
- **Classroom authoring** (`/admin/classroom`, sysadmin only) — see Section 15.
- **AiMS Guides admin** — system admins can add / assign / unassign guides. Guides have admin-like scope inside their assigned companies only.
- **Dashboard AI briefs** — cached per company with prompt-hash invalidation; `AiBrief` React component types out the reveal on first view of a fresh brief, then renders instantly on revisits (localStorage-tracked, respects `prefers-reduced-motion`).

---

## 17. Cross-cutting UX System

- **Left Sidebar** (`components/sidebar/Sidebar.tsx`) — fixed rail at 260px expanded, 68px collapsed (icons-only). Collapse state persists in an HTTP-only cookie (`nav-collapsed`) read server-side by the app layout so first paint matches the user's preference (no post-hydration jump). Nav items grouped as flat section headers (Disciplines, Resources, Strengths) rather than dropdowns — one click to any surface. Inline SVG icons per item; hover slides a chartreuse left-accent bar in with a subtle white-tint bg + icon color shift on a single 200ms `--ease-out` curve. Active item keeps the accent bar and a slightly stronger bg. Context pill under the logo reads "SYSTEM ADMIN · COMPANY NAME" (or "AIMS GUIDE · COMPANY NAME") when a cross-tenant role is scoped in. Footer holds the notification bell (opens upward via `placement="up"` on `NotificationBell` so the tray doesn't fall off the bottom of the screen) and the user pill (opens a popover upward with Profile / Exit company / Sign out). Below 768px the rail slides off-canvas and a hamburger in a slim top strip opens it as a drawer with a backdrop scrim. `NavBand.tsx` is retained in-tree for revert parity but no longer rendered; the notification tray's placement variant lives with the bell for reuse.
- **ConfirmDialog** (`components/ui/ConfirmDialog.tsx`) — branded replacement for native `window.confirm()`. Auto-focuses Cancel so a stray Enter can't fire destruction; Escape cancels; overlay click cancels; danger vs primary tone. Used everywhere destructive actions land — no `confirm()` or `alert()` remains in user-visible code paths.
- **PrivacyNote** (`components/ui/PrivacyNote.tsx`) — small, subtle line telling the user who can see the surrounding content. Three tones (private / managerial / shared). Placed on coaching surfaces, meeting analyses, and the personal scorecard.
- **Undo affordance on commitment resolves** — 6-second inline chip that reverses the state without needing to hunt for a reopen gesture.
- **Person quick-view drawer** (`/commitments`) — right-side portal-rendered drawer with follow-through stats + Coach jump + reassign, opens from any owner-name click on a commitment row.
- **Design tokens** (`brand/tokens.css`) — brand palette (navy/cobalt/sky/chartreuse + midnight/sand/white), functional accents, typography (Inter for headings + labels, Figtree for body), spacing scale, radii, motion. Consistent `.aims-prose`, `.aims-tabular`, `.aims-rule`.
- **Help widget** — every user-facing route has a corresponding markdown help doc under `docs/help/` served through `/api/help`, surfaced by a floating `?` widget. `npm run check:help` enforces coverage in CI.
- **Empty states** — every empty page carries teaching copy + a next-step link (e.g., foundation cards, plan cascade, /measures). No product tours, tooltips, or overlay onboarding — teaching happens inline via the empty states.

---

## 18. Non-Functional Characteristics

- **Auth:** Supabase Auth (email + password). Flows:
  - Sign-in at `/sign-in`.
  - Password change on `/profile`.
  - Forgot-password magic link at `/forgot-password`, verified at `/reset-password`.
  - Email invitation acceptance at `/accept-invite` (role assigned at invite time; user sets password on first login).
- **Isolation:** every table has RLS enabled + `force row level security`; company-scoped policies check both role and company match. Cross-tenant reads flow through `auth_profile()` and `company_has_feature()` helper functions.
- **Timezone:** per-company (`companies.timezone`). Week-ending Friday is computed in the company's local time. AI cron jobs run on a UTC schedule but resolve week boundaries per tenant.
- **AI providers:** Anthropic Claude across the app. **Nine distinct AI callers, three model tiers:**
  - **Sonnet 4.6** (`ANTHROPIC_SUMMARY_MODEL`, `ANTHROPIC_COACH_MODEL`, `ANTHROPIC_FACILITATION_MODEL` — all default to Sonnet 4.6):
    1. Meeting analyzer (summary markdown)
    2. Meeting commitment extractor (JSON, roster-validated)
    3. Meeting facilitation review (tool-use, structured)
    4. Coach chat (streaming, tool-use, cached)
    5. Ask Aimee (same as coach, general mode)
    6. Dashboard "Week in review" brief (cached per prompt-hash)
  - **Haiku 4.5** (`ANTHROPIC_CLARITY_MODEL`, default Haiku 4.5) — lightweight quality-check passes:
    7. Commitment clarity scoring (on every save)
    8. Success measure target validation (advisory)
    9. Metric-draft critique panel (Metric / Target / Fit dimensions)
  - Each caller instantiates its own `Anthropic` client with `ANTHROPIC_API_KEY`. Model IDs are env-var overridable.
- **Streaming:** SSE for coach chat + weekly brief. Tool-use loop on coach (max 4 iterations per turn).
- **Prompt caching:** coach chat is the only caller using `cache_control: { type: "ephemeral" }` in v1.
- **Storage:** Supabase Storage — private `classroom-attachments` bucket with server-signed URLs.
- **Email:** Resend (transactional) for meeting-analysis commitment digests to participants, and for auth invitations / password reset emails via Supabase.
- **External integrations:** Google Drive (OAuth per company, `0110_oauth_per_company`) for transcript ingest. No other external integrations.
- **Cron jobs (Vercel):**
  - `/api/cron/transcripts` — every 15 min, polls all active Google Drive sources, ingests + analyzes + emails.
  - `/api/cron/performance` — Saturdays 15:00 UTC, opens "Log this week's value" commitments for missed `auto_track` measures.
  - `/api/cron/scorecard` — Sundays 07:00 UTC, writes one `company_discipline_snapshots` row per (company, discipline) so the AiMS Scorecard sparklines + trajectory arrows have history. Current score is computed live; the snapshot is only for the trend line.
- **Middleware:** Supabase session refresh + `/admin/companies/[id]` auto-scope (mutates request cookies for the current render + response cookies for future navigations) + root-path routing (unauthenticated → marketing landing, authenticated → dashboard, cross-tenant roles → `/admin/companies`).
- **Idempotent seeds:** demo companies (e.g., Meridian Construction Group) rebuild in place; safe to rerun.
- **CI enforcement:** `npm run typecheck` (tsc), `npm run lint` (Next), `npm run test` (Vitest), `npm run check:help` (help doc coverage).
- **Design system:** custom CSS modules; brand palette (navy/cobalt/gradient primary); consistent card + button vocab; tabular numerics for metrics; `aims-rule` accent bars under key headings.

---

## 19. Explicit Non-Goals / Gaps

Things intentionally not built (yet):

- No native calendar integration.
- No push notifications, Slack, or mobile push. Transactional email is limited to (a) auth invitations & password reset, and (b) the per-meeting commitment digest to participants — no daily/weekly digests, no in-app notification centre.
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

## 20. Competitor Scoring Rubric

When evaluating a competitor, score them on:

1. **Strategic plan cascade** — SFA / Annual Goal / Quarterly Priority levels with progress roll-up?
2. **Weekly commitment tracking with a real Follow-Through Rate metric.**
3. **Commitment clarity scoring** — do they enforce timeline + observable outcome per commitment, and *AI-score* it automatically?
4. **Person-level follow-through history** with verbatim missed reasons.
5. **Functional org chart** with outcomes and success measures.
6. **Weekly success-measure tracking** with generative "gaining ground / wins / worth a conversation" insight cards.
7. **AI target & metric-quality coaching** — do they validate that a leader-authored target is specific and observable, and coach on the draft?
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

# AiM Higher (AiMS Execution Platform) — Product Build Spec

**One-liner:** Multi-tenant SaaS operating system for small-to-mid company leaders who run their business by the AiMS methodology — turns strategic plan → weekly commitments → follow-through data into one operating rhythm, layered with meeting-transcript intelligence, an AI coach, and a shared training library.

**Target customer:** Owner-led companies, $2M–$50M revenue, 10–150 employees. Bought by the CEO/owner or COO. Delivered through the AiMS advisor network.

**Stack signals:** Next.js 15 App Router (server components + server actions), Supabase (Postgres + auth + Storage + RLS), Anthropic Claude for AI. Multi-tenant on shared Postgres with row-level security. SSE streaming for chat + AI briefs.

**This document intentionally excludes the Strengths module and any strengths-related surfaces.**

---

## 1. Tenancy & Roles

- **Tenant** = Company. Everything below is company-scoped via RLS.
- **Roles:**
  - `system_admin` — vendor staff, cross-tenant scope; only role that can author Classroom content.
  - `company_admin` — owner/leaders, full write on their company.
  - `aims_guide` — external AiMS coach assigned to one or more companies; admin-like within assigned companies, no cross-tenant privileges beyond assignments.
  - `team_member` — read + self-write.
- **Scope-in (system_admin + aims_guide):** clicking a company on `/admin/companies` (or navigating to `/admin/companies/[id]`) auto-scopes them into that company via a signed cookie. Layout renders a persistent "SYSTEM ADMIN · COMPANY NAME" sub-band under the top nav with an *Exit company* affordance in the user menu.
- **Managers:** `profiles.reports_to` establishes a direct manager, unlocking manager-level affordances (e.g., coach *about* a direct report) without granting admin.
- **Invitations:** email invite flow with expiry; role assigned at invite time. Admins can pre-stage the roster (create as pending, send invite later).

---

## 2. Company Feature Flags

Per-tenant entitlements gate module visibility everywhere (nav, dashboards, coach tools). Set by system_admin on the company settings page.

| Flag | Turns on |
| --- | --- |
| `execution` | Core: commitments, plan cascade, chart, coaching, dashboard |
| `performance_tracking` (labelled **Success Tracking**) | Requires targets on every success measure; enables the weekly measure log page, the Saturday "log this week" nudge cron, and the four generative dashboard insight cards |
| `meeting_facilitation_review` | Second LLM pass on every ingested meeting scoring how the meeting was run against the AiMS Weekly Leadership Meeting framework; renders as a coaching-tone panel on the meeting detail page + a signal chip on the Leadership list |
| `classroom` | Adds the shared training library (top-level nav item, consumer surfaces at `/classroom`) + a `search_classroom` tool for Ask Aimee |

Feature strings are open-schema in the DB (no CHECK constraint) so new modules can ship without a migration.

---

## 3. Foundation Module (One-Page Plan)

The "why we exist, where we're going, and who we're going after" layer. Single-tenant per company. Everything is inline-edit-on-click with autosave chips.

- **Purpose** — statement + short elaboration.
- **Vision** — title + tagline + long-form body (3-year horizon).
- **Vision milestones** — dated waypoints on the way to the vision.
- **Core values** — titled + body, ordered, auto-append pattern.
- **Differentiators** — titled + body, ordered.
- **Marketing strategy** (rolled into Foundation, not a separate module) — positioning statement, executive summary, anchoring message, messaging pillars (named themes with a JSON language bank), and marketing snippets across 7 kinds: `short_hook`, `long_hook`, `website_copy`, `avoid`, `icp_best_fit`, `icp_psychographic`, `elevated_phrase`.
- **Ideal Client Avatar (ICA)** — demographics + psychographics + best-fit descriptions.
- **Key metrics** — company-level metrics (revenue, headcount, etc.) shown as one-liners.

All items reorderable, admin-writable. Consumed by the AI coach, meeting analyzer, and marketing surfaces. Every card has a first-run empty state that teaches ("Add the purpose statement to give the whole company a shared north star.").

---

## 4. Planning Cascade

Three-level strategic plan tied to quarters. Progressive add reveal — each level's "+ Add" only appears once the parent level exists, so a first-run admin can't build orphans by accident.

- **Strategic Focus Areas (SFAs)** — long-lived themes (often multi-year), sponsor assigned, sortable, archivable, future-perfect narrative body. Detail page hero: status + progress on their own row underneath identity metadata.
- **Annual Goals** — belong to an SFA (or orphan), owner assigned, per-year. Independent archive / *Mark complete* — an admin can close a Goal while its parent SFA stays open (common because SFAs span multiple years).
- **Quarterly Priorities** — belong to an Annual Goal (or orphan), owner assigned, per-quarter, status: `not_started` / `on_track` / `behind` / `complete` / `ongoing`.
- **Quarters** — start/end dates, status: `open` / `closed`, one open per company.
- Progress rolls up: priorities → goals → SFAs → company-level **Strategic Progress %**.
- **Start a new planning cycle** (formerly "Bulk Reset") — collapsed *danger zone* panel at the bottom of the plan page (admins only). Archives every active SFA / Goal / Priority in the company; nothing is deleted (records remain on file). Open commitments that were linked to now-archived priorities become Operational (their `priority_id` nulls out); resolved commitments keep their historical link so past-quarter priority progress stays intact.

---

## 5. Commitments (Weekly Rhythm)

The heart of the operating rhythm.

- Each commitment: owner, description, due_date, week_ending (Friday), optional priority link (strategic vs operational), status: `open` / `kept` / `missed`, missed_reason (verbatim text), source_meeting_id (nullable — set when created by transcript analysis).
- **Week ends Friday** — hardcoded assumption; commitments always belong to a Fri-ending week.
- **Follow-Through Rate** = kept / (kept + missed), computed across any window. Title-cased consistently across the app.
- **Language** — the UI calls resolved-late commitments **Missed** (used to say "Closed"; changed because "closed" reads as "finished" in everyday English).
- **Row layout** — resolve circle | clarity dot | description (+ From-meeting chip when transcript-sourced) | owner name | priority link | due date | status chip | delete (hover-revealed on the far right).
- **Resolve interaction (safety-hardened)** — 28px resolve circle at the left; single click marks Kept (on-time) or opens a "What happened?" reason strip (overdue). Immediately after a resolve, an inline "*Marked kept · Undo*" chip appears for 6 seconds so a misclick reverses in one gesture. Delete lives at the far right, hover-revealed, styled as a trash glyph — deliberately separated from the resolve circle so the two can't be confused.
- **Owner click → person quick-view drawer** — clicking any owner name opens a right-side slide-in drawer with the person's Follow-Through Rate this quarter, kept / missed / open counts, a *Coach about {name}* button (admins + managers), and a link to the full scorecard. Reassign lives inside the drawer under "Reassign this commitment" — one gesture deeper than before so an accidental click can't change ownership.
- **Full-width editor strips** for reschedule / close-with-reason / clarity review — direct grid children of the row so they span all columns and drop in as a clean sub-row below the row's cells.
- **Clarity scoring** — each commitment carries two boolean signals (`clarity_timeline`, `clarity_success`) + optional `clarity_note`. Rendered as a colored dot beside the resolve circle (green = both criteria met, amber = at least one not, muted = unassessed). Editor allows manual override; the analyzer also fills these in when a commitment is extracted from a transcript. The dot is 14px with a persistent border, click-to-edit, and the editor hides the refinement-note field when both criteria are already YES.
- **Priority linking** — searchable picker with a placeholder "Search priorities to link…". Frozen once a commitment resolves (linkage is a historical fact; changing it would silently rewrite priority progress history).
- **Reassign, reschedule** — inline editors on the row with reason capture on due-date changes.
- **Filter pills** at the top: All / Me / specific person + status + strategic vs operational. State lives in URL search params (shareable / back-button friendly).
- **Groups on the page:** *Needs attention* (past-week still-open items, red group title) pinned above *This week* (which has the always-live inline "add commitment" row). Prior weeks collapse into per-week summary rows.
- **"From meeting" chip** on rows extracted by the transcript analyzer. Admin-clickable → jumps back to the source meeting analysis.

---

## 6. Company Dashboard

Real-time single-page view for admins + members.

- **Hero band** (--grad-brand navy gradient) — company name, current quarter label, and a row of stat pills. Each pill: big value + label + short caption underneath naming what it measures. On admin: five stats — **Strategic Progress**, **Follow-Through Rate**, **On Track**, **Open This Week**, **Commitment Clarity**. Hover tooltip carries the fuller explanation; caption ensures the meaning is legible under projection without hover.
- **First-run Setup Checklist** (admin-only, empty-state) — a *Set up {company}* card at the top of the dashboard renders when foundation / roster / open quarter / plan are still incomplete. Four ordered steps auto-check as each prerequisite lands; the card stops rendering once everything is done.
- **Week in review** (admin-only, streamed) — AI brief summarising what's worth knowing right now. Streams via Suspense + a light typewriter reveal on first view of a fresh brief; instant on revisits. Cached with a prompt-hash so identical inputs don't regenerate.
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

## 7. People / Person Scorecard

- **Roster** (`/people`) — everyone in the company, with role, status, open count, Follow-Through Rate. Team members read-only; admin actions column hidden.
- **Person scorecard** (`/people/[id]`) — per person: Follow-Through Rate for the open quarter, Kept / Missed counts, 12-week trend chart, open commitments, resolved-commitment history grouped by week (with missed reasons visible verbatim).
- **Privacy note on the scorecard** — self view: "Your numbers are visible to system admins, your company admins, and your direct manager. Admins and your direct manager can each keep private coaching notes about your development; every note is visible only to whoever wrote it, never to you." Other view: "This scorecard is visible to system admins, company admins, and their direct manager. They can see their own scorecard too."
- **Manager access:** direct manager (`profiles.reports_to`) can view and coach about their reports without being an admin.
- **People status toggle** (admin) — active/inactive; branded confirmation.

---

## 8. Chart (Org Chart of Functions)

The functional org chart. Distinct from the reporting hierarchy in `profiles.reports_to`.

- **Function nodes** — hierarchical (parent → child), each with title, description, and one seat holder (`leader_id`).
- **LTD model** — Lead / Track / Decide are three responsibilities of the *one* seat holder, not three assignees (distinguishing simplification vs traditional EOS-style Accountability Chart).
- **Function Outcomes** — the 2–4 short outcomes each function is "obsessed with delivering."
- **Success Measures** — per outcome. Each carries: description, target (optional if Success Tracking off; required if on), `value_type` (`number` / `percent` / `text`), `target_direction` (`higher_is_better` / `lower_is_better`), and `auto_track` (opt out of the weekly nudge for context measures like headcount).
- **Weekly value entries** — `success_measure_entries` keyed on measure + week_ending Friday.
- Rendered as a real org-chart tree with connector lines; sibling boxes normalize to a common size.
- **Delete function** — hard delete with a branded confirmation that spells out the cascade (sub-functions, outcomes, measures, and recorded values go with it).

*(The old `/scorecard` route redirects to `/chart`; scorecard functionality was consolidated in migration 0019.)*

---

## 9. Success Measures / Success Tracking

Feature-gated (`performance_tracking`). When on:

- **Batch entry page** (`/measures`, top-level nav "Success Measures") — one row per measure the caller owns: description, target, this-week input, mini trend of the last few weeks. Save-all in a single upsert. Blank rows are skipped (partial saves are fine).
- **Who sees what:** leaders see measures on functions they lead; system_admin + company_admin see every measure in the company (so they can cover for a leader who's out).
- **Weekly nudge cron** (Saturdays) — for each `auto_track` measure that missed the current week's value, opens a commitment on the leader's board (description: "Log this week's value for '{measure title}'").
- **Dashboard pending card** — inline entry for measures that don't yet have a value for the current week.
- **Dashboard generative cards** — four coaching-tone insight cards (see Section 6).
- **Nothing is deleted or overwritten** — measures marked archived stay in history.

---

## 10. Meeting Analysis Pipeline

Ingest → analyse → extract commitments → optionally review facilitation, all from meeting transcripts dropped in a Google Drive folder.

- **Google Drive per company** (`transcript_sources`) — each company connects its own Google account via OAuth (`0110_oauth_per_company`), so folders can live under different Workspaces. Multiple folders per company. Statuses: `active` / `paused` / `revoked`.
- **Transcript aliases** (`transcript_aliases`) — case-insensitive substring on the filename that routes a meeting to a specific company when a shared folder serves multiple clients.
- **Unrouted queue** — meetings whose filename doesn't match any alias sit in an admin queue for manual routing (Assign, Route + analyze, Dismiss).
- **Ingest cron** (Vercel every 15 min) — polls each active source's folder, hashes file contents, avoids re-ingesting duplicates.
- **Two-call analysis pipeline** (`src/lib/transcripts/analyze.ts`) using Anthropic Claude:
  - **Call 1 — Analysis:** feeds the transcript + a `<company_context>` block (foundation, roster + AiMS coaches, open-quarter priorities) into the AiMS meeting-analyzer prompt. Output is a structured markdown write-up stored in `meeting_analyses.analysis_markdown`.
  - **Call 2 — Extraction:** JSON-strict extraction of commitments, validated against the roster + priority whitelist. Each extracted commitment includes clarity scoring (timeline + success criteria) + a refinement note when unclear. Due-date resolution rules: prefer stated over fallback ("ideally by X, worst case by Y" → X); handle day-of-week vs numerical date mismatch by preferring the number and flagging in clarity_note.
- **Commitments creation** — validated extractions become real `commitments` rows carrying `source_meeting_id` (renders as the *From meeting* chip on `/commitments`).
- **Leadership surface** (`/leadership`) — table of every ingested meeting for the scoped company (title, received date, status, Facilitation chip if the feature is on, View link). Rows show `pending` / `analyzing` / `complete` / `failed` — failed rows surface the error verbatim.
- **Meeting detail** (`/leadership/meetings/[id]`) — analysis markdown, list of commitments the meeting created, facilitation review (when feature on). PrivacyNote at the top: "Meeting analyses and facilitation reviews are visible to system admins, company admins, and AiMS Guides for this company only. Meeting participants don't see this page."

---

## 11. Meeting Facilitation Review

Feature-gated (`meeting_facilitation_review`) opt-in second LLM pass on every ingested meeting. Scores how the meeting was run against the AiMS Weekly Leadership Meeting framework + the 4Ws Solution Framework.

- **Prompt** — versioned on disk (`src/lib/leadership/facilitation/prompt.v1.md`). Includes explicit generative-tone guardrails: lead with what's working, depersonalize gaps, forward-looking recommendations, growth-edges not weaknesses.
- **Structured output** via Anthropic tool-use — `record_facilitation_review` tool with typed JSON schema; normalized against `FacilitationReview` type (`src/lib/leadership/facilitation/types.ts`) before persisting.
- **Storage** — JSONB column `meeting_analyses.facilitation_review_json` (migration 0119). Version-tagged so future breaking shape changes can be handled per-row.
- **Best-effort pipeline hook** — runs after the primary summary + extraction; failures never block the primary write.
- **UI panel** (`components/leadership/FacilitationReview.tsx`) on the meeting detail page:
  - Overall "Facilitation signal" (0–10) on a warm cobalt→chartreuse scale — never red.
  - Dimension chips: Agenda sections (X/5), Rhythm, Accountability, Alignment.
  - **What worked** first (green, prominent).
  - **Growth edges** grouped by dimension (amber, coaching-framed).
  - **What to try next week** — 3–5 forward-looking experiments.
  - **4Ws audit** — filled check for "landed", hollow circle for "worth a beat next time" (never ✗).
  - Handles `insufficient_transcript` gracefully.
- **List chip** on `/leadership` — compact Facilitation N/10 pill on complete rows, warm-scale coloured.

---

## 12. Coaching Module (AI)

Streaming AI coach modeled on the AiMS methodology.

- **Modes:**
  - `about` — leader/manager thinks through someone specific. Access: system_admin anywhere, company_admin within the subject's company, or the subject's direct manager. Self-coaching via `/coach/{me}` is redirected to Ask Aimee (self-mode is retired at the entry-point level).
- **Context kinds:** `execution` (default — commitments, keep rates, priorities, missed reasons). Other kinds gate on the corresponding company features.
- **Prompt selection** — system prompt in `prompts/leadership-coach.md`, prepended with a `GENERAL_MODE_PREAMBLE` in Ask Aimee mode.
- **Injected context per turn:** company block (purpose, values, differentiators), person block (role, keep rates across quarters, kept/missed counts, missed reasons *verbatim*, open + chronic commitments, plan items owned), coaching mode metadata.
- **Prompt caching:** static system prompt cached; dynamic context rides on the latest user message only.
- **Tool use:**
  - `get_strengths_profile` — *(strengths module, excluded from this spec)*
  - `search_classroom` (Classroom on) — queries lessons + trainings by keyword so Aimee can recommend a training in conversation. Returns matches with title, description, category, and a stable URL.
- **Streaming:** SSE to the client, error-tolerant (user message persists on API failure — retry path reuses it).
- **Auto-title:** after the first exchange, model generates a short conversation label.
- **Privacy** (verified against migration 0021_coaching_platform.sql:53-55) — `coaching_conversations` SELECT is `created_by = auth.uid()`. **Every thread is private to its creator.** Another admin or the person's direct manager can create their own separate threads about the same person; each thread stays private to its author. The subject cannot see any coaching thread written about them. PrivacyNote on the thread list surface makes this explicit.

---

## 13. Ask Aimee (Personal Reflection AI)

Top-level nav item, always visible to any active member.

- Same coaching backend as coach threads; runs in `general` mode with no subject on file.
- **Privacy** — same RLS: private to the creator only. No admin, manager, or guide sees a user's Ask Aimee thread. The subtitle on `/ask-aimee` states this plainly ("Your Ask Aimee conversations are visible only to you.").
- **Classroom recommendations** — when Classroom is on for the company, Aimee has the `search_classroom` tool and will link a stable training URL when a user's question aligns with library content.
- **Company context is still injected** (purpose, values, focus areas) — Aimee is grounded in the company Q&A even in general mode. She's explicitly told not to invent per-person data in general mode.

---

## 14. Classroom (Shared Training Library)

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

## 15. Admin & Ops

- **Companies list** (`/admin/companies`, cross-tenant) — table of every company for system admins, filtered to assignments for guides. Create company + timezone + initial features; archive / reactivate; AiMS Guides admin panel (invite, assign, unassign, delete).
- **Company settings** (`/admin/companies/[id]`) — features toggle card, transcript sources + aliases (folded into one *Meeting transcripts* panel), Google Drive account connection.
  - Opening this page auto-scopes the caller into the company (middleware sets the scope cookie on the request + response so the top nav flips immediately AND subsequent clicks resolve to the correct company).
- **Classroom authoring** (`/admin/classroom`, sysadmin only) — see Section 14.
- **AiMS Guides admin** — system admins can add / assign / unassign guides. Guides have admin-like scope inside their assigned companies only.
- **Dashboard AI briefs** — cached per company with prompt-hash invalidation; `AiBrief` React component types out the reveal on first view of a fresh brief, then renders instantly on revisits (localStorage-tracked, respects `prefers-reduced-motion`).

---

## 16. Cross-cutting UX System

- **Top NavBand** (`components/nav-band/NavBand.tsx`) — sticky, gradient (--grad-brand), primary items on top row + optional dropdown groups (Company ▾ contains One-Page Plan, Plan, Chart, Commitments, People, Leadership, Success Measures — the last two feature-gated). A soft box-shadow fades in only after the band detaches from the top edge (IntersectionObserver on a zero-height sentinel — no scroll listener). Sub-band under it reads "SYSTEM ADMIN · COMPANY NAME" when a cross-tenant role is scoped in.
- **ConfirmDialog** (`components/ui/ConfirmDialog.tsx`) — branded replacement for native `window.confirm()`. Auto-focuses Cancel so a stray Enter can't fire destruction; Escape cancels; overlay click cancels; danger vs primary tone. Used everywhere destructive actions land — no `confirm()` or `alert()` remains in user-visible code paths.
- **PrivacyNote** (`components/ui/PrivacyNote.tsx`) — small, subtle line telling the user who can see the surrounding content. Three tones (private / managerial / shared). Placed on coaching surfaces, meeting analyses, and the personal scorecard.
- **Undo affordance on commitment resolves** — 6-second inline chip that reverses the state without needing to hunt for a reopen gesture.
- **Person quick-view drawer** (`/commitments`) — right-side portal-rendered drawer with follow-through stats + Coach jump + reassign, opens from any owner-name click on a commitment row.
- **Design tokens** (`brand/tokens.css`) — brand palette (navy/cobalt/sky/chartreuse + midnight/sand/white), functional accents, typography (Inter for headings + labels, Figtree for body), spacing scale, radii, motion. Consistent `.aims-prose`, `.aims-tabular`, `.aims-rule`.
- **Empty states** — every empty page carries teaching copy + a next-step link (e.g., foundation cards, plan cascade, /measures).

---

## 17. Non-Functional Characteristics

- **Auth:** Supabase Auth (email + password). Password change flow on `/profile`.
- **Isolation:** every table has RLS enabled + `force row level security`; company-scoped policies check both role and company match. Cross-tenant reads flow through `auth_profile()` and `company_has_feature()` helper functions.
- **Timezone:** per-company (`companies.timezone`). Week-ending Friday is computed in the company's local time.
- **AI providers:** Anthropic Claude across the app (meeting analyzer, commitment extraction, meeting facilitation review, coach chat, dashboard brief, measure target check, commitment clarity check). Each caller instantiates its own `Anthropic` client with `ANTHROPIC_API_KEY`. Model IDs per site, overridable via env (`ANTHROPIC_SUMMARY_MODEL`, `ANTHROPIC_FACILITATION_MODEL`, etc.).
- **Streaming:** SSE for coach chat + weekly brief. Tool-use loop on coach.
- **Storage:** Supabase Storage — private `classroom-attachments` bucket with server-signed URLs.
- **External integrations:** Google Drive (OAuth per company) for transcript ingest. No other external integrations.
- **Middleware:** Supabase session refresh + `/admin/companies/[id]` auto-scope (mutates request cookies for the current render + response cookies for future navigations).
- **Idempotent seeds:** demo companies (e.g., Meridian Construction Group) rebuild in place; safe to rerun.
- **Help system:** every user-facing route has a corresponding markdown help doc under `docs/help/`, surfaced by a floating `?` widget. `npm run check:help` enforces coverage in CI.
- **Design system:** custom CSS modules; brand palette (navy/cobalt/gradient primary); consistent card + button vocab; tabular numerics for metrics; `aims-rule` accent bars under key headings.

---

## 18. Explicit Non-Goals / Gaps

Things intentionally not built (yet):

- No native calendar integration.
- No push notifications (Slack, mobile push). Email is used only for invitations.
- No mobile apps (responsive web only).
- No CSV / Excel import (seed scripts only).
- No external integrations beyond Google Drive (no HRIS, Notion, Salesforce, QBO).
- No public / customer-facing portal.
- No time tracking, PTO, or performance-review workflows.
- No survey engine.
- No white-label / customer branding.
- **Classroom v1:** no completion tracking, no curriculum / prerequisite paths, no drag-and-drop reordering.
- **Coach memory:** not compressed across conversations — capped at last 200 messages per thread.
- **Meeting re-analyze:** no in-app "re-run this transcript through the current prompt" button; edits to the analyzer prompt only affect future ingests.

---

## 19. Competitor Scoring Rubric

When evaluating a competitor, score them on:

1. **Strategic plan cascade** — SFA / Annual Goal / Quarterly Priority levels with progress roll-up?
2. **Weekly commitment tracking with a real Follow-Through Rate metric.**
3. **Commitment clarity scoring** — do they enforce timeline + observable outcome per commitment?
4. **Person-level follow-through history** with verbatim missed reasons.
5. **Functional org chart** with outcomes and success measures.
6. **Weekly success-measure tracking** with generative "gaining ground / wins / worth a conversation" insight cards.
7. **Meeting transcript ingest** with automatic commitment extraction into the plan cascade.
8. **AI facilitation review** grounded in a specific meeting-facilitation framework (not generic sentiment).
9. **AI coach grounded in real execution data**, with tool use — not generic chat.
10. **Shared training library** with per-tenant entitlement and stable content URLs the AI can recommend.
11. **Manager-of-a-report affordances** — not just admin / member binary.
12. **Multi-tenant with per-tenant feature entitlements.**
13. **External coaching role** (AiMS Guides / consultants) with cross-company scope without admin.
14. **Row-level security posture** — multi-tenant on shared DB.
15. **Real-time streaming** UX for AI features.

# AiM Higher (AiMS Execution Platform) — Product Build Spec

**One-liner:** Multi-tenant SaaS operating system for small-to-mid company leaders who run their business by the "AiMS" methodology — turns strategic plan → weekly commitments → follow-through data into one operating rhythm, layered with an AI coach and a strengths assessment.

**Target customer:** Owner-led companies, $2M–$50M revenue, 10–150 employees. Bought by the CEO/owner or COO. Delivered through the AiMS advisor network.

**Stack signals:** Next.js App Router (server components + server actions), Supabase (Postgres + auth + RLS), Anthropic Claude for AI. Multi-tenant on shared Postgres with row-level security. Real-time streaming for chat.

---

## 1. Tenancy & Roles

- **Tenant** = Company. Everything below is company-scoped via RLS.
- **Roles:** `system_admin` (vendor staff, cross-tenant scope), `company_admin` (owner/leaders, full write on their company), `team_member` (read + self-write).
- **System admin scope-in:** admins can "scope into" a company to see/edit as if inside it (with visible banner + "exit company" affordance).
- **Managers:** `profiles.reports_to` establishes a direct manager, which unlocks manager-level affordances (e.g., coach about a direct report) without granting admin.
- **Invitations:** email invite flow with expiry; role assigned at invite time.

---

## 2. Foundation Module

The "why we exist and where we're going" layer. Single-tenant per company.

- **Purpose statement** (why we exist) + **purpose context** (short elaboration).
- **Vision** — title + tagline + long-form body (3-year horizon).
- **Vision milestones** — dated waypoints on the way to the vision (e.g., end-of-2027, end-of-2028).
- **Core values** — titled + body, ordered.
- **Differentiators** — titled + body, ordered.

All items reorderable, admin-writable. Consumed by the AI coach and marketing modules.

---

## 3. Marketing Strategy Module

Positioning + messaging assets, one per company.

- **Positioning statement, executive summary, anchoring message**.
- **Messaging pillars** — named themes with a message and a JSON "language bank" for copy variants.
- **Marketing snippets** — 7 kinds: `short_hook`, `long_hook`, `website_copy`, `avoid` (words/phrases to never use), `icp_best_fit` (target client segments), `icp_psychographic` (target client mindsets), `elevated_phrase`.

Content is manually authored — no AI generation on this surface yet.

---

## 4. Planning Cascade

Three-level strategic plan tied to quarters.

- **Strategic Focus Areas (SFAs)** — long-lived themes, sponsor assigned, sortable, archivable, future-perfect narrative body.
- **Annual Goals** — belong to an SFA (or orphan), owner assigned, per-year.
- **Quarterly Priorities** — belong to an Annual Goal (or orphan), owner assigned, per-quarter, status: `on_track` / `at_risk` / `off_track` / `behind` / `complete` / `paused`.
- **Quarters** — start/end dates, status: `open` / `closed`, one open per company.
- Progress rolls up: priorities → goals → SFAs → company-level "Strategic Progress %".

---

## 5. Commitments (Weekly Rhythm)

The heart of the operating rhythm.

- Each commitment: owner, description, due_date, week_ending (Friday), optional priority link (strategic vs operational), status: `open` / `kept` / `missed`, missed_reason (verbatim text).
- **Week ends Friday** — hardcoded assumption.
- **"Follow-Through Rate"** = kept / (kept + missed), computed across any window.
- Commitments page shows: needs-attention (open + overdue), this week, prior weeks (grouped, with per-week keep rates).
- Bulk actions: add multiple, reset to open, mark kept/missed.
- Optional priority link means the same commitment tracks both strategic execution and operational follow-through.

---

## 6. Company Dashboard

Real-time single-page view for admins + members.

- **Headline stats:** Strategic Progress % (SFA average), Follow-Through Rate (quarter), On Track priority count, Open commitments this week.
- **Strategic Focus Areas** — status + progress bar per SFA.
- **Follow-Through Rate Trend** — 12-week keep-rate bar chart.
- **People table** — "Where to lend support" — sorted by keep rate ascending, with per-person open count and rate. Admin + managers can jump to Coach for people they're allowed to coach.
- **Recent Wins** (admin-only) — 5 most recent kept commitments this quarter.
- **Weekly Brief** (admin-only, AI-generated) — streamed narrative summary of the week for company_admins.

---

## 7. People / Person Scorecard

- **Roster** — everyone in the company, with role, status, open count, follow-through rate.
- **Person scorecard** — per person: quarter keep rate, kept/missed counts, 12-week trend, open commitments, resolved-commitment history grouped by week (with missed reasons visible).
- **Manager access:** direct manager can view + coach about their reports even without admin.
- **People status toggle** (admin) — active/inactive.

---

## 8. Functional Scorecard

Not the same as the person scorecard — this is KPI tracking by functional area (Finance, Ops, etc.).

- **Functional Areas** — named containers per company.
- **Scorecard Metrics** — description, target, value type (`number` / `percent` / `text`).
- **Scorecard Entries** — weekly values per metric.
- Displays as a grid: areas × weeks, with entries.

---

## 9. Chart (Org Chart of Functions)

The functional org chart. Distinct from the reporting hierarchy in `profiles.reports_to`.

- **Function nodes** — hierarchical (parent → child), each with title, description, and one seat holder.
- **LTD model** — Lead / Track / Decide are treated as three responsibilities of the *one* seat holder, not three assignees. (A distinguishing simplification vs traditional EOS-style Accountability Chart.)
- **Function Outcomes** — the 2–4 short outcomes each function is "obsessed with delivering."
- **Success Measures** — per outcome, with target and weekly value entries (same shape as scorecard entries).
- Rendered as a real org-chart tree with connector lines; sibling boxes normalize to a common size.

---

## 10. Strengths Module (Per-Company Entitlement)

A completable assessment + interpretation layer, gated by feature flag.

- **Assessment:** conversational format, backed by narrative messages the user writes about themselves. Model interprets → structured profile.
- **Framework:** 4 dimensions (Thinking, Influence, Execution, Relating), each with 4 sub-strengths → 16 total. Each sub-strength scored on **competence** (1–5) and **energy** (1–5) separately.
- **Flags per sub-strength:** `signature` (high on both), `capable_but_draining` (high competence, low energy — burnout risk), `hidden_pull` (low competence, high energy — growth zone), `neutral`.
- **Results view** — dimension charts, sub-strength cards with narrative evidence, "worth exploring" divergences.
- **Orientation** — direct / balanced / facilitative lean.
- **People strengths overlay** — roster view showing top strengths + dimension energy per person for admins.
- **Teams** — create teams, add members, AI-generated team insights (composition, gaps, dynamics), advisor recommendations.
- **Coaching link** — strengths results feed the AI coach when strengths-context conversations are opened.

---

## 11. Coaching Module (AI)

Streaming AI coach modeled on the AiMS methodology.

- **Modes:** `self` (person coaches themselves) and `about` (leader/manager thinks through someone else). Persisted per conversation.
- **Context kinds:** `execution` (default — commitments, keep rates, priorities, missed reasons) and `strengths` (adds the strengths profile as overlay). Feature-gated.
- **Who can start what:** self-coach open to any active member; coach-about requires admin OR the subject's direct manager.
- **Prompt selection** — three system prompt files: leadership-coach, self-coach, strengths-self-coach.
- **Injected context per turn:** company block (purpose, values, differentiators), person block (role, keep rates across quarters, kept/missed/carried counts, missed reasons *verbatim*, open + chronic commitments, plan items owned), optional strengths block, coaching mode metadata.
- **Prompt caching:** static system prompt cached; dynamic context rides on the latest user message only.
- **Tool use:** model can call server-side tools to fetch deeper execution/strengths data mid-conversation (e.g., historical detail).
- **Streaming:** SSE to the client, error-tolerant (user message persists even on API failure — retry path reuses it).
- **Auto title:** after the first exchange, model generates a 4-word conversation label.
- **Privacy:** RLS restricts coaching_conversations and coaching_messages to the creator — even the company admin can't read a team member's self-coach thread.

---

## 12. Admin & Ops

- **Companies list** (system_admin) — create/edit companies, timezone, status.
- **Company features** — per-tenant feature flags (currently used for `strengths` entitlement).
- **Invitations** — invite + pending list per company.
- **Dashboard AI Briefs** — cached briefs with prompt-hash invalidation so identical inputs don't re-generate.

---

## 13. Non-Functional Characteristics

- **Auth:** Supabase Auth (email + password). Password change flow on `/profile`.
- **Isolation:** every table has RLS enforced; company-scoped policies check both role and company match. Force RLS on all sensitive tables.
- **Timezone:** per-company (defaults to America/Anchorage in schema, seed uses America/Boise).
- **Idempotent seeds:** demo companies (Meridian Construction Group) rebuild in place; safe to rerun.
- **Streaming:** SSE for coach + weekly brief.
- **Design system:** custom CSS variables, brand palette (navy/cobalt/gradient primary), consistent card + button vocab, tabular numerics for metrics, `aims-rule` accent bars.

---

## 14. Explicit Non-Goals / Gaps (useful for competitor scoring)

Things intentionally not built (yet) — competitors may or may not have these:

- No native calendar integration.
- No native email/Slack notifications (all in-app).
- No mobile apps (responsive web only).
- No CSV/Excel import for people, priorities, or commitments (seed scripts only).
- No external integrations (HRIS, Google, Notion, Salesforce, QBO).
- No file/document storage.
- No public/customer-facing portal.
- No time tracking, no PTO, no reviews/performance management.
- No survey engine beyond the strengths assessment.
- No white-label / customer branding.
- Coach memory across conversations is not compressed — capped at last 200 messages per thread.

---

## 15. Competitor Scoring Rubric (suggested categories)

When evaluating a competitor, score them on:

1. **Strategic plan cascade** — do they have SFA / Annual Goal / Quarterly Priority levels? Progress roll-up?
2. **Weekly commitment tracking with a real keep-rate metric.**
3. **Person-level follow-through history** (with verbatim missed reasons).
4. **Functional org chart** with outcomes and success measures.
5. **Strengths assessment integrated with execution data.**
6. **AI coach grounded in real execution data**, not generic chat.
7. **Manager-of-a-report affordances** (not just admin/member binary).
8. **Multi-tenant with per-tenant feature entitlements.**
9. **Real-time streaming** UX for AI features.
10. **Row-level security posture** (multi-tenant on shared DB).

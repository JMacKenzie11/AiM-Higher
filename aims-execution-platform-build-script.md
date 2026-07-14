# AiMS Execution Platform — Build Script for Claude Code

Working title: **AiMS Execution Platform** (rename is a find-and-replace; nothing below depends on the name).

This document is the complete specification. Follow it literally. Where a composition is prescribed element by element, build exactly that composition. Do not invent alternative layouts, color treatments, or component styles. Where something is genuinely unspecified, choose the simplest option consistent with the conventions here and leave a `// ASSUMPTION:` comment at the decision point.

---

## 1. Product intent (context, read once)

The AiMS Institute helps SMB leadership teams execute strategy through a cascade: **Strategic Focus Areas (3-year big hills) → Annual Goals (completable in under 12 months) → 90-Day Priorities (belong to a quarter) → Weekly Commitments**. Clients currently run this in spreadsheets. This app replaces the spreadsheet with a multi-company platform that preserves full history, runs the weekly accountability rhythm, and shows execution health at the company and person level.

Two principles shape every decision:

1. **The weekly rhythm is the heartbeat.** Commitments are made for a week, reviewed the next week, and every record is preserved forever. Longitudinal data is the product's core value.
2. **Flexibility for execution maturity.** Annual Goals may exist without a parent SFA. Priorities may exist without a parent Annual Goal. Commitments MUST have a parent Priority. Parents can be attached later.

---

## 2. Stack and conventions

- **Next.js (App Router)**, TypeScript, deployed on Vercel.
- **Supabase**: Auth (email + password) and Postgres with Row Level Security.
- **Standalone project.** New repo, new Supabase project. Do not connect to any existing app. However, follow the same schema conventions as the AiMS Strengths Assessment: `uuid` primary keys with `gen_random_uuid()`, `created_at timestamptz default now()`, `updated_at timestamptz` maintained by trigger, snake_case names, soft ownership via `company_id` foreign keys, and every table protected by RLS.
- **Every authorization rule is enforced twice**: in the route/server action AND in RLS policies. Never rely on the UI alone.
- No email provider integration yet. Use Supabase built-in email for invitations and password reset. Structure the invite code so a Resend swap later touches one module.
- No AI features in v1. Design the schema so longitudinal queries are easy (RelayHub and automation layers will consume this data via a future API).
- Styling: plain CSS Modules or a single global stylesheet consuming CSS custom properties from `brand/tokens.css`. If Tailwind is used, it must be configured to reference the token variables; never hardcode hex values either way.

### Environment variables

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=        # server only: seed script, invitations, admin ops
NEXT_PUBLIC_APP_URL=
```

---

## 3. Branding (mandatory on every screen)

The repo will contain `brand/tokens.css`, `brand/assets/logo-navy.png`, and `brand/assets/logo-white.png` copied from the AiMS branding system. Import `tokens.css` once at the app root and use only its custom properties.

### Rules (follow on every screen: dashboards, forms, tables, admin views)

- **Fonts**: load Inter (400, 500, 600, 700, 800) and Figtree (300, 400, 500, 600) from Google Fonts. Inter (`--font-sans`) for headings, ALL-CAPS labels, buttons, and stat/numeric displays. Figtree (`--font-body`) for body copy, descriptions, nav, table text, and form values. No other fonts.
- **Color**: `--aims-sand` (#F7F7F2) app background; `--aims-white` cards. `--aims-navy` (#1F3352) headings and logo. `--aims-midnight` (#11151A) body text. `--aims-cobalt` (#3551A4) is THE interactive color: primary buttons, links, active nav, focus. `--aims-sky` (#8CC4DF) secondary fills and chart series 2. `--aims-chartreuse` (#D6E264) accent only: tapered underlines, highlights, small markers, and the hero CTA on gradient surfaces. Never chartreuse as large background, button fill on light surfaces, or text color on light backgrounds. Functional colors (`--aims-success/warning/danger`) sparingly, mostly as tints with dark text.
- **The signature surface**: `--grad-brand` (navy → cobalt, 135deg) for the top nav band, page heroes, and empty states. It is the ONLY permitted gradient.
- **Glass on dark**: on gradient/dark surfaces, cards use `background: var(--glass-bg); border: 1px solid var(--glass-border); backdrop-filter: blur(var(--glass-blur)); border-radius: 16px`. Content cards overlap the hero band bottom with negative margin so pages feel layered.
- **Cards on light**: white, 10–12px radius, 1px `--border`, `--shadow-sm` at rest, `--shadow-md` + `translateY(-2px)` on hover.
- **Typography scale**: headlines Inter Bold, Title Case, `--text-heading`, line-height 1.3. Subheads/labels Inter Bold 11px ALL CAPS `letter-spacing: .15em`. Body Figtree 400, 14px, line-height 1.6. Stats use `--text-stat` (800, 40px, tabular-nums). Nothing below 12px.
- **Signature accent**: a short 3px rounded chartreuse bar under key page headings (wider at left, tapering).
- **Buttons**: pill radius. Primary = cobalt fill, white text on light surfaces. On gradient/dark surfaces the hero CTA is chartreuse fill + navy text with `--shadow-cta` glow. Secondary = navy 1.5px outline (white outline on dark). Ghost = text-only cobalt. Heights 28/34/42px. Hover darkens and lifts.
- **Inputs**: white, 1px `--border`, 6px radius, 34px height; focus = cobalt border + 3px `--focus-ring` halo. Labels use subhead style. Errors: danger border + 12px danger message below, non-blaming copy.
- **Tables**: compact; header row subhead style in `--text-muted`; 1px row hairlines; row hover `--aims-navy-tint`; numeric cells right-aligned with tabular-nums.
- **Charts**: `--chart-1..4` in order (cobalt, sky, chartreuse, navy). Rounded bar ends. Fill/dash animates once on load (`--duration-slow`, ease-out). No gridline clutter; label directly where possible.
- **Motion**: hover lifts and one-time load fills only. No bouncing, no continuous animation.
- **Nav**: top bar uses the brand gradient with the white logo (matches the established Strengths Assessment pattern): logo left, nav links right in white, active link full opacity with others at 80%.
- **Voice in UI copy**: positive and affirming, simple, punchy. Buttons are verbs ("Add Commitment", "Save Changes"). Celebrate progress; never scold. Errors say what happened and how to fix it.
- **Never**: decorative blob/bubble backgrounds, gradients other than `--grad-brand`, emoji in UI, pure black, sharp corners on interactive elements, chartreuse body text.
- **Name usage**: "the AiMS Institute" formal, "AiMS" short. Always capital A, lowercase i, capital MS.

### The quality bar

The sign-in page of the Strengths Assessment is the established quality bar: full-viewport `--grad-brand` background, AiMS white logo centered at top, display headline in white (`--text-display`), short chartreuse rule beneath it, one-line subtitle in white at 70% opacity, centered glass card containing the form, chartreuse pill CTA with glow, ghost "Forgot password?" link below the card. Reproduce this exact composition for this app's sign-in (headline copy in Section 8).

---

## 4. Data model

Run as Supabase migrations in this order. All tables get: `id uuid primary key default gen_random_uuid()`, `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` (trigger-maintained). Add sensible indexes on every foreign key and on the lookup columns named below.

### 4.1 Identity and tenancy

```sql
-- companies
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- profiles (1:1 with auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references companies(id),
  full_name text not null,
  position text,                      -- job title, e.g. "Project Manager"
  role text not null default 'team_member'
    check (role in ('system_admin','company_admin','team_member')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Rules: `system_admin` has `company_id` null and full access across companies. `company_admin` and `team_member` always have a `company_id`. A user belongs to exactly one company. Role changes are protected in BOTH the route layer and RLS: a company_admin may not grant system_admin, may not change their own role, and a team_member may not change any role or company assignment (mirror the role-protection pattern from the Strengths Assessment).

```sql
-- invitations
create table invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  email text not null,
  full_name text not null,
  position text,
  role text not null default 'team_member' check (role in ('company_admin','team_member')),
  invited_by uuid not null references profiles(id),
  token uuid not null default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on invitations (company_id, email) where status = 'pending';
```

### 4.2 Quarters

```sql
create table quarters (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  label text not null,                 -- "Q3 2026"
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index on quarters (company_id, label);
```

Only company_admin or system_admin may create, open, or close a quarter. At most one open quarter per company: enforce with a partial unique index `create unique index one_open_quarter on quarters (company_id) where status = 'open';`. Closing a quarter does not modify its priorities or commitments; it freezes history and removes the quarter from "current" pickers.

### 4.3 The goal cascade

```sql
-- statuses shared by SFAs, goals, priorities
-- 'not_started' | 'on_track' | 'behind' | 'complete' | 'ongoing'

create table strategic_focus_areas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  title text not null,
  description text,                    -- future-perfect narrative
  sponsor_id uuid references profiles(id),   -- the accountable owner
  status text not null default 'not_started'
    check (status in ('not_started','on_track','behind','complete','ongoing')),
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table annual_goals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  sfa_id uuid references strategic_focus_areas(id),   -- NULLABLE by design
  title text not null,
  description text,
  owner_id uuid references profiles(id),
  target_date date,                    -- must be within 12 months of creation; validate in app layer with a warning, not a hard block
  status text not null default 'not_started'
    check (status in ('not_started','on_track','behind','complete','ongoing')),
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table priorities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  annual_goal_id uuid references annual_goals(id),    -- NULLABLE by design
  quarter_id uuid not null references quarters(id),   -- REQUIRED
  title text not null,
  description text,
  owner_id uuid references profiles(id),
  due_date date,
  status text not null default 'not_started'
    check (status in ('not_started','on_track','behind','complete','ongoing')),
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 4.4 Commitments (the heartbeat)

```sql
create table commitments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  priority_id uuid not null references priorities(id),   -- REQUIRED parent
  owner_id uuid not null references profiles(id),
  description text not null,
  week_ending date not null,           -- the Friday of the week this commitment belongs to
  due_date date not null,              -- defaults to week_ending; owner may set earlier
  status text not null default 'open'
    check (status in ('open','kept','missed','carried')),
  completed_at timestamptz,
  missed_reason text,                  -- REQUIRED when status = 'missed' (enforce in app layer and with a check)
  carried_from_id uuid references commitments(id),  -- set on the NEW commitment created by a carry
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint missed_needs_reason check (status <> 'missed' or missed_reason is not null)
);
create index on commitments (company_id, week_ending);
create index on commitments (owner_id, week_ending);
```

Semantics, enforced in server actions:

- **Kept**: marked complete with `completed_at::date <= due_date`. Set `status = 'kept'`.
- If marked complete AFTER the due date, set `status = 'missed'`, record `completed_at` anyway, and require a `missed_reason`. The UI copy for this state is "Completed late" (a missed commitment that still got done). The keep-rate math treats it as missed; the item detail shows it was ultimately finished.
- **Missed**: not done. `missed_reason` required. The weekly review flow cannot resolve a commitment as missed without a reason.
- **Carried**: carrying forward closes the original with `status = 'carried'` and inserts a NEW commitment in the next week (`week_ending + 7 days`, same priority, same owner, same description unless edited) with `carried_from_id` pointing back. History is never rewritten.
- Commitments are never hard-deleted once their week has ended. Open commitments in the current week may be deleted by their owner or a company_admin.

**Keep rate** (used everywhere): `kept / (kept + missed)` over resolved commitments in the window. `carried` and `open` are excluded from the denominator. Track carry count separately; chronic carrying is its own signal.

### 4.5 Derived progress (no stored percentages)

Percent progress is always computed, never stored. Compute in SQL views or server-side helpers:

- **Priority percent** = `kept / (kept + open + missed)` across its commitments, excluding `carried` rows (the carried copy in the later week counts instead). A priority with `status = 'complete'` reports 100 regardless. A priority with no commitments reports null and the UI shows its status chip only, with a muted "No commitments yet" note.
- **Annual Goal percent** = mean of its non-archived priorities' percents (complete priorities count as 100; priorities with null percent are excluded from the mean). A goal with `status = 'complete'` reports 100. No priorities → null.
- **SFA percent** = mean of its non-archived goals' percents, same null handling. `status = 'complete'` → 100.

Create a Postgres view `priority_progress` and build goal/SFA rollups on top of it so the dashboard reads from one place. Leave a comment noting this v1 math is intentionally simple and will be refined.

### 4.6 Company foundation

Fixed five sections. All company members read; company_admin and system_admin write.

```sql
-- Simple singleton fields per company
create table company_foundation (
  company_id uuid primary key references companies(id),
  purpose_statement text,
  purpose_context text,                -- the framing paragraph above the statement
  vision_title text,                   -- e.g. "Vision 2035: Powering Alaska's Future..."
  vision_tagline text,                 -- e.g. "big enough to lead, yet small enough to care"
  vision_body text,                    -- narrative paragraphs
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Repeating items: core values, vision milestones, differentiators
create table foundation_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  kind text not null check (kind in ('core_value','vision_milestone','differentiator')),
  title text not null,                 -- "We Deliver on Our Promises" / "Tripled in Size" / "Unmatched Adaptability"
  body text,                           -- the supporting paragraph
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 4.7 Marketing strategy (structured, queryable)

```sql
create table marketing_strategy (
  company_id uuid primary key references companies(id),
  positioning_statement text,          -- the final anchor statement
  executive_summary text,
  anchoring_message text,              -- the "trusted to carry complex work..." paragraph
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table messaging_pillars (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null,                  -- "We Make Complex Infrastructure Work Easier"
  message text,                        -- the core message paragraph
  language_bank jsonb not null default '[]',   -- array of strings: phrases to use verbatim
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table marketing_snippets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  kind text not null check (kind in ('short_hook','long_hook','website_copy','avoid','icp_best_fit','icp_psychographic','elevated_phrase')),
  content text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

This keeps the ICP, hooks, and pillar language individually queryable for RelayHub later without over-modeling.

### 4.8 Functional scorecard

```sql
create table functional_areas (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  name text not null,                  -- "Sales & Marketing"
  accountable_id uuid references profiles(id),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table scorecard_metrics (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  functional_area_id uuid not null references functional_areas(id),
  name text not null,                  -- "# of bids submitted"
  target text,                         -- free text: "Zero", "100%", "5"
  value_type text not null default 'number' check (value_type in ('number','percent','text')),
  sort_order int not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table scorecard_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  metric_id uuid not null references scorecard_metrics(id),
  week_ending date not null,
  value_number numeric,
  value_text text,
  entered_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (metric_id, week_ending)
);
```

---

## 5. Row Level Security

Enable RLS on every table. Use a `security definer` helper to avoid recursive policy lookups:

```sql
create or replace function auth_profile()
returns table (uid uuid, company_id uuid, role text)
language sql security definer stable as $$
  select id, company_id, role from profiles where id = auth.uid()
$$;
```

Policy matrix (implement literally; every table gets its four policies):

| Table | select | insert | update | delete |
|---|---|---|---|---|
| companies | system_admin: all. others: own company | system_admin | system_admin | system_admin (archive only in UI) |
| profiles | system_admin: all. others: profiles in own company | system_admin, company_admin (own company, roles ≤ company_admin) | self (name/position only), company_admin (own company, role-protection rules), system_admin | system_admin, company_admin (own company) |
| invitations | admins of that company + system_admin | company_admin (own company), system_admin | same | same |
| quarters | company members read own company; system_admin all | company_admin/system_admin | same | same |
| strategic_focus_areas, annual_goals, priorities | company members read own company | company_admin/system_admin | company_admin/system_admin; additionally the item's owner may update `status` | company_admin/system_admin |
| commitments | company members read own company | owner inserting for self; company_admin/system_admin for anyone in company | owner updates own; company_admin/system_admin update any in company | owner (own, current open week only); admins |
| company_foundation, foundation_items, marketing_strategy, messaging_pillars, marketing_snippets | company members read own company | company_admin/system_admin | same | same |
| functional_areas, scorecard_metrics | company members read | company_admin/system_admin | same | same |
| scorecard_entries | company members read | the area's accountable person or any admin | same | admins |

Note the deliberate rule from product requirements: **team members have read visibility into the entire company plan but can only add and change their own commitments.** Company admins can add and change everyone's commitments.

---

## 6. Auth flows

- **Sign in**: email + password (composition in Section 8).
- **Forgot password**: request page → Supabase reset email → reset page. Same glass-card-on-gradient composition as sign-in.
- **Seed script** (`scripts/seed-admin.ts`, run with service role key): creates the first system_admin from `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` env vars. Idempotent.
- **Invitation flow**: admin creates invitation (name, email, position, role) → server action uses the service role client to send a Supabase invite email carrying the invitation token in the redirect URL → invitee lands on `/accept-invite?token=...`, sets a password, profile row is created with the invitation's company, role, and position, invitation flips to `accepted`. Admins can revoke pending invitations and resend. Expired tokens show a friendly message telling the person to ask their admin for a new invite.

---

## 7. Route map

```
/sign-in
/forgot-password
/reset-password
/accept-invite

/                            → redirect by role:
                               system_admin → /admin/companies
                               others       → /dashboard

/admin/companies             system_admin: company list, create, archive
/admin/companies/[id]        system_admin: manage one company (acts as that company's admin view)

/dashboard                   Company Dashboard (all roles)
/plan                        The cascade workspace: SFAs → Goals → Priorities
/plan/sfa/[id]               SFA detail
/plan/goal/[id]              Annual Goal detail
/plan/priority/[id]          Priority detail (commitment history lives here)
/weekly-review               The weekly rhythm view
/scorecard                   Functional scorecard grid
/people                      Roster + invitations (admins manage; team members view)
/people/[id]                 Person execution scorecard
/foundation                  Company foundation (tabs: Purpose, Core Values, Vision, Differentiators, Marketing Strategy)
/profile                     Own profile + change password
/quarters                    Quarter management (admins)
```

Layout for all authenticated routes: gradient top nav band, white AiMS logo left; links right: Dashboard, Plan, Weekly Review, Scorecard, People, Foundation; far right: user name → menu (My profile, Sign out). System admins get an additional "Companies" link and a persistent subtle band under the nav showing which company they are currently viewing ("SYSTEM ADMIN · B&B ELECTRIC" in subhead style, matching the Strengths Assessment pattern).

---

## 8. Page compositions (prescribed)

### 8.1 Sign in

Full-viewport `--grad-brand`. Centered column: white AiMS logo; display headline in white, two lines: **"Decisions made well. Made fast. Without you."** — replace with **"Execute what matters. Every week."** (use this second one; shorter and on-product); short chartreuse rule; subtitle at 70% white: "Sign in to the AiMS Execution Platform."; glass card (max-width 480px) with Email and Password fields (subhead-style labels in white, white input surfaces, password visibility toggle); chartreuse pill "Sign in" button with glow; below the card a ghost white link "Forgot password?".

### 8.2 Company Dashboard (`/dashboard`) — first cut

Hero band (`--grad-brand`) full width:

- Subhead line: "CURRENT QUARTER · Q3 2026" (the open quarter's label; if none open, "NO OPEN QUARTER" with a ghost link for admins to open one).
- Display headline: the company name, white, with chartreuse rule.
- One-line subtitle at 70% white: "How execution is going, this quarter and this week."
- A row of four glass stat cards inside the hero (each: stat number in `--text-stat` white, subhead label below):
  1. **Execution** — mean of SFA percents, shown as "68%".
  2. **Keep Rate** — company keep rate for the open quarter.
  3. **On Track** — count of priorities with status on_track or complete, over total active priorities in the quarter ("9 / 12").
  4. **This Week** — count of open commitments due this week.

Main content on sand background, first card overlapping the hero bottom by 32px:

1. **Strategic Focus Areas** (white card): one row per SFA. Each row: SFA title (h3, navy), sponsor name in muted text, status chip (pill, tinted: navy-tint for not started, sky-tint for on track/ongoing, warning-tint for behind, success-tint for complete), and a full-width progress bar (cobalt fill on navy-tint track, rounded ends, percent labeled at the right in tabular-nums, animated fill on load). Row click → `/plan/sfa/[id]`. Below the SFA rows, a muted row for unparented Annual Goals if any exist: "N goals not yet linked to a focus area" linking to `/plan`.
2. **Keep Rate Trend** (white card): bar chart, last 12 weeks, one bar per week_ending, cobalt bars with rounded tops, percent labeled directly above each bar, no y-axis gridlines, week labels beneath in caption style. Current week's bar in sky (in progress, not final).
3. **People** (white card): compact table: Name (cobalt link to `/people/[id]`), Position (muted), Open (count), Keep Rate (a slim horizontal bar, cobalt, with percent right-aligned), Carried (count this quarter). Sorted by keep rate ascending so attention goes where it's needed, but the header copy stays positive: "Where to lend support".

### 8.3 Plan workspace (`/plan`)

Standard light page: h1 "Strategic Plan" with chartreuse rule; a quarter selector pill row (open quarter default; closed quarters selectable read-only).

Body: SFAs as expandable white cards in sort order. Card header: SFA title, sponsor, status chip, derived percent mini-bar. Expanded: its Annual Goals as sub-rows (title, owner, target date, status chip, percent mini-bar), each expandable to show Priorities for the selected quarter (title, owner, due date, status chip, percent mini-bar, commitment count). Every level has a ghost "+ Add" affordance (admins only). Two persistent sections at the bottom of the list: **"Goals without a focus area"** and **"Priorities without a goal"** rendering the unparented items with the same row treatment plus a "Link to..." action. Never hide unparented items; making them visible is the nudge to eventually connect them.

Detail pages (`/plan/sfa/[id]`, `/plan/goal/[id]`, `/plan/priority/[id]`): light hero strip (white card overlapping a shallow gradient band, same layered pattern), breadcrumb back-link, editable fields for admins, children listed below. The Priority detail page additionally shows the full commitment history table for that priority, grouped by week_ending descending, each commitment with owner, description, due date, resolution chip (Kept = success tint, Missed = danger tint, Carried = navy tint, Completed late = warning tint), and missed reasons displayed in caption style beneath.

### 8.4 Weekly Review (`/weekly-review`) — the heartbeat

This page runs the weekly meeting. Two stacked sections on one page:

1. **Last Week** (h2, chartreuse rule): every commitment with `week_ending` = last Friday and any still-open commitment from earlier weeks. Grouped by owner. Each row: description, priority title (muted, linked), due date, and a right-aligned action group of three pill buttons: **Kept** (success outline), **Missed** (danger outline), **Carry Forward** (navy outline). Choosing Missed opens an inline field: "What got in the way?" (required, non-blaming label). Choosing Carry Forward opens an inline confirm showing the new week and an editable description. Resolved rows collapse to a single line with the resolution chip. A team member sees the same list but the action buttons are enabled only on their own rows.
2. **This Week** (h2, chartreuse rule): commitments with `week_ending` = this Friday, grouped by owner, plus an "Add commitment" composer at the top: description, priority picker (searchable, scoped to open-quarter priorities), owner (team members locked to self; admins can pick anyone), due date defaulting to Friday. Empty state on gradient tile: "No commitments yet this week. What will move a priority forward?"

Header of the page: h1 "Weekly Review", the week range in muted text, and one glass-less stat trio: commitments to review, resolved so far, keep rate this quarter.

Week convention: weeks end Friday. Compute "this Friday" and "last Friday" server-side in the company's timezone; store a `timezone` text column on companies defaulting to `America/Anchorage` for the first client, editable by admins.

### 8.5 Functional Scorecard (`/scorecard`)

h1 "Functional Scorecard" with chartreuse rule. A horizontally scrolling grid, sticky first three columns: Functional Area (grouped, area name in subhead style), Metric, Target. Then one column per week_ending, most recent 13 weeks, newest at left. Cells are inline-editable (click to edit, enter to save) for admins and for the row's accountable person; read-only otherwise. Number cells right-aligned tabular-nums. A cell with a numeric target colors its text success when meeting the target and stays neutral otherwise; do not build complex comparators in v1, just `>=` for numbers and exact match for text targets, and skip coloring when the target isn't parseable. Row hover navy-tint. "+ Add metric" and "+ Add area" ghost buttons for admins. Empty state: gradient tile with white copy "Metrics turn opinions into signals. Add your first functional area."

### 8.6 People (`/people`) and Person Scorecard (`/people/[id]`)

`/people`: same composition as the Strengths Assessment roster (hero band, overlapping white People card): table of Name, Position, Role, Status, plus Open commitments and Keep Rate columns. Admin-only actions: Edit, Deactivate. Above the table for admins: "Invite person" primary button opening a modal (name, email, position, role). A second card lists pending invitations with Resend and Revoke ghost actions.

`/people/[id]`: hero strip with the person's name, position, and back-link. Content cards:
1. **Scorecard**: four stat tiles: Keep Rate (quarter), Kept, Missed, Carried. Beneath, a 12-week keep-rate bar chart (same treatment as dashboard).
2. **Open Commitments**: table of current open items with due dates, overdue rows carrying a warning-tint chip "Past due".
3. **History**: commitments grouped by week descending with resolution chips and missed reasons.

Every user can open their own page from the nav user menu ("My scorecard"). Team members can view other people's pages too (company visibility is open by design), but only admins see edit affordances.

### 8.7 Foundation (`/foundation`)

h1 "Foundation" with chartreuse rule; subtitle "Who this company is, in its own words." Pill tab row: Purpose, Core Values, Vision, Differentiators, Marketing Strategy. All members read; admins see "Edit" ghost buttons switching sections to inline edit mode.

- **Purpose**: the statement rendered big (Figtree 300, 22px, navy) inside a white card with a corner sky shape accent; the context paragraph beneath in body style.
- **Core Values**: one white card per value: title (h3), body beneath. Admin edit supports add, edit, delete, and drag-to-reorder (simple up/down buttons are acceptable in v1).
- **Vision**: vision_title as h2, tagline in muted italic beneath, body paragraphs, then vision_milestones as a two-column grid of cards (title bold, body beneath).
- **Differentiators**: numbered cards (the number rendered in `--text-stat` cobalt), title, body.
- **Marketing Strategy**: stacked sections: Positioning Statement (rendered like Purpose), Executive Summary (body prose), Messaging Pillars (expandable cards: name, message, then the language bank as chartreuse-tinted chips, each chip's text in navy), ICP (two columns: "Best-fit clients and projects" and "Psychographics", each a simple list), Hooks (Short and Long groups, each hook a quoted line), Messaging to Avoid (muted list). Admin edit is per-section.

### 8.8 Quarters (`/quarters`)

Simple admin page: table of quarters (label, dates, status, priority count), "Open next quarter" primary action prefilling label and dates from the calendar, and a Close action with a confirm modal stating what closing means (freezes the quarter; commitments and priorities remain visible in history).

### 8.9 System admin (`/admin/companies`)

Hero band "Companies", overlapping white card table: Name, People count, Open quarter, Keep rate (quarter), Status, with Open and Archive actions. "Create company" primary button (name + timezone). Opening a company routes to `/admin/companies/[id]` which renders the same company navigation and pages scoped to that company, with the persistent "SYSTEM ADMIN · COMPANY NAME" band.

---

## 9. Build order

Build in this sequence, verifying each phase compiles and runs before the next:

1. Project scaffold, tokens.css import, fonts, base layout, nav band, sign-in page to the quality bar.
2. Migrations 4.1–4.2, RLS helper and policies for identity tables, seed script, auth flows, invitation flow end to end.
3. Migrations 4.3–4.5, plan workspace and detail pages, quarter management.
4. Commitments and the Weekly Review page.
5. Company Dashboard and Person Scorecard (progress views, keep-rate math).
6. Functional Scorecard.
7. Foundation and Marketing Strategy sections.
8. System admin company management.
9. Polish pass: empty states, loading states (skeleton bars in navy-tint), error states, motion, responsive behavior down to 768px (below that, tables scroll horizontally; nav collapses to a menu).

## 10. Definition of done, per page

- Uses only token variables; zero hardcoded hex.
- Both fonts loaded and applied per the rules; no default system font leaking into headings.
- Every authorization rule verified by attempting the action as the wrong role (write a short manual test list in the PR description).
- Keyboard focus visible (cobalt ring) on every interactive element.
- Empty, loading, and error states designed, not default.
- No emoji anywhere in the UI.

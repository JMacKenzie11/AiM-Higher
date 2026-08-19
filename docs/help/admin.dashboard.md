---
title: Platform (system admin dashboard)
roles: [system_admin]
---

# Platform

Cross-company view of what's live, what's active, and what needs
attention. Numbers refresh on page load; the themes and cost
cards run off nightly jobs.

## What's on the page

- **Pulse strip** — four platform-wide numbers over the last 7
  days: active users (people who sent a coach message), coaching
  turns (one exchange = one turn), new companies, and token
  spend.
- **Needs attention** — companies flagged on one of three
  coach-chat signals: no coach conversations in 14+ days, coach
  conversations dropped from 4+ (last 30 days) to zero this week,
  or Follow-Through Rate under 40% over the last 30 days.
  Meeting-transcript ingest is a separate pipeline and does NOT
  count as coach activity here. Click a row to jump straight into
  that company.
- **Top coaching themes** — five themes clustered nightly by a
  small Haiku call from recent conversation titles and openings.
  First card populates after the first nightly run at 06:00 UTC.
- **Conversations per company** — top eight by 30-day thread
  count. Bars scale to the leader.
- **Practice adoption** — one tile per registered practice:
  Started (any conversation created), Engaged (3+ messages,
  proxy for going past the opener), Companies (distinct
  companies whose users started this practice).
- **Token spend** — total 7-day and 30-day, plus a 30-day daily
  ridge. When the Anthropic Admin API workspace is configured
  the numbers are real invoiced spend across every model call
  the platform makes; otherwise it falls back to a coach-only
  local estimator (marked "Estimated · coach only" in the
  header).
- **Company activity table** — sortable client-side (click any
  header). Users = distinct people who sent a coach message in
  the window. Conv. = coaching threads started. Practices =
  practice conversations started (30 days). Follow-Through Rate
  = kept-on-time ÷ (kept-on-time + kept-late + missed) commitments
  over 30 days.

## Common things you'd do here

- **Skim the pulse strip** to check the platform is alive.
- **Scan Needs attention** for a call list — every company here
  is a candidate for outreach.
- **Sort the activity table by Conv. 30d** to see the most
  engaged companies at the top; **sort by Last active** to find
  quiet ones.
- **Watch Token spend** to catch cost creep. The daily ridge
  makes spikes obvious.
- **Read Top coaching themes** to sense-check what people are
  actually working on with the coach across the platform.

## Heads-up

- **Per-company cost is not shown.** Anthropic's Admin API
  doesn't segment cost by AiMHigher companies. The Token spend
  card gives the platform total; a per-company breakdown isn't
  available.
- **First-run gaps.** The themes card is empty until the nightly
  clustering job runs. The Token spend chart fills in from the
  day the Anthropic workspace was configured, not retroactively.
- **Estimator vs. real.** When the workspace env vars aren't
  set, Token spend is a rough estimate from the local coach
  token log — it under-counts non-coach model calls (meeting
  analyzer, RD generator, strengths narrative, dashboard brief).
  Set `ANTHROPIC_ADMIN_KEY` and `ANTHROPIC_WORKSPACE_ID` in
  Vercel to switch to real invoiced numbers.
- **System admins only.** The nav entry (System admin →
  Platform) and the route both gate on `system_admin`.

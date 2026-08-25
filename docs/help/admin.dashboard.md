---
title: Platform (system admin dashboard)
roles: [system_admin]
---

# Platform

Cross-company view of what's live, what's active, and what needs
attention. Numbers refresh on page load; themes and cost cards run
off nightly jobs.

## What you can do here

- **Skim the pulse strip** — four platform-wide numbers over the
  last 7 days: active users (people who sent a coach message),
  coaching turns, new companies, and token spend.
- **Scan Needs attention** — companies flagged on one of three
  coach-chat signals: no coach conversations in 14+ days, coach
  conversations dropped from 4+ (30 days) to zero this week, or
  Follow-Through Rate under 40% over the last 30 days. Click a
  row to scope into that company. Meeting-transcript ingest is a
  separate pipeline and doesn't count as coach activity here.
- **Read Top coaching themes** — five themes clustered nightly
  from recent conversation titles and openings. Populates after
  the first nightly run at 06:00 UTC.
- **Compare Conversations per company** — top eight by 30-day
  thread count. Bars scale to the leader.
- **Read Practice adoption** — one tile per registered practice:
  Started (any conversation), Engaged (3+ messages, proxy for
  going past the opener), Companies (distinct companies whose
  users started this practice).
- **Watch Token spend** — 7-day and 30-day totals plus a 30-day
  daily ridge. Real invoiced Anthropic spend when the Admin API
  workspace is configured; otherwise a local coach-only
  estimator (marked *Estimated · coach only*).
- **Sort the company activity table** — click any header. Users
  = distinct people who sent a coach message in the window.
  Conv. = coaching threads started. Practices = practice
  conversations started (30 days). Follow-Through Rate =
  kept-on-time ÷ (kept-on-time + kept-late + missed) over 30
  days.

## Common workflows

- **Call list for the week** — start in Needs attention. Every
  row is a candidate for outreach.
- **Find quiet companies** — sort the activity table by *Last
  active*.
- **Sense-check what people are working on** — read Top coaching
  themes.
- **Catch cost creep** — watch the Token spend daily ridge for
  spikes.

## Common questions

**Why isn't per-company cost shown?** Anthropic's Admin API
doesn't segment cost by AiMHigher companies. The card gives the
platform total; a per-company breakdown isn't available.

**Why is Token spend empty?** The chart fills in from the day the
Anthropic workspace was configured, not retroactively. First-run
gaps also apply to Themes (empty until the first nightly
clustering job).

**Estimator vs. real spend?** With the workspace env vars unset,
Token spend is a rough estimate from the local coach token log —
it under-counts non-coach model calls (meeting analyzer, RD
generator, strengths narrative, dashboard brief). Set
`ANTHROPIC_ADMIN_KEY` and `ANTHROPIC_WORKSPACE_ID` in Vercel to
switch to real invoiced numbers.

---
title: AiMS Scorecard
---

# AiMS Scorecard

A live read on how consistently the AiMS disciplines are being
practiced across the company. Everyone in the company sees the same
view — the Scorecard is transparent by design. Numbers are computed
on every page load; the sparklines behind them come from the weekly
Sunday snapshot.

## What you can do here

- **Read the overall score** and the 26-week arc under the hero.
- **Read each discipline's card** — score, trend arrow vs. 90 days
  ago, sparkline, and the evidence lines the score was built from.
- **See what to fix** — the Accountability Chart card lists the
  specific functions missing a Lead, an outcome, or a measure.
- **Hover the `?` on any card** for the exact scoring rubric.
- **Click through** from any card to the page that improves the
  score (Foundation, Chart, Plan, Commitments, Measures, Meetings).

## What's scored

Eight disciplines, each 0–10:

- **Foundation** — purpose, vision, at least three core values /
  differentiators / key success metrics on the One-Page Plan.
  State-based (no trend line).
- **Accountability chart** — every function has a Lead assigned,
  at least one outcome, and at least one measure. State-based. LTD
  Track/Decide always sit with the Lead, so they're not scored.
- **Strategic plan** — an open quarter with a populated cascade
  (2-point baseline), plus how well annual goals and quarterly
  priorities close on their due dates (4 points each). Fresh plans
  with nothing past-date get full credit for the closure halves.
- **Execution** — 30-day follow-through rate on commitments, minus
  aging (open more than 14 days past due). Priority linkage is
  deliberately not scored.
- **Success tracking** — every measure has a target, has been
  logged in the last 7 days, and auto-track measures aren't sitting
  empty. Only scored when the Success Tracking feature is on.
- **Weekly leadership meeting** — a meeting is happening most
  weeks (rolling 8) and the facilitation reviews are landing well.
  Only scored when Meeting Facilitation Review is on.
- **Solution seeking** — how well the team runs the AiMS 4Ws
  (What / Want / Way / Who-by-when) on surfaced issues over the
  rolling 8 weeks. Not scored until issues appear.
- **Appreciative practice** — the positive-framing signal from
  meeting reviews plus counts of appreciations, generative
  questions, and reframes. Not scored until at least one v2 review
  has run.

The **overall score** is a weighted average across the disciplines
that actually scored — Planning and Execution weight double.
Disciplines whose feature is off don't drag the average down; their
weight is redistributed.

## Rolling and trajectory

Every metric is rolling by construction — drop off for a month and
the score reflects it; improve across 30 days and it climbs. Each
card also carries an arrow vs. 90 days ago so you can distinguish
"low but climbing" from "high but sliding."

## What isn't scored (and why)

- **Meeting attendance.** Transcripts don't reliably map speaker
  names to profiles, so we leave attendance out rather than score
  it inconsistently.
- **Text quality of Foundation entries.** The score checks that
  the surfaces are filled in, not whether the purpose statement is
  well written — that's a coaching conversation.
- **Meaningfulness of individual measures.** We check targets
  exist and get logged; a coach reviews whether a measure fits
  the outcome.

## Common questions

**Why is my score different today than yesterday?** It's computed
live. If ten commitments closed this morning, Execution moves this
afternoon. The Sunday snapshot only backs the sparkline.

**Why is a discipline sitting at "Not enabled"?** The company's
feature flag for that discipline is off. A system admin can flip
Success Tracking or Meeting Facilitation Review from company
settings; the tile activates on the next page load.

**Why don't I see a trend arrow?** There isn't a snapshot old
enough to compare against yet. By week 3 or 4 there'll be enough
history for the arrow to render.

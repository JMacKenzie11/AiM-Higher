---
title: AiMS Implementation
---

# AiMS Implementation

A live read on how consistently the AiMS disciplines are being practiced
across the company. Everyone in the company sees the same view — the
Scorecard is transparent by design. Numbers are computed on every page
load; the sparklines behind them come from the weekly Sunday snapshot.

## Setup checklist at the top

If you have admin authority on this company (system admin, company
admin, or an assigned AiMS Guide), a *Set up {company}* card renders
above the discipline tiles. It stays visible even after every step is
ticked off, so the page keeps working as a shared map of the operating
disciplines.

Five ordered steps, each auto-checking as its condition becomes true:

1. **Build the team** — add people and build the functional chart.
2. **Invite the team** — send invitations to everyone on the roster.
3. **Open a quarter** — the wrapper every commitment lives in.
4. **Start the weekly rhythm** — a commitment logged in the last 14
   days.
5. **Track Issues / Solutions** — an issue logged in the last 14 days.

Team members don't see this card — it's only for people who can act on
the steps.

## What you can do here

- **Read the overall score** and the 26-week arc under the hero.
- **Read each discipline's card** — score, trend arrow vs. 90 days ago,
  sparkline, and the evidence lines the score was built from.
- **See what to fix** — the Accountability Chart card lists the specific
  functions missing a Lead, a critical success factor, or a measure.
- **Hover the `?` on any card** for the exact scoring rubric.
- **Click through** from any card to the page that improves the score
  (Foundation, Chart, Plan, Commitments, Measures, Meetings).

## What's scored

Eight disciplines, each 0–10:

- **Foundation** — purpose, vision, at least three core values, and
  at least three differentiators on the One-Page Plan. Four things,
  2.5 points each. State-based (no trend line).
- **Accountability chart** — every function has a Lead assigned, at
  least one critical success factor, and at least one measure.
  State-based. LTD Track/Decide always sit with the Lead, so they're not
  scored.
- **Strategic plan** — an open quarter with a populated cascade (2-point
  baseline), plus how well goals and quarterly priorities close
  on their due dates (4 points each). Fresh plans with nothing past-date
  get full credit for the closure halves. A populated cascade means
  focus areas and quarterly priorities: goals are optional, so a plan
  that runs priorities straight off its focus areas is not penalised
  for having none.
- **Execution** — 30-day follow-through rate on commitments, minus aging
  (open more than 14 days past due). Deleted and parked commitments
  don't count toward either half. Priority linkage is deliberately
  not scored.
- **Success tracking** — every measure has a target, has been logged in
  the last 7 days. Scored
  for every company. It used to be skipped unless the Success Tracking
  setting was on; that setting is about automatic reminders now, not
  about whether you track, so it no longer decides this.
- **Weekly leadership meeting** — a meeting is happening most weeks
  (rolling 8) and the facilitation reviews are landing well. Only scored
  when Meeting Facilitation Review is on.
- **Solution seeking** — how well the team runs the AiMS 4Ws (What /
  Want / Way / Who-by-when) on surfaced issues over the rolling 8 weeks.
  Not scored until issues appear.
- **Appreciative practice** — the positive-framing signal from meeting
  reviews plus counts of appreciations, generative questions, and
  reframes. Not scored until at least one v2 review has run.

The **overall score** is a weighted average across the disciplines that
actually scored — Planning and Execution weight double. Disciplines
whose feature is off don't drag the average down; their weight is
redistributed.

## Rolling and trajectory

Every metric is rolling by construction — drop off for a month and the
score reflects it; improve across 30 days and it climbs. Each card also
carries an arrow vs. 90 days ago so you can distinguish "low but
climbing" from "high but sliding."

## What isn't scored (and why)

- **Meeting attendance.** Transcripts don't reliably map speaker names
  to profiles, so we leave attendance out rather than score it
  inconsistently.
- **Text quality of Foundation entries.** The score checks that the
  surfaces are filled in, not whether the purpose statement is well
  written — that's a coaching conversation.
- **Meaningfulness of individual measures.** We check targets exist and
  get logged; a coach reviews whether a measure fits the critical
  success factor.

## Common questions

**Why is my score different today than yesterday?** It's computed live.
If ten commitments closed this morning, Execution moves this afternoon.

**Why did Execution jump on 14 September 2026?** A fix, not a change
in how anyone worked. Deleted commitments were being counted against
the aging half of this tile and should never have been — deleting one
is meant to take it out of every count. Four companies had been
scoring lower than they'd earned. Earlier weeks keep the numbers they
were recorded with rather than being rewritten, so the trend line
steps up once on that date.
The Sunday snapshot only backs the sparkline.

**Why is a discipline sitting at "Not enabled"?** The company's feature
flag for that discipline is off. A system admin can flip Success
Tracking or Meeting Facilitation Review from company settings; the tile
activates on the next page load.

**Why don't I see a trend arrow?** There isn't a snapshot old enough to
compare against yet. By week 3 or 4 there'll be enough history for the
arrow to render.

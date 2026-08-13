---
title: AiMS Scorecard
---

# AiMS Scorecard

The AiMS Scorecard is the company's read on how consistently the
disciplines are being practiced. It sits next to the Dashboard in the
nav because it answers a different question: not "what happened this
week?" but "how are we doing overall?".

Every signed-in member of the company sees the same view. Scores are
computed **live** on every page load, so a change in behavior — a
missed weekly meeting, a run of kept commitments, opening a new
quarter — shows up immediately. The historical trend lines behind
the scores come from weekly snapshots the platform writes every
Sunday.

## What's scored

Six disciplines, each rated 0–10:

- **Foundation** — purpose statement, vision, and at least three
  core values / differentiators / key success metrics on the One-Page
  Plan.
- **Accountability chart** — every function has a Lead and a Track
  assigned, at least one outcome, and something being measured.
- **Strategic plan** — an open quarter exists, and the cascade
  (focus areas → annual goals → priorities) is actually populated,
  not orphaned rows.
- **Execution** — weekly commitments landing on time (follow-through
  rate over the last 30 days), linked to a priority, without piling
  up more than 14 days past due.
- **Success tracking** — every measure has a target set, has been
  logged in the last 7 days, and auto-track measures aren't sitting
  empty. Only scored when Success Tracking is enabled for the
  company; otherwise the tile shows "Not enabled".
- **Weekly leadership meeting** — a meeting is happening most weeks
  (rolling 8 weeks) and the AI facilitation reviews are landing
  well. Only scored when Meeting Facilitation Review is enabled;
  otherwise the tile shows "Not enabled".

The **overall score** is a weighted average across the disciplines
that were actually scored — Planning and Execution weight double
because they're the two the whole system is oriented around.
Disciplines whose feature is off don't drag the average down; their
weight is redistributed across the ones that did score.

## Rolling and trajectory

Every metric is rolling by construction. If your meeting cadence
drops off for a month, the Meetings score falls because the rolling
8-week window naturally reflects that. If follow-through improves
across the last 30 days, Execution climbs.

Each score also shows an **arrow vs 90 days ago**, comparing today's
live number against the oldest snapshot inside the trajectory
window. An improving company sees ↑ arrows; a company slipping sees
↓; both live alongside the absolute number so you can distinguish
"low but climbing" from "high but sliding."

The sparkline under each score shows the last 26 weeks so you can
see the arc, not just the two endpoints.

## What isn't scored (and why)

- **Meeting attendance.** Transcripts don't reliably match speaker
  names to profile records — a "Great point, John" from a client
  meeting shouldn't be attributed to your John. Rather than score
  something inconsistently, we leave attendance out. Weekly meeting
  quality still shows up through the AI facilitation review.
- **Text quality of Foundation entries.** The score asks whether
  the surfaces are filled in, not whether the purpose statement is
  well written. That judgment belongs in a conversation with a coach.
- **Meaningfulness of individual measures.** We check that targets
  exist and get logged; a coach on the measure critique flow
  reviews whether the measure fits the outcome.

## Common questions

**Why is my score different today than yesterday?**
Because it's computed live, not from the cron snapshot. If a team
member closed out ten commitments this morning, Execution moves this
afternoon. The weekly snapshot is only used for the historical
trend line, not the current score.

**Why is a discipline sitting at "Not enabled"?**
The company's feature flag for that discipline is off. Turn on
Success Tracking or Meeting Facilitation Review from the company
settings page (system-admin) and the tile activates on the next
page load.

**Why don't I see a trend arrow?**
There isn't a snapshot old enough to compare against yet. The
Sunday cron will start writing rows this coming Sunday; by week 3
or 4 there'll be enough history for the arrow to render.

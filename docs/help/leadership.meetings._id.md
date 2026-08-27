---
title: Meeting analysis
---

# Meeting analysis

The full write-up of a single meeting plus the extractions it
produced: commitments (already live on `/commitments` when
Automated Commitment Tracking is on, or waiting to be routed
below when it's off) and issues (never auto-created — an admin
or guide adds them to the open list one at a time).

## What you can do here

::: role team_member
As a team member, you can:

- **Read the analysis** — the model's structured read: themes,
  decisions, risks.
- **See the commitments the meeting created** — the list up top
  links each one back to `/commitments` where owners resolve or
  reschedule.
:::

::: role company_admin,aims_guide,system_admin
As an admin or guide, you can also:

- **Route extracted commitments** *(when Automated Commitment
  Tracking is off)* — each extracted commitment shows in the
  *Commitments identified* card with three actions: link to a
  Priority, link to a Functional Area, or *Convert to issue*.
  Once you act, the pickers disappear and a green checkmark
  chip takes their place spelling out what happened — *Added to
  &lt;Priority name&gt;*, *Added to &lt;Function name&gt;*,
  *Captured as commitment* (no link), or *Issue created*. Same
  read on a hard refresh, so you can walk away and come back.
- **Add extracted issues to the open list** — *Issues identified*
  lists each unresolved question the team raised. Click *Add to
  open issues* on the ones worth working on; the row flips to
  a green *Added as issue* chip. Idempotent by title + meeting,
  so a double-click doesn't create twins.
- **Read the facilitation review** *(when Meeting Facilitation
  Review is on)* — the "How the meeting was run" panel is a
  coaching-tone read against the AiMS Weekly Leadership Meeting
  framework. Strengths first, growth edges framed as
  opportunities, and a *what to try next week* section. The
  overall number is a signal, not a grade — shape over several
  meetings matters more than any single week.
- **Reanalyze the meeting** — a *Reanalyze meeting* button at the
  bottom wipes this meeting's analysis, any commitments the
  pipeline auto-created from it, and any issues added from it,
  then re-runs the extraction. Use it after fixing the roster or
  the transcript, or when the extraction landed thin. The
  facilitation review regenerates as part of the same pass.
:::

## How duplicate awareness works

For each extracted commitment or issue, the pipeline runs a
trigram similarity check against every open commitment or issue
from the last 14 days. A close match surfaces a small *Possibly
already captured* badge next to the extracted row.

Click the badge — a callout opens with the matched text quoted
and a link to the surface (/commitments or /issues) where the
near-duplicate lives, so you can eyeball it before deciding. It's
a hint, not a block: add the row anyway if the resemblance is
coincidental.

Items that this meeting itself already produced don't count as
duplicates (self-match filter), so a re-scan of the same meeting
doesn't decorate every row with the badge.

## How reanalyze behaves

Clicking *Reanalyze meeting* immediately:

1. Deletes the current analysis row.
2. Deletes commitments this meeting created (only rows tagged
   with `source_meeting_id = this meeting`).
3. Deletes issues added from this meeting.
4. Resets the meeting to `pending` and kicks off the extraction
   pipeline in the background.

While the re-run is in flight, a pulsing *Analyzing this meeting*
banner sits above the analysis card and the *Reanalyze* button
hides itself so a second reset can't queue on top of the first.
Refresh the page in 30-90 seconds to see the fresh output.

## Common questions

**Who sees this page?** The meeting summary and the commitments
list are visible to everyone at this company. Facilitation
reviews and raw transcripts stay admin-only. Commitments
extracted from the meeting show up on each owner's Commitments
list and scorecard — same visibility as any other commitment.

**A commitment on the list looks wrong.** The commitment lives
on `/commitments` — click through and edit it there (reassign,
reschedule, or fix the description). Issue-linked commitments
edit inline from `/issues` instead.

**The extraction returned nothing after Reanalyze.** The
pipeline logged what happened (stop_reason, response length,
head/tail of the raw JSON) — a system admin can pull the log
from Vercel. Model stochasticity is real; a second Reanalyze
usually recovers.

**Why is there no facilitation review?** Either Meeting
Facilitation Review is off for the company, the transcript was
flagged insufficient (too short or too fragmented), or the
review pipeline hasn't run against this meeting yet. Reanalyze
regenerates it as part of the same pass.

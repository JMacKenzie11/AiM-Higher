---
title: Meeting analysis
---

# Meeting analysis

The full write-up of a single meeting plus the extractions it
produced: commitments (already live on `/commitments` when
Automated Commitment Tracking is on, or waiting to be routed
below when it's off) and issues (never auto-created — an admin
or guide adds them to the open list one at a time).

## How the page is laid out

A strip at the top shows the meeting date, who attended and the
score. It stays in view on every tab. Below it are three tabs:

- **Coaching notes** opens first. Core values in action, then the
  facilitation review: the score, what worked, growth edges, what
  to try next week, questions worth asking next week, the
  questions that opened things up, and the 4Ws audit.
- **Issues and commitments**: the commitments the meeting created
  and the issues it raised, with the controls to add or resolve
  them.
- **Meeting Analysis**: purpose, attendees, agenda, the discussion
  section by section, decisions and support needed.

Each tab has its own link. Add `#coaching-notes`,
`#issues-and-commitments` or `#meeting-analysis` to the page address to
send someone straight to that tab.

A commitment where nobody named a day shows **By next meeting**
instead of a date. A date appears only where somebody said one.

## What you can do here

::: role team_member
As a team member, you can:

- **Read the analysis** — the model's structured read: themes,
  decisions, risks.
- **See the commitments the meeting created** — the list up top
  links each one back to `/commitments` where owners resolve or
  reschedule.
- **Read the full coaching notes if you are the AiMS champion.**
  The champion sees the whole Coaching notes tab, the score and
  the facilitation review included, the same as the company's
  admins. Everyone else on the team sees Core values in action.
:::

::: role company_admin,aims_guide,system_admin
As an admin or guide, you can also:

- **Route extracted commitments** *(when Automated Commitment
  Tracking is off)* — each extracted commitment shows in the
  *Commitments identified* card with three actions: link to a
  Priority, link to a Functional Area, or *Convert to issue*.
  Once you act, the pickers disappear and a navy checkmark
  chip takes their place spelling out what happened — *Added to
  &lt;Priority name&gt;*, *Added to &lt;Function name&gt;*,
  *Captured as commitment* (no link), or *Issue created*. Same
  read on a hard refresh, so you can walk away and come back.
- **Add extracted issues to the open list** — *Issues identified*
  lists each unresolved question the team raised. Two paths:
  - *Resolved in meeting* on the left drops the item straight into
    the resolved list — the team already talked through it and no
    follow-up work is needed. No desired outcome, no commitment,
    no owner; the row lands closed with a *Resolved in meeting*
    chip and today's timestamp.
  - *Add to open issues* on the right keeps it as work: the row
    joins the open backlog on /issues where a leader can add the
    desired outcome, a commitment, and an owner.
  Both are idempotent by title + meeting, so a double-click
  doesn't create twins. First click wins between the two paths.
  The two chips are deliberately different marks so the column is
  scannable: a check in a circle means the loop closed in the
  room, a plus in a circle means it went onto the list to work
  later. Over on /issues, a row closed by the shortcut reads
  *Resolved in meeting* in its *Commitment* column rather than
  showing a blank, so you can tell later how it got there.
- **Read the facilitation review** *(when Meeting Facilitation
  Review is on)*: the "How the meeting was run" panel on Coaching
  notes. Strengths first, growth edges framed as opportunities,
  and a *what to try next week* section. The score, the
  *Facilitation signal*, sits on the strip at the top of the page.
- **See how the score is made.** Open *How this is scored* in the
  "How the meeting was run" panel. It shows the five parts, the
  score for each, and its weight: Positive framing 25%,
  Accountability 25%, Rhythm 20%, Alignment 15%, Agenda sections
  15%. The score is the weighted average, shown to one decimal
  there and rounded on the strip (half or more rounds up, so 7.5
  shows as 8). The ⓘ beside each part says what it measures, the
  same words as here:
  - **Positive framing:** How much the meeting looked for what's
    working and built on it. Strong meetings ask what's going well
    and how to get more of it before they ask what's wrong.
  - **Accountability:** Whether the things people agreed to do left
    the meeting with a name and a date. Strong meetings turn good
    conversation into commitments someone owns.
  - **Rhythm:** How closely the meeting followed the AiMS weekly
    flow: Positive Check-In; Functional Updates; Forward Momentum on Strategy; Solve, Together; Review Commitments. Strong meetings give each part its own time
    rather than letting updates take over.
  - **Alignment:** Whether the team connected what it discussed to
    the company's goals and priorities. Strong meetings make it
    clear why each item matters to where the business is going.
  - **Agenda sections:** How many of the five sections of the AiMS
    weekly meeting happened: Positive Check-In; Functional Updates; Forward Momentum on Strategy; Solve, Together; Review Commitments. Scored out of 5, then
    doubled to match the others.

  Meetings analysed before 25 September 2026 keep the score they
  were given at the time, with no breakdown.
- **Take a question into next week.** *Questions worth asking next
  week* offers three, each drawn from something that went well in
  this meeting. *Questions that opened things up* credits the questions
  that changed where the discussion went, with who asked and what
  each one opened. They are put in plain words rather than quoted
  word for word. In the 4Ws
  audit, a step the meeting didn't reach comes with the question
  to ask next time.
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

*Reanalyze meeting* is for system admins, and only appears on a
meeting that has no commitments or issues created from it, such as
one whose analysis failed or came back empty. It replaces the
analysis and runs the extraction again. It never touches anybody's
commitments or issues: a meeting that has any cannot be
reanalyzed.

If a meeting with commitments on people's lists needs a better
summary, ask your AiMS contact. It can be regenerated without
changing the commitments or issues.

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

**A commitment came out Unassigned.** Aimee only gives a
commitment to someone she can tell was at the meeting. If she
could not tell who said it, or it named someone who was not
there ("I'll see if John can do it"), it comes out Unassigned
rather than on the wrong person's list. Open it on
`/commitments` and pick the owner.

**The summary says "an unidentified speaker".** The recording
labels people by number, and Aimee names someone only when she
is confident who it was. Where she is not, she says so rather
than guess.

**The extraction returned nothing after Reanalyze.** The
pipeline logged what happened (stop_reason, response length,
head/tail of the raw JSON) — a system admin can pull the log
from Vercel. Model stochasticity is real; a second Reanalyze
usually recovers.

**Why is there no facilitation review?** Either Meeting
Facilitation Review is off for the company, the transcript was
flagged insufficient (too short or too fragmented), or the
review pipeline hasn't run against this meeting yet. Ask your AiMS
contact to regenerate it; that leaves commitments and issues as
they are.

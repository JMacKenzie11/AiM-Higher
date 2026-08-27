---
title: Issues/Solutions
---

# Issues/Solutions

The Solution Seeking discipline in one list. Name the issue,
decide what you want, and commit to the next step that moves it
forward. Each row is one issue with (optionally) one open
commitment attached — the commitment lives here **and** on the
owner's Commitments list and scorecard.

## What you can do here

::: role team_member
As a team member, you can:

- **Add your own commitment** to an issue that has none — type in
  the *Commitment* cell, pick a due date, save.
- **Edit the commitment description, owner, and due date** on any
  issue you own or that a commitment of yours is on. Fields are
  click-to-edit inline; rescheduling asks you for a one-line
  reason so patterns stay visible over time.
- **Toggle the clarity dot** on your own commitment — same
  three-state check as `/commitments` (Timeline agreed? Definition
  of done observable?).
- **See resolved history** — the *Resolved issues* section at the
  bottom is read-only and mirrors the open table (Issue / What we
  want / Commitment / Assigned to / Due date).
:::

::: role company_admin,aims_guide,system_admin
As an admin or guide, you can also:

- **Add, rename, and resolve any issue.** Click the title to
  rename; use *Resolve* on the right to close the loop.
- **Delete an issue** — trash icon left of *Resolve*. Hard
  delete; the confirm dialog spells out that it can't be undone.
  Any commitments linked to the issue stay live and just lose the
  linkage, so no owner loses their next-step work.
- **Reorder issues by rank** — drag the handle in column two.
  Rank persists across everyone's view.
- **Edit any issue's desired outcome** by clicking the *What we
  want* cell.
- **Reassign or reschedule any linked commitment** — same inline
  editors as team members, no reason required.
:::

## How to name a good issue

Aim for a neutral one-sentence description: *what's the tension
or unresolved question?* Not the fix, not the blame. Fill in
*What we want* once the team agrees on the desired outcome —
until then, leave it blank. The commitment is the next step
someone will take to move it forward.

## How to add a commitment to an issue

1. Find the issue's row.
2. Click into the *Commitment* cell (the dashed input under the
   Commitment header). Type the next-step description.
3. Set the owner and due date. If you're not an admin, the owner
   defaults to you.
4. Save. The commitment now shows up on the owner's Commitments
   list and scorecard alongside every other commitment, tagged
   as linked to this issue.

## How to filter the list

- **Stats pills** at the top count everything (Open,
  No commitment yet, Resolved this quarter) — they don't move
  when you filter, so the "what's out there" read stays stable.
- **Assigned to** filters rows by whose open commitment is on the
  issue. Issues with no commitment fall out when you pick a
  specific person; the *No commitment yet* stat covers that pile.
- **Status** switches between Open, Resolved, or both.
- **Source** narrows to issues added from a meeting transcript
  vs. issues added manually here.

## How issues arrive from a meeting

The extraction pipeline flags unresolved questions the team
raised and lists them under *Issues identified* on the meeting
summary. Nothing lands here automatically — an admin or guide
clicks *Add to open issues* on each one worth working. That's on
purpose: issues named too eagerly clutter the list.

If the extraction flagged something similar to an issue you
already added recently, you'll see a small *Possibly already
captured* badge on the meeting summary row. It's a hint, not a
block — you can still add it.

## Common questions

**What's the clarity dot for?** It's the same three-state check
used on `/commitments` — timeline agreed and definition of done
observable. Green = both yes, amber = one or both no, grey =
not yet assessed. Only shows when a commitment exists on the
issue. Click to review or update.

**Why doesn't my issue-linked commitment show on the main
Commitments page?** Presentation-layer separation: issue-linked
commitments live here (the Issues/Solutions surface) so the
Commitments page stays focused on standalone functional and
strategic commitments. They still appear on personal surfaces
(the owner's Guide HQ *My commitments*, their scorecard).

**Resolving an issue — what happens to the commitment?** The
issue moves off the open list into the Resolved section. Any
open linked commitments stay live on the owner's list — Resolve
only closes the issue, not the work.

**Can I un-resolve an issue?** Not from the UI. If it was closed
in error, add a new issue capturing what's still unresolved.

**What happens to commitments when an admin deletes an issue?**
The commitments stay alive on the owner's list; only the link
back to the (now-gone) issue is cleared. Delete removes the
issue row itself, not the work anyone committed to.

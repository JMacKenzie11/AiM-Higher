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
  the *Commitment* cell. The row auto-saves when you tab out of
  the form (or press Cmd/Ctrl+Enter); there's no submit button.
- **Edit the commitment description, owner, and due date** on any
  issue you own or that a commitment of yours is on. Fields are
  click-to-edit inline and save on blur. Clearing the description
  entirely deletes the commitment (the row falls back to the
  add-commitment state). Rescheduling asks you for a one-line
  reason so patterns stay visible over time.
- **Toggle the clarity dot** on your own commitment — same
  three-state check as `/commitments` (Timeline agreed? Definition
  of done observable?).
- **See resolved history** — the *Resolved issues* section at the
  bottom is read-only and mirrors the open table (Issue / What we
  want / Commitment / Assigned to / Due date). Rows with no *What
  we want*, no *Commitment*, and no *Assigned to* were closed via
  the *Resolved in meeting* shortcut on the meeting summary —
  the team talked the issue through in the meeting and no
  follow-up work was needed, so it landed straight in the
  resolved list. The *Due date* column on those rows shows the
  date the button was clicked.
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
  Rank is company-wide and shared: everyone in the company sees
  the same order, and the new position sticks across sessions.
  Team members see the drag handle only on issues they created.
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
   Commitment header) and type the next-step description.
3. Adjust the owner and due date if you need to. If you're not
   an admin, the owner defaults to you.
4. Tab out of the form (or press Cmd/Ctrl+Enter) to save. There's
   no submit button: the row auto-saves the moment focus leaves
   the whole form, so tabbing between description → owner → date
   doesn't fire early. The commitment now shows up on the owner's
   Commitments list and scorecard alongside every other
   commitment, tagged as linked to this issue.

## How to edit or delete a commitment on an issue

The commitment description, owner, and due date on an active
issue are all click-to-edit inline:

- **Description** — click the text, edit in place, click away to
  save. Cmd/Ctrl+Enter also saves; Escape cancels.
- **Delete via the description** — clear the description text
  entirely and blur (click away). That deletes the commitment
  (soft delete, same as the /commitments trash gesture). The row
  falls back to the add-commitment state and the clarity dot
  disappears with it.
- **Owner** — click the name to open an inline dropdown, pick
  a new owner, the row rerenders. Same picker /commitments uses.
- **Due date** — click the date to open the reschedule editor.
  Non-admins are asked for a one-line reason (patterns stay
  visible over time); admins can shift the date in one click.
  Save/Cancel buttons here rather than blur-to-save, so the
  reason field can't be lost by a stray click outside.

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
decides what to do with each one. Two shortcuts per row:

- **Add to open issues** — the issue joins the open backlog on
  `/issues` where a leader can add the desired outcome, a
  commitment, and an owner. Standard flow when the team wants
  to work the issue further. Post-click the row flips to a green
  *Added as issue* chip.
- **Resolved in meeting** — the issue lands in the *Resolved
  issues* section right away with no *What we want*, no
  *Commitment*, and no *Assigned to*. Use it when the team
  already talked the issue through in the meeting and there's
  no follow-up work needed. Post-click the row flips to a green
  *Resolved in meeting* chip; the *Due date* on that row shows
  the date the button was clicked. So if you're scanning
  `/issues` later and see a resolved row with no commitment or
  owner, that's how it got there.

First click wins between the two shortcuts — a second click on
the other button is a no-op, and the label persists across
page refreshes (the chip is seeded from the issue's status in
the database, not just in-memory state).

If the extraction flagged something similar to an issue you
already added recently, you'll see a small *Possibly already
captured* badge on the meeting summary row. Click it — a callout
opens with the matched text quoted and a link to the surface
(/issues or /commitments) where the near-duplicate lives, so you
can check before adding a second one. It's a hint, not a block —
add it anyway if the resemblance is coincidental.

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

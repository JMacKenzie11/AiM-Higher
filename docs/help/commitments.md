---
title: Commitments
---

# Commitments

This is where the work lives, one week at a time. Every commitment
is *owned*, *dated*, and in one of four states: **open** (not
started), **kept on time** (delivered on or before the due date),
**kept, but late** (delivered after the due date — still a keep,
just late), or **missed** (not done). Late keeps use the same
success check as on-time keeps with a small clock badge — the
signal is "did the work," not "failed." Follow-Through Rate counts
only on-time keeps in the numerator; late keeps and misses are in
the denominator only.

## Common things people do here

- **Resolve a commitment** — click the circle at the left of the
  row to open a small menu. Options depend on state:
  - Open (on time): *Mark kept* · *Reschedule* · *Park*
  - Open (overdue): *Mark kept (late)* · *Reschedule* · *Park*
  - Parked rows: *Bring back*
  - Kept or Missed: *Reopen*
  A "Marked kept · Undo" chip appears in the row for **30 seconds**
  after each resolve so a misclick during a meeting can be reversed
  without hunting.

  Notice there's no *Mark missed* in the menu. If the work got
  done, use *Mark kept (late)*. If it didn't happen this week,
  either *Reschedule* (you'll do it later) or *Park* (set aside).
  The Missed state still exists in the system — it's used by the
  ongoing-weekly rollover when a week ends unresolved, and by
  admin tooling — but owners don't reach it from the row menu.
- **Late keeps** — when you mark an overdue commitment kept, an
  optional "What slowed it down?" strip appears with a **Skip**
  button. The reason is welcome but never required. Admins skip
  the strip entirely — they can mark kept-late in one click.
- **Park a commitment** — pick *Park* from the menu. The row moves
  to the Parking Lot section at the bottom of the page and is
  excluded from all counts, overdue logic, and Needs Attention. No
  reason required. Bring it back any time via the *Bring back*
  menu item; you'll pick a fresh due date and it re-enters the
  weekly flow.
- **Ongoing (weekly) commitments** — tick the *Ongoing (weekly)*
  box next to the date picker when adding a commitment. Ongoing
  rows always show a current due date; resolving them records the
  resolution for the completed week and rolls the due date forward
  to the same weekday next week. One row, many weeks of history —
  each week counts individually in Follow-Through math. On the row
  itself, the "Ongoing (weekly)" chip is a click-to-stop
  affordance — clicking it converts the row back to a one-shot
  commitment due at its current date.
- **Reschedule** — pick *Reschedule* from the circle menu (or
  click the due date directly). Move the row and capture a short
  reason for the shift. Admins can reschedule any date — including
  past-due ones — without a reason.
- **Open a person's quick view** — click the owner name on any row
  to slide open a right-side drawer with their Follow-Through Rate
  this quarter, kept-on-time / kept-late / missed / open counts, a
  Coach button (admins and managers), and a link to the full
  scorecard. Reassigning to someone else happens inside the drawer
  too — one gesture deeper so an accidental click can't change
  ownership.
- **Add a commitment** — the always-live row at the bottom of
  *This week* creates one on save. Enter submits from any field;
  focus jumps back to the description for the next one. Tick
  *Ongoing (weekly)* if the work repeats every week.
- **Edit the description** — click the commitment text to swap in
  an inline editor. Save (⌘/Ctrl-Enter) commits the change;
  Escape or Cancel reverts.
- **Delete a commitment** — the trash icon sits to the right of
  the resolve circle when you have permission. Deletes are **soft
  deletes**: the row hides from every list and metric but is
  retained internally for potential future coaching-signal work.
  No user-facing recovery UI — treat delete as final for practical
  purposes.

## Admin exemptions

System admins and company admins (and AiMS guides on their
assigned companies) are exempt from all reason requirements:

- They can mark any commitment **kept on time, kept late, or missed**
  in one click, no reason.
- They can **change any due date** in one click, no reason.
- They can act on past-due dates the same as on-time ones.

Every admin-driven resolution is stamped with the resolving role
so the coaching context can distinguish "no reason given by the
owner" from "resolved by an admin in the weekly meeting on
someone else's behalf."

## Heads-up

- **Yours this week** — as a team member, your own commitments
  are pinned in their own section at the top of the page (below
  Needs Attention if you have overdue rows). No more scanning the
  whole team's list for your name.
- **Needs attention** — anything past-week that's still open sits
  in its own red-titled section pinned above This week. The
  header pill counts the same set.
- **Follow-Through Rate** hover — the label on the header pill and
  on any scorecard has a dotted underline; hover or focus to see a
  one-sentence definition.
- **Kept late** — appears distinctly wherever kept counts appear
  (dashboards, person scorecards, the person quick-view drawer).
  It's a "did the work" signal, not a failure.
- The **clarity dot** to the right of the resolve circle shows
  whether the commitment has a stated timeline and a well-defined
  finish line. Click it to open the quick clarity editor.
- Priority linking is frozen once a commitment resolves — this
  keeps priority progress history from silently rewriting itself.
- Rows tagged *From meeting* were extracted from a transcript; the
  chip links to the analysis for admins.
- **Meeting-extracted dates** — when a transcript doesn't state a
  specific deadline, the extracted commitment defaults to
  **meeting date + 7 days**. Explicitly stated dates come through
  as-is. Extraction never lands a nearer-than-7-days guess just
  because someone said "aim for Tuesday" without agreeing.

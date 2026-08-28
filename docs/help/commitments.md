---
title: Functional Commitments
---

# Functional Commitments

Every commitment your team has made, one week at a time. Rows are
*owned*, *dated*, and in one of four states: **open**, **kept on
time**, **kept, but late**, or **missed**. Late keeps use the same
success check as on-time keeps with a small clock badge — the
signal is "did the work," not "failed."

## What you can do here

::: role team_member
As a team member, you can:

- **Add and resolve your own commitments** — the always-live
  add row is at the bottom of *This week*.
- **See your own row set** pinned in a *Yours this week* section
  at the top of the page.
- **Mark your commitments kept, kept-late, or reschedule** them.
- **Reassign a row you own** by clicking the owner name — an
  inline dropdown opens, pick the new owner, done. Same picker
  the Issues page uses.
:::

::: role company_admin,aims_guide,system_admin
As an admin or guide, you can also:

- **Resolve any commitment on the team's behalf** — kept, kept
  late, or missed, in one click, no reason required. Reason
  requirements only apply to owners resolving their own rows.
- **Reschedule any commitment** — including past-due dates — in
  one click without a reason.
- **Reassign a commitment** by clicking the owner name on any
  row. The inline dropdown opens; pick a new owner. Same picker
  the Issues page uses.
- **Force-classify a past-due keep as on-time** for retroactive
  corrections (via the resolve menu). Every admin-driven
  resolution is stamped with the resolving role so coaching
  context can tell "no reason given" from "resolved by admin".
:::

## How to read a row

Every row group (Needs attention, This week, prior weeks,
Parking lot) has a labelled column header above it:
**Commitment / Assigned to / Priority / Due date / Status**.
The header matches the Issues page so the two surfaces read as
siblings. On narrow screens the row grid collapses to a stacked
layout and the header hides.

## How to resolve a commitment

Click the circle at the left of the row to open the menu. Options
change based on state:

- **Open (on time):** Mark kept · Reschedule · Park
- **Open (overdue):** Mark kept (late) · Reschedule · Park
- **Parked:** Bring back
- **Kept or Missed:** Reopen

A *Marked kept · Undo* chip stays visible for **30 seconds** after
each resolve — a misclick in a meeting is easy to reverse.

Notice there's no *Mark missed* in the menu. If the work got
done, use *Mark kept (late)*. If it didn't happen this week,
either *Reschedule* (you'll do it later) or *Park* (set aside).
Missed still exists as a state — it's used by the ongoing-weekly
rollover and by admin tooling — but owners don't reach it from
the row menu.

## How to add an ongoing (weekly) commitment

1. In the add row, tick **Ongoing (weekly)** next to the date
   picker.
2. Save. The row shows a current due date; resolving it records
   the resolution for that week and rolls the due date forward
   seven days.
3. To stop it repeating: click the *Ongoing (weekly)* chip on
   the row itself — it converts back to a one-shot commitment
   due at its current date.

## How to park a commitment

Pick *Park* from the resolve menu. The row moves to the Parking
Lot section at the bottom of the page and is excluded from every
count, overdue check, and Needs Attention grouping. No reason
required. Bring it back via *Bring back* — you'll pick a fresh
due date and it re-enters the weekly flow.

## Common questions

**What's in *Needs attention*?** Anything past-week that's still
open. Pinned red-titled section at the top. Header pill counts
the same set.

**Why is my Follow-Through Rate not counting late keeps?**
Follow-Through Rate counts only *on-time keeps* in the numerator;
late keeps and misses land in the denominator. Late keeps still
show as "did the work" in every other view.

**What's the clarity dot next to the resolve circle?** It shows
whether the commitment has a stated timeline and a well-defined
finish line. Click it to open the quick clarity editor.

**Can I change which priority a resolved commitment links to?**
No — priority linking is frozen once a commitment resolves, so
priority progress history doesn't silently rewrite itself.

**A row is tagged *From meeting* — what does that mean?** It was
extracted from a meeting transcript. If no specific date was
stated in the meeting, the extracted commitment defaults to
**meeting date + 7 days**. Auto-creation depends on the
*Automated Commitment Tracking* company feature.

**Where are my issue-linked commitments?** Not here — those live
on `/issues` (Workspace → Issues/Solutions) alongside the issue
they're moving forward. They still show on personal surfaces
(your Guide HQ *My commitments*, your scorecard).

**Is a delete recoverable?** Not through the UI. Deletes are soft
(the row is hidden from every list and metric), but there's no
end-user recovery flow. Treat as final.

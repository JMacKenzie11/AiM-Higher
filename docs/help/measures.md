---
title: Critical Success Factors
---

# Critical Success Factors

Two levels, one page.

A **Critical Success Factor** is a result a function is accountable for.
It is a lagging measure: by the time it moves, the work that moved it is
already done. "All jobs invoiced by month end."

A **Key Performance Indicator** is a leading measure that drives it. It
is something a person can act on this week. "Jobs closed out within two
days of completion."

Both carry a target and a weekly value. The difference is not how they
are tracked, it is what they tell you. A CSF tells you where you ended
up. A KPI tells you whether you are going to like where you end up.

Everything is grouped by function, because a function head owns their
own critical success factors and the KPIs beneath them.

## The two sections

1. **The board** — 13 weeks of every measure against its target, across
   every function. Only shown when Success Tracking is on. Opens on
   **Timeline**.
2. **The manager** — every function's critical success factors, the KPIs
   under each, and the inputs for this week's values.

## What you can do here

## Who sees what

Everyone in the company reads every function. These are the company's
commitments to itself, and someone who cannot see what their own
function is held to cannot align to it.

Writing is narrower, and it works per function rather than per person:

- **The Lead or the Track** on a function types this week's values for
  it. Everywhere else they see the numbers, not input boxes.
- **Admins and guides** can type on any function, and can switch to
  *Edit setup* to add, edit and archive.
- **Everyone else** reads. No inputs, no save, no edit controls.

::: role team_member
As a team member, you can:

- **Read the board.** *Timeline* shows one row per function, each week
  rolled into a single cell, so you can see which functions have been
  drifting. *Grid* breaks each function into per-measure sparklines.
- **Log this week's numbers** for any function you lead — the critical
  success factor's own value and each KPI under it. Type into the *This
  week* boxes, then press the save button in that function's card.
- **Filter by status.** The *On target* / *Off* / *Not yet logged* chips
  narrow the list. They are multi-select; click again to clear.
- **See the last three weeks** in the *Recent* column, as coloured
  pills.
- **Fix a bad number.** Retype and save. Values are keyed on the measure
  and the week, so the last one wins.
- **Log from your phone.** Click a measure name for a single big input.
:::

::: role company_admin,aims_guide,system_admin
As an admin or guide, you can also:

- **See every function in the company**, not just your own seats.
- **Add a critical success factor** to any function.
- **Rename one** by clicking its title, or click the note beneath it
  to write why it matters. Both save when you click away.
- **Add a KPI** under any critical success factor.
- **Edit a measure** — description, target, value type, direction,
  update frequency, and whether it is chased when a value is missing.
- **Archive** a critical success factor or a KPI. Archiving is soft;
  past weekly values stay.
- **Log a value for anyone**, using the same inputs the leader sees.
:::

## Saving

Each function has its own save button, inside its own card. There is no
single save for the whole page, because there is no single person who
fills the whole page in. A function head saves their function.

An admin or guide sees every function and can enter numbers for someone,
one function at a time.

## How often a measure is expected

Every measure has an update frequency: **every week**, **every two
weeks**, or **every month**.

The clock starts from when the measure was created, not from the
calendar. A monthly measure created in the second week of the month is
expected in the second week of every month after that.

This is what the system chases on. A monthly measure is not "missing"
three weeks out of four.

## What happens when a number is late or bad

A job runs on Saturday morning and looks at every measure that was due
that week.

**No value logged** creates a **commitment** for the person who owns the
function: *"Log this week's value for [measure]."* Due at the end of the
same week, so it closes as soon as the number is in. This is an
administrative nudge, so it is a commitment.

**A value below target** raises an **issue**: *"Off target: [measure]."*
Missing a target is a business problem, not an admin task. It belongs
where the team discusses problems, not on someone's to-do list.

Both apply to critical success factors and KPIs.

Turn off *chase this measure* in the measure's edit form for numbers you
track as context rather than as a target, like headcount.

## Targets

A KPI needs a target. A leading measure with no target is not telling
anyone anything.

A **critical success factor does not have to have one**. Some results
are named before anyone has worked out what good looks like, and forcing
a number at that point produces a made-up one. A CSF with no target
still collects values and still appears on the board; its cells read as
*no target set* rather than on or off.

## How many KPIs

Two or three per critical success factor is usually right. Past three
the page tells you so.

It is a nudge, not a limit. Some functions genuinely need a fourth, and
a hard cap would only push people into vaguer KPIs that bundle two
things together.

## Archiving

Archiving a critical success factor archives the KPIs under it. A KPI
that outlives the result it was there to move keeps collecting values
and keeps chasing its owner while pointing at nothing.

Restoring a CSF does **not** restore its KPIs, since some of them were
probably archived deliberately beforehand.

Nothing hard-deletes from this page, so past weekly values survive.

## When Success Tracking is off

- The board is hidden.
- The manager drops the filter chips, the *Recent* column, the *This
  week* inputs, the status dots and the save buttons.
- What is left is a place to write down critical success factors and the
  KPIs beneath them.

Turn the entitlement on from company settings and the tracking columns
appear on the next load.

## Where else values can be logged

- **Quick log** (`/measures/[id]`) — one measure, one big input.
- **Dashboard, *Pending this week*** — the measures a leader has not
  logged yet.

Every route writes the same row, keyed on the measure and the week.

## Common questions

**Are these the old Outcomes and Key Success Measures?** Yes. An outcome
became a critical success factor and a key success measure became a KPI.
The rename came with a real change: a critical success factor is now
measured itself, where before it was only a heading.

**Can one KPI drive more than one critical success factor?** The data
allows it. The screen does not, yet. A KPI is attached to one CSF today,
and that can be opened up later without a migration.

**Where did the add-measure flow on the chart page go?** Here. The chart
function page shows a summary and links back. The chart stays a chart.

**Who sees which functions?** Team members see the functions they lead.
Admins see everything in the company. Guides see everything in each
company they are assigned to.

**Do guides have admin access?** Yes, on their assigned companies. They
can add, rename and archive, and log values for anyone.

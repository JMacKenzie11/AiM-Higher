---
title: Critical Success Factors
---

# Critical Success Factors

The numbers each function is held to, week by week, in one table grouped by function. Each critical success factor has a name, an optional target, and a number someone puts in each week.

For example: "Zero lost time incidents" or "Percentage of reports accepted first submission".

::: role team_member
## What you can do here

- **Read every function.** Everyone at your company can see every function's numbers.
- **Log your function's numbers.** If you lead a function, you get an input box on its rows. Type this week's value and click **Save** above the table.
- **Run your own function's list.** As a function's lead you can also add a critical success factor, change a target, edit its settings and archive rows you've outgrown. On other functions you see the numbers but no boxes or edit controls.
- **Reorder your function's rows.** Drag a row by its handle.
- **Connect a measure to a spreadsheet or to HubSpot**, for a function you lead, when your company has External Measures turned on.

If you don't lead a function, the page is read only for you.
:::

::: role company_admin,aims_guide,system_admin
## What you can do here

Everything a function's lead can do, on every function:

- **Log a value for anyone**, in any week on the page, not just the two open ones. Correcting an old number is something you just do.
- **Add, edit and archive** critical success factors in any functional area.
- **Reorder rows** within a functional area, and **reorder whole functional areas** by dragging the handle beside the area's name.
- **Connect any measure to a spreadsheet or to HubSpot**, when your company has External Measures turned on.
:::

::: role portfolio_admin
## What you can do here

Read every function's critical success factors, targets and weekly numbers. Changes are made by the company's own people.
:::

## Reading the table

It's laid out like a spreadsheet: Functional Area, Owner, Critical Success Factor, Frequency, Target, then one column per week. Functional Area and Owner are written once per function.

**Weeks are named by the day they start.** A column headed *14* is the week beginning Monday 14 September. A week belongs to the month it starts in, so the week beginning Monday 28 September sits under September even though it runs into October.

**It opens on this week.** You can reach a rolling twelve months. The current month is open, and earlier months are folded to one column each. Click a month to open it, and click again to fold it. A folded month shows only its name.

**Two weeks take a value: this one and the one that just closed.** Both are tinted. A week stays open until the end of the following week, so a number asked for on Tuesday can go in any time up to the next Friday. After that it locks and is there to read.

**The count beside Save** only counts your own rows, for the week that just closed, since that's the one with a deadline. For example: *"2 of 6 still to log for the week beginning 31 Aug."* If you have nothing to log, it says nothing.

**The scrollbar sits above the table** and moves only the week columns. Drag it, click the track to jump, or use the arrows at either end to move about a month at a time.

**On a phone the whole table slides.** It opens on the names, so swipe left to reach the current week.

## How often a measure is expected

Each measure is due **every week**, **every two weeks**, or **every month**. The Frequency column shows which.

- **Monthly** measures get one box that stretches across the month's columns. Put the number in whenever you have it. It's due in the month's last week.
- **Every two weeks** counts from the week the measure was created, not the calendar.
- A week a measure wasn't due is shaded, not marked missing, and nobody is chased for it.

## Adding and editing

**Add a critical success factor** opens a panel at the side where you set everything at once: functional area, name, target, value type, direction, units, how often to update, and whether it shows on the company dashboard. Each row has a **pencil** to open the same panel and a **bin** to archive it. You only see these on functions you can change.

Close the panel with **Cancel**, the **✕**, the Escape key, or by clicking outside it.

**Archiving** takes a measure off the page and keeps its past weekly values on file.

## Targets

**A target is optional.** A measure with no target still collects values and still gets a chart, with no target line. A list with several blank targets is usually worth tidying up.

**Changing a target doesn't rewrite the past.** Each week is judged against the target in force when it closed. A change applies from the week you're in. The grid marks the week a target moved with a line down the left of the cell. Hover it to see the old and new target.

## Value types and units

Each measure has a **Value type**:

- **Number** shows what you entered: 38.6
- **Currency ($)** shows $1,234
- **Percent** shows 13%
- **Yes/No** shows what you typed: Yes, Green

If a number shows without the % or $ you expected, change the value type.

**Units** is for big numbers, on Number and Currency only. Set it to *Millions* and you type 18 to mean eighteen million, and the page shows $18M. Set the target the same way.

A Yes/No measure has no direction, so that setting disappears and the target shows as Yes.

## Putting things in order

Drag a critical success factor by its handle to move it within its functional area. With the keyboard, focus the handle and press the up or down arrow. The order you set is what everyone sees, on every device.

::: role company_admin,aims_guide,system_admin
Drag a functional area by the handle beside its name to move the whole block. It moves among the areas at the same level of the chart. It can't move to a different level, because that changes the chart itself.
:::

## The company dashboard

**Show on company dashboard** decides whether a measure gets a chart on the Dashboard. It's on by default. This page always shows everything.

A function only appears on the Dashboard if at least one of its measures is switched on.

The Dashboard also has a 13-week board with the same name as this page, under *What's worth knowing today*. *Timeline* rolls each function's week into one cell so you can see who's drifting. *Grid* shows a small chart for each measure. It appears once at least one value has been logged.

## Connecting a measure to a spreadsheet

When your company has External Measures turned on, a measure can take its weekly number from a Google Sheet or from HubSpot instead of someone typing it. Choose which under *Source*. The fields are at the bottom of the add and edit panel. They're never required. On a new measure, they become usable once the measure is saved, and the panel stays open so you can fill them in.

You name two column headings: the one holding dates and the one holding the number. It finds the row for the week and reads the number across from it.

- Any date inside the week works: Monday, Friday, or the day the report was run.
- If several rows fall in one week, it takes the **last** one. A sheet with a row per day gives you the last day's figure, not the week's total. If you need a weekly total, put a weekly row in the sheet.
- Headings are matched by name, not column letter, so inserting a column won't point it at the wrong one.
- The scheduled pull runs after the week ends and records the week's number. If someone pressed **Pull now** during the week, that running total is replaced by the week's final number when the scheduled pull runs. A number someone typed is never replaced.

## Connecting a measure to HubSpot

Choose *HubSpot* as the source. Your company's admin first adds a HubSpot key on *Connections*, in Company settings. The pipelines and stages come from your HubSpot, so you pick them from a list.

- **Weekly** gives a total for each week: the deals' amounts added up, or the number of deals. Choose which date places a deal in a week: the date it entered a stage, or the date it was created. For "won this week", choose the date it entered your won stage. HubSpot records that date itself, so it can't be typed to suit a forecast the way Close date can.
- **Snapshot** adds up the deals in the stages you tick, as they stand when the pull runs: at their full amount, or at their weighted amount (amount × probability). Add a second part to combine them, for example won deals at full amount plus quoted deals weighted. A snapshot can't be worked out for past weeks, so it starts the week it's first pulled.
- Amounts are in your HubSpot account's main currency. A deal with no amount adds nothing, and the receipt says how many there were.
- *Verify* shows what a pull would read now, without recording anything.
- If a stage the measure counts is removed in HubSpot, the pull records nothing and says so. Choose the stages again.

## Success Tracking

Success Tracking is a company setting. It doesn't change anything on this page. When it's on:

- On Friday, the person who leads a function gets a reminder in the notification bell for any measure they haven't logged: *"Log this week's numbers."* It's a reminder only. Nothing lands on anyone's commitments.
- On Tuesday morning, a measure that came in below target for the week just finished raises an issue on Issues/Solutions: *"Off target: [measure] (42 vs. target 55)."* You get one issue per measure, and it stays open while the measure stays below target. Once it's resolved, it can be raised again if the measure slips back.

Nobody is chased for a number that was logged or came in from a connected spreadsheet.

## Common questions

**Where do I log a number?** Here, in the row itself. This is the only place values are entered.

**How do I know what I still have to log?** The count beside Save, and the notification bell.

**Why can I see functions I have nothing to do with?** The numbers a company holds itself to are shared with everyone. You can read every function and type only into the ones you can change.

**Where did KPIs go?** There's one level now. What used to be a KPI is a critical success factor, with its target and every logged week kept.

::: role company_admin,aims_guide,system_admin
**Do guides have admin access here?** Yes, on the companies they're assigned to. They can add, edit and archive, and log values for anyone.
:::

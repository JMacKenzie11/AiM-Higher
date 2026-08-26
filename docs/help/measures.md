---
title: Key Success Measures
---

# Key Success Measures

The weekly logging surface for every metric an owner has on file.
The page has two sections stacked: **Board (read) at the top**, and
the **batch scoreboard (write) at the bottom**.

## What you can do here

::: role team_member
As a team member, you can:

- **Read the Board** — a 13-week read of metric performance vs.
  target across every function. Toggle *Grid* to see per-metric
  sparklines on function cards, or *Timeline* for cross-function
  patterns row-by-row.
- **Log this week's numbers** — the scoreboard at the bottom
  shows every metric you own with a coloured input per row. Type
  a value, click *Save week*.
- **Focus on what's slipping** — toggle *At-risk only* to hide
  rows that already hit target for the week.
- **Fix a bad number** — retype and save. The row upserts on
  `(measure_id, week ending)`, so the last value wins.
- **Log from your phone** — click a metric name (or open its
  deep link) for a big, centred single-metric quick-log input.
:::

::: role company_admin,aims_guide,system_admin
As an admin or guide, you can also:

- **See every metric in the company** in the scoreboard, not
  just the ones on your seats — useful for covering a leader
  who's out or a seat that's vacant.
- **Log a value on anyone's behalf** from the scoreboard or from
  the metric's quick-log page.
:::

## How to log the week

1. Type a value into every row you have data for. Leave the rest
   blank — a blank row is a skip, not a clear.
2. Click *Save week*. The three chips at the top count
   on-target / off / not-yet-logged for the current week; colours
   match the row input.

## Where else to log a value

- **Metric quick-log** (`/measures/[id]`) — one metric, one big
  input, phone-friendly. Click a metric name in the scoreboard.
- **Chart function page** — the value pill on any metric row
  accepts a number inline. Blur or press Enter to save; a green
  check flashes on success.

All three surfaces write to the same row, upserted on
`(measure_id, week ending)`.

## Common questions

**Who sees which metrics on the scoreboard?** Leaders see metrics
on functions where they're in the seat. Admins see every metric
in the company. Guides see everything for their assigned company.

**What if I miss a week?** With Success Tracking on, missing a
week's update triggers an auto-commitment on Saturday reminding
the leader to log it. Turn a measure's *auto-track* off if it's
context (like headcount) rather than a target to hit.

**Success Tracking is off — why can I still log values?** The
scoreboard still logs. What stays off until the entitlement
flips: target is optional on new metrics, and the Saturday
auto-check doesn't fire.

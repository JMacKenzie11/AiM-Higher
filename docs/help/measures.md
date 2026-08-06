---
title: Success Measures
---

# Success Measures

The weekly logging surface for every metric an owner has on file.
Reach it from *Disciplines ▾ → Success Measures* (visible when the
company has Success Tracking on **or** at least one metric has been
added on the chart) or from the *This week's numbers* card on the
dashboard.

There are three places to log the current week:

1. **/measures scoreboard** — a table of every metric you own with a
   coloured input per row, three history pills, and a status dot.
   Best when logging several metrics in one sitting.
2. **/measures/[id] quick-log** — one metric, one big input, phone-
   friendly. Reach it by clicking a metric name in the scoreboard or
   from a deep link.
3. **Chart function page** — click the value pill on any metric row
   on the function's detail page and type a number. Blur or press
   Enter to save; a green ✓ flashes on success.

And one place to *read* the story across every function:

- **/measures/board — Success Tracking Board.** Two toggleable
  views over the last 13 weeks: a *Grid* of function cards (each
  card is a compact metric × week heatmap, ranked worst first),
  and a *Timeline* where each function is a row of rolled-up
  weekly cells so cross-function patterns pop. Deep-link from the
  batch scoreboard or open directly.

All three write to the same row in `success_measure_entries`, upserted
on `(measure_id, week ending)`, so the last value wins.

## Common things people do here

- **Log the week** — type a value into every row you have data for,
  leave the rest blank, click *Save week*. A blank row is a skip,
  not a clear.
- **See where you stand** — the three chips at the top of the
  scoreboard count on-target / off / not-yet-logged for the current
  week. Colours match the row input.
- **Focus on what's slipping** — toggle *At-risk only* to hide the
  rows that already hit target for the week.
- **Fix a bad number** — retype the value and save. The row upserts
  on `(measure_id, week ending)`.
- **Log from your phone** — open a metric's quick-log page. The
  input is centred and large enough to punch in without fumbling.

## Heads-up

- **Who sees what** — leaders see metrics on the functions where
  they're in the seat (Lead or Track). System admins and company
  admins see every metric in the company so they can cover for a
  leader who's out or a seat that's vacant. Guides see everything
  for the companies they're assigned to.
- **Missed weeks** — if the company has Success Tracking on, missing
  a week's update triggers an auto-commitment on Saturday reminding
  the leader to log it. Turn a measure's *auto-track* off if it's
  context (like headcount) rather than something to hit a target on.
- **Success Tracking off but metrics defined** — the nav link still
  shows and the scoreboard still logs values. What stays off until
  the entitlement flips: target is optional on new metrics, and the
  Saturday auto-check doesn't fire.

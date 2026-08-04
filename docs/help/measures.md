---
title: Success Measures
---

# Success Measures

The weekly logging surface for every success measure in play — one
row per measure, one input for the current week, a mini trend of the
last few weeks to the right. Save-all writes them in a single upsert.
Reach it from *Company ▾ → Success Measures* (visible when Success
Tracking is on) or from the *This week's numbers* card on the
dashboard.

## Common things people do here

- **Log the week** — type a value into every row you have data
  for, leave the rest blank, click Save. A blank row is a skip,
  not a clear.
- **Come back later** — partial saves are fine. The rows you
  already logged stay logged; the blank ones will still be waiting
  next time.
- **Fix a bad number** — retype the value and save. The row upserts
  on `(measure_id, week ending)`.

## Heads-up

- **Who sees what** — leaders see measures on the functions where
  they're in the seat. System admins and company admins see every
  measure in the company so they can cover for a leader who's out
  or a seat that's vacant.
- **Missed weeks** — if the company has Success Tracking on, missing
  a week's update triggers an auto-commitment on Saturday reminding
  the leader to log it. Turn a measure's *auto-track* off if it's
  context (like headcount) rather than something to hit a target on.

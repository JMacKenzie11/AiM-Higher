---
title: This week's numbers
---

# This week's numbers

The weekly logging surface for every success measure you own — one
row per measure, one input for the current week, a mini trend of
the last few weeks to the right. Save-all writes them in a single
upsert.

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

- You'll only see measures on functions where you're in the seat
  (i.e. `leader_id` on the function is you).
- If your company has Performance Tracking on, missing a week's
  update triggers an auto-commitment on Saturday reminding you to
  log it. Turn a measure's *auto-track* off if it's context (like
  headcount) rather than something to hit a target on.

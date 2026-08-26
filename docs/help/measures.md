---
title: Key Success Measures
---

# Key Success Measures

One surface for two jobs: **defining what "winning" looks like**
(outcomes + the measures under them) and **logging weekly values**.
Grouped by function so a leader scanning their seats and a coach
scanning the whole company both find rows without a search.

Sections stack top-to-bottom:

1. **Board (read)** — a 13-week view of every metric vs. target
   across every function. Only shown when Success Tracking is on.
2. **Manager (author + track)** — every function's outcomes and
   their key success measures. Author inline. When Success Tracking
   is on, each row also shows *recent* pills, a *this week* input,
   and a status dot.

## What you can do here

::: role team_member
As a team member, you can:

- **Read the Board** — 13 weeks vs. target across every function.
  Toggle *Grid* for per-metric sparklines on function cards, or
  *Timeline* for cross-function patterns row-by-row.
- **Log this week's numbers** on any key success measure under a
  function you lead. Type into the *This week* input, click *Save
  week* at the bottom.
- **Filter by status** — click the *On target* / *Off* / *Not yet
  logged* chips at the top to narrow the manager. Chips are
  multi-select; click again to clear.
- **See prior weeks at a glance** — the *Recent* column shows the
  last three weeks as coloured pills (green on target, red off).
- **Fix a bad number** — retype and save. Rows upsert on
  `(measure_id, week ending)`, so the last value wins.
- **Log from your phone** — click a measure name (or open its
  quick-log deep link) for a big, centred single-metric input.
:::

::: role company_admin,aims_guide,system_admin
As an admin or guide, you can also:

- **See every function in the company** in the manager, not just
  the ones on your seats.
- **Add an outcome** to any function via the always-live *Add an
  outcome* row at the bottom of the function block.
- **Rename an outcome** inline (click the title). Open *Details* to
  edit the "why this matters" description or archive the outcome.
- **Add a key success measure** to any outcome via the always-live
  add-measure row under the outcome. Description, target, value
  type; press Enter.
- **Edit a measure** — click *Edit* on any row to expand into the
  full form (description, target, value type, direction, auto-track,
  AI + rule-based coaching hints on the metric quality). Save
  in-place; the row collapses back.
- **Archive an outcome or measure** — archive is soft; historical
  weekly entries stay intact.
- **Log a value on anyone's behalf** — same input the leader sees.
:::

## How the surface changes when Success Tracking is off

When the company doesn't have Success Tracking enabled:

- The Board hides entirely.
- The manager drops its filter chips, *Recent* column, *This week*
  input, status dot, and *Save week* button.
- What's left is a pure authoring surface — every function's
  outcomes and the measures under them, with add/edit/archive
  affordances for admins and guides.

Flip the entitlement on the company settings page and the tracking
columns activate on the next page load.

## How the surface is organised

- **Function heading** — one per function you can see. The heading
  links back to the function's detail page on the chart.
- **Outcome block** — one per outcome. Header shows the outcome
  title (admin: click to rename) + optional description +
  *Details* / *Archive* buttons.
- **Measure rows** — dense grid of measures under the outcome.
  Columns adapt to tracking on/off and role.
- **Add rows** — always-live inputs for adding an outcome (per
  function) and a measure (per outcome). Enter to save; focus
  returns for the next entry.

## Where else to log a value

- **Metric quick-log** (`/measures/[id]`) — one metric, one big
  input, phone-friendly. Click any measure name in the manager.
- **Dashboard *Pending this week*** — inline entry for the measures
  the leader hasn't logged yet.

All surfaces write to the same row, upserted on `(measure_id, week
ending)`.

## Common questions

**Where did the "add measure" flow on the chart page go?** It moved
here. The chart function page shows a compact summary and a link
back to *Key Success Measures* — the chart stays a chart.

**Who sees which functions in the manager?** Team members see
functions they lead. Admins see every function in the company.
Guides see every function in each company they're assigned to.

**Does a measure need a target?** With Success Tracking on, yes —
every new measure requires a target (server rejects the create
otherwise). With Success Tracking off, target is optional.

**What if I miss a week?** With Success Tracking on, missing a
week's update on an `auto_track` measure triggers an auto-commitment
on Saturday reminding the leader to log it. Turn *auto-track* off
in the measure's Edit form if it's context (like headcount) rather
than a target to hit.

**Why can't I hard-delete an outcome or measure?** Both only
archive from the UI, so past-quarter weekly entries stay intact.

**Do AiMS Guides have admin access?** Yes, on the companies they're
assigned to. Guides can add, rename, and archive outcomes and
measures, and log values for anyone's seat.

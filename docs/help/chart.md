---
title: Accountability chart
---

# Accountability chart

The chart is the org: who owns what. Every function is a box with
a leader, roles & responsibilities they're on the hook for,
success measures for what "healthy" looks like, and metrics under
each one with a target. When *Role Descriptions* is on for the
company, each function also has Decision Rights and Competency
Indicators sections plus a Role Description panel at the bottom
that assembles it all into a publishable document.

## Common things people do here

- **Add a function** — click *+ Add function* at the top of the
  chart card to grow the tree. New companies start with Visionary
  and Integrator seed boxes at the top.
- **Assign a seat** — open a function and click the *In the seat*
  editor to pick from the roster. The seat holder is the single
  person accountable for that function (Lead / Track / Decide are
  all one seat).
- **Edit roles & responsibilities** — click any responsibility
  title to rename it inline (Enter to save, Escape to cancel);
  use the trash icon to delete. The baseline *Lead, Track,
  Decide* row is locked.
- **Add a success measure** — on the function detail page, type
  into the *Add a success measure* row at the bottom of the
  Success Measures section. Enter saves and focus jumps back for
  the next one.
- **Rename a success measure inline** — click the title on any
  Success Measure card to edit in place. Use *Details* on the
  card to open the fuller form (edit "why this matters" or
  archive).
- **Add a metric** — under a success measure card, type into the
  always-live *Add a metric* row: description, target, value type
  (number / percent / yes-no). Enter saves. Direction defaults to
  *higher is better* and auto-track stays on; both are editable
  per-metric via the row's Edit affordance. As you type, a
  coaching panel appears with amber hints when the metric reads
  as vague (e.g. "Do your best") or when the target and value
  type don't line up. On blur, a second-opinion AI check weighs
  in on whether the metric actually measures the parent Success
  Measure. Every hint is advisory — Save stays enabled
  regardless.
- **Get a suggestion** — when *Role Descriptions* is on for the
  company, each list (Responsibilities, Success Measures, Metrics
  under an outcome, Decision Rights, Competency Indicators) has
  a small *Suggest…* pill under its add-row. Click it and three
  ready-to-use options appear as cards, each with **Use this**
  (writes as-is), **Edit** (flip the card into an editable
  version), and **Skip**. **Suggest 3 more** regenerates the
  list. Suggestions are positively-framed, values-aware, and
  written in AiMS voice.
- **Add a Decision Right or Competency Indicator** — when *Role
  Descriptions* is on, two extra sections appear on the function
  page. Same inline add rhythm: type, Enter, focus resets for the
  next one. Trash icon deletes.
- **See the assembled Role Description** — the *Role Description*
  card at the bottom of the function page shows a 5-section
  readiness checklist (Title, Responsibilities, Success Measures
  with metrics, Decision Rights, Competency Indicators). The
  primary button reads *Create role description →* the first
  time and flips to *View role description →* once the doc is
  cached. See the [Role description help](./chart.function._id.role-description.md)
  for what happens on the assembled page.

## Heads-up

- **Delete function** on the function detail page removes the
  function and cascades to its sub-functions, outcomes, measures,
  and recorded weekly values — it's a hard delete. A branded
  confirmation dialog spells out the cascade before the click
  lands so a stray tap can't wipe a tree.
- **Archive vs delete** — success measures and metrics only
  archive (never hard-delete from the UI). This keeps the weekly
  entries intact so past-quarter reports don't lose data.
- **Target required?** — when the company has Success Tracking
  on, every new metric needs a target (server rejects the create
  otherwise). With Success Tracking off, target is optional and
  can be filled in later.
- **Weekly logging isn't here.** Logging this week's value for a
  metric lives on `/measures` and the dashboard, not on the
  function detail page. The function page is for describing the
  metric; the measures page is for logging against it.
- **AiMS Guides count as company admins** on the companies
  they're assigned to. They can edit anything an admin can —
  seats, R&R, outcomes, metrics, decision rights, competencies,
  the role description.

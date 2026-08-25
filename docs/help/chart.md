---
title: Accountability chart
---

# Accountability chart

The org, in one view: who owns what. Every function has a leader,
responsibilities they're on the hook for, success measures for
what "healthy" looks like, and metrics with a target. When *Role
Descriptions* is on for the company, each function also has
Decision Rights, Competency Indicators, and a Role Description
panel that assembles it all into a publishable document.

## What you can do here

::: role team_member
As a team member, you can:

- **See the chart** — every function, who's in the seat, and what
  they own.
- **Open a function** to see its full detail: responsibilities,
  success measures with metrics, and (where enabled) decision
  rights and competency indicators.
:::

::: role company_admin,aims_guide,system_admin
As an admin or guide, you can:

- **Add or delete functions** to grow / shape the tree.
- **Assign seats** — one person per function.
- **Edit responsibilities, success measures, metrics** — all
  inline on the function page.
- **Add Decision Rights and Competency Indicators** (Role
  Descriptions feature on) with the same inline pattern.
- **Get AI-drafted suggestions** for any list (Responsibilities,
  Success Measures, Metrics, Decision Rights, Competency
  Indicators) via the *Suggest…* pill under the add-row.
- **Publish a Role Description** — the panel at the bottom of the
  function page assembles the sections into a shareable doc.
:::

## How to add a function

1. On the chart, click *+ Add function* at the top of the chart
   card.
2. New companies start with **Visionary** and **Integrator** seed
   boxes at the top — build under them.

## How to assign a seat

1. Open a function.
2. Click the *In the seat* editor.
3. Pick from the roster. The seat holder is the single person
   accountable for that function (Lead / Track / Decide are all
   one seat, one person).

## How to add a success measure and metric

1. On the function detail page, type into the *Add a success
   measure* row at the bottom of the Success Measures section.
   Enter to save; focus jumps back for the next one.
2. Under the new success-measure card, type into the always-live
   *Add a metric* row: description, target, value type (number /
   percent / yes-no). Enter to save.
3. Direction defaults to *higher is better*, auto-track stays on;
   both are editable per-metric via the row's Edit affordance.

As you type a metric, a coaching panel appears with amber hints
when the metric reads as vague ("Do your best") or when the
target and value type don't line up. On blur, a second-opinion
check weighs in on whether the metric actually measures the
parent Success Measure. Every hint is advisory — Save stays
enabled regardless.

## How to publish a Role Description

::: role company_admin,aims_guide,system_admin
1. On the function detail page, scroll to the *Role Description*
   card at the bottom.
2. Check the 5-section readiness list (Title, Responsibilities,
   Success Measures with metrics, Decision Rights, Competency
   Indicators). Fill any gaps.
3. Click *Create role description →* the first time. It flips to
   *View role description →* once cached.

See the [Role description help](./chart.function._id.role-description.md)
for what happens on the assembled page.
:::

## Common questions

**What happens when I delete a function?** Hard delete — cascades
to sub-functions, outcomes, measures, and recorded weekly values.
A confirmation dialog spells out the cascade before the click
lands.

**Why can't I hard-delete a success measure?** Success measures
and metrics only archive from the UI, so past-quarter weekly
entries stay intact.

**Do metrics need a target?** When Success Tracking is on,
yes — every new metric requires a target (server rejects the
create otherwise). With Success Tracking off, target is optional.

**Where do I log this week's value for a metric?** On `/measures`
or the dashboard, not here. The function page is for describing
the metric; the measures page is for logging against it.

**Do AiMS Guides have admin access?** Yes — on the companies
they're assigned to, guides can edit anything an admin can
(seats, R&R, outcomes, metrics, decision rights, competencies,
the role description).

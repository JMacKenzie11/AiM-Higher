---
title: Meetings
---

# Meetings

Every meeting transcript this company has run through the analyzer,
most recent first. Click a complete row to open the full analysis
and the commitments the meeting created.

## What you can do here

::: role team_member
As a team member, you can:

- **See the meeting list** — title, received date, and analysis
  status (*pending*, *analyzing*, *complete*, *failed*).
- **Open a completed analysis** — the *View* link on a *complete*
  row opens the meeting summary and the commitments it created.
:::

::: role company_admin,aims_guide,system_admin
As an admin or guide, you can also:

- **Read the facilitation chip** — when *Meeting Facilitation
  Review* is on, each complete row shows a Facilitation chip
  (e.g. *Facilitation 8/10*) on a warm cobalt → chartreuse scale.
  Never red — this is a coaching signal, not a grade. Non-admins
  don't see this column.
- **Investigate a failed row** — the failure reason is surfaced
  inline so you can decide whether to retry (via *Check now* on
  the company settings page) or dig in.
:::

## How to open an analysis

1. Find the row in the meetings list (most recent first).
2. Click *View* — only shown once the row status is *complete*.
3. Read the summary, the derived commitments, and (admin-only)
   the facilitation review.

## Common questions

**Who sees this list?** Meeting summaries here are visible to
everyone at this company. Facilitation reviews and raw
transcripts stay admin-only — those don't appear on this page
for non-admins.

**Why is nothing showing up?** Meetings are ingested from Google
Drive folders connected on the company settings page. If nothing
lands here, that's the first place to look.

**A row is stuck at *pending* or *analyzing*.** The ingest +
analysis pipeline runs asynchronously; give it a few minutes. If
it stalls, admins can hit *Check now* on the company settings
page to force a run.

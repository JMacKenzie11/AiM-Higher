---
title: Guide HQ (oversight view)
roles: [system_admin]
---

# Viewing another guide's Guide HQ

Read-only view of a specific guide's Guide HQ. Everything they'd
see on their own `/hq` renders here — *My commitments* across
companies, the attention queue, the caseload, recent activity —
but every mutation control (resolve, reschedule, park, reassign)
is disabled. Works whether the target is an `aims_guide` or a
`system_admin` carrying a caseload.

## What you can do here

- **Read every panel** exactly as the guide sees it. Nothing
  is redacted; the panels render with the guide's caseload.
- **Jump into a company** via its name link — that scopes you
  in under your own identity; anything you change there is done
  as you, not the guide.
- **Generate a Session Brief** for a company via the
  *Prepare for* button. Briefs have no side effects and the
  brief author is recorded as you, not the guide being viewed.

## What you can't do

- **Resolve, reschedule, park, or reassign** any commitment
  from this page. The controls render disabled by design — the
  oversight view is intentionally passive.

## Common questions

**Why can't I act on a commitment I can see?** By design.
Actions on behalf of another guide would leave confusing audit
trails. Click into the company and act there under your own
identity.

**Whose HQ am I looking at?** The banner at the top names the
guide so it's never ambiguous, and the eyebrow crumb links back
to `/admin/companies`.

**The guide has no assignments.** The empty-state card explains
that. Their own commitments still show below so you can see
what they're carrying personally.

---
title: Companies (admin overview)
roles: [system_admin, aims_guide]
---

# Companies

The fleet view. System admins see every company on the platform;
AiMS Guides see only the companies they're assigned to. Click a
company name to scope into it — the top nav flips to that
company's context. Company admins don't have a list view — they're
redirected straight to their own company's settings page.

## What you can do here

- **Open a company** — click its name in the list. Every module
  (Dashboard, Plan, Chart, etc.) then reads that company's data.
  Use *Exit* in the user menu to drop back out.
- **Open a company's settings** — the per-row *Settings* link
  goes to `/admin/companies/[id]` for that company.

### System admins only

- **Create a new company** — the form below the list creates the
  company, seeds its default Visionary/Integrator functions, opens
  the current calendar quarter, and turns on the features you
  pick. Every module (Execution Platform, Strengths, Success
  Tracking, Meeting Facilitation Review, Classroom, Role
  Descriptions) is available at creation; toggle them later on
  the company's settings page. Industry is optional at creation
  and editable afterwards.
- **Archive or reactivate a company** — row-level actions. Archive
  hides the company from picker lists and stops sign-ins;
  reactivate restores it.
- **Manage AiMS Guides** — the *Guides* card invites external
  coaches, assigns them to companies, and shows each guide's
  current caseload. An `aims_guide` needs at least one
  assignment; you can't unassign their last company (delete the
  guide instead).
- **Give a system admin a coaching caseload** — the mini-form
  below the Guides table assigns an existing sysadmin to one or
  more companies. No invite is sent (they already have an
  account); the row shows with a *System admin* badge. Removing
  a sysadmin's last assignment is fine — their access is
  role-based, not assignment-based.
- **View a guide's Guide HQ** — the row-level button on each
  guide opens their `/hq` read-only. Every mutation control is
  disabled; jump into a company from there to act.
- **Route unrouted meetings** — the platform transcripts panel
  at the bottom lists any meeting that didn't match a company
  alias. Route it or dismiss it.

## Common questions

**Why do guides see so much less?** Guides can't create,
archive, or manage guides. Those actions are system-admin only
by design.

**Why does the *Attention* column on the Guides panel show
"—"?** The per-guide count was removed to keep this page fast as
caseloads grow. The attention queue itself is live on each
guide's `/hq` surface where it actually drives behaviour.

**A company admin landed here.** They're auto-redirected to
their own company's settings page — `/admin/companies` isn't a
list view for them, it's an entry point that resolves to their
one company.

---
title: Company settings
roles: [system_admin, aims_guide]
---

# Company settings

Everything that configures a single company: features (system
admins only), Google Drive transcript folders, transcript aliases
that route shared-folder meetings.

Opening this page also scopes you into the company — the top nav
flips to that company's Dashboard / Chart / Commitments etc., and
the "SYSTEM ADMIN · <company>" sub-band appears with an Exit button.
No separate "open the company" step is needed.

## Common things people do here

- **Toggle features** — the Features card enables or disables the
  modules: *Execution Platform* (commitments, success measures,
  coaching dashboard), *Strengths* (assessments, results,
  strengths-aware coaching), *Success Tracking* (requires targets
  on every success measure and turns on the weekly nudge +
  generative dashboard cards), and *Meeting Facilitation Review*
  (adds a coaching-tone review of how each meeting was run,
  visible on the meeting detail page and as a signal chip on the
  Leadership list). Turning a module off hides it in nav; existing
  data is preserved.
- **Connect Google Drive** — click *Connect Google account*. Each
  company has its own OAuth, so folders can live under different
  Google Workspaces. After connecting, share the transcript folder
  with the connected email as Viewer and paste the folder URL
  below.
- **Add a transcript alias** — a case-insensitive substring on the
  file name that maps a shared folder's meeting to this company.
  Only needed if the folder holds meetings for more than one
  client.
- **Check now** — force-runs the ingest + analysis pipeline for a
  source. Useful right after connecting a new folder.
- **Start a new planning cycle** — the *Planning cycle* card
  (sysadmin only) archives every active SFA, Goal, and Action for
  this company so the team can build the next cycle from a clean
  canvas. Nothing is deleted; records stay on file. Open
  commitments become Operational (unlinked); resolved commitments
  keep their historical link so past-quarter progress is intact.
  The card only appears when there's something to archive.

## Heads-up

- Only sysadmins see the Features card and the Archive action.
- Guides can do everything else here for their assigned company.

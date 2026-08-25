---
title: Company settings
roles: [system_admin, company_admin, aims_guide]
---

# Company settings

Everything that configures a single company: features (system
admins), industry, Google Drive transcript folders and aliases,
and the planning-cycle rollover.

Opening this page also scopes you into the company — the top nav
flips to that company's Dashboard, Chart, Commitments, and so on.
No separate "open the company" step is needed.

## What you can do here

- **Open this company** — the top-of-page action jumps into the
  company's Dashboard. (System admins and guides only — company
  admins are already inside their own company.)
- **Connect Google Drive** — *Connect Google account*. Each
  company has its own OAuth, so folders can live under different
  Google Workspaces. After connecting, share the transcript
  folder with the connected email as Viewer and paste the folder
  URL below.
- **Add a transcript source** — paste a shared-folder URL. The
  ingest pipeline pulls new transcripts from it.
- **Add a transcript alias** — a case-insensitive substring on
  the file name that maps a shared folder's meeting to this
  company. Only needed if the folder holds meetings for more
  than one client.
- **Check now** — force-runs the ingest + analysis pipeline for
  a source. Useful right after connecting a new folder.

### System admins and company admins only

- **Set the industry** — free-text field on the Industry card.
  Displayed in the settings hero, stored on the company row for
  reference and future analytics. Guides don't see this card.
- **Start a new planning cycle** — the *Planning cycle* card
  archives every active Strategic Focus Area, Annual Goal, and
  Priority so the team can build the next cycle from a clean
  canvas. Nothing is deleted; records stay on file. Open
  commitments become Operational (unlinked); resolved commitments
  keep their historical link. The card only appears when there's
  something to archive.

### System admins only

- **Archive or reactivate the company** — under Actions.
- **Toggle features** — the Features card enables or disables
  the modules: *Execution Platform*, *Strengths*, *Success
  Tracking*, *Meeting Facilitation Review*, *Automated Commitment
  Tracking*, *Classroom*, and *Role Descriptions*. Each toggle
  carries a one-line hint. Turning a module off hides it in nav;
  existing data is preserved.

## How to connect Google Drive and start ingesting meetings

1. Click *Connect Google account* and complete OAuth. This links
   the connected email to this company only.
2. In Google Drive, share the transcript folder with the
   connected email as Viewer.
3. Back here, paste the folder URL into *Add source*.
4. If the folder holds meetings for more than one company, add a
   transcript alias — a substring of the file name that
   identifies meetings for this company.
5. Click *Check now* on the source to pull whatever's already
   there. Future transcripts flow in automatically.

## Common questions

**Who can see what on this page?** System admins see everything.
Company admins see Actions (their company can't archive
themselves — only *Open this company* is shown), Industry,
transcripts, and Planning cycle. Guides see Actions and
transcripts, but not Industry or Features or Planning cycle.

**A transcript came in but didn't route to this company.**
Check the alias substring against the file name (case-insensitive
substring match). If no alias applies, the meeting sits in the
unrouted queue on `/admin/companies` for a system admin to route.

**Do features affect existing data?** Turning a module off hides
it in nav; existing data is preserved. Turning it back on brings
everything back exactly as it was.

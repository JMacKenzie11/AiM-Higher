---
title: Company settings
roles: [system_admin, company_admin, aims_guide, portfolio_admin]
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
  reference and future analytics. Guides don't see this card;
  portfolio admins do.
- **Start a new planning cycle** — the *Planning cycle* card
  archives every active Focus Area, Goal, and
  Priority so the team can build the next cycle from a clean
  canvas. Nothing is deleted; records stay on file. Open
  commitments become Operational (unlinked); resolved commitments
  keep their historical link. The card only appears when there's
  something to archive.
  You can run this for your own company as a company admin, or for
  any company in your caseload as a guide. It archives, it does not
  delete, and the counts it reports back are what it actually
  archived.

### Assigned access

Who administers this company without being part of its team. Two
kinds of person show up here, and the Type column tells them apart:

- **AiMS Guide** — assigned to work with this company. A system
  admin or the company's own admin can end that with *Remove from
  this company*. The guide keeps their account and any other
  companies they work with; only their access to this one ends.
- **Portfolio** — a portfolio admin who has taken company admin
  rights here. There is no Remove control on these rows. Portfolio
  access is managed at the portfolio level, and a company cannot
  end it.

These people are not listed on your People page. That page is your
team, and they are not on it.

System admins, portfolio admins and the company's own admins see
this card. Guides do not.

### System admins and portfolio admins only

- **Archive or reactivate the company** — under Actions.
- **Toggle features** — the Features card enables or disables
  the modules: *Execution Platform*, *Strengths*, *Success
  Tracking*, *Meeting Facilitation Review*, *Automated Commitment
  Tracking*, *Classroom*, and *Role Descriptions*. Each toggle
  carries a one-line hint. Turning a module off hides it in nav;
  existing data is preserved. Every change is recorded, so "when
  did this company get Strengths?" stays answerable.
- **Change the timezone** — the Timezone card. **Read this before
  you use it.** Every weekly and daily number in the product is
  bucketed by date in the company's own clock: the scorecard, the
  discipline snapshots, the follow-through window. Moving the clock
  does not migrate anything, it re-asks the question, so counts
  either side of the old midnight will read differently afterwards.
  The last three changes are listed under the control with the name
  of whoever made them. Company admins and guides cannot reach this
  field.

### System admins only

- **Delete the company** — the *Delete* button, which only appears
  once a company is archived. Portfolio admins can archive and
  cannot delete.

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

Portfolio admins see everything except *Delete* — they can change
the name, timezone, industry and features, and archive or
reactivate the company, but not remove one.

Company admins see Actions (their company can't archive
themselves — only *Open this company* is shown), Industry, Assigned
access, transcripts, and Planning cycle. They do not see Timezone:
moving a company's clock re-dates its whole reporting history, so it
sits with the roles that own the portfolio rather than the ones
inside it.

Guides see Actions and transcripts, but not Industry, Assigned
access, Timezone, Features or Planning cycle.

**Why isn't our guide on the People page?** Because People is your
team, and a guide belongs to no company. They appear under Assigned
access on this page instead, where the person who administers the
company can see them and end the assignment.

**A transcript came in but didn't route to this company.**
Check the alias substring against the file name (case-insensitive
substring match). If no alias applies, the meeting sits in the
unrouted queue on `/admin/companies` for a system admin to route.

**Do features affect existing data?** Turning a module off hides
it in nav; existing data is preserved. Turning it back on brings
everything back exactly as it was.

## AiMS champion

This is the person who will lead your implementation of AiMS, and who
Aimee will coach through the process.

Today that means Aimee gets in touch after each leadership meeting is
summarised, inviting them to talk it through. That is where it starts
rather than where it ends: more will follow as the implementation
goes on.

**It grants nothing.** Being the champion does not open anything that
was closed, and taking the seat away does not close anything. Everyone
who could already read a meeting summary still can. The seat decides
who Aimee works with, and that is all it decides.

Anyone on the company's team can hold it. It does not have to be an
admin, and often the right person is whoever actually drives the work
day to day.

**Nobody yet** is a normal setting. With the seat empty, Aimee has no
one to work with at this company and those notes are not sent. Nothing
else changes.

If the person in the seat is deactivated or moves to another company,
the seat empties itself and the company's admins get a note saying so,
because a company that quietly stops hearing from Aimee is worse than
one that knows why.

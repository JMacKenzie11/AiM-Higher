---
title: Coach conversations
roles: [system_admin, company_admin, aims_guide]
---

# Coach conversations

Private coaching threads about a specific person on the roster. You
land here from a teammate's scorecard or from the quick-view drawer.
A privacy note at the top of the list tells you exactly who can
read what.

## What you can do here

- **Start a thread about someone** — the *New conversation* button
  drafts coaching notes about the subject. Available to system
  admins, the subject's company admin, and the subject's direct
  manager.
- **Resume an existing thread** — every thread carries its own
  history; open one from the list to keep the conversation going.
- **Share a thread** — the *Share* button at the top of a coaching
  thread lets you invite another person in your company to read
  or reply. Useful for co-leaders comparing notes on the same
  report. Access is same-company only, granted per-person, and
  the sharee's replies show their name and avatar. See "Who can
  see this" below for the boundaries.
- **Archive a thread** — the row-level action tucks a thread out
  of the way without deleting it.
- **Ask about history** — Aimee can look up what actually happened:
  follow-through by quarter for a person or the whole company,
  how the scorecard has moved week by week, resolved issues with
  everything that was tried against each one, and what past
  quarters planned against what landed. Ask in plain language
  ("is this a pattern or a bad quarter?", "have we tried anything
  on invoicing before?") and Aimee goes and reads the record.

  Two things worth knowing. Aimee only reads what **you** can already
  see — the same records, the same permissions, nothing extra. And
  when the record is thin, it says so instead of calling two data
  points a trend.

## How to start a coaching thread

1. Open the person's scorecard from `/people` or the roster.
2. Click *New conversation*.
3. Type your first note or question. Aimee shows *Thinking…* while
   reading context; once tokens stream, a cursor tracks the
   response.

## Who can see this

Every thread is private to its creator by default. You can
explicitly share a specific thread with another active person in
your company — or an AiMS Guide assigned to it — as *Read-only*
(view only) or *Collaborate* (reply too); nobody
else — including admins, guides, or the subject themselves —
sees the thread otherwise. Another admin or the subject's direct
manager can still create their own separate threads about the
same person, and those stay private to them.

The subject never sees a coaching thread written about them
unless the owner explicitly shares it with the subject. There is
no auto-share.

## Common questions

**I opened a chat from another company and my sidebar didn't
change. Is that right?** Yes, and it changed on purpose. Opening a
conversation used to switch you into its company for the next eight
hours, so the next thing you clicked took you somewhere you hadn't
chosen. Now the conversation reads correctly against its own
company and your scope stays where you put it. To actually move,
pick the company from Guide HQ or the Companies list.



**Where do I self-coach?** Use *Ask Aimee* — anyone landing on
their own coach URL gets redirected there automatically.

**Can I share a thread with another admin?** Yes. Use the
*Share* button at the top of the thread. Choose *Read-only* or
*Collaborate*, pick the person (teammate or assigned guide),
and they'll see the thread in their
Shared with you list — and get a notification in their top-right
bell linking straight into it. You stay the owner and can change
access or remove them at any time.

**Can I share cross-company?** No. Shares are locked to the
conversation's company by app logic, RLS, and a database trigger.
Every layer blocks it independently.

**Are threads deletable?** They can be archived but not deleted.
The subject can't read them unless the owner shares the thread
with them.

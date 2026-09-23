---
title: Agent Hub
roles: [system_admin]
---

# Agent Hub

Controls the agents people meet in Ask Aimee: what each one is
called, what it says it does, which group it sits in, what order
they appear in, and who can reach them.

Changes here apply to every company as soon as you save them.
There is no per-company copy of an agent.

## What you can do here

- **Edit** an agent to change its name, its description and the
  category it sits in. The name is the heading on the card and
  the description is the line underneath it. Nothing is saved
  until you press *Save*, and *Cancel* leaves the agent as it
  was. Moving an agent to a different category puts it last in
  that group; use the arrows on its row to move it up.
- **Access** an agent to choose who can reach it:
    - **Roles.** Check nothing and every role can use it. Check
      one or more and it is limited to those. Guides also need to
      be assigned to the company.
    - **Functional Leads.** Anyone who leads a function as per the
      functional chart, even when their role is not checked.
      Useful for an agent about a function, where the lead is
      usually a team member.
    - **Feature.** Pick a feature and only companies that have it
      switched on can use the agent. Leave it on "No feature
      needed" for an agent that should reach everyone.
- **Move an agent** with the up and down arrows on its row. The
  order here is the order the cards appear in.
- **Hide an agent** to take it off the list people pick from.
  Conversations already using it keep working and keep the
  agent's name. Press *Show again* to bring it back.
- **Add, rename, reorder and hide categories** in the lower card.
  Categories are the headings agents are grouped under.

- **Config** an agent to change what it says and how it behaves:
  its wording, its opening chips, which tools it can use, its
  token ceiling and its model.
    - An agent starts out running the version set in the code.
      **Edit in Hub** copies that into a draft. Nothing changes
      for anyone until you publish.
    - **Save** keeps working on the draft. **Preview** opens a
      real conversation running the draft, visible only to you
      and left out of every usage report. Both save what is on
      screen first, so they always use what you are looking at.
    - **Review and publish** shows what changed against the
      version that is live now, or against the code default if
      nothing has been published. Publish notes are required:
      they are the record of why every company's agent changed.
    - **History** lists every version with its notes and who
      published it. **Make live** puts an older one back, and
      asks for its own note.
    - **Revert to code default** goes back to the version set in
      the code.

## Creating an agent

**New agent** at the top of the Agents card opens a three-step
form: what it is called, who can reach it, and what it says.
Creating saves it as a **draft**, which nobody but a system admin
can see. It does not exist for anyone else until you publish it.

Before you can publish a new agent it needs a name, a description,
a category and a prompt. Everything else has a sensible default.

**Preview it before you publish.** The Config panel has a Preview
button that opens a real conversation running your draft, visible
only to you and left out of every usage report. It is the only way
to find out what the agent actually does before a client meets it.

The publish screen shows a sentence saying who will be able to see
the agent, worked out from the access settings you chose. Read it.
It is the difference between a new agent going to one role and
going to everybody in every company.

**An agent's id never changes.** It is made from the name you first
give it, and every conversation ever run on the agent is filed
under it, so renaming the agent later changes what people see and
not what it is called underneath.

## Sending an agent to other instances

**Distribute** on any agent shows where it stands on every other
instance: current, behind, never sent, or the reason a previous
attempt was refused.

It needs something published first. An agent still running the
version set in the code has nothing to send, and the dry run says
so: open Config, **Edit in Hub**, and publish before you push.

It is always two steps. **Dry run** tells you exactly what would
happen on each instance you picked, including anything you should
know first, like an agent that would go live somewhere no company has
the feature it needs. **Apply** then does exactly that, and nothing
else. Changing which instances you picked throws the plan away, so
you can never apply a plan you have not read.

**Pushing is switched off** until it has been tried against a real
instance for the first time. The dry run works and is safe; the
apply button is disabled and the server refuses it either way.

**Retract** takes the agent out of one instance's pickers. As with
unpublishing here, conversations already running there keep
answering on the version they started with.

An agent you have sent anywhere **cannot be deleted** here. Retract
it from each instance first, then hide it. The record has to stay, or
conversations on those instances lose their name and their wording.

## An agent managed from somewhere else

On an instance that receives agents, one sent from AiMS HQ shows as
**Managed from AiMS HQ** with no edit controls at all. That is not a
permissions quirk to work around: it is authored somewhere else, and
changes to it come from there. The database refuses local edits
regardless of what the screen offers.

## When this page has no controls at all

Agents are built and changed in one place, and shared out from
there. Everywhere else this page is a list: you can see every
agent, what it does and who can reach it, and there is no *New
agent*, no *Edit*, no *Access* and no *Config*.

That is not something to fix or ask to have switched on. If an
agent needs changing for your instance, that change happens where
the agents are built, and arrives here when it is sent.

## Unpublishing versus deleting

These are different, and only one of them is usually what you want.

**Unpublish** takes the agent out of every picker. No new
conversation can start on it, and conversations already running
carry on exactly as they are, on the version they started with. You
can publish it again whenever you like. This is the safe one, and
it is what to use for an agent that is not working out.

**Delete** removes the agent and its drafts for good, and is only
offered while an agent has **never been published**. Once an agent
has been published, conversations may have run on it, and those
conversations need its record to keep their name and their wording.
So a published agent can be unpublished or hidden, never deleted.
Nothing is lost by that: an unpublished agent is invisible to
everyone.

## What you cannot do here

**Delete a published agent.** See above. Unpublish it instead.

**Change an agent mid-conversation.** A conversation keeps the
version it started with for its whole life. Publish while someone
is mid-chat and they finish on what they started with; their next
conversation picks up the new one. This is deliberate, and it is
what makes publishing and reverting safe to press.

## Common questions

**Somebody says an agent has disappeared.** Check two things on its
Access panel: is their role checked, and does their company have the
feature you chose. If neither explains it and the person leads a
function, check whether Functional Leads is checked. The summary line
on the agent's row shows all of it at a glance.

**I hid an agent by mistake.** Press *Show again* on its row.
Nothing was lost: hiding only takes it off the picker.

**Why will a category not hide?** A category has to be empty
first. Move its agents to another category and try again. The
count beside each category name tells you how many it holds,
including any you have hidden.

**An agent row says there is no matching agent in the code.** It
will not appear to anyone. Tell the engineering team rather than
editing around it.

**Does renaming an agent break old conversations?** No. A
conversation stays attached to the agent it started with and
picks up the new name.

**I published something wrong. What now?** Open Config, go to
History, and press *Make live* on the version you want back. It
asks for a note. Anyone mid-conversation was never affected;
anyone starting one after you press it gets the restored version.

**Why does the draft's version number keep going up?** Every save
writes a new version rather than changing the last one. Nothing can
be edited after the fact, which is what lets a conversation safely
keep the exact version it started with.

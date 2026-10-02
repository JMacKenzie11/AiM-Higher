---
title: Agent Hub
roles: [system_admin]
---

# Agent Hub

The Agent Hub is where you build and publish the agents people meet in Ask Aimee: what each one is called, what it says, which group it sits in, what order they appear in, and who can reach them.

Changes here apply to every company as soon as you save or publish them. There's one copy of each agent, shared by every company.

## What you can do here

- **Edit an agent.** Change its name (the heading on its card), its description (the line underneath) and its category. Nothing is saved until you press *Save*, and *Cancel* leaves it as it was. Moving an agent to a new category puts it last in that group.
- **Choose who can reach it.** Open *Access*:
    - **Roles.** Tick nothing and every role can use it. Tick one or more and only those roles can. Guides also need to be assigned to the company.
    - **Functional Leads.** Anyone who leads a function on the Functional Chart, even if their role isn't ticked. Useful for an agent about a function, where the lead is usually a team member.
    - **Feature.** Pick a feature and only companies that have it switched on can use the agent. Leave it on *No feature needed* for an agent everyone should reach.
- **Change the order.** The up and down arrows on each row set the order the cards appear in.
- **Hide an agent.** It comes off the list people pick from. Conversations already using it keep working and keep its name. *Show again* brings it back.
- **Manage categories.** Add, rename, reorder and hide the headings agents are grouped under, in the lower card.
- **Change what an agent says and does.** Open *Config* to change its wording, its conversation starters, what it can look up, its token ceiling and its other settings.

## Changing an agent and publishing it

An agent starts out on its built-in version. **Edit in Hub** copies that into a draft. Nothing changes for anyone until you publish.

- **Save** keeps working on the draft. Every save becomes a new version number.
- **Preview this draft** opens a real conversation running the draft. Only you can see it, and it's left out of every usage report. Save and Preview both save what's on screen first, so they always use what you're looking at.
- **Review and publish** shows what changed against the live version (or against the built-in one if nothing has been published). Publish notes are required: they're the record of why every company's agent changed.
- **Checked against the AiMS coaching principles.** Review and publish also checks the prompt against the coaching principles and lists any instruction that pulls against one, quoting the prompt and saying how. It takes a few seconds. It never stops you publishing: when it finds something, or can't run, tell it why you're publishing anyway, and the reason is kept with the version. Some agents work with problems on purpose, and that is a fine reason. *Make live* from History checks the older version the same way.
- **History** lists every version with its notes, who published it, and any principles warnings with the reason given. *Make live* puts an older one back and asks for its own note.
- **Revert to code default** goes back to the built-in version.

A conversation keeps the version it started with for its whole life. If you publish while someone is mid-chat, they finish on what they started with, and their next conversation picks up the new one.

## Creating an agent

**New agent** at the top of the Agents card opens a three-step form: what it's called, who can reach it, and what it says. It's saved as a **draft**, and only system admins can see it until you publish it.

To publish, it needs a name, a description, a category and a base prompt. Everything else has a sensible default.

Preview it before you publish. It's the only way to see what the agent actually does before a client meets it.

The publish screen has a sentence saying who will be able to see the agent, based on the access you chose. Read it: it's the difference between one role and everybody in every company.

The short name under an agent's title is made from the name you first give it, and it never changes. Renaming the agent later changes what people see, and old conversations pick up the new name.

## Unpublishing, hiding and deleting

**Unpublish** takes the agent out of every picker. No new conversation can start on it, and conversations already running carry on as they are. You can publish it again whenever you like. Use this for an agent that isn't working out.

**Delete** removes the agent and its drafts for good. It's only offered while the agent has never been published. Once it's been published, it can be unpublished or hidden, but not deleted, so the conversations that ran on it keep their name and wording.

## Sending an agent to other instances

**Distribute** shows where the agent stands on every other instance: *Current*, *Behind*, *Never sent*, or the reason an earlier attempt was refused.

The agent needs a published version first. If it's still on its built-in version, open *Config*, press *Edit in Hub*, and publish.

Sending is always two steps. **Dry run** shows exactly what would happen on each instance you picked, including anything to know first, like an agent going live where no company has the feature it needs. **Apply this plan** then does exactly that. Changing which instances you picked throws the plan away, so you always apply a plan you've read.

If the drawer says **Pushing is switched off**, the apply button is disabled. The dry run still works and changes nothing.

**Retract from this instance** takes the agent out of that instance's pickers. Conversations already running there keep going on the version they started with.

An agent you've sent anywhere can't be deleted. Retract it from each instance first, then hide it.

## When an agent can't be edited

On an instance that receives agents, one sent from AiMS HQ is marked **Managed from AiMS HQ** and has no edit controls. Changes to it come from AiMS HQ.

On an instance where agents aren't built, the whole page is a list. You can see every agent, what it does and who can reach it, but there's no *New agent*, *Edit*, *Access* or *Config*. Changes are made where the agents are built and arrive when they're sent.

## Common questions

**Someone says an agent has disappeared.** Open its *Access* panel. Check their role is ticked and their company has the feature you chose. If they lead a function, check whether *Functional Leads* is ticked. The summary on the agent's row shows all of this at a glance.

**I hid an agent by mistake.** Press *Show again* on its row. Nothing was lost.

**Why won't a category hide?** It has to be empty first. Move its agents to another category and try again. The count beside the name includes any hidden agents.

**Does renaming an agent break old conversations?** No. They stay with the agent and show the new name.

**I published something wrong. What now?** Open *Config*, go to *History*, and press *Make live* on the version you want back. Add a note. Anyone mid-conversation isn't affected, and anyone starting one afterwards gets the version you restored.

**Why does the draft's version number keep going up?** Every save makes a new version rather than changing the last one. That's what lets each conversation keep the exact version it started with.

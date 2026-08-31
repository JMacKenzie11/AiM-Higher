---
title: Ask Aimee
---

# Ask Aimee

A thinking partner for whatever you're working through: a decision,
a conversation to prep for, an employee not on the platform, or your
own leadership. Conversations are private to you by default, and you
can invite specific people from your company to read along or reply.

## How the page is laid out

Two tabs at the top of the content area:

- **Ask Aimee** (default) — your recent conversations plus the
  *New conversation* button. Open-ended thinking-partner mode. If
  someone has shared a chat with you, a second **Shared with you**
  card appears underneath.
- **Practice Coaches** — the entry cards for each guided practice.
  Pick one and Aimee follows the script for that practice.

The active tab lives in the URL (`?tab=coaches` for Practice
Coaches), so sending someone a link to either view works.

## What you can do here

- **Start a Practice** — switch to the *Practice Coaches* tab
  and pick a card. Each practice is a structured entry point
  ("I have a real thing to work through").
- **Start a free-form conversation** — on the *Ask Aimee* tab,
  click *New conversation*. Type your question and send.
- **Resume a thread** — every conversation stays under your
  account and shows in the Recent conversations list on the
  *Ask Aimee* tab.
- **Share a chat** — inside any conversation you own, use the
  **Share** button at the top of the chat. Pick a person from
  your company and choose *Write* (they can reply) or *Read*
  (they can follow along). Owners can change access later or
  remove someone; sharees can leave a chat at any time. See
  "How sharing works" below for the rules.
- **Archive a conversation** — the row-level action tucks a thread
  out of the way without deleting it.
- **Get a training recommendation** — when the company has
  Classroom on, Aimee can search the library and suggest a lesson.
  Try "what should I watch on facilitating a weekly meeting?".

## Practices available today

- **Prepare a hard conversation** — walks you through preparing
  for a specific conversation with a specific person. Ends with a
  script card you can copy or refine.
- **Navigate an emotionally charged conversation** — the LEAD
  Model applied to a moment where someone is already upset. Ends
  with a script card + optional role-play.
- **Ask great questions** — helps you craft generative questions
  for a conversation, meeting, or one-on-one.
- **Functional Chart Builder** — *admin-only*. Walks you through
  building a Functional Accountability Chart for your business:
  the core functions, their top responsibilities, and the two
  seats above them. Ends with a chart proposal card that has an
  **Apply to Chart** button — one click adds the proposed
  functions and responsibilities to your Functional Chart page.
  See "How Apply works" below.

## How Apply works on the Functional Chart Builder

The Apply button is additive-only:

- **Functions that already exist on your chart are kept** (the
  proposal's version doesn't overwrite yours).
- **New functions are created.**
- **Responsibilities the proposal lists that you don't already
  have are added** to the matching function. Responsibilities you
  already have are never modified or removed.
- **The two top seats** (Visionary/Integrator, or whatever you've
  renamed them to) are kept as-is. If the proposal suggested
  different names, the summary tells you what those were so you
  can rename yours if you prefer.

The result summary tells you exactly what changed. You can run
the practice again with a coach revision and press Apply again —
nothing gets duplicated, only new pieces land.

## How sharing works

You own the conversations you create. Sharing is opt-in and
narrowly scoped:

- **Same company only.** You can only share with active people in
  your own company. Cross-tenant shares are blocked by the app,
  by row-level security, and by a database trigger.
- **Read or Write.** Read lets someone follow the transcript.
  Write lets them reply to Aimee in the same thread. Both see
  every message posted before and after they're added.
- **Owner controls.** Only the owner can invite, change access,
  or remove people. Renaming and archiving stay owner-only.
- **Sharees can leave.** A shared person can open the share
  dialog and click *Leave this chat* to remove their own access.
- **Attribution shows up automatically.** When a chat has any
  sharees, user bubbles show the sender's name and avatar so
  it's clear who said what.
- **Practice thread rules don't change.** The Functional Chart
  Builder practice is admin-only to *start*, but once a chart
  builder thread exists, a company admin can share it with a
  team member for input. The team member can chat inside the
  thread; *Apply to Chart* still requires chart-edit rights, so
  a non-admin sharee can't push changes to your Functional Chart.

## How to start a conversation

1. Pick a card on the *Practice Coaches* tab if what you're
   working on matches one, or stay on the *Ask Aimee* tab and
   click *New conversation* for open-ended.
2. Type your question and send. Aimee shows a *Thinking…*
   indicator while she reads context; once tokens stream, a cursor
   tracks the response.
3. Keep going — the whole thread is one conversation, and Aimee
   remembers it end-to-end.

## Common questions

**Who can see my Ask Aimee conversations?** Only you, unless you
explicitly share a thread with someone from your company. Admins,
your manager, and AiMS Guides can't see your conversations by
default — access is granted per-thread, per-person by you as the
owner.

**Why is Aimee "Thinking…" for so long?** First token can take a
few seconds while she reads your company context. Once content
starts streaming, the indicator disappears.

**Aimee didn't know something obvious about my company.** Her
answers are grounded in what she can see. If a piece of data seems
missing, check the underlying page — she doesn't invent numbers.

**Why can't I see the Functional Chart Builder practice?** It's
restricted to company admins, system admins, and AiMS Guides
assigned to your company — the chart is a company-wide artifact,
so the coached version comes with edit rights. If your role
should have access and the card isn't showing, ask a system
admin to check your role and (for guides) your assignments.

**The chart proposal didn't render.** Occasionally the model
emits a proposal in the wrong shape and the card falls back to
a "Couldn't read that chart proposal" line with a *Fix the
proposal* button — press it and Aimee regenerates a full clean
proposal on the next turn.

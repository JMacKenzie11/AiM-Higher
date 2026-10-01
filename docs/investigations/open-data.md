# Open company data: investigation

Status: investigation only, 2026-10-01. Nothing is built, and nothing
builds until Jason approves a phase. Read from `origin/main` at
`dae7977`, plus read-only queries on production's catalog and its
meeting summaries.

**The principle under investigation.** Inside a company, everyone can
read all of the company's data. The one exception is conversations with
Aimee: only the person who started one can know it exists, read it or
query its history, unless they share it. That holds for every role,
including company admins, guides, system admins and Jason. Anything
Aimee remembers from a conversation is private in the same way,
including memory from a conversation about another person, which that
person must never see. Who can change data stays as it is.

## Decisions needed

Each has a recommendation. The section that explains it is in brackets.

1. **The nightly conversation insights job.** It reads the text of every
   conversation in every company and shows system admins summaries of
   it, filterable to one company. The themes job sends titles and first
   messages to the model. Both break the principle for system admins.
   *Recommend:* switch both off, delete what they stored
   (`coaching_conversation_analyses`, `coach_theme_snapshot`), and
   remove the dashboard cards. (§2)
2. **Usage per person on the admin dashboard.** System admins can see
   who used Aimee, how often and at what cost. That tells them a
   conversation exists. *Recommend:* per company totals only, no
   per-person rows; cost stays per company. (§2)
3. **Debrief invitations.** Company admins, guides, portfolio admins
   and system admins can see that a person's debrief conversation
   exists and whether they opened it. *Recommend:* the invitation row
   is readable by its recipient only. (§2)
4. **Memories that already hold judgments about another person.** The
   memory prompt has been telling Aimee to record a leader's
   assessments of the person they discussed. Nobody else can read
   these, so this is a content clean-up, not a leak. *Recommend:*
   delete about-mode memories that are not about the asker's own
   goals, plans or decisions, after the new rule is in place, with a
   count shown to you first. (§4)
5. **Guides and portfolio admins on the Coach button.** A "same company"
   rule silently leaves them out, because they have no home company.
   *Recommend:* an assigned guide, and a portfolio admin switched on as
   a company's admin, can coach about anyone in that company; other
   portfolio admins cannot. (§3)
6. **Strengths inputs.** *Recommend:* results open to the company; the
   raw answers and the assessment conversation stay private to the
   person, because they are closer to an Aimee conversation than to a
   result. (§1)
7. **Colleagues' email addresses.** Any member can already see a
   colleague's email on their person page, read through a service-role
   call. *Recommend:* keep it (a company directory is company data),
   but read it through a rule rather than the service role. Say if you
   want it restricted instead. (§1)
8. **Guide session briefs.** These are a guide's preparation notes for
   a session. *Recommend:* they stay private to the guide who
   generated them. (§1)
9. **Company history logs** (settings changes, feature changes, sheet
   pull log). *Recommend:* open to the company; `portfolio_admin_events`
   stays system admin only. (§1)
10. **When a summary breaks the personal-detail rule.** *Recommend:*
    retry once with the fault named, then remove the offending sentence
    and log it; never fail the meeting. (§6)
11. **The 13 existing summaries.** *Recommend:* a reviewed redaction, not
    a reanalysis. (§6)
12. **A transcript page.** No page shows a transcript to anyone today,
    admins included. Opening transcripts means building one. *Recommend:*
    build it in phase 3, after summaries are protected. (§1, §6)

## What I found, in short

- **Most company content is already open to everyone in the company.**
  Of 76 tables, most read rules are already "same company". Meeting rows
  and their summaries are already readable by every member, and so is
  the transcript column itself at the database level. The app hides the
  transcript, but there is no rule doing so.
- **What is still narrower is a short list:** strengths results and
  team strengths, the dashboard brief, the facilitation review, the
  sheet pull log, history logs, and debrief invitations. (§1)
- **Conversations and messages are already owner-or-sharee for every
  role, system admins included.** Memory is stricter still: only its
  owner can read it, and even the service role is locked out. (§2)
- **The gaps are around the rules, not in them:** two nightly jobs that
  read conversation text with the service role, per-person usage
  figures, debrief invitation visibility, and an unused function that
  lets system admins count anyone's memories. (§2)
- **Memory from a conversation about someone records judgments about
  them,** on purpose, by the prompt. The safety check the code comment
  describes does not exist. (§4)
- **13 of production's 40 meeting summaries mention someone's health,
  family or a bereavement,** across 5 companies, by keyword. PromiseOne
  has no summaries yet. Since #379, every member can ask Aimee about
  these summaries, and nothing checks them. (§6)

## 1. Reading company data, table by table

Read from production's catalog (`pg_policies`, 168 read rules on 76
tables). "Company" below means the company's own people, its assigned
guides, portfolio admins and system admins, as today.

### Already open to the whole company (no change)

`annual_goals`, `commitments`, `commitment_occurrences`, `companies`,
`company_discipline_snapshots`, `company_features`, `company_foundation`,
`foundation_items`, `functional_areas`, `functions`, `function_roles`,
`function_competencies`, `function_decision_rights`, `issues`,
`marketing_snippets`, `marketing_strategy`, `messaging_pillars`,
`meetings` (including `transcript_text`), `meeting_analyses`,
`priorities`, `profiles`, `quarters`, `role_descriptions`,
`role_description_versions`, `role_description_documents`,
`scorecard_entries`, `scorecard_metrics`, `strategic_focus_areas`,
`success_measures`, `success_measure_entries`, `success_measure_targets`,
`transcript_aliases`, `user_strengths`, and the Classroom tables (by
feature). The five views are all `security_invoker`, so they follow the
same rules.

### Would open

| Table | Today | Change |
|---|---|---|
| `strengths_assessments` | the person, company admins, guides, portfolio, system admins | add same-company read |
| `strengths_results` | same | add same-company read |
| `strengths_teams`, `strengths_team_members`, `strengths_team_evaluations`, `strengths_team_insights` | company admins, guides, portfolio, system admins | add same-company read |
| `dashboard_ai_briefs` | company admins, guides, portfolio, system admins | add same-company read |
| `external_pull_log` | company admins, guides, system admins | add same-company read |
| `company_settings_events` | system admins | add company read (decision 9) |
| `company_feature_events` | system admins, guides, portfolio | add company read (decision 9) |

Every row in that table is a new read rule, not a changed write rule.
Each ships with a harness probe shown red first.

### Stays restricted, with the reason

| Table | Reason |
|---|---|
| `coaching_conversations`, `coaching_messages`, `coaching_conversation_shares`, `coach_memories` | the exception itself |
| `coaching_conversation_analyses`, `coach_theme_snapshot` | derived from conversations; decision 1 proposes deleting them |
| `strengths_responses`, `strengths_narrative_messages` | raw answers and the assessment conversation (decision 6) |
| `guide_nudges` | addressed to one person, and carries a conversation id (decision 3) |
| `notifications` | addressed to one person |
| `session_briefs` | a guide's own preparation (decision 8) |
| `oauth_credentials`, `transcript_sources` | credentials and setup, not content |
| `transcript_source_audit_log`, `portfolio_admin_events`, `voice_rule_breaks`, `aimee_panel_events`, `coach_token_usage`, `anthropic_daily_cost` | oversight and cost records, system admins only |
| `agents`, `agent_versions`, `agent_distributions` | Hub configuration, not company content |
| `guide_assignments`, `portfolio_assignments` | already readable where they matter; no change proposed |
| `company_spellings`, `instances` | no read rule at all; service role only |

### Functions that skip the rules

Of the 46 `SECURITY DEFINER` functions, none returns company content to
a caller beyond what the rules already allow. Most are rule helpers
(`auth_role`, `is_guide_for` and so on) or triggers. Three matter here,
all in §2: `coach_memory_metadata`, and the share checks
`has_coaching_share` / `is_coaching_conversation_owner`, which are also
granted to `anon`.

### App gates that would come down

These hide data from team members in the app even where the rule
already admits them.

- The facilitation column on Meeting Summaries
  (`src/app/(app)/leadership/page.tsx:32,57`).
- The facilitation review on a meeting's page, today shown to admins,
  guides and the AiMS champion
  (`src/app/(app)/leadership/meetings/[id]/page.tsx:104-125`).
- Week in review and Recent wins on the dashboard
  (`src/app/(app)/dashboard/page.tsx:45-47,227,246`). Guides are left
  out of these today too.
- Someone else's strengths page (`src/app/(app)/people/[id]/strengths/page.tsx:33-37`).
- The team strengths pages (`src/app/(app)/strengths/teams/*`).

Already open, with copy that says otherwise: a person's page
(`src/app/(app)/people/[id]/page.tsx`) has no read gate, and its
privacy note says the scorecard is visible to admins and the manager
only. It is visible to the whole company today.

Documentation that would change: `docs/help/leadership.md:31` (already
wrong about transcripts), `leadership.meetings._id.md`, `strengths.md:32`,
`people.md`, `dashboard.md:85-86`, `coach.md`; spec §1, §6, §8, §11, §12.
The spec does not cover Strengths at all, so strengths visibility needs
a home there.

## 2. Who can read Aimee conversations today

### By the rules

| | Conversation | Messages | Shares | Memory |
|---|---|---|---|---|
| Owner | yes | yes | yes | yes |
| Someone it was shared with | yes | yes | their own share row | no |
| Team member, company admin, guide, portfolio admin, system admin | no | no | no | no |
| Service role | yes | yes | yes | **no** (revoked, 0194) |

The rules match the principle. Memory is the strongest: privileges are
revoked from the service role and row security is forced.

### Around the rules

| Path | Who | What it exposes |
|---|---|---|
| Nightly insights job (`src/app/api/cron/coaching-insights/route.ts:88-124`) | runs for system admins | the last 10 messages of every conversation in every company, sent to the model; summaries stored in `coaching_conversation_analyses` |
| Admin dashboard insights (`src/lib/admin/coaching-insights-service.ts:570-620`) | system admins | up to 3 summary sentences per theme, verbatim, filterable to one company |
| Nightly themes job (`src/app/api/cron/themes/route.ts:60-110`) | runs for system admins | titles and the first 240 characters of first messages, sent to the model with no instruction to leave names out |
| Admin dashboard usage (`src/lib/admin/dashboard-service.ts`) | system admins | who used Aimee, how often, at what cost, per person |
| Debrief invitations (`guide_nudges`, 0235) | company admins, guides, portfolio admins, system admins | that a debrief conversation exists, and whether it was opened |
| `coach_memory_metadata` (0194) | system admins | anyone's memory count and dates. Nothing calls it |
| Share checks (0151) | anyone, including signed out | given a conversation id, whether a person owns it. Ids are random, so low risk |
| Saving a role description (`src/lib/role-descriptions/save-action.ts:91-105`) | anyone | different errors for "no such conversation" and "not yours" |
| PostHog | the product team | could record text on screen if session recording is switched on in the PostHog project. Not checked |

Clean: the Agent Hub, Aimee's history tools, the memory tool and how
context is loaded all run as the person. Sentry sends no message text.

### Gaps against the principle, most serious first

1. System admins read what is said, through the insights job and its
   dashboard (decision 1).
2. Memory records judgments about the other person (§4, decision 4).
3. The themes job sends conversation openings, names included, to the
   model (decision 1).
4. Admins can see that a debrief conversation exists and was opened
   (decision 3).
5. Conversations and messages are not locked against the service role,
   unlike memory. Privacy depends on no code reaching for it.
6. System admins see per-person usage (decision 2).
7. `coach_memory_metadata` lets system admins count anyone's memories.
8. Existence checks for anyone holding a conversation id.
9. PostHog session recording, if on.

No harness case today asserts that a system admin, company admin, guide
or portfolio admin is refused someone else's conversation or messages.
Memory has one; conversations do not.

## 3. The Coach button

**Today:** a system admin, the person's company admin, or their direct
manager. All four layers agree: the button (People list, dashboard
roster, the person's page), the server action
(`src/lib/coach/actions.ts:62-75`), the page guard
(`src/app/(app)/coach/[profileId]/page.tsx:38-47`) and the database
rule (`coaching_conversations_insert`, 0186). Guides and portfolio
admins see no button and are refused at every layer.

**Opening it to anyone in the company:**

1. The button condition in three places becomes "same company, and not
   me".
2. The action and the page guard change to the same check.
3. A migration replaces the about-mode branch of the insert rule. The
   rule checks that the subject is in the asker's company, so a forged
   company id cannot get through. Guides and portfolio admins follow
   decision 5.
4. This is a role widening, so it ships with a probe shown red first: a
   team member who manages nobody can start one about a colleague, and
   is still refused for someone in another company.
5. Strengths: the tool reads under the asker's login. A colleague who
   cannot read the strengths results gets `incomplete`, which wrongly
   says the person has not finished. Phase 2 opens results, which fixes
   this; the tool should still say "not visible to you" when that is
   the reason.
6. The prompts assume a senior asker ("a manager… with one of their
   direct reports", `prompts/leadership-coach.md:7,11`). A peer needs
   its own framing.

**Aimee's rules for these conversations.** The base prompt already says
not to speculate about motives or home life, not to open with a ranking
or verdict, and not to claim more than the data supports. It says
nothing about building a case or comparing two people. Proposed:

- **In the prompt:** she helps the person prepare to act, usually a
  direct conversation; she never ranks or compares people; she never
  assembles someone's history as a case against them; she never
  speculates about health, personal life or motives.
- **In the structure, where it can be enforced:** the person scope reads
  one person, the conversation's subject, and the model cannot name
  another. So she cannot pull a second person's record to compare.
  Company scope returns totals with no names. That stays.
- **What a code check can and cannot do:** replies stream, so a check
  after the fact can flag and log, not unsend. The existing voice check
  (`voice_rule_breaks`, labels only, no text) is the place to add
  "compares named people" and "personal speculation" labels, so we can
  see how often it happens.

## 4. Memory from a conversation about someone else

**How it works.** Memories are written as the asker, by the asker's own
session, and belong to the asker. The person discussed never sees them;
the harness case `coach-memory-about-mode` proves it. Aimee reads them
back in the asker's later conversations, and in a conversation about
the same person she pulls the asker's earlier memories about that
person first (`src/lib/coach/context.ts:466-488`).

**What is recorded.** The prompt (`prompts/coach-memory.md:71-96`) and
the call (`src/lib/coach/memory-actions.ts:302-311`) both say to keep
"what the leader observes about the person… performance, patterns,
readiness, fit", with examples like "Is weighing whether Marcus is in
the right role". The comment at `memory-actions.ts:51-77` says the
opposite and describes a check by the subject's name that does not
exist. Health and family are filtered for everyone.

**To record only the asker's intent:**

1. Rewrite that part of the prompt and the call: keep what the asker
   intends, decided, committed to and keeps avoiding. Drop anything that
   says what the other person is like, did, or should be.
2. Build the check the comment describes: pass the subject's name to
   the memory filter, and drop any memory that names them unless it
   describes the asker's own action ("Committed to…", "Plans to…",
   "Decided to…"). That is narrow on purpose: it will drop some good
   memories rather than keep a bad one.
3. Show it failing on today's output first, with unit fixtures.
4. Clean up existing memories (decision 4).

## 5. Aimee and the live week: "she reads what you can read"

Every one of Aimee's data tools already reads under the person's own
login, never the service role, and the harness and source guards hold
that. So the simple rule is how she already works. Two things follow.

- **It replaces the separate design.** The plan we had parked, "Aimee
  can look at a named person", was this same rule. What remains is only
  how a name becomes a person: the server looks the name up among
  people the asker can read, and the model still never passes an id.
- **Three guards stay:**
  1. Other people's conversations and memory stay out of her reach even
     though they are "company data". The history tools' guard against
     those tables stays.
  2. Where a rule is wider than the screen, she exposes it. That is the
     reason phase 2 audits each table before opening the app.
  3. Code that reads with the service role must never feed her a
     result. None does today; the source guards stay.

## 6. Transcripts, and protecting people in summaries

**Transcripts.** Readable by every member at the database level today,
shown to nobody in the app. Opening them is a new page, not a removed
gate.

**What the summaries hold.** A read-only keyword count on production,
counts and dates only:

| | Summaries |
|---|---|
| All summaries | 40 |
| Mentions someone's health (illness, surgery, injury, hospital, maternity, sick leave and similar) | 9 |
| Mentions a family member or family reasons | 5 |
| Mentions a bereavement | 1 |
| **Any of these** | **13**, across 5 companies |

Dates: 2026-07-31, 08-04, 08-05, 08-20, 08-26, 09-08 (two), 09-10,
09-15, 09-16, 09-22, 09-28, 09-30. PromiseOne has no summaries yet.

A keyword count misses some phrasings and catches some harmless ones
("his father founded the firm" would count). Words that turned out to
be business vocabulary ("diagnostic", "medical" on its own) were left
out. An exact number needs a reviewed pass (below).

**The rule for the summariser.** The invitation writer's rule, word for
word (`src/lib/guide/headline.ts:96`): "Never mention health, family, or
personal reasons for anybody's absence, or where they were instead. If
somebody was away, leave the reason out entirely." Proposed for the
summariser: that rule, plus "nothing about a person's private
situation".

**How it would be checked in code.**

- One shared check, built from the two that exist (the invitation
  card's `PERSONAL_REASON` and the meeting questions' `PERSONAL`),
  in one module so they cannot drift.
- It runs in `analyzeMeeting` after the summary is final and before
  anything is written (`src/lib/transcripts/analyze.ts`, between the
  spelling step and the insert). It reads the summary, the commitments,
  the issues, coverage and the facilitation review.
- **When it is broken:** the summary call is retried once, told exactly
  which sentence broke which rule, as the invitation card does. If the
  retry still breaks it, the offending sentences are removed. The
  meeting always completes. Each break is logged as a rule label and a
  count, never the text.
- The work's own vocabulary has to pass: a clinic's appointments, a
  "diagnostic" review, a health and safety item. Unit fixtures cover
  both sides, shown red first.

**Cleaning up the existing summaries, without changing anything yet.**

- Reanalysis is not an option for most: a meeting with commitments or
  issues created from it cannot be reanalyzed, by design.
- *Recommended:* a one-off script, read only, applies the new check to
  each existing summary and writes a local file of proposed removals,
  sentence by sentence. You read that file and decide. What you approve
  goes in as a guarded data migration through the runner, which refuses
  any summary whose text changed since the file was made.
- The script never runs a write. The migration runs only on your go,
  per instance.

## 7. Harness checks

Each is shown failing first, against a planted wrong rule.

1. **Conversations are the owner's alone.** For one owner's
   conversation, as each of: a team member in the same company, the
   company admin, an assigned guide, a portfolio admin with and without
   the company admin switch, and a system admin. Each reads 0
   conversations, 0 messages, 0 shares and 0 memories. The owner reads
   all of them; someone it was shared with reads the conversation and
   messages but no memory. Planted: a rule admitting system admins.
2. **No way around it in the database.** No function callable by a
   signed-in user, other than the owner checks, reads the four
   conversation tables. Planted: a definer function that returns a
   message count.
3. **No way around it in code.** A source guard: no service-role read
   of `coaching_messages` or `coaching_conversations` outside a short
   named list, which shrinks as phase 1 lands.
4. **Debrief invitations are the recipient's.** A company admin, guide
   and system admin read 0 of someone else's.
5. **Everyone in the company reads its content.** For every table on the
   company-content list, a team member reads exactly what the database
   holds for their own company, and 0 for another company. Planted: a
   rule narrowed to admins.
6. **The Coach button rule** (§3).
7. **Not harness, but unit tests:** the memory filter with the subject's
   name, and the summary check with both kinds of fixture.

## 8. Phased plan

Privacy first, then openness: each phase closes a gap before the next
widens anything. Every migration goes through the runner, is rehearsed
on dev, and reaches the fleet only on your go. Every phase updates the
spec and help in the same PR.

**Phase 1. Close the conversation gaps.** Nothing becomes more visible.
- Switch off the insights and themes jobs, delete what they stored,
  remove the dashboard cards (decision 1).
- Per-company usage only (decision 2).
- Debrief invitations readable by the recipient only (decision 3).
- Drop `coach_memory_metadata`; revoke the share checks from `anon`;
  same error for "missing" and "not yours".
- Revoke the service role from conversations and messages where no
  remaining code needs it, as memory already is.
- Harness checks 1 to 4.

**Phase 2. Protect people in summaries and in memory.**
- The summariser rule and its code check (§6).
- The memory rule and its check (§4).
- Prepare, then on your decision apply, the clean-ups for existing
  summaries and memories.

**Phase 3. Open company content.**
- New read rules on the "would open" tables (§1), with check 5.
- Remove the app gates, fix the person page's privacy note.
- The transcript page.
- Help and spec, including a Strengths section in the spec.

**Phase 4. The Coach button for everyone.**
- Button, action, page guard and insert rule (§3), with check 6.
- Aimee's rules for these conversations, and the voice check labels.
- The strengths tool's "not visible to you" answer.

**Phase 5. Aimee looks at a named person from the panel.** Under the
"reads what you can read" rule, with the name looked up on the server.

Docs: this file is the investigation. No product behaviour changed.

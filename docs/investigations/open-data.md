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

## Decisions (Jason, 2026-10-01)

Recommendations 2 to 12 are accepted as written below. Decision 1 is
changed. The section that explains each is in brackets.

1. **Changed: the insights and themes jobs stay, and become
   anonymous.** AiMS uses them to improve the product, so the jobs and
   the dashboard cards stay. Before any conversation text goes to the
   model, and before anything is stored, people's names and identifying
   details are removed, using the company's roster to find names. The
   model is told to leave names, roles that identify one person, and
   personal details out of what it writes. Unit fixtures show a summary
   that would have named someone failing first, then passing. (§2a)
   The principle is restated, in the spec and in the help, in these
   words: "Only the person who started a conversation can see it. AiMS
   reviews anonymised summaries of conversation themes to improve
   Aimee." Wherever the product describes Aimee's privacy, it says this.
2. **Accepted.** Usage on the admin dashboard is per company only, no
   per-person rows. (§2)
3. **Accepted.** A debrief invitation is readable by its recipient
   only. (§2)
4. **Accepted.** About-mode memories that are not about the asker's own
   goals, plans or decisions are deleted after the new rule is in
   place, with the count shown to Jason first. (§4)
5. **Accepted.** Assigned guides, and portfolio admins switched on as a
   company's admin, can use the Coach button for that company. Other
   portfolio admins cannot. (§3)
6. **Accepted.** Strengths results open to the company; raw answers and
   the assessment conversation stay private to the person. (§1)
7. **Accepted.** Colleagues' email stays visible in the company, read
   through a rule rather than the service role. (§1)
8. **Accepted.** Guide session briefs stay private to the guide who
   generated them. (§1)
9. **Accepted.** Company history logs open to the company;
   `portfolio_admin_events` stays system admin only. (§1)
10. **Accepted.** A summary that breaks the personal-detail rule is
    retried once with the fault named, then the offending sentence is
    removed and logged. The meeting never fails. (§6)
11. **Accepted.** The existing summaries get a reviewed redaction, not a
    reanalysis. (§6)
12. **Accepted.** A transcript page is built after summaries are
    protected. (§1, §6)

**Also decided:**
- Aimee's rules for coaching about someone else (help them act, no
  ranking or comparing, no case-building, no speculation, and framing
  for a peer as well as a manager) go into
  `prompts/aims-coaching-principles.md` as part of the coaching
  principles project, not into a separate prompt. That file holds
  Jason's final text, so the added wording goes to him for approval
  before it is used. Phase E (the Coach button) depends on it. (§3)
- PostHog: Jason checks whether session recording is on. (§2)
- Order: summary protection first (§8).
- Nothing merges and nothing reaches the fleet without Jason's go.

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
| `coaching_conversation_analyses`, `coach_theme_snapshot` | derived from conversations; stay system admin only and become anonymous (decision 1, §2a) |
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
   dashboard. Decision 1: kept, and made anonymous (§2a).
2. Memory records judgments about the other person (§4, decision 4).
3. The themes job sends conversation openings, names included, to the
   model. Decision 1: kept, and made anonymous (§2a).
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

## 2a. Anonymous insights and themes (decision 1)

The two jobs and the dashboard cards stay. What changes is what reaches
the model and what is stored.

**Before the model sees anything.**
- Build a name list from the company's roster: each person's full name,
  first name, last name and email name, longest first. Replace each, as
  a whole word and in any case, with "a colleague" in the text sent to
  the model. Remove email addresses and phone numbers the same way.
- The themes job gets the same treatment for titles and first messages.
- The prompt tells the model to leave out names, roles that identify one
  person ("the CEO", "our only finance person", "the head of sales"),
  and personal details: health, family, private situation.

**Before anything is stored.** The model's output is checked in code:
the roster names again, a list of one-person roles (CEO, CFO, COO,
founder, owner, president, "head of", "director of", "the only"), and
the personal-detail check from phase A. On a hit the call is retried
once with the fault named. If it still fails, that summary's sentence
is not stored; its topic and friction level still are. Each failure is
logged as a label and a count, never the text.

**What it cannot catch.** A nickname, or a name that is not on the
roster (a client, a spouse). The prompt and the output check cover some
of that, not all. That is why the principle says "anonymised summaries"
and why the company view needs the limits below.

**Fixtures, failing first.** A conversation that names "Marcus" and
"our CFO" and mentions a hospital stay. Today its summary goes through
untouched (red); with the scrub and the check, the stored summary holds
none of the three (green). And a control that must pass: a summary
about "sales pipeline health" and a "diagnostic review".

**Rows already stored.** Production holds 41 conversation analyses
written before this rule (and no theme rows). *Recommendation:* delete
them and let the job rebuild under the new rule, rather than trying to
scrub them after the fact. That is a production write, on Jason's go.

**The wording,** in the spec and in the help, wherever the product
describes Aimee's privacy: "Only the person who started a conversation
can see it. AiMS reviews anonymised summaries of conversation themes to
improve Aimee." Places that describe it today: `docs/help/coach.md`,
`docs/help/ask-aimee.md`, the coaching page's privacy note
(`src/app/(app)/coach/[profileId]/page.tsx:68-73`), and spec §13 and
§14. Phase B checks for others.

### Can the company filter still point at a person?

Yes, and on today's numbers it almost always would. In the last 30 days
on production, 6 companies had Aimee conversations, and in each of
them only 1 to 3 people had them. Company rosters run from 2 to 15
people. An anonymous theme filtered to a company where one person used
Aimee that month is that person's conversation, whatever the wording.
Topic and timing do the rest: "worried about a key hire leaving" in a
six-person company, the week after someone resigned, needs no name.

*Recommendations:*
- **A minimum crowd for the company view.** A company appears in the
  filter only when at least 5 different people had conversations there
  in the period shown. Below that, its themes count only towards "all
  companies". Today no company would appear, so in practice the filter
  goes away until a company is big enough.
- **A minimum crowd for a quoted sentence.** A theme shows example
  sentences only when it is drawn from at least 3 different people,
  across at least 2 companies. Otherwise it shows its label and count.
- **No finer than a month** on any company view.
- **No list of single conversations** anywhere on the dashboard. Today
  it is per theme, and it stays that way.

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
   says the person has not finished. Phase D (open company content)
   opens results, which fixes this; the tool should still say "not visible to you" when that is
   the reason.
6. The prompts assume a senior asker ("a manager… with one of their
   direct reports", `prompts/leadership-coach.md:7,11`). A peer needs
   its own framing.

**Aimee's rules for these conversations.** The base prompt already says
not to speculate about motives or home life, not to open with a ranking
or verdict, and not to claim more than the data supports. It says
nothing about building a case or comparing two people. Proposed:

- **In the principles file, not a separate prompt** (decided): she
  helps the person prepare to act, usually a direct conversation; she
  never ranks or compares people; she never assembles someone's
  history as a case against them; she never speculates about health,
  personal life or motives; and she frames the conversation for a peer
  as well as for a manager. These go into
  `prompts/aims-coaching-principles.md` as part of the coaching
  principles project, worded for Jason's approval since that file holds
  his text. Phase E waits for it.
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
     reason phase D audits each table before opening the app.
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
   named list, which shrinks as phase B lands.
4. **Debrief invitations are the recipient's.** A company admin, guide
   and system admin read 0 of someone else's.
5. **Everyone in the company reads its content.** For every table on the
   company-content list, a team member reads exactly what the database
   holds for their own company, and 0 for another company. Planted: a
   rule narrowed to admins.
6. **The Coach button rule** (§3).
7. **Not harness, but unit tests:** the memory filter with the subject's
   name, and the summary check with both kinds of fixture.

## 8. Phased plan (order decided 2026-10-01)

Summary protection first: 13 summaries holding health, family or
bereavement details are readable by everyone in their companies today,
including through Aimee. Then privacy before openness. Every migration
goes through the runner, is rehearsed on dev, and reaches the fleet
only on Jason's go, per instance. Every phase updates the spec and help
in the same PR. Nothing merges without Jason's go.

**Queue.** After the measure-entries fix and the production-build
tests, which stay first.

**Phase A. Protect people in summaries.**
- The summariser rule and its check in code (§6), with fixtures shown
  red first.
- A read-only script that applies the check to existing summaries and
  writes the proposed removals to a file **on this computer only, never
  in the repo**. The file is deleted once Jason has decided.
- Jason's decisions are applied through the runner as a guarded data
  migration, per instance, on his go.

**Phase B. Close the conversation gaps.**
- Insights and themes jobs: kept, made anonymous (§2a), with the
  company view limits and the restated principle in spec and help.
- Per-company usage only (decision 2).
- Debrief invitations readable by the recipient only (decision 3).
- Drop `coach_memory_metadata`; revoke the share checks from `anon`;
  the same error for "missing" and "not yours".
- Revoke the service role from conversations and messages where no
  remaining code needs it, as memory already is.
- Harness checks 1 to 4.

**Phase C. Memory about another person.**
- The memory rule and its check (§4).
- The clean-up of existing about-mode memories: the count goes to Jason
  first, then the deletion on his go.

**Phase D. Open company content** (was phase 3).
- New read rules on the "would open" tables (§1), with check 5.
- Remove the app gates; fix the person page's privacy note.
- The transcript page.
- Help and spec, including a Strengths section in the spec.

**Phase E. The Coach button for everyone** (was phase 4).
- Button, action, page guard and insert rule (§3), with check 6,
  including assigned guides and switched-on portfolio admins.
- Depends on the coaching principles project carrying the rules for
  coaching about someone else.
- The strengths tool's "not visible to you" answer.

**Phase F. Aimee looks at a named person from the panel** (was phase
5). Under the "reads what you can read" rule, with the name looked up
on the server.

**Still open:**
- PostHog session recording: Jason is checking.
- Deleting the 41 stored conversation analyses (§2a): a production
  write, on Jason's go.

Docs: this file is the investigation. No product behaviour changed.

# Aimee in a panel, with product help: investigation

2026-09-28. Investigation only: no code, no database writes, no PR.
File references are `path:line` against `main` at the time of writing.

The goal, in Jason's words, condensed:
- a friendly Aimee icon replaces the "?" help icon, in the same spot;
- clicking it opens Aimee in a sliding panel, and the whole conversation
  happens there;
- Aimee keeps everything she does today, and can also search product
  help and help people use the app;
- people can ask about any page from any page, and get a link to it;
- help stays matched to the person's role;
- Guide nudges show on the Aimee icon, and maybe all notifications later;
- the current Aimee page stays;
- later: Aimee picks the best agent for what the person asks.

---

## Decisions I need from you first

1. **Can people use the page while Aimee is open?** The house drawer
   today is modal: it dims the page and blocks it. For "help me use the
   app", people need to follow Aimee's instructions on the page with the
   panel still open. I recommend **side by side on desktop** (the page
   stays usable), **full screen on a phone**. This is the biggest design
   choice, because it changes the drawer rather than just reusing it.

2. **Which Aimee answers in the panel?** I recommend plain Aimee (the
   general coach, with her memory and tools) plus the new help search,
   with no agent picker in the panel at first. The other agents stay on
   the Aimee page. The picker is the part that least fits a panel today
   (see "Panel behaviour").

3. **One running conversation, or a fresh one each time?** I recommend
   the panel reopens the conversation you had open, with a clear "New
   conversation" button. Either way, panel conversations are ordinary
   Aimee conversations and show on the Aimee page.

4. **Does "help for this page" still exist as something you can read,
   or only through Aimee?** I recommend keeping it: a short "About this
   page" section at the top of the panel, from the same help file as
   today. It costs nothing, needs no model call, and means phase 1 is
   useful before the chat moves in.

5. **Which notifications move first?** I recommend Guide nudges and
   "someone shared an Aimee chat with you" (both are Aimee
   conversations). The rest stay in the bell for now. The full list is
   under "Notifications".

6. **The icon.** Three directions are described under "The icon". Pick
   one, or tell me what none of them gets right.

7. **A list of every page, kept honest by CI.** Linking to pages and
   checking who can open them needs a page registry that does not exist
   today. OK to build it and have CI fail when a page is missing from it?

8. **Fix the problems I found first, as small separate PRs?** Five
   existing bugs came up (listed under "Things this investigation
   found"). Two of them change what people see today. I would fix them
   before building on top.

---

## Things this investigation found

These exist today, independent of the panel.

- **A portfolio admin gets no help on `/portfolio`.** The help loader
  only recognises four roles and drops `portfolio_admin` from a doc's
  `roles:` list (`src/lib/help/loader.ts:92-103`). `portfolio.md` then
  reads as system-admin-only. The company admin pages' help loses
  portfolio admins too.
- **One help doc can never load.**
  `chart.function._id.role-description.v._version.md`: both the loader
  and `check:help` turn the version number into `_id`, so the `_version`
  file is never looked for and the parent doc shows instead.
- **A published agent version's tools are ignored.** `/api/coach` takes
  an agent's tools from the code registry, not from the pinned version
  (`src/app/api/coach/route.ts` ~L338-343). Changing tools in the Hub
  has no effect, and an agent that exists only in the Hub gets none.
- **Swapping agents probably does not remove the old opener.**
  `setConversationAgentAction` deletes assistant messages
  (`src/lib/coach/actions.ts` ~L245-249) on the user's own client, but
  `coaching_messages` has no delete policy, so it likely deletes
  nothing. The unit test uses a mock, so it cannot tell.
- **Hub preview conversations show in the system admin's Aimee list.**
  They are excluded from analytics and memory, but not from
  `listConversationsForUser`.
- **The retry on a checked turn is not counted in usage.** When an opener
  or debrief reply is sent back once (#340), that second model call is
  not added to the turn's logged tokens, so cost reports undercount.

---

## Current state

### The Aimee page

- **Pages.** `/ask-aimee` (the list), `/ask-aimee/new` (creates a
  conversation, optionally with `?agent=`), `/ask-aimee/[id]` (the
  chat), `/ask-aimee/memory`. The chat page loads everything on the
  server: the conversation, access (owner, write or read share),
  messages, senders, the agent with its pinned settings, the agent
  picker list, and the champion and function-lead checks. It then
  renders the shared `ChatView`
  (`src/app/(app)/coach/[profileId]/[conversationId]/ChatView.tsx`,
  1,127 lines).
- **Agents.** Six are defined in code (`src/lib/practices/registry.ts`)
  and merged with the `agents` table, where the Hub edits identity and
  access. Each has a prompt, optional tools, an optional first turn
  (scripted or generated), and role, feature and relationship gates
  (`src/lib/practices/gate.ts`).
- **The agent picker** sits in the chat header. It is owner-only, and
  locked once the person has sent a message. Changing agent re-pins the
  conversation and reloads the page.
- **Version pinning.** Each conversation records the agent version it
  started on (`coaching_conversations.agent_version_id`, migration
  0228). A publish never changes a running conversation. A Hub preview
  pins the draft.
- **Storage.** Conversations are `coaching_conversations` rows
  (`general` mode for Ask Aimee, `about` mode for coaching about a
  person), and messages are `coaching_messages` rows. RLS: the owner and
  anyone the chat was shared with can read it, the owner or a write
  share can post, and nobody can delete. Sharing is per conversation,
  same company only.
- **Coach memory.** `coach_memories` is private to its person. It is
  written only through `record_coach_memory()` and read into the prompt
  on each turn. It cannot be written by any background job or the
  service role, by design. Memories are distilled from finished
  conversations by `MemorySweep`, which runs in the person's own session
  and is mounted on a fixed list of pages (enforced by
  `memory-sweep-mount.test.ts`).
- **The chat route** (`/api/coach`) streams replies. It runs a tool loop
  of up to 4 passes. Openers and debrief replies are held back, checked
  and retried once. Usage is logged per turn to `coach_token_usage`.
  **Nothing measures cost per conversation today.** Only per-company
  totals over 7 and 30 days are reported.

### Product help

- **Content.** 30 Markdown files in `docs/help/`: about 27,600 words,
  about **41,000 tokens** in total, averaging about 1,400 tokens each.
  The largest is `measures.md` at about 4,300 tokens. Each file has a
  `title` and an optional `roles:` list (none means everyone). Parts of
  a doc can be limited to certain roles with `::: role …` blocks
  (`docs/help/README.md`).
- **Choosing the doc.** The URL maps to a filename by turning `/` into
  `.` and IDs into `_id`, trying the most specific name first and
  falling back to the parent: `/leadership/meetings/<id>` tries
  `leadership.meetings._id`, then `leadership.meetings`, then
  `leadership`. The loader then filters by role and strips role blocks
  that don't apply (`src/lib/help/loader.ts:192-202`). The widget
  fetches it from `/api/help?pathname=` each time it opens.
- **`check:help`** (runs in CI) proves every page has a doc or a parent
  doc. It doesn't check the doc is right.
- **The "?" icon** is `src/components/help/HelpWidget.tsx`, mounted once
  in `src/app/(app)/layout.tsx:171`. It is a fixed round button at the
  bottom right, which opens a small popover above it that renders the
  Markdown.
- **Components that change:**
  - `HelpWidget` (replaced by the Aimee icon and panel);
  - the app layout (mount point);
  - `ChatView` (a panel mode);
  - the `Drawer` (non-modal option);
  - the bell (nudges move);
  - two e2e specs that find the "?" by its label and check nothing
    overlaps it (`e2e/clarity-drawer.spec.ts`,
    `e2e/chart-function-drawer.spec.ts`).

### The panel to reuse

Every right-side panel in the app uses one component,
**`src/components/ui/Drawer.tsx`**:
- It is portalled to the page body.
- It slides in from the right, and respects reduced motion.
- It handles Escape and focus, and can stay mounted while closed
  (`keepMounted`).
- It is full width on a phone.

It is used by:
- the chart's function editor (`chart/FunctionDrawer.tsx`, the best
  example to follow) and "Add function";
- the plan's add drawers;
- measure settings;
- the clarity drawer on commitments and issues;
- the five Agent Hub drawers.

What it needs for Aimee: a **non-modal** option (no dimmed backdrop, the
page stays usable, no `aria-modal`), and a z-index decision. It sits at
60 and the help widget at 100, and the drawer footers are left-aligned
only to dodge the widget.

---

## Help search

**How big it is:** 30 docs, about 41,000 tokens, growing slowly.

**Simple approach (recommended):**
- **A page index always in her prompt.** About 30 lines, one per page:
  title, one-sentence purpose, link. Only pages the person can open.
  Roughly 1,000 tokens. This alone answers "where do I…" questions and
  gives her the links.
- **A `search_help(query)` tool.** It splits the role-filtered docs into
  sections by heading, scores sections by keyword match (the same idea
  as the existing `search_classroom` tool, `src/lib/coach/tools.ts`
  ~L160-215), and returns the best few sections with their page links.
  A search adds a few thousand tokens to that turn only.
- **Why this is enough:** keyword search works well on a small,
  consistently written set of docs whose titles and headings name the
  features. There's nothing to keep in sync: the tool reads the same
  Markdown files the widget does.

**Heavier approach: embeddings.** Store a vector per section (pgvector),
re-embed on every doc change, run a similarity search per question.
- It is better at matching meaning when people use different words from
  the docs.
- It costs a new table on every instance (a fleet migration), a pipeline
  to keep the vectors current when docs change on deploy, an embeddings
  provider, and a second place where role filtering must be right.
- At 41,000 tokens it isn't justified. Revisit if the help grows several
  times over, or if the logged searches show misses that different
  wording would fix.

**Even simpler, and why not:** putting all the help in every prompt. It
works, but costs about 41,000 extra input tokens a turn (roughly 8 cents
uncached, under 1 cent cached), and crowds out the coaching context.

**Measure it:** log each `search_help` query and whether it returned
anything. A monthly look at the empty searches tells us whether keyword
search is enough.

---

## Role and access

**Where the check lives.** On the server, inside the `search_help` tool
and the page index builder. Both use the signed-in person's role and
company from the session, never anything the model or the browser sends.
They reuse the loader's existing role filter, after fixing the
portfolio admin bug:
- a doc whose `roles:` excludes the person is never searched;
- `::: role` blocks are stripped before searching, so an admin-only
  paragraph in a shared doc can't leak through a search hit.

**Links only to pages they can open.** Every link Aimee gives comes from
the page registry (next section), filtered by role and by the company's
features. The prompt tells her to link only to pages from the index or
a search result. A server-side check then removes any link in her reply
that isn't on the person's list. That runs in the same place the
checked-turn pass runs today.

**Tests:**
- A unit test of `search_help` as a `team_member`, for "Agent Hub",
  returns nothing from `admin.agents.md` and no `/admin/agents` link.
  The same search as a `system_admin` returns it.
- A doc shared by all roles, with a `::: role company_admin` block:
  searching the block's words as a member finds nothing.
- The page index for a member contains no admin pages. For a company
  without the classroom feature, it contains no classroom pages.
- The link check removes a link the person can't open from a reply.
- An e2e test: signed in as the member, ask about the Agent Hub, and
  check the reply has no `/admin` link.

---

## Page links: is there a list of pages?

**No.** There are four partial sources:
- the sidebar's link lists (about 20 top-level links, with roles and
  feature flags, but no descriptions);
- the help doc titles;
- the filesystem walk in `check:help`;
- `requireRole` calls inside 8 pages.

Most pages use `requireProfile` plus a company check, and some depend on
a company feature flag (classroom, role descriptions, facilitation
review, strengths, external measures). The `execution` feature only
hides sidebar links; the pages themselves don't check it.

**What we'd build.** `src/lib/pages/registry.ts`, one entry per page:
- route pattern (e.g. `/leadership/meetings/[id]`);
- title and one-line purpose;
- roles allowed;
- company feature required, if any;
- the kind of record an `[id]` refers to, if any.

A test fails CI when a `page.tsx` has no entry, as `check:help` does for
docs. A second test checks each entry's roles against the page's
`requireRole` where one exists. The sidebar, the help mapping and the
page index can then all read from it, one source instead of four.

---

## Page context: "help me with this"

**The URL.** The panel lives in the app layout, so it knows the current
URL (`usePathname`). With the registry's route patterns it can tell the
page and any record ID: meeting, function, goal, priority, person and so
on.

**Sending it.** It goes with each message as `{ path, pattern, recordId }`.
The chat route resolves the record under the person's own access (RLS),
for example "the Weekly Leadership meeting of 22 Sep", and adds it to
that turn as "the page they're on". The route never trusts more than an
ID from the browser. A record they can't read resolves to nothing.

**The gap.** Records opened in a drawer don't change the URL: the chart
function editor, commitments, issues. For those, a small shared "what's
open" context that a drawer sets when it opens and clears when it
closes. This is phase 4, not phase 1.

**Existing piece to replace.** `/ask-aimee/new?from=` only drives a back
link, allows three page prefixes, and never reaches the prompt. Page
context replaces it.

---

## Panel behaviour

- **Following a link.** The app layout doesn't remount on in-app
  navigation, so a panel mounted there, open, keeps its conversation
  when the person follows a link Aimee gave. A full page reload loses
  the on-screen state but not the conversation, which is stored. The
  panel remembers the open conversation's ID in the browser and reloads
  it.
- **Panel and Aimee page, both ways.** Panel conversations are ordinary
  `general` Aimee conversations, so they show on the Aimee page. The
  panel gets an "Open full page" link, and the Aimee page gets
  "Continue in the panel". It's one conversation either way, with the
  same pinning and memory.
- **What has to change in ChatView:**
  - It scrolls the window and uses sticky header and composer positions
    that assume the page scrolls. It needs a "scroll inside this box"
    mode.
  - Changing agent and auto-titling call `router.refresh()`, which in a
    panel would refresh the page underneath, not the panel. Both must
    update the panel's own state.
  - Everything the chat page loads on the server (access, senders,
    pinned agent settings, picker list) needs one server action that
    returns the same bundle to the panel.
  - Closing the panel must not unmount the chat mid-reply, which would
    cancel it. Keep it mounted and hidden.
- **Coach memory.** `MemorySweep` must run once per page load in the
  layout, not per panel open. Its mount list and test change
  deliberately.
- **Mobile.** The drawer goes full width on a phone. The Aimee icon
  keeps the "?" icon's bottom-right spot, which on a phone is also the
  only place a badge is visible without opening the menu. Today the bell
  is inside the phone menu, so a phone user can't see an unread count at
  all. The on-screen keyboard needs the composer to stay above it; test
  on a real phone.

---

## Notifications

**Today.** One bell, in the sidebar footer (and inside the menu on a
phone), fed by `getHeaderNotifications`
(`src/lib/notifications/service.ts:75-235`). No notification sends an
email; the only emails are invites and password resets.

| Notification | What it is | Recipient | Move to Aimee? |
|---|---|---|---|
| Guide nudge (`guide-nudge`) | Aimee's invitation to debrief a meeting | **The company's AiMS champion only** | **Yes, first.** It already is Aimee. The champion-only rule stays exactly where it's enforced today: raising (`src/lib/guide/nudges.ts`), RLS, and recipient-only opening. |
| Chat shared (`chat_shared`) | Someone shared an Aimee conversation with you | The person shared with | **Yes.** It opens an Aimee conversation, so it belongs with her. |
| Champion seat empty (`champion-empty`) | The champion left, so the seat is empty | Company admins | **No, for now.** It's an admin task (go to company settings), not a conversation. It could become "Aimee noticed…" later. |
| Overdue commitments | A live count of your overdue work | The owner | **No.** A status count, recalculated on every page. Aimee could mention it in conversation, but the count should stay visible at a glance. |
| Due today | Same, due today | The owner | **No**, same reason. |
| Friday measures | Measures to enter this week | The function lead | **No**, same reason. |

**What moving nudges takes.**
- The Aimee icon shows a badge from the same query, filtered to Aimee's
  kinds. The bell shows the rest.
- Clicking the nudge opens the debrief in the panel, not a new page.
  The nudge page's logic moves into a server action the panel calls.
- "Not now" and uptake measurement stay as they are.
- The champion card's copy ("a note in their notification bar",
  `ChampionForm.tsx` ~L84-87) and `docs/help/guide.md` change in the
  same PR.

---

## Choosing agents automatically (later)

**How it could work.** On the person's first message, before anything
is pinned, a small routing call reads the message and the list of
agents the person is allowed to use. It picks one, or none, meaning
plain Aimee. The conversation is then pinned to that agent's live
version, as today. The existing rule already fits: the agent is chosen
before the first turn, and locks when the person has spoken.

**Design now so it isn't blocked later:**
- Keep "which agent" a server-side decision, made in one function at
  conversation creation. Not in the panel's UI.
- Record why an agent was chosen: a nullable `routed_by` or `routing`
  column, or an event row, so routing can be measured and corrected.
- Keep the panel's agent choice to "plain Aimee" at first (decision 2),
  so routing later replaces a default rather than a picker people have
  learned.
- Fix the pinned-tools bug first. Routing to an agent whose pinned
  tools are ignored would route to the wrong behaviour.

---

## The icon

All three fit the brand tokens (`brand/tokens.css`): cobalt, sky, sky
tint and a chartreuse accent. None says "AI"; she is "Aimee".

1. **The "A" in a soft circle.** A rounded lowercase "a" or capital "A"
   in cobalt, on a sky-tint circle, with a small chartreuse spark at its
   shoulder. Closest to the current "?" button in size and weight, so it
   reads as a direct replacement.
2. **A speech bubble built from the logo's bars.** The three rising bars
   of the AiMS-HQ mark set inside a rounded speech bubble. It says
   "conversation" and "AiMS" together, and is recognisably ours.
3. **A friendly face, abstracted.** A rounded shape with two dots and a
   short curve, cobalt line on white with a sky ring. The warmest of the
   three, and the most "someone to talk to". It needs care to stay calm
   rather than cartoonish.

**Unread.**
- A chartreuse dot with the count at the top right, the same as the
  bell's badge today.
- Once, when a new nudge arrives, a single soft ring pulse, skipped for
  anyone who prefers reduced motion.
- The button's label says it: "Aimee, 1 new".

---

## Risks

- **Coach memory.** The memory sweep's mount list is a guarded, closed
  set. Moving the chat into the layout means changing it on purpose,
  with the test updated in the same PR. Memory itself is unaffected:
  the panel uses the same route and session.
- **The Agent Hub.** Previews open the chat page, which is fine and
  stays. Previews already leak into the admin's conversation list
  (a finding above); a panel that lists recent conversations would make
  that more visible.
- **Cost per conversation.** It isn't measured today. The page index
  adds about 1,000 input tokens per turn, cached after the first.
  A help search adds a few thousand tokens to that turn only. Page
  context adds a few hundred. Before phase 3, add a per-conversation
  cost figure to the admin dashboard, so the change is measured rather
  than guessed.
- **Tests that will break on purpose:**
  - the two e2e specs that find the "?" by label;
  - `memory-sweep-mount.test.ts`;
  - specs that assume the chat is always a full page at
    `/ask-aimee/<id>` (they stay valid, since the page stays, but panel
    flows need their own);
  - no component tests exist for ChatView or the picker, so the panel
    mode needs its first ones.
- **Layering.** The widget's z-index of 100 and the left-aligned drawer
  footers exist only because of the "?" button. Replacing it means
  deciding the panel's layer against the drawer (60), the confirm
  dialog (70) and the notification tray (60), in one place.
- **A non-modal drawer** is new behaviour for the house component. Focus
  handling, Escape and screen readers must still be right when the page
  behind stays usable.
- **"Never say AI in the app"** applies to every new string: the icon's
  label, the panel's title, empty states.

---

## Phased build plan

Each phase is its own PR, useful on its own, merged before the next
starts.

### Phase 0: fix what's broken underneath (small separate PRs)

- **Delivers:**
  - portfolio admins get their help;
  - the role-description version doc loads;
  - Hub-published tools apply;
  - old openers really are removed on agent swap;
  - previews leave the admin's list;
  - checked-turn retries are counted in cost.
- **Changes:** `loader.ts` and `check-help-coverage.ts`; the route's
  tool resolution; a delete path for openers (a narrow delete policy,
  or a definer function); `listConversationsForUser`; usage logging.
- **Migrations:** one, if the opener fix is a policy or function. It is
  RLS, so it needs a harness probe with red first (E5).
- **Tests:**
  - loader tests for `candidateSlugs` and `parseRoles`;
  - a route test that pinned tools win;
  - a harness probe: the owner can delete only their conversation's
    assistant opener before the first user turn, and nobody else can;
  - list test;
  - usage test.
- **Decide first:** decision 8.

### Phase 1: the icon and panel, with page help (small)

- **Delivers:** the Aimee icon replaces the "?". It opens a right-side
  panel showing "About this page", the same help as today and still
  role-filtered, plus an "Ask Aimee" button that opens the full Aimee
  page for now. No chat in the panel yet.
- **Changes:**
  - a new `AimeeLauncher` in the layout, replacing `HelpWidget`;
  - the `Drawer` gets a non-modal option;
  - the widget-driven z-index and footer rules are cleaned up.
- **Migrations:** none.
- **Tests:**
  - the two e2e specs updated to the new label;
  - a unit test that a member gets no admin-only help in the panel;
  - an e2e check that the panel opens, shows the page's help, and
    doesn't block the page on desktop.
- **Docs:** `docs/help/*` wherever the "?" is mentioned; a help file
  for the panel; spec §16.
- **Decide first:** decisions 1, 4 and 6.

### Phase 2: the page registry and help search, on the Aimee page first

- **Delivers:** Aimee can answer "how do I…" about any page, with links,
  on the existing Aimee page. It ships behind no panel change, so it can
  be judged on its own.
- **Changes:**
  - `src/lib/pages/registry.ts` and its CI test;
  - a page index in the prompt, built per person;
  - the `search_help` tool;
  - the server-side link check on replies.
- **Migrations:** none.
- **Tests:** the access tests listed under "Role and access", including
  that a member can't get admin-only help and that no unreachable link
  survives.
- **Decide first:** decision 7.

### Phase 3: the whole conversation in the panel

- **Delivers:** chatting in the panel. The conversation survives
  navigation, is shared with the Aimee page both ways, and works on a
  phone.
- **Changes:**
  - a panel mode for `ChatView`, which scrolls inside itself and uses
    no `router.refresh`;
  - a server action returning the chat bundle;
  - a keep-mounted panel;
  - `MemorySweep` moves into the layout;
  - "Open full page" and "Continue in panel";
  - a per-conversation cost figure on the admin dashboard.
- **Migrations:** none expected.
- **Tests:** the first component tests for the panel chat; e2e for
  starting in the panel, following a link and finding the conversation
  still there, and opening the same conversation on the Aimee page;
  `memory-sweep-mount` updated; the mobile layout spec.
- **Decide first:** decisions 2 and 3.

### Phase 4: page context

- **Delivers:** "help me with this" knows the page and the record.
- **Changes:**
  - `{ path, pattern, recordId }` sent per message;
  - the route resolves the record under RLS and adds it to the turn;
  - a shared "what's open" context for drawer-opened records.
- **Migrations:** none.
- **Tests:**
  - a record the person can't read resolves to nothing;
  - the ID is the only thing taken from the browser;
  - e2e: on a meeting page, "summarise this" names that meeting.

### Phase 5: nudges on the Aimee icon

- **Delivers:** the icon's badge; a nudge opens its debrief in the
  panel; chat shares move too (decision 5).
- **Changes:**
  - notification queries split by kind;
  - the nudge open logic becomes a server action;
  - the champion card copy and `guide.md` updated.
- **Migrations:** none. The champion-only rule is unchanged.
- **Tests:**
  - only the champion sees the badge;
  - "Not now" still records a dismissal;
  - opening from the panel marks it read and opened;
  - the bell no longer shows moved kinds.

### Later: automatic agent choice

This rests on the groundwork described above: one server-side choosing
function, a record of why an agent was chosen, and pinned tools fixed.

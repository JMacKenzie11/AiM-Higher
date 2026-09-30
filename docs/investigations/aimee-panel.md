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

## Decisions (Jason, 2026-09-28)

1. **The page stays usable on desktop; the panel is full screen on a
   phone.** How keyboard and screen reader use works is under "A panel
   that does not block the page".
2. **Plain Aimee plus help search in the panel, no agent picker** at
   first.
3. **The panel reopens the person's last plain Aimee conversation** (no
   agent, not the last conversation with any agent), with a "New
   conversation" button.
4. **"About this page" stays**, at the top of the panel.
5. **Guide nudges and shared chats move to the Aimee icon first.**
   Everything else stays in the bell.
6. **The icon is not chosen yet.** A preview page shows the three
   directions at real size, with the unread dot, in light and dark mode.
7. **Build the page list, with CI checking it stays complete.**
8. **Fix the five problems first, as small separate PRs, starting with
   the Agent Hub tools.** For the agent-switch problem, **hide** the old
   opener; message deletes stay forbidden.

**Coach memory in the panel (decided):**
- A conversation started in the panel **never writes** to coach memory,
  even if it is later opened on the Aimee page.
- Aimee in the panel **may read** coach memory, so she still knows the
  person.
- When a panel conversation turns into real coaching, Aimee offers to
  continue on the Aimee page, with a link that starts a **new** coaching
  conversation there. Memory works there as it does today.
- A test shows a panel conversation leaves coach memory unchanged.

**Build order (decided, replacing the phases at the end):** Step 2
(page list and help search, on the Aimee page) first. Steps 1 and 3 as
separate PRs, with the panel switched off for everyone except system
admins until Step 3 has merged, then released together. In Step 4 the
server loads the record under the person's own login, so the
database's access rules apply; the browser never sends a record's
contents.

---

## Marking a conversation as started in the panel

**A new column: `coaching_conversations.origin`**, `text not null
default 'page'`, `check (origin in ('page', 'panel'))`, set once at
creation by the panel's create action. **Yes, it needs a migration**
(0239-something, a fleet run like any other), because nothing on the row
today can carry it:
- `mode` is `general`/`about` and is constrained by a shape check;
- `context_kind` is `execution`/`strengths`;
- `practice_id` is null for plain Aimee on both surfaces, so it cannot
  tell them apart;
- a title prefix or a browser flag would be forgeable and invisible to
  the database.

**What reads it, and why it is enough for "never writes":**
- **The memory sweep** (`memory-actions.ts`, `summarizeFinishedConversationsAction`)
  skips `origin = 'panel'`, beside the existing `practice_id` skip. It
  reads the row, not the surface, so opening the conversation later on
  the Aimee page changes nothing.
- **The write tools.** `remember_this` (and the memory update tool) can
  write in the middle of a conversation, not only at the sweep. The
  route leaves them out of the tool list whenever the conversation's
  `origin` is `panel`. `memory_lookup` stays: reading is allowed.
- **Not an access boundary.** The owner could in principle flip their
  own row's `origin` through the update policy, but it only governs
  their own memory, so there is nothing to protect against. The column
  is a routing fact, not a permission, and needs no RLS probe of its
  own. The migration still runs through the harness like any other.

**The test (decided):** a panel conversation, with a turn that would
normally trigger `remember_this` and a sweep run afterwards, leaves
`coach_memories` for that person exactly as it was (count and rows,
before and after), including after the same conversation is opened
through the Aimee page's route. A second test: the same turn in a page
conversation does write, so the test cannot pass by the memory path
simply being broken (red first, E4).

**"Continue on the Aimee page."** The prompt tells panel Aimee to offer
it when the conversation turns to the person's own development rather
than using the app. The link goes to `/ask-aimee/new` (a new `page`
conversation), never to the same conversation, so memory rules never
change mid-conversation.

---

## A panel that does not block the page

On desktop the panel is a **complementary region**, not a dialog:
- `role="complementary"` with `aria-label="Aimee"`, no `aria-modal`, no
  dimmed backdrop, no focus trap. The page behind stays in the tab
  order and usable.
- **Opening** moves focus to the panel's message box, so a keyboard user
  can type at once. The Aimee button carries `aria-expanded` and
  `aria-controls`.
- **Escape** closes the panel from anywhere inside it and returns focus
  to the Aimee button. Closing never loses the conversation.
- **Getting back into it:** the panel is a landmark, so screen reader
  users reach it with their landmark navigation. For everyone, a
  keyboard shortcut (proposed: Alt+A, shown in the button's tooltip)
  focuses the panel's message box when it is open, and opens it when it
  is not.
- **New replies are announced** through a polite live region when the
  reply is complete, never token by token (a streamed reply read out as
  it arrives is unusable). Checked turns already arrive whole.
- **Reduced motion** skips the slide, as the house drawer does.

On a phone the panel covers the screen, so it behaves as a **dialog**:
`aria-modal`, focus trapped inside, Escape and a visible close button,
focus back to the Aimee button on close. One component, two behaviours,
chosen by the same breakpoint the sidebar uses (768px).

Tested with an axe check on both widths and a keyboard-only e2e: open
with the button, type, Escape, confirm focus is back on the button, and
confirm the page's own controls are reachable with the panel open on
desktop.

---

## What a panel message costs

**Measured today, production, the last 70 Aimee turns:** on average
2,600 fresh input tokens, 7,000 read from cache, 3,000 written to cache
and 650 output. At Sonnet 5 rates ($2 in, $10 out, $2.50 cache write,
$0.20 cache read, per million tokens) that is about **2 cents a turn**.
Dev, 105 turns, comes out the same (about 2 to 3 cents).

**Added by the panel:**
- **The page index**, about 1,000 tokens in the cached system prompt:
  about 0.25 cents on the first message of a conversation (cache write),
  about 0.02 cents on each message after (cache read).
- **A help search**, when she runs one: a few sections back, about 3,000
  tokens, read again on the tool loop's next pass: about 0.6 to 1 cent
  on that message only.
- **Page context** (Step 4): a few hundred tokens: under 0.1 cent.

**Estimate: about 2 to 3 cents for a panel message, about 3 to 4 cents
when she searches the help.** The per-conversation figure on the admin
dashboard (Step 3) replaces this estimate with a measurement.

---

## Counting panel use and help answers

`npm run aimee:uptake`, read-only, every active instance, one line per
company per week, shaped like `guide:uptake`:

| column | from |
|---|---|
| panel opens | a `aimee_panel_events` row per open (see below) |
| panel conversations started | `coaching_conversations` where `origin = 'panel'` |
| panel messages | `coaching_messages` joined to those conversations, counted, never read |
| help answers | turns that ran `search_help`, from the same events table |
| help searches with no result | the same, where the search returned nothing |
| moved to the Aimee page | "Continue on the Aimee page" clicks |

**Why a table and not only analytics.** PostHog already takes events, but
this app's own reports (`guide:uptake`, `analysis:weekly`) read the
database, and a weekly decision should not depend on a third party's
retention. So a small `aimee_panel_events` table (migration, same PR as
`origin`): `company_id`, `profile_id`, `kind` (`opened`, `help_search`,
`continue_on_page`), `found` (for searches), `created_at`. **No query
text and no page content**: a search can contain personal detail, and
coaching is private, so the table records that a search happened and
whether it found anything, never what was asked. RLS: insert own rows
only; read by system admins (for the script, which uses the service
role anyway). It gets an RLS probe (a member cannot read another
person's rows) because it is a new table with user writes.

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

**Decided (Jason, 2026-09-29): it floats over the page, like every other
panel in the app.** The page keeps its width and the panel sits over its
right-hand edge. It has no dimmed backdrop, so everything not under it
stays usable. An early build pushed the page left to make room, and was
changed. Anything the panel covers, including a drawer's or a dialog's
buttons, is on the manual test list.

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

## Build plan (in the decided order)

Each step is its own PR, useful on its own, merged before the next
starts unless said otherwise.

### Step 0: the five fixes (small separate PRs, first)

In order, Agent Hub tools first:
1. **Pinned tools apply**: the route takes an agent's tools from the
   pinned version, not the code registry.
2. **Old openers are hidden on agent swap**, never deleted. A
   `hidden_at` on `coaching_messages` (migration), set through a
   definer function the owner may call only before the first user turn,
   and filtered out of the history the page and the route read. It gets
   an RLS probe with red first (E5): the owner can hide their own
   conversation's opener before the first user turn; nobody else can,
   and nobody can hide anything after.
3. **Portfolio admins get their help**; the role-description version
   doc loads (`loader.ts`, `check-help-coverage.ts`, new loader tests).
4. **Hub previews leave the admin's conversation list.**
5. **Checked-turn retries are counted in cost.**

### Step 2 (first): the page list and help search, on the Aimee page

- **Delivers:** Aimee answers "how do I" about any page, with links the
  person can open, on the existing Aimee page.
- **Changes:** `src/lib/pages/registry.ts` with its CI completeness test;
  a per-person page index in the prompt; the `search_help` tool; the
  server-side link check on replies.
- **Migrations:** none.
- **Tests:** a member cannot get admin-only help; `::: role` text does
  not leak through search; the index for a member has no admin pages and
  no pages behind features the company lacks; a link to a page the
  person cannot open is removed from a reply; the registry completeness
  test fails for a page with no entry.

### Step 1: the icon and panel, with "About this page" (system admins only)

- **Delivers:** the Aimee icon replaces the "?", opening the panel with
  "About this page" (today's help, role-filtered). Shown to system admins
  only until Step 3 merges.
- **Changes:** `AimeeLauncher` in the app layout; the house `Drawer` gets
  a non-modal mode (desktop) and keeps its dialog mode (phone); the
  z-index and footer rules that existed for the "?" are settled.
- **Migrations:** none.
- **Tests:** the two e2e specs that find the "?" by label; keyboard and
  axe checks at both widths; a non-admin still sees the "?" and not the
  icon.

### Step 3: the conversation in the panel (system admins only, then release)

- **Delivers:** chatting in the panel; the last plain Aimee conversation
  reopens; "New conversation"; the conversation survives following a
  link; it shows on the Aimee page; panel conversations never write
  coach memory; "Continue on the Aimee page"; the per-conversation cost
  figure; `aimee:uptake`.
- **Changes:** a panel mode for `ChatView` (scrolls inside itself, no
  `router.refresh`); a server action returning the chat bundle; the
  panel kept mounted; `MemorySweep` into the layout; the `origin` column
  and `aimee_panel_events` table.
- **Migrations:** `origin` and `aimee_panel_events` (one migration, fleet
  run on Jason's go, dry run shown first).
- **Tests:** the coach memory tests above (panel leaves memory unchanged,
  page still writes, red first); the events table RLS probe; component
  tests for the panel chat; e2e for start in panel, follow a link, still
  there, open the same conversation on the Aimee page.
- **Release:** Steps 1 and 3 switch on for everyone together, after this
  merges.

### Step 4: page context

- **Delivers:** "help me with this" knows the page and the record.
- **Changes:** the panel sends `{ path, pattern, recordId }`; the server
  loads the record **under the person's own login**, so RLS applies, and
  adds a short description of it to the turn. The browser never sends a
  record's contents. A shared "what is open" context for records opened
  in a drawer.
- **Tests (decided):** a team member cannot get Aimee to read a record
  they cannot open (the ID of another company's meeting, or an
  admin-only record, resolves to nothing and nothing about it reaches
  the prompt); the route ignores anything but the ID from the browser.

### Step 5: nudges and shared chats on the Aimee icon

- **Delivers:** the icon's badge; a nudge opens its debrief in the panel;
  shared chats open in the panel. Everything else stays in the bell.
- **Changes:** notification queries split by kind; the nudge open logic
  becomes a server action; the champion card copy and `guide.md`.
- **Migrations:** none. The champion-only rule is unchanged.
- **Tests:** only the champion sees the nudge badge; "Not now" still
  records a dismissal; opening from the panel marks it read and opened;
  the bell no longer shows the moved kinds.

### Next project, after the panel ships: Aimee sees what leaders ask about

(Decided 2026-09-29.) Choosing the panel's suggested questions showed
how little plain Aimee can see. She has the company's purpose, vision
and values, company-wide history (follow-through by quarter, closed
quarters' plans, resolved issues, scorecard movement), the person's
own memory, the help, and the name and description of the record on
screen. She cannot see who is behind, what is at risk this quarter,
numbers off target, meeting decisions, open issues, anyone's
strengths, or who leads a function. So the suggested questions were
limited to what she can answer, and these were held back:

1. **The last meeting's decisions**, and who owns each. First.
2. **This quarter's priorities and their progress.**
3. **Open commitments.** A team member sees their own; an admin sees
   everyone's.
4. Numbers off target (critical success factors and their latest
   entries).
5. Open issues, and how long they have been open.
6. A named person's strengths, in plain Aimee rather than only in
   coaching about that person.
7. Who leads each function.
8. For a guide or portfolio admin, which of their companies needs
   attention (across companies, not inside one).

Each is a new tool, read under the person's own session so RLS decides
what comes back, with a harness probe showing a team member reading
another person's or another company's rows gets nothing. Items 1 to 3
first, in that order. The review of the panel's questions
(2026-09-29) lists the questions each one would unlock.

### Later: varied example first replies, instead of more checks

Jason, 2026-09-30, after the last wording change for now. Plain
Aimee's first reply is checked before it is shown (#367): her name,
an opening "That's" or "Okay", "actually" in the question, "rather
than" / "instead of" / "not just", more than one question, and a
named strength skipped. Each check was added after a test run showed
her settling into one pattern ("That's X, especially...", then "Okay,
that's...", then "... is real"), and each one closed that pattern
while the next appeared.

The next step is not another check. Give her a set of varied example
first replies in her instructions, different in shape and length, so
she has more than one pattern to draw on. Decide what goes in from
the weekly counts (`npm run aimee:uptake`: stock openings, harsh
words said back, and the rest), not from single test replies.

### Later: automatic agent choice

Groundwork as described above: one server-side choosing function, a
record of why an agent was chosen, pinned tools fixed (Step 0.1).

### Separately: the icon preview (done)

A preview page with the three directions, for Jason to choose from.
He chose his own mark instead (2026-09-29): a white speech bubble with
a chartreuse smile, on a cobalt circle. The preview (#351) was closed
and the page removed.

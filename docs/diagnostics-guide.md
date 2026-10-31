# Capacity Diagnostic: the lead's guide

How to run a Capacity Diagnostic in AiMS HQ. This guide is for the person running it and is not served in the app: nothing about this module goes into Aimee's help or the `?` widget (Jason, 2026-10-29).

Run a three-week Capacity Diagnostic for a client: their systems, the work done in them, the first win and the readout, all in one place. The people interviews (the survey, the conversations, the people in scope, the owner's pledge and the quotes) are hidden for now, so the diagnostic is about systems and process.

The pages are on no menu. Go to `/diagnostics` for every engagement, or `/diagnostics/clients` for the businesses you run them for. **Diagnostics**, **Across clients** and **Clients** at the top of each switch between them.

## Across clients

**Across clients** adds up how the diagnostics have gone: how many met the guarantee, how many chose the sprint or declined, the average hours back a week, measured and projected, the average hours a week carried between systems by hand, and the share of people who use AI tools they found themselves. The last two show a dash until a published readout has systems or AI answers in it. The same figures follow by industry and by source. Only published readouts count toward them; a diagnostic still running is counted as running.

## Add a client

On **Clients**, select **Add a client** and fill in the business, the owner, its size and where it is. A client here is not a company on AiMS HQ. **Edit** on the client's page changes the details. **Archive** puts a client away without deleting anything, and **Restore** brings it back.

## Automations

A client's page lists the automations being built for them under **Automations**: each one's stage (Planned, Building, Testing, Live or Paused), its build dates, its champion and the latest update. **Add from the diagnostic** starts the list from the newest diagnostic: the first win (Live once it is in use) and each next win on the roadmap (Planned, with its champion). Pressing it again adds only what is not there yet. **Add an automation** adds one by hand. Select an automation's name to change its stage, the day its build starts, the day it goes live, its champion or the latest update, or to remove it. The client will read this list on their own dashboard once client logins are built.

## Bots

Most automations are built as Grok Bots. In an automation's drawer, **Add a bot** and fill in:

- **Bot code**: the name the bot reports by, such as `northline-invoice-match`. It says which bot and which client.
- **How it starts**: **On a schedule** (how often, and when) or **When something happens** (what sets it off, which the client will read, and if you like how often it should run at least).
- **One item is a**, **Agreed minutes saved per item**, **Agreed hourly rate** and **Agreed on**: what the savings are worked out from.

The Grok Bot reports each run to AiMS HQ with the `record_bot_run` tool, connected to AiMS HQ through AI apps and signed in as a system admin: the bot code, whether it worked or failed, how many items it handled, and for a failure one line on why. A failed run counts but saves nothing; only system admins see why it failed.

A bot is **Late** when its next run is half an interval overdue, **Stopped** after two missed runs, and **Needs attention** when its last run failed. **Bots**, at the top of the diagnostic pages, lists every client's bots with the ones needing a look first. When a bot changes to or from one of those, AiMS HQ sends a webhook to the Bot Management Grok Bot; `list_bot_problems` gives the same list when no alert came.

## People who can sign in

The people at a client can sign in and see their own dashboard: the hours and money their bots have saved, each bot's status and runs, the automations being built, and their published readout. They never see why a run failed or a bot's code. On the client's page, under **People who can sign in**, enter a name and email and select **Send invite**. They get the usual AiMS HQ invite, set a password, and from then on land on their dashboard at the usual address. They see nothing else in AiMS HQ. Each person shows when they last signed in, or that they haven't yet, with **Send again**. **Remove access** deletes their account.

## Seeing their portal

On the client's page, select **See their portal**. It opens their dashboard as their logins see it, with a strip across the top saying it's a preview. Proposal and readout links open your own pages, so nothing there signs or changes anything for them. **Back to the client** returns you to their page.

## Proposals

On the client's page, under **Proposals**, select **New proposal**. It starts a Capacity Unlocking Engagement from the template, with the client's owner and your name filled in, and the plan's four stages (Capacity Diagnostic, Your readout, Deployment, Support) already written. Each section has its own editor and saves when you click away. Fill in every bracketed placeholder, such as the investment and the term: until they are gone, the proposal can't be published.

The owner signs with the login for the owner email on the client, so add that email under Details and invite the same email under **People who can sign in** first. The Proposals card tells you when either is missing.

To publish, type your name, tick that you are signing for AiMS Institute, and select **Sign and publish**. That is your signature, and the version locks. The owner sees **Ready for your signature** at the top of their dashboard when they sign in, reads the proposal, and signs it by typing their name. You can also copy the link from the proposal's page and send it. Either of you can download the PDF, which carries both signatures and the signing record (each name, the time, the IP address and the version's fingerprint).

To change a published proposal, select **Make version 2 to change it**. When you sign and publish the new version, it replaces the old one, and the owner signs again. A draft can be deleted; a published version can't.

## Start a diagnostic

On the client's page, select **Start a diagnostic**. It opens on the first screen of Pre-flight.

A diagnostic takes weeks, so you can work in any order. Opening a diagnostic shows its **Overview**: **Next up** with **Continue** to the next thing to do, each step's progress, every screen with where it stands, and anything you skipped on the way. Each step is a few short screens. Every screen shows where you are in the step and one save status, and has **Back**, **Save and exit to overview** and **Next** at the foot. Everything saves as you go, and Next waits for it. Nothing is locked except publishing the readout, which needs the first win's measured week. The tabs along the top go to the overview or to any step.

On **Score tasks**, each task is a card: pick a chip in each row, or press 1 to 9 for the highlighted row, and Enter for the next task. **Skip for now** moves on. **Table view** shows every task's scores in one table.

1. **Pre-flight.** List the tools the group uses and the IT contact, then tick what is done. **Next** waits for **Access secured**: no access by kickoff means the kickoff moves. Below that is the **systems walkthrough**, a 30-minute conversation with the IT or admin contact. Its four questions are on screen.
   - **Add a system** for each one the team works in every week: its name, kind, what lives there and who looks after it.
   - **Add a link** for each way information moves from one system to another: what moves, and whether it is typed in again, exported and imported, or connected automatically. Put what breaks or gets missed (question 4) in the link's notes. **Edit** opens either one again. You can delete a link any time, and a system once no task or link uses it.
   - Under **The work done in them**, add each recurring task: what it is, who does it (a role, not a name), where it happens and its hours a week. In the table, **Copies information** picks the link the task copies along, if it does. Enter units a week and minutes per unit against the biggest tasks to check their hours, then the data risk and build hours. Every task is a candidate for the first win until you set **Candidate** to **No, leave it out**. Each cell saves when you leave it.
   - Score each task in the same row: **How often**, **Data risk**, **Build effort**, **Needs approval** and **Agent type**. These rank the candidates on Build and suggest the agent team.
   - Tick **where requests come in** and **what the business has written down**, and say where it lives.
   - Last, **AI tools the team uses for work**: one per line or comma. The readout lists them by name.
2. **Kickoff.** First **The owner's week**: three questions about where the owner's own time goes, which show on the readout under The Capacity Destination. Then the kickoff and readout dates, the guarantee (3 hours unless you agreed something else), the scope and the Capacity Destination.
3. **Build.** The systems map shows each system as a box and each way information moves as an arrow: a heavy arrow is typed in again or exported and imported, labelled with the hours a week the copying tasks spend on it, and a thin one is automatic. Under it, the candidates, highest score first: 10 points for each hour a week, less for medium or high data risk and for a longer build, with how each score adds up. **Top 3 next wins** are the low-risk candidates you can build in half a day or less. **Recommended agent team** suggests up to four agents from the tasks' agent types; edit any card and **Save the team**. Select **Choose first win** to pick a pattern and the task it serves and enter the baseline. Once it is in use, enter the minutes per unit after and the Friday that ends its first full week: the measured hours back, the recovery rate, the projection and the guarantee fill in. Under **Systems and AI**: the connections carried by hand, biggest first; any copying no link covers yet; and the AI tools the team uses. Under **Guardrails snapshot**, describe how the business sounds when it writes to customers, tick what an agent never does alone, then enter the data the builds would touch and three rules, one per line. **Retyping removed** is in the pattern library for a first win on a connection carried by hand. Record the midpoint check with the owner at the bottom (the readout date is set on Kickoff).
4. **Readout.** **Open the readout** shows it as the owner will read it; **Download the PDF** gives you the file to send. Set the 90-day roadmap (three next wins, the week each lands and the champion to train) and press **Save**. The readout runs The First Win, Hours Back, The Capacity Destination, Top 3 Next Wins, the **Recommended Agent Team**, the **Systems and AI Snapshot** (the systems map, the top three connections carried by hand with their hours, the AI tools, the data at risk and the three rules) and The 90-Day Roadmap. **Write the narrative** drafts a short paragraph for each section from the figures; edit any of them, and each saves when you leave it. A section left empty after writing came back with a number that isn't in the readout, so write that one yourself. When it reads right, press **Publish the readout**. You need the first win's measured week first. Publishing is final: the readout stops changing, and the PDF shows what you published. Then record the decision: **They chose the sprint** or **They declined**, which asks once before recording. Both wait until the readout is published. **Download the roadmap as Markdown** gives you the roadmap, the next wins and the Capacity Destination to set up a sprint by hand.

**Archive** at the foot of a diagnostic puts it away.

A readout published before the interviews were hidden keeps every section it was published with.

## Who sees what

Only system admins on AiMS HQ can open these pages. The owner gets the readout PDF, and the people you add under **People who can sign in** see their own dashboard and nothing else.

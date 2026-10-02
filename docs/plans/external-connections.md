# External connections: the corrected plan

Status: Phase 1 approved and built (PR #395, not merged). Written
2026-10-02 against `main` at e8208db.

## Read this first: the Sep 22 file did not arrive

The attachment `external-connections-build-plan.md` did not come through
with the request, and no copy exists in the repo, in any earlier session
on disk, or in the published pages. This document is built from the four
phases as the request names them (vault, the contract with Sheets moved
onto it, the Connections page, HubSpot), the "AiMS Integration Framework"
proposal of Sep 3, and spec §10b, which names the same later phases.
**Send the Sep 22 file and I will reconcile anything in it this misses.**
Each "assumed" line below is what those sources assumed.

## Decisions

**Approved by Jason, 2026-10-02: 1, 2, 3, 6, 7 and 8.** Jason gets 4
and 5 from the client before Phase 4. Conditions he attached:

- **1:** confirm whether dev can decrypt production's secrets after a
  clone, and keep the scrub either way. **It can.** Dev's Vault key
  matched production's, compared by fingerprint through the Management
  API, because the clone is made with "Restore to a new project", which
  copies the key. The scrub now removes every vault secret and fails
  while dev's key is production's (section 1.3).
- **2:** check Benson's weekly pull on dev before and after the move,
  and on production right after it, with a way back if it fails.
  Benson's numbers must not miss a week. Done on dev, with the
  production runbook in `docs/deployment.md`.
- **7:** the client's validation report must count wins by the date
  entered Closed won, not Close date (Phase 4, measure 3).

The list as first written:

1. **How secrets are encrypted.** I recommend Supabase Vault (Phase 1,
   section 1.3).
2. **Move the Google tokens into the vault in Phase 1.** Google refresh
   tokens sit in `oauth_credentials` as plain text today, and every Sheets
   pull uses them. I recommend moving them in Phase 1, so the vault is
   proven on a secret that is already in use before HubSpot depends on it.
3. **Who may manage a connection.** I recommend the same people who may
   map a measure today: a system admin, the company's own company admin,
   and anyone `is_content_admin_for()` admits (an assigned guide, or a
   portfolio admin a system admin has switched on as that company's
   admin). An unswitched portfolio admin may not.
4. **What "awarded" means for Total Factored Pipeline.** This one needs
   the client (Phase 4, measure 1).
5. **Which HubSpot pipeline, and which stage is "Quoted".** Stage ids,
   from the client's account (Phase 4).
6. **Snapshots start the week they are switched on.** Measures 1 and 2
   are "right now" numbers. HubSpot keeps no history of them, so past
   weeks cannot be filled in. I recommend accepting that, and showing it
   on the measure.
7. **Which date makes a deal "awarded in the week".** I recommend the
   date the deal entered Closed won, which HubSpot sets, over Close date,
   which anyone can edit (Phase 4, measure 3).
8. **The order.** I recommend keeping it, with two changes (section 5).

## What changed since Sep 22 that the plan has to absorb

- **Google is hard-wired into the database in four places:**
  - the `success_measures.external_source` shape check (only
    `week_keyed` and `snapshot`, both sheet-shaped);
  - the `success_measure_entries.origin` check (`'google_sheet'` only);
  - the literal `'google_sheet'` inside `_record_external_pull`;
  - the `external_pull_log.mapping_kind` check.
  A second connector needs all four changed.
- **Who may write measures changed (0245).** Every guide write rule now
  uses `is_content_admin_for()`, including `record_external_pull`. That
  function admits an assigned guide, and a portfolio admin only when a
  system admin has switched it on for that company. CLAUDE.md's
  Permissions section keeps portfolio admin writes to a closed list, and
  forbids `is_guide_for()` and `is_admin_for()` in a write rule.
- **Corrected 2026-10-02: no gap here.** The first version of this
  plan said `pullExternalMeasureAction`'s `isAdminForCompany` admitted
  any assigned portfolio admin. It does not: it reads
  `portfolio_admin_company_ids`, which holds only the companies where a
  system admin switched the portfolio admin on. That is the same rule as
  `is_content_admin_for()`.
- **0246** (owners assigned to a company own their work) changed nothing
  for measures.
- **0247 (the measure-entries fix)** changed no permission. It added
  `company_id` to measures and entries, set by trigger from the parent
  row. A connector never writes `company_id` itself, which suits the
  contract.
- **0248** lets the scheduled pull replace its own earlier value when the
  source changed. A typed value still always wins. The contract must keep
  both rules for every connector.
- **0253 (open data, phase D)** made the pull receipts
  (`external_pull_log`) readable by the company. The open-data
  investigation keeps credentials and setup restricted: "credentials and
  setup, not content". A connection's status can be shown to the company.
  Its secret is never readable by anyone.
- **Dev is cloned from production**, and `npm run scrub:dev` deletes
  `oauth_credentials` by table name and nothing else. Any new place a
  secret lives has to be added to the scrub, its test and `docs/e2e.md`,
  in the same PR that creates it.
- **The fleet.** Every instance is its own Supabase project, and the cron
  already runs per instance (`forEachActiveInstance`). Connections,
  secrets and pulls all stay inside the instance that owns the company.
- **Stale docs found on the way**, to fix in the contract phase:
  - §10b still says mapping is system admin only;
  - its "Pull" bullet predates 0245, and its receipts list predates 0253;
  - its schedule table has performance on Saturday 15:00, where it is
    Tuesday 12:00;
  - it says the scheduled pull "may replace nothing", which 0248 changed;
  - line 1407 says there are no integrations beyond Google Drive.

## Phase 1: the vault

**What it is.** One place every connector's secret lives, readable only
by server code acting for the connection's own company, and never by any
signed-in person.

### 1.1 What the plan assumed that is no longer true

- **Assumed:** the vault starts empty and HubSpot is its first secret.
  **Now:** the Google tokens are the only secrets AiMS holds, they are
  plain text, and Sheets depends on them. Proving the vault on them first
  is safer (decision 2).
- **Assumed:** "no read policy for any role" was enough. **Now:** the
  write path also has to follow 0245. A secret is written by a privileged
  function whose comment names the roles it admits, and it may not test
  the role with `is_guide_for()` or `is_admin_for()`.
- **Assumed:** the scrub was a deployment chore. **Now:** it is a rule
  (#77, failure mode E3), and the scrub knows tables only by name. The
  vault cannot ship without the scrub covering it.

### 1.2 Corrections

1. A `connections` table: one row per company per connector, holding
   status, the account it reaches, the scopes it has, when it was checked
   and the last error. **No secret in it.** It points at the secret by id.
2. Writing a secret goes through one privileged function that resolves the
   company from the connection row, never from what the caller sends. It
   admits a system admin, the company's company admin, and
   `is_content_admin_for(company)` (decision 3).
3. Reading a secret goes through one function granted to `service_role`
   only. Nobody signed in can call it.
4. The screen only ever shows that a key is saved, its last four
   characters and when it was saved. A saved key is never sent back to the
   browser.
5. `scrub:dev` deletes the vault's secrets and the connection rows'
   pointers on the clone. A test and a harness probe prove that, and that
   nobody signed in can read a secret. The probe fails first, against the
   schema without the vault.
6. Each connect, replace, disconnect and failed check goes in an audit log,
   with no secret in it.

### 1.3 The open decision: Supabase Vault or encryption in the app

**What each is, in plain terms.**

- **Supabase Vault.** The secret is encrypted inside the database. The
  key that unlocks it is held by Supabase, outside the database, per
  project. It is never in our code, our environment variables or a
  database dump.
- **Encryption in the app.** Our code encrypts the secret before saving
  it, with a key we keep in Vercel's environment variables. The database
  only ever sees scrambled text.

**What the dev clone does to each.** Dev is cloned from production, so
whatever is in the table is copied either way.

- With **Vault**: **corrected after checking, 2026-10-02.** The first
  version of this plan said dev's key would differ. It does not. Dev is
  made with Supabase's "Restore to a new project", which copies the
  project's Vault key, and dev's key matched production's. So, until the
  scrub runs, the clone can decrypt what it copies. The scrub removes
  every vault secret, then fails while the keys match, and
  `--rotate-key` gives dev its own key once its secrets are gone. A
  clone made with a plain dump and restore would get a fresh key.
- With **app encryption**, whether dev can read production's secrets
  depends on which key dev's environment holds. Dev runs locally with
  production-shaped variables (`LOCAL_INSTANCE_*`). One copied variable
  would let dev decrypt every client's live CRM key. The only protection
  would be the scrub and our discipline about variables.

**What happens if the key is lost.**

- **Vault:** the key cannot be lost apart from the project. Restoring the
  project's own backup keeps it. Restoring into a new project does not,
  so the secrets in that copy cannot be decrypted. Each client would
  re-enter their key, and the Connections page would show those
  connections as needing a new key.
- **App encryption:** if the environment variable is deleted, overwritten
  or rotated without keeping the old one, every saved secret becomes
  scrambled text that nothing can recover. Every client re-enters their
  key, as above. A leaked variable is worse. Together with a database
  dump, it exposes every client's key at once, on every instance that
  shares it.

**Other differences.**

- **One key per instance comes free with Vault**, because each instance
  is its own project. With app encryption we would add a key per instance
  to `{PREFIX}_*` and keep track of it.
- **App encryption is portable** away from Supabase. That matters only if
  we leave Supabase, and the whole fleet runs on it.
- **Vault is reached through SQL functions.** That suits this codebase:
  the definer-function pattern is how pulls are already written, and the
  harness can probe it.

**Recommendation: Supabase Vault.** A key cannot be lost on its own,
nothing secret lives in Vercel, and each instance gets its own key with
no work (PromiseOne's differs from production's). The dev clone is the
exception, handled by the scrub. Vault is installed on all three
projects (`supabase_vault` 0.3.1). **One more thing to know:** the
Supabase Management API returns a project's Vault key to anyone holding
the management token, so that token (in `.env.provisioning`) is, in
effect, the master key to every instance's secrets. Before Phase 1 starts, I
will confirm that Vault is enabled on all three projects and which
version runs there. Supabase has moved Vault off pgsodium, and the plan
should build on the supported version.

## Phase 2: the connector contract, with Sheets moved onto it

**What it is.** One shape every connector fills in, so the pull, the
cron, the receipts and the rules about which value wins are written once.

### 2.1 What the plan assumed that is no longer true

- **Assumed:** a "third mapping kind" would be added for HubSpot (spec
  §10b). **Now:** HubSpot's measures are not sheet-shaped. Today's two
  kinds describe where a number sits in a sheet: a row per week, or one
  cell. HubSpot's numbers are computed: a sum or count over deals. Adding
  a third kind beside two sheet kinds would mix "where" with "what time
  it describes".
- **Assumed:** pulled entries were simply "from Google". **Now:** the
  origin is checked as `'google_sheet'` in two places and written as a
  literal in a third.

### 2.2 Corrections

1. **Kinds describe time, not layout.** Two kinds for every connector:
   - **weekly**: a value for a given week, which can be worked out for
     past weeks and so can be backfilled;
   - **snapshot**: a value as it stands at the moment of the pull, which
     cannot be backfilled.

   Sheets' "row per week" becomes a weekly recipe and its "one cell"
   becomes a snapshot recipe, so existing mappings are translated in
   place, by migration. Each connector owns its recipe shape, checked in
   code and by the database.
2. **The origin names the connector**: `google_sheet`, `hubspot`. The
   receipts record the connector and the kind.
3. **One pull function per path, written once**: manual wins, the
   scheduled pull replaces only its own earlier value when the source
   changed (0248), the company comes from the measure, and
   `is_content_admin_for()` is the guide test, which the app's
   `isAdminForCompany` already matches.
4. **A shared helper turns a timestamp into its week**: the company's
   timezone first, then `fridayOf`. HubSpot dates are timestamps, and
   `fridayOf` only takes calendar dates today. Weeks run Saturday to
   Friday.
5. **Sheets reads its Google connection from the vault** (decision 2),
   not from the transcript row directly. Transcripts and Sheets keep
   sharing one Google connection per company. The Connections page shows
   it once.
6. Fix the stale §10b items listed above.
7. **Proof that nothing moved**: the three Sheets e2e tests and the cron
   test pass unchanged against the contract, and the migration translates
   every existing mapping. I will count them on each instance before and
   after.

## Phase 3: the Connections page

### 3.1 What the plan assumed that is no longer true

- **Assumed:** connect lives on the admin companies page, beside the
  transcripts panel. **Now:** the client enters the HubSpot key himself,
  so the page must be one a company admin reaches in their own company,
  not a system admin's page.
- **Assumed:** a guide or any admin could connect. **Now:** 0245 decides
  who (decision 3).
- **Assumed:** help could wait. **Now:** the documentation rule needs a
  help page for a new surface, in the same PR, and the page has to be
  added to the page registry (`check:help` and the registry test enforce
  that).

### 3.2 Corrections

1. A **Connections** page for the company, behind the existing
   `external_measures` feature (its hint is already connector-neutral).
   - One card per connector: Google, then HubSpot.
   - Each card shows status, the account it reaches, its scopes, when it
     was last checked and the last error.
   - Actions: **Add key**, **Replace key**, **Disconnect**.
2. **Adding a HubSpot key checks it before saving**: one small read call
   proves the key works and has the deals read scope. A key that fails is
   never stored.
3. **The key is typed in on this page only.** The page says so, and the
   help and the invite email say never to send a key by email or chat.
4. **Google moves here from the admin companies page**: the same
   connection, shown in one place.
5. **Who sees what.** Everyone who may manage a connection sees the full
   card. The rest of the company sees nothing, because the setup stays
   restricted (open-data).
6. A help page, the page registry entry, a spec section and a harness
   probe for every new write rule, red first.

## Phase 4: HubSpot, as it is now

### 4.1 What the plan assumed that is no longer true

- **Assumed:** a public OAuth app, with a private app token as a
  stopgap. **Now:** HubSpot's own advice for a data-only integration with
  one account is a **service key**. It is created by a Super Admin under
  Settings → Integrations → Service keys, or Development → Keys → Service
  keys, and sent as a Bearer token. The client creates it with two
  read-only scopes, `crm.objects.deals.read` and `crm.schemas.deals.read`.
- **A correction to the brief:** October 26, 2026 is the date existing
  accounts lose the ability to create new private apps. Private app
  tokens that already exist keep working; HubSpot says existing legacy
  private apps "continue to work as-is". That changes no decision: a
  service key is still right. It does mean there is no hard deadline on
  our side.
- **Assumed:** a six-metric catalog. **Now:** four named measures, each
  with a recipe.
- **Assumed:** webhooks later for freshness. **Now:** service keys
  cannot receive webhooks, so this connector is pull-only.

### 4.2 How each HubSpot measure maps onto the contract

HubSpot has no "sum this" call. Every recipe searches deals with filters
and adds up the results in our code, page by page (up to 200 deals a
page). Its search returns at most 10,000 results for one query, far above
one client's weekly volume. Amounts use the home-currency versions of each
property, so a deal in another currency is converted the way HubSpot
converts it.

**1. Total Factored Pipeline. Kind: snapshot.**
- **The recipe holds:** the pipeline; the stage or stages that count as
  awarded; the quoted stage or stages; for awarded deals, the full amount;
  for quoted deals, the weighted amount (HubSpot's Weighted amount, which
  is amount × deal probability).
- **Why it can be unreliable:**
  - "Awarded" is not yet defined (decision 4). Closed won ever, this year,
    or not yet delivered all give very different totals.
  - A deal's probability stops following its stage once anyone edits it
    by hand, so its weighted amount can be stale.
  - Deals with no amount count as zero, silently.
  - As a snapshot it has no history, so the week it starts is the first
    week shown (decision 6).

**2. Amount of work currently quoted. Kind: snapshot.**
- **The recipe holds:** the pipeline and the Quoted stage id or ids; the
  sum of amount for deals in those stages at the moment of the pull.
- **Why it can be unreliable:**
  - Deals left sitting in Quoted keep counting until somebody moves them,
    so the number grows with neglect, not just with new quotes.
  - It depends on the day of the pull, because the number moves daily.
  - It has no history.
  - If the stage is renamed nothing breaks, because the recipe holds the
    stage id. If the stage is replaced, the measure silently falls to
    zero, so the pull should fail loudly when a stage id no longer exists.

**3. New work awarded in the week. Kind: weekly.**
- **The recipe holds:** the pipeline; the Closed won stage; the date that
  places a deal in a week (decision 7); the sum of amount for deals whose
  date falls in that week, in the company's timezone, Saturday to Friday.
- **Approved (decision 7):** a deal belongs to the week it entered
  Closed won (HubSpot's `hs_v2_date_entered_<closed won stage id>`),
  not to its Close date. **The client's validation report must count
  wins the same way**, by the date entered Closed won. A report built
  on Close date will disagree with AiMS whenever a Close date was typed
  by hand, and the comparison would look like our error.
- **Why it can be unreliable:**
  - Close date can be edited by anyone and is often typed to suit a
    forecast. The date the deal entered Closed won is set by HubSpot.
  - A deal reopened and won again moves weeks.
  - A deal marked won late, dated last week, changes a week already
    shown. The scheduled pull replaces only its own last value (0248), so
    older weeks need a backfill to catch up.
  - An amount edited after the win changes the total.
  - This kind can be backfilled.

**4. Number of new opportunities identified. Kind: weekly.**
- **The recipe holds:** the pipeline; a count of deals whose create date
  falls in the week, in the company's timezone.
- **Why it can be unreliable:**
  - Imported or bulk-created deals get the import date, so a migration
    shows up as a record week.
  - A deleted deal disappears from past weeks.
  - A deal created in another pipeline and moved in later is counted only
    if the recipe looks at the deal's current pipeline. That needs a
    choice.
  - If the client creates deals only when a quote goes out, "identified"
    really means "quoted". Worth asking.
  - This kind can be backfilled.

### 4.3 Other corrections

- **The key is checked on save and on every pull.** A revoked or rotated
  key marks the connection as needing a new key, with one notice. HubSpot
  keeps a rotated key working for seven days, which gives the client time
  to paste the new one.
- **Rate limits** are far above one weekly pull per measure. The pull
  still runs one measure at a time, as Sheets does.
- **No deal records are stored.** Only the weekly number and the receipt,
  as the Sep 3 proposal said: storing CRM records would bring the client's
  data into our compliance surface for no product benefit.

## 5. The order

The order holds: vault, contract with Sheets moved onto it, Connections
page, HubSpot. Two changes:

1. **Design the contract against all four HubSpot recipes on paper, not
   only against Sheets.** A contract shaped by one connector is the risk
   the Sep 3 proposal warned about ("resist generalising until the second
   provider"). With the HubSpot recipes written down, the second connector
   is in the design without being built.
2. **Settle decisions 4, 5 and 7 with the client before Phase 4 starts,
   not during it.** They decide what the recipes hold, and a wrong guess
   means a measure that is confidently wrong.

There is no reason to rush HubSpot ahead of the vault. The October 26
date does not stop existing tokens, and the client can create a service
key whenever the Connections page is ready. Storing a client's CRM key
before the vault exists would be the exposure 0164 fixed, made again on
purpose.

## Sources for the HubSpot facts

- [Legacy Private App Creation Being Disabled](https://developers.hubspot.com/changelog/legacy-private-app-creation-sunset)
- [HubSpot Service Keys: The Right API Credential for Data Integrations](https://developers.hubspot.com/blog/hubspot-service-keys-the-right-api-credential-for-data-integrations)
- [Service Keys enter public beta](https://developers.hubspot.com/changelog/service-keys)
- [Stage calculated properties (hs_v2_date_entered)](https://developers.hubspot.com/changelog/upcoming-sunset-of-pipeline-legacy-stage-calculated-properties-for-contacts-and-deals)
- [Weighted amount and deal probability behaviour](https://community.hubspot.com/t5/Tips-Tricks-Best-Practices/Deal-Probability-property-updates/td-p/464967)

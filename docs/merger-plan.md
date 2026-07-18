# AiMSHigher × Strengths Map merger plan

Living design doc. Started 2026-07-18. Update as decisions land and phases complete.

## Vision

One platform, two subscribable modules. Customers pick **Execution** (this app: strategy → priorities → weekly commitments → follow-through), **Strengths Map** (assessment → dimension scoring → team builder), or both. Positioned as a Ninety.io alternative for SMB owners, with Strengths Map as the differentiator Ninety doesn't have.

## Locked decisions

1. **Coaching model = one shared primitive.** A single `coaching_conversations` / `coaching_messages` pair with a `context_kind` column (`'execution' | 'strengths' | ...`). Each module contributes its own prompt file and context assembler; the table, RLS, streaming, chat UI, and message persistence stay shared. Access rule stays `created_by = auth.uid()` + company/role scope. New coaching contexts (a specific priority, onboarding, whatever comes next) plug in without another migration.

2. **Profile shape adopts Strengths Map's structured fields.** AiMSHigher's `full_name` gets replaced by `first_name` + `last_name`, and we add `hire_date`, `position_start_date`, and `reports_to`. The last one unlocks an org-chart surface later without a second migration.

3. **AiMSHigher is home base.** All Strengths Map code moves in as a `modules/strengths/` sub-tree. Rationale: denser code, current SDK versions (SM lags on Anthropic + Supabase-ssr), more recent architectural conventions (route groups, `auth_profile()` helper, hash-invalidated caches).

## Boundary sketch

```
shared/
  lib/{supabase, auth, types, utils, dates}   ← Profile, Company, Role, RLS helpers
  components/{nav, auth-shell, ui}            ← NavBand with module switcher
  app/(auth)/*                                ← sign-in, reset, accept-invite

modules/execution/                            ← current AiMSHigher
  app/(app)/{dashboard, plan, commitments, people, foundation, quarters, coach}
  lib/{commitments, plan, dashboard, coach}
  supabase/migrations/000X_*.sql              ← keep numbering, extend

modules/strengths/                            ← ported from Strengths Map
  app/{assessment, results, teams, admin}
  lib/{scoring, team-scoring, voice-rules}
  supabase/migrations/01XX_strengths_*.sql    ← renumbered to avoid collision
```

Subscription gate: new `company_features` table (`company_id`, feature name). NavBand queries it and hides modules the customer didn't buy. RLS on module tables uses the same `auth_profile()` + `company_id` predicates we already use, no extra check needed.

## Phase-by-phase execution

- [x] **Phase 1 — Prep** (dependency bumps, migration renumbering, `company_features` table)
  - [ ] Bump Strengths Map's dependencies in the SM repo (manual — see below), verify assessment + coaching endpoints still work locally
  - [ ] Renumber SM migrations to `01XX_` range so they don't collide with AiMSHigher's `0001–0016` (deferred until Phase 4/5 when SM tables physically import; renumbering earlier gains nothing)
  - [x] Add `company_features(company_id, feature)` migration to AiMSHigher (`supabase/migrations/0016_company_features.sql`)
  - [x] Add `company_has_feature(cid, feat)` SQL helper for module-table RLS in later phases
  - [x] Backfill `'execution'` entitlement for every existing company
  - [x] `src/lib/subscriptions/service.ts` exposes `getCompanyFeatures` / `companyHasFeature` for server components

### Strengths Map dep bumps (manual, in the SM repo)

Edit `/Users/jasonmackenzie/Custom Applications/AiMS Strengths Map/package.json`:

```json
"@anthropic-ai/sdk": "^0.111.0",     // was 0.32.1
"@supabase/ssr": "^0.12.1",           // was 0.5.2
"@supabase/supabase-js": "^2.110.5"   // was 2.47.10
```

Then in that repo:

```bash
npm install
npm run typecheck
npm run dev
# smoke-test: /assessment, /results, /api/coach, /api/generate-team-insights
```

Anthropic bumped from 0.32 → 0.111 is the biggest jump; expect changes around the streaming helper (`.stream()` / `.finalMessage()`) and the tool-use API. If SM only uses `messages.create` without tools/streaming, the surface is nearly unchanged.
- [x] **Phase 2 — Shared auth + tenancy** (partial — schema landed, code unification deferred until SM ports over)
  - [x] Add `first_name`, `last_name`, `hire_date`, `position_start_date`, `reports_to` to `profiles`; backfill; keep `full_name` in sync via a bidirectional BEFORE INSERT/UPDATE trigger so both legacy `full_name` writes and new structured writes work (migration 0017)
  - [x] Update `Profile` TS type with all five new fields (nullable, backfilled by migration)
  - [ ] Unify invitation flow on AiMSHigher's `invitations` table (SM's `invite_status` on profile gets deprecated) — **deferred to Phase 4/5** when SM code physically moves in
  - [ ] Consolidate to one sign-in / reset / accept-invite surface — **deferred to Phase 4/5** for the same reason
- [x] **Phase 3 — Shared nav + module switcher** (partial — feature gating landed, URL restructure deferred)
  - [x] Layout fetches `getCompanyFeatures` for the effective company and passes to `NavBand`
  - [x] `NavBand` tags every link with its module (`execution` | `strengths` | `null` for always-on) and filters by subscription before rendering
  - [x] Placeholder comment marks where Strengths Map links slot in when Phase 4 lands
  - [ ] Move route groups to `/execution/*` and `/strengths/*` — **deferred**. Reasoning: current execution routes live at root (`/dashboard`, `/plan`, etc.); a URL restructure would touch every internal link, redirect, and revalidatePath. Cleaner to leave execution as the default namespace and namespace only Strengths (`/strengths/*`) when its code lands.
- [x] **Phase 4 — Coaching consolidation**
  - [x] Add `context_kind` column to `coaching_conversations` (default `'execution'`, CHECK constraint on `('execution', 'strengths')`) — migration 0018
  - [x] `CoachingConversation` type + `CoachingContextKind` union in the coaching service; `createConversationAction` accepts `contextKind` (defaults to `'execution'`) so every existing entry point keeps working untouched
  - [x] Prompt-selection matrix in `/api/coach`: `context_kind × isSelfCoaching` → `strengths-self-coach.md` | `self-coach.md` | `leadership-coach.md`. Strengths context defaults to the self-coach prompt since SM only shipped self-coaching
  - [x] `buildCoachContext` dispatches on `contextKind` — execution path is the existing rich person context; strengths path is a stub note ("assessment data not yet loaded") until Phase 5 physically moves SM tables in
  - [x] `prompts/strengths-self-coach.md` ported from SM's inline coach prompt + VOICE_RULES, adapted to the shared context-block format
- [x] **Phase 5 — Physical SM code import + module API/component merge** — all sub-phases file-complete. Visual polish against AiMSHigher's tokens + shared-component hoist remain.
  - [x] **5a — Schema import.** SM's 7 domain tables land in AiMSHigher's DB (migrations 0101–0103) with a `strengths_` prefix — `strengths_items`, `strengths_assessments`, `strengths_responses`, `strengths_narrative_messages`, `strengths_results`, `strengths_team_insights`, `strengths_teams`, `strengths_team_members`, `strengths_team_evaluations`. RLS uses `auth_profile()` + `company_has_feature(company_id, 'strengths')` so a company without the subscription can't even read the tables. 64-item seed ported verbatim.
  - [x] **5b — Lib import.** Ported into `src/lib/strengths/`: `types.ts` (Role/InviteStatus/Profile stripped — those live in AiMSHigher's unified `src/lib/types.ts`), `scoring.ts`, `team-scoring.ts`, `team-signals.ts`, `team-labels.ts`, `tenure.ts`, `voice-rules.ts`. All imports remain relative so nothing else needs to change. Skipped: `anthropic.ts` (AiMSHigher instantiates the client inline), `email.ts` + `resend.ts` (email/invite logic waits for auth surface merge), `toast.ts` (no toast convention here yet), `supabase/*` (AiMSHigher has its own client wrappers).
  - [x] **5c — Assessment routes.** `/strengths/{welcome,assessment,results}` ported into the `(app)` route group so they inherit NavBand + auth from the shared layout. Depends: `src/components/strengths/{ProgressBar,ResultsView,CoachingSummaryCard}`. All references to `/welcome`, `/assessment`, `/results`, `/api/narrative`, `/api/generate-results` rewritten to their new namespaces. TopNav imports and JSX stripped.
  - [x] **5d — Team Builder.** `/strengths/teams/{,[id],recommend}` ported into the `(app)` route group. Depends: `src/components/strengths/teams/{CreateTeamForm,RecommendPage,TeamPage}` and `src/components/strengths/AdminBackLink`. Same set of path/table/import substitutions.
  - [x] **5e — API endpoints.** `/api/strengths/{narrative,generate-results,generate-team-insights}` ported. Shim `src/lib/strengths/anthropic.ts` mirrors SM's original `anthropic()` singleton and reads the shared `ANTHROPIC_COACH_MODEL`. Anthropic SDK 0.32 → 0.111 broke SM's inline TextBlock type predicate; fixed with `Anthropic.TextBlock` + default import at the top of each file.
  - [x] **5f — Coach entry-point wiring.** `NewConversationButton` takes an optional `contextKind` prop; `/coach/[profileId]?context=strengths` triggers a strengths conversation. SM's inline `/api/coach` is now redundant — the unified `/api/coach` (Phase 4) serves both modules.
  - [x] **5g — Nav strengths items.** Added Assessment / Results / Teams links to `APP_LINKS` with `feature: 'strengths'`. Auto-hidden today because no company has the entitlement; they light up the moment `company_features` gets a row.
  - [x] **5h — Wire strengths context assembler.** `buildCoachContext`'s strengths branch now queries `strengths_assessments` (latest completed) + `strengths_results` (profile + summary) + `strengths_narrative_messages` (transcript). Falls back to a graceful "not yet completed" note when the subject hasn't finished one.
  - [ ] Shared components (form primitives, cards, chips) hoist to `shared/components/ui` — deferred; do after 5b–5h so we can see the actual shared surface.
- [ ] **Phase 6 — Validation + staged rollout**
  - Full integration test: user signs in, sees both modules based on `company_features`, uses each end-to-end
  - Deploy to staging with both modules enabled for a test company; verify RLS on cross-module reads
  - Prod rollout behind feature flag; existing customers grandfathered by default

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| SM's SDK bumps introduce breaking changes to assessment / coach endpoints | Phase 1 in isolation, before any merge. If the Anthropic streaming API surface shifted, wrap with an adapter. |
| Coaching table schema change breaks existing AiMSHigher conversations | `context_kind` added as nullable with default `'execution'`; existing rows treated as execution context. Backfill in the same migration. |
| Profile rename (`full_name` → `first_name` + `last_name`) breaks queries | Add new fields; keep `full_name` as a generated column (`first_name || ' ' || last_name`) so old code keeps reading it. Deprecate reads over Phase 3–5. |
| RLS drift when SM tables move into the same DB | Every SM migration re-declares its policies using `auth_profile()`; audit each renumbered file before applying. |
| Company data grows across two modules; queries slow down | RLS is already company-scoped; add composite indexes on `(company_id, ...)` for hot paths as they surface in staging. |
| Two teams of admins get confused about coaching visibility | Shared coaching primitive means one mental model. UI copy on the coach entry points explicitly says who can see the conversation. |

## Status log

- 2026-07-18 — Doc drafted. Phase 0 (analysis + decisions) complete. Awaiting green-light on Phase 1.
- 2026-07-18 — Phase 1 partial: `company_features` table + `company_has_feature` helper + `getCompanyFeatures` service landed in AiMSHigher (migration 0016). Existing companies backfilled with `'execution'`. SM dep bump documented above for manual application in the SM repo. Migration renumbering deferred to Phase 4/5 when SM tables actually import.
- 2026-07-18 — Phase 2 partial: profile schema expansion landed (migration 0017 + `Profile` type update). Added `first_name`, `last_name`, `hire_date`, `position_start_date`, `reports_to`. Bidirectional `sync_profile_names` trigger keeps `full_name` and structured fields aligned regardless of which side writes, so every existing caller (profile edit form, invite accept, seed scripts, dashboard reads) keeps working untouched. Invite-flow + auth-surface unification wait for SM code to physically move in.
- 2026-07-18 — Phase 3 partial: NavBand feature-gating landed. Layout reads `getCompanyFeatures` for the effective company and passes to NavBand; NavBand tags each APP_LINKS entry with its module and filters by subscription before rendering. Placeholder comment marks the Strengths link slot for Phase 4. Behavior unchanged in production (every company has `'execution'` per Phase 1 backfill), but Phase 4 can drop in Strengths items and they'll gate correctly with zero further nav work. Full `/execution/*` URL restructure deferred — execution stays the default namespace; only Strengths gets a namespace prefix.
- 2026-07-18 — Phase 4 complete on the AiMSHigher side. Coaching primitive now supports both modules via a `context_kind` column (migration 0018, default `'execution'` so no existing row moves). `createConversationAction` takes an optional `contextKind` param (default execution) and every current entry point keeps working untouched. `/api/coach` picks one of three prompt files off a matrix, and `buildCoachContext` dispatches its person-context block on `context_kind` — execution keeps the rich commitments/priorities block, strengths returns a stub until Phase 5 imports the assessment tables. `prompts/strengths-self-coach.md` ported from SM's inline prompt + VOICE_RULES.
- 2026-07-18 — Phase 5a complete: SM schema imported. Nine tables landed under a `strengths_` prefix (migrations 0101 schema, 0102 RLS, 0103 items seed). RLS transliterated to `auth_profile()` and every table is feature-gated via `company_has_feature(company_id, 'strengths')` — a company without the subscription can't read or write any strengths row even if its role would otherwise allow it. 64-item question bank ported verbatim (sed rename of `public.items` → `public.strengths_items`). Coaching tables intentionally skipped — the unified primitive from migration 0012 + 0018 serves both modules.
- 2026-07-18 — Phase 5b complete: SM lib code ported into `src/lib/strengths/` — `types` (Profile / Role / InviteStatus stripped so they don't duplicate `src/lib/types.ts`), `scoring`, `team-scoring`, `team-signals`, `team-labels`, `tenure`, `voice-rules`. All internal imports stayed relative so nothing needed rewiring beyond a single `./types.ts` → `./types` extension fix. Typecheck clean. Anthropic client, email/resend, toast, and SM's supabase wrappers deliberately skipped — AiMSHigher has its own equivalents or doesn't need them yet.
- 2026-07-18 — Phases 5g + 5h done together as a small batch. NavBand now carries Assessment / Results / Teams links tagged `feature: 'strengths'` (auto-hidden until a company gets the entitlement). `buildCoachContext`'s strengths branch replaced its stub with real queries against `strengths_assessments` / `strengths_results` / `strengths_narrative_messages`, with a graceful "not yet completed" fallback.
- 2026-07-18 — Phase 5e + 5f: three SM API endpoints ported to `/api/strengths/*` (narrative, generate-results, generate-team-insights). `src/lib/strengths/anthropic.ts` mirrors SM's client singleton against the shared model env var. Anthropic SDK 0.32 → 0.111 broke SM's inline `type: "text"` predicate; switched to `Anthropic.TextBlock`. Coach entry point takes an optional `contextKind` so a `/coach/[profileId]?context=strengths` URL creates a strengths conversation via the unified `/api/coach`.
- 2026-07-18 — Phase 5c file-complete: `/strengths/{welcome,assessment,results}` ported. Three supporting components under `src/components/strengths/`. Uses the shared `(app)` layout for NavBand + auth.
- 2026-07-18 — Phase 5d file-complete: `/strengths/teams/{,[id],recommend}` ported. Three team components under `src/components/strengths/teams/` (2000+ LOC combined; mostly React logic, sed-substituted for imports and table names). Typecheck clean.
- 2026-07-18 — Phase 5 file-import complete. Every SM surface (assessment, results, team builder, API endpoints, coaching integration, nav) lives inside AiMSHigher. Nothing links to the strengths routes yet — the NavBand entries auto-light for any company with the `'strengths'` feature entitlement. Remaining work: visual polish against AiMSHigher's design tokens (SM's original CSS shipped as-is), shared-component hoist to `shared/components/ui`, and auth-surface consolidation (deferred from Phase 2). None of that blocks a real end-to-end smoke test of the merged platform.

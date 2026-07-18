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
- [ ] **Phase 3 — Shared nav + module switcher**
  - Extend `NavBand` to read `company_features` and render module tabs conditionally
  - Move route groups: `/execution/*` and `/strengths/*` under a shared `(app)` layout
- [ ] **Phase 4 — Coaching consolidation**
  - Add `context_kind` column to `coaching_conversations` (nullable, defaults to `'execution'` for existing rows)
  - Port SM's self-coaching + admin-coaching flows onto the same primitive
  - Prompt selection matrix: `context_kind × (subject == creator)` → one of four prompt files
- [ ] **Phase 5 — Module API + component merge**
  - `/api/coach` stays generic; assembles context by `context_kind` and picks the right prompt file
  - Strengths-only endpoints move to `/api/strengths/*` (`narrative`, `generate-results`, `generate-team-insights`)
  - Shared components (form primitives, cards, chips) hoist to `shared/components/ui`
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

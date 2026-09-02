-- =============================================================
-- Migration 0161: indexes for the hottest read paths.
--
-- Five indexes covering queries the app runs constantly and which
-- currently have no usable index. Identified by a performance audit
-- on 2026-09-02; each one is tied to a specific call site below.
--
-- On CONCURRENTLY: deliberately NOT used. `supabase db push` wraps
-- each migration file in a transaction, and CREATE INDEX CONCURRENTLY
-- cannot run inside one — it would abort the whole migration. A plain
-- CREATE INDEX takes a SHARE lock that blocks writes (not reads) for
-- the duration of the build. At current volume (thousands of
-- commitments across tens of companies) each build is milliseconds,
-- so the lock is not worth the operational complexity of running
-- these by hand outside the migration system. Revisit if any of these
-- tables reaches the millions of rows, at which point these should be
-- rebuilt concurrently out-of-band.
--
-- All five are IF NOT EXISTS so re-running is safe.
-- =============================================================

-- ---- 1. Notification bell ------------------------------------
-- src/lib/notifications/service.ts:~100 — runs on EVERY authenticated
-- page render (the (app) layout calls getHeaderNotifications), twice:
-- once for overdue, once for due-today. Filters owner_id + company_id
-- + status + due_date and orders by due_date.
--
-- due_date appeared in no index at all before this. The closest match
-- was commitments_owner_week_idx (owner_id, week_ending), which gets
-- the owner prefix and then heap-filters everything else.
--
-- The partial predicate mirrors the query exactly as of migration
-- 0161's companion code change, which added the missing deleted_at /
-- parked_at filters to both bell queries (they were counting
-- soft-deleted and parked commitments into the badge).
create index if not exists commitments_owner_open_due_idx
  on public.commitments (owner_id, company_id, due_date)
  where status = 'open'
    and deleted_at is null
    and parked_at is null;

-- ---- 2. Follow-through rate on Guide HQ ----------------------
-- src/lib/hq/service.ts:~202 and src/lib/hq/attention.ts:~140 — both
-- scan `.in("company_id", caseload).gte("completed_at", windowStart)`.
-- completed_at was unindexed, so this scanned every commitment for
-- every assigned company on each /hq render.
create index if not exists commitments_company_completed_idx
  on public.commitments (company_id, completed_at)
  where completed_at is not null
    and deleted_at is null;

-- ---- 3 + 4. Duplicate-awareness lookback ---------------------
-- find_similar_open_commitment / find_similar_open_issue (migration
-- 0144) filter company_id + status + a 14-day created_at window
-- before evaluating similarity(). created_at was unindexed on both
-- tables, so the window could not be applied by index and every open
-- row in the tenant reached the similarity call.
--
-- The meeting summary page (src/app/(app)/leadership/meetings/[id])
-- calls this once per extracted item in parallel, so a meeting with
-- 10 commitments and 5 issues fires 30 of these at once.
--
-- NOTE: these two indexes make the WINDOW cheap. They do not make
-- similarity() itself indexable — that needs a trigram index AND a
-- rewrite of the RPC predicate from `similarity(a,b) >= t` to the `%`
-- operator, since the GIN trigram opclass only answers `%`. Left for
-- later; the window is what collapses the candidate set at current
-- volume.
create index if not exists commitments_company_created_open_idx
  on public.commitments (company_id, created_at desc)
  where status = 'open'
    and deleted_at is null
    and parked_at is null;

create index if not exists issues_company_created_open_idx
  on public.issues (company_id, created_at desc)
  where status = 'open';

-- ---- 5. Coaching threads for a subject -----------------------
-- src/lib/coach/service.ts:~62 — filters mode + subject_profile_id and
-- orders by updated_at desc. The existing index
-- coaching_conversations_by_admin_idx is (created_by,
-- subject_profile_id, updated_at desc); this query does not filter
-- created_by, so that index's leading column is unusable and the
-- planner falls back to a scan plus sort.
--
-- The predicate covers mode only, NOT archived. The same call site
-- optionally includes archived rows (includeArchived), and a partial
-- index on archived = false would not serve that path; as a plain
-- column filter it stays cheap either way.
create index if not exists coaching_conversations_subject_idx
  on public.coaching_conversations (subject_profile_id, updated_at desc)
  where mode = 'about';

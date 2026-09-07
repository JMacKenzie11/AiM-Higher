-- =============================================================
-- Migration 0171: the Phase 4 probe table (EXPAND step)
--
-- WHY THIS EXISTS. This table carries no product meaning. It exists
-- to prove, on real infrastructure, that a migration authored here
-- reaches every registered instance through the runner and nothing
-- else — no hand-applied SQL, no per-instance step, no dashboard.
--
-- It is deliberately the most trivial change that is still
-- observable: a table with one row. Trivial because the point of the
-- exercise is the DELIVERY MECHANISM, not the change. A probe that
-- was interesting in its own right would confuse "the migration
-- reached every instance" with "the migration did the right thing".
--
-- EXPAND-SAFE BY CONSTRUCTION. It adds an object that no running
-- code reads or writes. Deploy order therefore cannot matter: an old
-- deployment is unaffected because it never touches this table, and
-- a new one is unaffected for the same reason. That is what makes it
-- safe to apply to production during business hours, which a probe
-- has to be or it is not a probe worth running.
--
-- ITS OTHER HALF. Migration 0172 drops it. The pair is the point:
-- expand and contract as one demonstrated cycle rather than an
-- addition that quietly becomes permanent. If you are reading this
-- and 0172 does not exist, the exercise was abandoned half way and
-- this table is litter — drop it.
--
-- See docs/deployment.md, "How we know multi-instance operations
-- work", for the run this belongs to and what it proved.
-- =============================================================

create table if not exists public.phase4_probe (
  id uuid primary key default gen_random_uuid(),
  note text not null,
  created_at timestamptz not null default now()
);

-- The row is the observable. Verifying the migration landed means
-- reading this back on each instance, which is a cheaper check than
-- inspecting the schema.
--
-- Idempotent: the runner is expected to be safe to re-run, and a
-- second application must not produce a second row.
insert into public.phase4_probe (note)
select 'phase 4 multi-instance delivery probe'
where not exists (select 1 from public.phase4_probe);

-- No RLS policy is written on purpose. Migration 0170's event trigger
-- enables row level security on this table automatically, and with no
-- policy attached it is readable by service_role and nobody else.
-- That is correct for a table holding nothing: it also means this
-- probe doubles as a live check that 0170's trigger fires on every
-- instance, since a missing trigger would leave RLS off here.

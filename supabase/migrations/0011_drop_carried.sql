-- =============================================================
-- Phase 5 — Migration 0011: drop the "carried" status.
--   Simplification: commitments are Open, Kept, or Missed. Carry
--   Forward introduced a whole second row per rollover; we're
--   removing that ceremony. A commitment closed after its due date
--   is Missed — treated in the UI as "Closed" (late) — and it's an
--   opportunity to improve.
--
--   Existing 'carried' rows convert to 'missed' with the original
--   missed_reason if any, or a boilerplate one so the
--   missed_needs_reason CHECK is satisfied. The carried_from_id
--   column stays for historical linkage of any successor rows that
--   were spawned by the old carry-forward flow.
-- =============================================================

update public.commitments
set status = 'missed',
    missed_reason = coalesce(missed_reason, 'Carried forward from prior week')
where status = 'carried';

alter table public.commitments
drop constraint commitments_status_check;

alter table public.commitments
add constraint commitments_status_check
check (status in ('open', 'kept', 'missed'));

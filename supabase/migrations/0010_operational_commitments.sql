-- =============================================================
-- Phase 5 — Migration 0010: operational commitments.
--   Commitments may now exist without a parent priority.
--   priority_id NOT NULL is dropped and the FK's ON DELETE
--   changes to SET NULL so deleting a priority quietly turns
--   its commitments operational rather than blocking the delete
--   (previous ON DELETE RESTRICT) or destroying history.
--
--   The strategic-vs-operational distinction is derived from the
--   presence of priority_id and never stored. Only strategic
--   commitments feed priority progress; operational commitments
--   count toward keep rate identically but never toward plan %.
--
--   RLS policies key off owner_id / company_id and are unaffected
--   by this change; no policy edits are needed.
-- =============================================================

alter table public.commitments
  alter column priority_id drop not null;

alter table public.commitments
  drop constraint commitments_priority_id_fkey;

alter table public.commitments
  add constraint commitments_priority_id_fkey
  foreign key (priority_id)
  references public.priorities(id)
  on delete set null;

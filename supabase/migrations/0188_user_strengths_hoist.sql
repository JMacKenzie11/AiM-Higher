-- =============================================================
-- Migration 0188: user_strengths, the table F8 batch 6c deferred.
--
-- Four policies. The last table in the schema still calling
-- auth_profile() once per row.
--
-- WHY 6c DEFERRED IT, AND WHY THAT REASONING WAS WRONG.
--
-- The helper sits inside a CORRELATED exists — correlated on
-- user_strengths.user_id — where a scalar subquery is re-evaluated
-- per row whatever it is wrapped in. 6c tried the naive hoist, saw
-- auth_profile still at loops=4 on the clone's four-row table, tried
-- a restructure, measured loops=13, called it worse and stopped.
--
-- Four rows. docs/f8-rls-hoist.md already said, in the sentence about
-- every batch's EXPLAIN section, that the clone's small tables are
-- SHAPE evidence and the 5000-row measurement is the MAGNITUDE
-- evidence. The rule was written down and not applied. At 5000 rows:
--
--   A  today, helper inside the correlated exists
--        member  loops=5000  92.6 ms     system_admin  loops=5000  94.0 ms
--   B  the naive hoist
--        member  loops=1015  26.2 ms     system_admin  loops=5000  93.9 ms
--   C  6c's restructure, the one called worse
--        member  loops=64     4.3 ms     system_admin  loops=64     3.7 ms
--   D  this migration
--        member  loops=13     2.8 ms     system_admin  not in plan  1.2 ms
--
-- C was 23x faster than the status quo, not worse. D is faster again
-- and simpler to read.
--
-- THE SHAPE. Put the caller-only branches FIRST, where they are
-- evaluated once, and leave only the company comparison correlated:
--
--   system_admin?                      -> once
--   is this row mine?                  -> once, compared per row
--   otherwise, does the SUBJECT belong to my company?  -> a lookup
--
-- A system_admin never reaches the third branch, which is why
-- auth_profile leaves their plan entirely.
--
-- WHAT MAKES DROPPING THE JOIN SAFE. The original's exists() joins
-- profiles and therefore requires the SUBJECT to have a profile row
-- before anyone, system_admin included, may see their strengths.
-- That is guaranteed by the schema, not by the policy:
--
--   user_strengths_user_id_fkey
--     FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
--
-- A user_strengths row whose subject has no profile cannot exist, and
-- the FK deletes the strengths when the profile goes. Checked on
-- production before this was written: 4 rows, 0 orphans. So the
-- existence half of the original exists() is dead weight, and the
-- correctness of this rewrite now rests on that constraint — stated
-- here because a future migration dropping the FK would silently
-- widen these four policies.
--
-- SELECT admits any member of the subject's company. INSERT, UPDATE
-- and DELETE admit only that company's ADMIN. That difference is in
-- the original and is preserved.
-- =============================================================

-- ---- select: any colleague in the subject's company -----------

drop policy if exists user_strengths_select on public.user_strengths;
create policy user_strengths_select on public.user_strengths
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (select auth.uid()) = public.user_strengths.user_id
  or (
    (select public.auth_company_id()) is not null
    and exists (
      select 1 from public.profiles p
      where p.id = public.user_strengths.user_id
        and p.company_id = (select public.auth_company_id())
    )
  )
);

-- ---- insert / update / delete: the subject's company ADMIN -----

drop policy if exists user_strengths_insert on public.user_strengths;
create policy user_strengths_insert on public.user_strengths
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (select auth.uid()) = public.user_strengths.user_id
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and exists (
      select 1 from public.profiles p
      where p.id = public.user_strengths.user_id
        and p.company_id = (select public.auth_company_id())
    )
  )
);

drop policy if exists user_strengths_update on public.user_strengths;
create policy user_strengths_update on public.user_strengths
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (select auth.uid()) = public.user_strengths.user_id
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and exists (
      select 1 from public.profiles p
      where p.id = public.user_strengths.user_id
        and p.company_id = (select public.auth_company_id())
    )
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (select auth.uid()) = public.user_strengths.user_id
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and exists (
      select 1 from public.profiles p
      where p.id = public.user_strengths.user_id
        and p.company_id = (select public.auth_company_id())
    )
  )
);

drop policy if exists user_strengths_delete on public.user_strengths;
create policy user_strengths_delete on public.user_strengths
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (select auth.uid()) = public.user_strengths.user_id
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) is not null
    and exists (
      select 1 from public.profiles p
      where p.id = public.user_strengths.user_id
        and p.company_id = (select public.auth_company_id())
    )
  )
);

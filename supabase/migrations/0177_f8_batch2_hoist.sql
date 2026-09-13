-- =============================================================
-- Migration 0177: F8 batch 2 — commitments, commitment_occurrences.
--
-- Same rewrite as 0175, on the next table group in the order set by
-- docs/f8-rls-hoist.md. Every predicate here is the current one
-- transcribed from pg_policies with:
--
--   ap.role        ->  (select public.auth_role())
--   ap.company_id  ->  (select public.auth_company_id())
--   auth.uid()     ->  (select auth.uid())
--
-- Form D throughout: the helper is always inside a scalar subquery,
-- never a bare call. 0175's measurement is why — a bare
-- security-definer wrapper containing `limit` is not inlinable and ran
-- 374x slower than the status quo, and nothing in the policy text
-- would tell you.
--
-- WHO IS ADMITTED DOES NOT MOVE. The `is not null` guards stay exactly
-- where they are today even though `=` already denies on NULL. The
-- `_guide` mirrors are untouched: is_guide_for(company_id) takes a
-- per-row argument and cannot be hoisted.
--
-- NEW IN THIS BATCH: auth.uid(). Batch 1's three tables had no
-- owner-scoped policies. These two are the first with them, and
-- `auth.uid()` is the same failure mode as auth_profile() — a stable
-- function called once per row when it could be evaluated once per
-- statement. Left alone, the after-plans for the owner policies would
-- still carry a per-row call and this batch's claim that every judged
-- plan hoisted would be true only of the policies we chose to look at.
--
-- commitment_occurrences keeps its EXISTS over commitments: that one
-- is a join to the parent row, not a helper call, and it is what
-- carries company scope to a table that has no company_id of its own.
-- What comes out of the loop is auth_profile.
-- =============================================================

-- ---- commitments --------------------------------------------

drop policy if exists commitments_select on public.commitments;
create policy commitments_select on public.commitments
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and (select public.auth_company_id()) = public.commitments.company_id
  )
);

drop policy if exists commitments_select_owner on public.commitments;
create policy commitments_select_owner on public.commitments
for select to authenticated
using (public.commitments.owner_id = (select auth.uid()));

drop policy if exists commitments_insert_admin on public.commitments;
create policy commitments_insert_admin on public.commitments
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.commitments.company_id
  )
);

drop policy if exists commitments_insert_owner on public.commitments;
create policy commitments_insert_owner on public.commitments
for insert to authenticated
with check (
  public.commitments.owner_id = (select auth.uid())
  and (select public.auth_company_id()) = public.commitments.company_id
);

drop policy if exists commitments_update_admin on public.commitments;
create policy commitments_update_admin on public.commitments
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.commitments.company_id
  )
)
with check (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.commitments.company_id
  )
);

drop policy if exists commitments_update_owner on public.commitments;
create policy commitments_update_owner on public.commitments
for update to authenticated
using (
  public.commitments.owner_id = (select auth.uid())
  and (select public.auth_company_id()) = public.commitments.company_id
)
with check (public.commitments.owner_id = (select auth.uid()));

-- Claiming an unassigned commitment: the row must have no owner, the
-- caller must be in its company, and the new row must be owned by the
-- caller. All three halves preserved.
drop policy if exists commitments_claim_unassigned on public.commitments;
create policy commitments_claim_unassigned on public.commitments
for update to authenticated
using (
  public.commitments.owner_id is null
  and (select public.auth_company_id()) = public.commitments.company_id
)
with check (public.commitments.owner_id = (select auth.uid()));

drop policy if exists commitments_delete_admin on public.commitments;
create policy commitments_delete_admin on public.commitments
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_role()) = 'company_admin'
    and (select public.auth_company_id()) = public.commitments.company_id
  )
);

-- Non-admin owners may only delete their own OPEN commitments. That
-- is failure mode 7 in docs/failure-modes.md, and the status clause is
-- the whole of it.
drop policy if exists commitments_delete_owner on public.commitments;
create policy commitments_delete_owner on public.commitments
for delete to authenticated
using (
  public.commitments.owner_id = (select auth.uid())
  and public.commitments.status = 'open'
);

-- ---- commitment_occurrences ---------------------------------

drop policy if exists commitment_occurrences_select on public.commitment_occurrences;
create policy commitment_occurrences_select on public.commitment_occurrences
for select to authenticated
using (
  exists (
    select 1
    from public.commitments c
    where c.id = public.commitment_occurrences.commitment_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_company_id()) is not null
          and (select public.auth_company_id()) = c.company_id
        )
        or public.is_guide_for(c.company_id)
      )
  )
);

drop policy if exists commitment_occurrences_write_admin on public.commitment_occurrences;
create policy commitment_occurrences_write_admin on public.commitment_occurrences
for all to authenticated
using (
  exists (
    select 1
    from public.commitments c
    where c.id = public.commitment_occurrences.commitment_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = c.company_id
        )
        or public.is_guide_for(c.company_id)
      )
  )
)
with check (
  exists (
    select 1
    from public.commitments c
    where c.id = public.commitment_occurrences.commitment_id
      and (
        (select public.auth_role()) = 'system_admin'
        or (
          (select public.auth_role()) = 'company_admin'
          and (select public.auth_company_id()) = c.company_id
        )
        or public.is_guide_for(c.company_id)
      )
  )
);

drop policy if exists commitment_occurrences_write_owner on public.commitment_occurrences;
create policy commitment_occurrences_write_owner on public.commitment_occurrences
for all to authenticated
using (
  exists (
    select 1
    from public.commitments c
    where c.id = public.commitment_occurrences.commitment_id
      and c.owner_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.commitments c
    where c.id = public.commitment_occurrences.commitment_id
      and c.owner_id = (select auth.uid())
  )
);

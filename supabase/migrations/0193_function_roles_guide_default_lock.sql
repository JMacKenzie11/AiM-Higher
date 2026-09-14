-- =============================================================
-- Migration 0193: guides lose the exemption nobody granted them.
--
-- THE FINDING. `function_roles` holds one baseline row per function,
-- flagged `is_default = true`, carrying "Lead, Track, Decide". It is
-- meant to be immutable — 0107 says so in its header, in as many
-- words: "RLS blocks update/delete when is_default=true".
--
-- For system_admin and company_admin it does. `function_roles_update`
-- and `function_roles_delete` both open with `is_default = false`.
--
-- For an aims_guide it does not. The guide mirrors added in 0111
-- copied the tenant predicate — `is_guide_for(f.company_id)` — and
-- dropped the `is_default` clause along the way. So a guide can edit
-- and delete the baseline row that a SYSTEM ADMIN cannot touch, which
-- is not a permission anybody designed. It inverts the hierarchy the
-- rest of the table follows.
--
-- HOW IT WAS FOUND, and why it sat there. The harness's write-probe
-- rule says a refusal is only proven by trying it as every role: two
-- zeros are not evidence that a third caller would also get zero. The
-- `is_default` guard looked like a rule that admits nobody until an
-- aims_guide was actually probed, and that is exactly the shape the
-- rule exists for. Nothing in the app exercises the hole:
-- updateFunctionRoleAction, renameFunctionRoleAction and
-- deleteFunctionRoleAction all carry `.eq("is_default", false)`
-- themselves, so the only way to reach it is a crafted request.
--
-- THE FIX. Add the clause the mirrors dropped. After this, all four
-- write policies on this table say the same thing about the baseline
-- row, and the sentence in 0107's header is true again.
--
-- NOT TOUCHED, and named so the omission is visible rather than
-- silent: INSERT. Neither the guide policy nor the admin one
-- restricts `is_default` on insert, so any admitted caller could in
-- principle create a baseline row for a function that has none. The
-- partial unique index `function_roles_default_per_function` already
-- stops a SECOND one per function, the app never sets the column on
-- insert (it defaults to false), and closing it properly is a
-- different question — whether a baseline should be creatable at all
-- outside the seeding path in 0107 — that deserves its own decision
-- rather than being settled inside a fix for something else.
--
-- Form D throughout: the policies below are rewritten whole, and
-- `is_guide_for` keeps its per-row argument, which is why it is not
-- hoisted (docs/f8-rls-hoist.md).
-- =============================================================

drop policy if exists function_roles_update_guide on public.function_roles;
create policy function_roles_update_guide on public.function_roles
for update to authenticated
using (
  is_default = false
  and exists (
    select 1 from public.functions f
     where f.id = public.function_roles.function_id
       and public.is_guide_for(f.company_id)
  )
)
with check (
  is_default = false
  and exists (
    select 1 from public.functions f
     where f.id = public.function_roles.function_id
       and public.is_guide_for(f.company_id)
  )
);

-- WITH CHECK as well as USING, and they are not redundant. USING
-- decides which rows the guide may touch; WITH CHECK decides what the
-- row may look like afterwards. Without the second, a guide could
-- take a non-default row they are allowed to edit and FLIP it to
-- is_default = true — manufacturing a baseline, or colliding with the
-- partial unique index. The admin policy has carried both since 0107
-- for the same reason.

drop policy if exists function_roles_delete_guide on public.function_roles;
create policy function_roles_delete_guide on public.function_roles
for delete to authenticated
using (
  is_default = false
  and exists (
    select 1 from public.functions f
     where f.id = public.function_roles.function_id
       and public.is_guide_for(f.company_id)
  )
);

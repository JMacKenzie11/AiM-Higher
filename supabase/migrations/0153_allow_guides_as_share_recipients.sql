-- =============================================================
-- Migration 0153: let a coaching-share recipient be an aims_guide
-- assigned to the conversation's company.
--
-- The same-company invariant from 0150 assumed the sharee had a
-- non-null profiles.company_id, which excluded guides (guides
-- have no primary company; their access is derived from
-- guide_assignments rows). Per the platform rule "aims_guide =
-- company_admin on assigned companies," a guide assigned to the
-- conversation's company should be a valid sharee — otherwise
-- the coaching layer treats them as second-class here even
-- though every other cross-tenant policy already admits them.
--
-- What changes:
--   1. Add a small helper `profile_is_in_company(profile_id, cid)`
--      that returns TRUE when profile.company_id = cid OR the
--      profile is an aims_guide with a matching guide_assignments
--      row. SECURITY DEFINER — bypasses profiles/guide_assignments
--      RLS so it can be called from any policy or trigger.
--   2. Rewrite the assert_coaching_share_same_company trigger to
--      call the helper instead of comparing company_ids directly.
--   3. Rewrite the coaching_conversation_shares_insert RLS policy
--      to use the same helper for its sharee check.
--
-- Everything else (SELECT/UPDATE/DELETE on shares, the extended
-- conversations SELECT policy, the messages policies) stays
-- exactly as it was after 0151 — this only touches WHO CAN BE
-- MADE a sharee, not who can read/write once a share exists.
-- =============================================================

-- ---- Helper -------------------------------------------------
create or replace function public.profile_is_in_company(
  candidate_profile_id uuid,
  target_company_id uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = candidate_profile_id
      and (
        p.company_id = target_company_id
        or (
          p.role = 'aims_guide'
          and exists (
            select 1
            from public.guide_assignments ga
            where ga.guide_id = p.id
              and ga.company_id = target_company_id
          )
        )
      )
  );
$$;

revoke all on function public.profile_is_in_company(uuid, uuid) from public;
grant execute on function public.profile_is_in_company(uuid, uuid)
  to authenticated, anon;

-- ---- Rewrite the trigger ------------------------------------
-- Keeps the same raise messages so any monitoring keyed on
-- them still works.
create or replace function public.assert_coaching_share_same_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  convo_company uuid;
begin
  select company_id into convo_company
    from public.coaching_conversations
   where id = new.conversation_id;

  if convo_company is null then
    raise exception 'coaching_share_invalid_conversation: % not found', new.conversation_id;
  end if;

  if not public.profile_is_in_company(new.profile_id, convo_company) then
    raise exception 'coaching_share_cross_tenant: profile % is not a member or assigned guide of company %',
      new.profile_id, convo_company;
  end if;

  return new;
end;
$$;

-- ---- Rewrite the shares INSERT policy -----------------------
-- Owner check is unchanged. The sharee-in-same-company branch
-- now goes through the helper so guides match.
drop policy if exists coaching_conversation_shares_insert on public.coaching_conversation_shares;

create policy coaching_conversation_shares_insert
on public.coaching_conversation_shares
for insert to authenticated
with check (
  created_by = auth.uid()
  and public.is_coaching_conversation_owner(
        coaching_conversation_shares.conversation_id,
        auth.uid()
      )
  and exists (
    select 1
    from public.coaching_conversations cc
    where cc.id = coaching_conversation_shares.conversation_id
      and public.profile_is_in_company(
            coaching_conversation_shares.profile_id,
            cc.company_id
          )
  )
);

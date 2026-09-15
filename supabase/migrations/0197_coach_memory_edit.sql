-- Coach memory: editing a memory in place.
--
-- SUPERSEDES the append-only decision recorded in 0194, which said of
-- UPDATE: "no policy. Deliberately absent. Do not add one." That was
-- the right default and it is being reversed deliberately, by the
-- product owner, because a person who can see a line written about
-- them should be able to correct it rather than only destroy it.
--
-- ---- THE SHAPE, AND WHY IT IS NOT A GRANT ----------------------
--
-- `authenticated` does NOT get the UPDATE privilege. It gets an
-- UPDATE POLICY, and the only thing able to exercise it is the
-- definer function below, which runs as the table owner.
--
-- That distinction is failure mode E8 read forwards. E8 was a policy
-- hole hiding a privilege hole: no UPDATE policy existed, so nobody
-- checked the privilege, and Supabase had already granted it. The
-- answer then was to revoke the privilege and keep asserting its
-- absence. Granting it now to enable editing would undo exactly that,
-- and the harness check asserting `authenticated` holds no UPDATE
-- would have to be weakened.
--
-- So: the privilege stays revoked, the harness check stays as it is,
-- and editing goes through a function with no profile_id parameter,
-- the same way writing does. A caller cannot spell an edit of
-- somebody else's memory, and a direct UPDATE from the app still
-- fails at the privilege level with 42501.
--
-- The policy is still required, because the table is FORCE ROW LEVEL
-- SECURITY: the owner is subject to policies too, so a definer
-- function with no UPDATE policy to satisfy would be refused along
-- with everybody else. This is the same arrangement INSERT already
-- has.

alter table public.coach_memories
  add column if not exists edited_at timestamptz;

comment on column public.coach_memories.edited_at is
  'When the person last rewrote this line. Null means it is as first '
  'written. The record stays honest about what was remembered AND '
  'about what was changed afterwards.';

-- Scoped to the owner's own rows on both sides. WITH CHECK matters as
-- much as USING here: without it a row could be updated out of the
-- caller's own profile and into somebody else's.
create policy coach_memories_update on public.coach_memories
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- The edit path. No profile_id parameter, for the same reason
-- record_coach_memory has none.
--
-- The kind becomes 'directed', and that is not a convenience. Once
-- somebody rewrites the words, the words are theirs; leaving "Aimee
-- inferred" on a line the person authored is precisely the
-- mislabelling the said/inferred split exists to prevent. The
-- original created_at is kept, so the record still says when the
-- thought first appeared, and edited_at says when it was rewritten.
create or replace function public.update_coach_memory(
  p_id uuid,
  p_content text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'update_coach_memory requires an authenticated caller';
  end if;

  update public.coach_memories
     set content = p_content,
         kind = 'directed',
         edited_at = now()
   where id = p_id
     and profile_id = v_uid
  returning id into v_id;

  if v_id is null then
    raise exception 'update_coach_memory: no such memory for this caller';
  end if;

  return v_id;
end;
$$;

revoke all on function public.update_coach_memory(uuid, text) from public;
revoke all on function public.update_coach_memory(uuid, text) from anon;
revoke all on function public.update_coach_memory(uuid, text) from service_role;
grant execute on function public.update_coach_memory(uuid, text) to authenticated;

-- Deliberately NOT granted, and asserted absent by the permanent
-- coach_memories access wall check in scripts/rls-harness.ts:
--   grant update on public.coach_memories to authenticated;

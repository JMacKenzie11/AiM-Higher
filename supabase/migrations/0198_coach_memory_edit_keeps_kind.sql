-- Editing a memory KEEPS its kind.
--
-- 0197 relabelled an edited row to 'directed', on the reasoning that
-- once somebody rewrites the words the words are theirs. The product
-- owner decided otherwise: an edit is a correction, not a change of
-- authorship, and a person fixing a detail in something Aimee noted
-- did not thereby author it.
--
-- Corrected FORWARD rather than by amending 0197, which is already
-- applied to the dev clone. `supabase db push` records a migration by
-- name and will not re-run an edited file, so rewriting 0197 would
-- leave dev running the old function while the repo described the new
-- one: a database whose state no file describes. Failure mode E2.
--
-- What honesty the kind used to carry, `edited_at` now carries: the
-- label says where the line came from, and the surface says it has
-- been rewritten since.
--
-- Everything else about 0197 stands and is not restated loosely here:
-- no UPDATE privilege for `authenticated`, an UPDATE policy only
-- because FORCE ROW LEVEL SECURITY subjects the definer's owner to
-- policies, and no profile_id parameter.
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

-- Re-asserted: create or replace does not preserve a revoke, and this
-- function's safety story is that only `authenticated` may call it.
revoke all on function public.update_coach_memory(uuid, text) from public;
revoke all on function public.update_coach_memory(uuid, text) from anon;
revoke all on function public.update_coach_memory(uuid, text) from service_role;
grant execute on function public.update_coach_memory(uuid, text) to authenticated;

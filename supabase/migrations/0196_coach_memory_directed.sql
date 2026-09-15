-- Coach memory: the 'directed' kind.
--
-- A third kind, for memories the person ASKED to be kept, rather than
-- ones distilled from what they said ('said') or concluded by the
-- coach ('inferred'). Two entry points write it: an input on the
-- memory card, and an in-conversation request the coach recognises.
--
-- Why a kind and not a boolean: the three are mutually exclusive by
-- provenance, which is the question every one of them answers. A
-- `directed` row is not a `said` row with a flag on it, because
-- nobody said it in a conversation; it is a person handing the record
-- a line and asking for it back later. The surface renders each
-- differently and the coach voices each differently, and a boolean
-- beside a kind would let a row be both.
--
-- TWO PLACES, not one. The column's check constraint is the
-- structural guard; record_coach_memory ALSO validates the kind in
-- its own body, and a migration that changed only the constraint
-- would leave the function raising on the new value with a message
-- saying the kind must be said or inferred. Failure mode E8 in
-- reverse: the privilege was not the thing that bit, the second
-- redundant guard was.

alter table public.coach_memories
  drop constraint if exists coach_memories_kind_check;

alter table public.coach_memories
  add constraint coach_memories_kind_check
  check (kind in ('said', 'inferred', 'directed'));

comment on column public.coach_memories.kind is
  'said = the person stated it. inferred = the coach concluded it. '
  'directed = the person asked for it to be kept. Provenance, not '
  'confidence: the three answer "who put this here".';

-- Unchanged except for the kind guard. Restated in full rather than
-- patched, because a definer function is the write path and reading
-- it in one piece is how the no-profile_id-parameter property stays
-- checkable at a glance.
create or replace function public.record_coach_memory(
  p_kind text,
  p_content text,
  p_conversation_ref uuid default null
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
    raise exception 'record_coach_memory requires an authenticated caller';
  end if;
  if p_kind not in ('said', 'inferred', 'directed') then
    raise exception 'record_coach_memory: kind must be said, inferred or directed';
  end if;

  insert into public.coach_memories (profile_id, conversation_ref, kind, content)
  values (v_uid, p_conversation_ref, p_kind, p_content)
  returning id into v_id;

  return v_id;
end;
$$;

-- The grants are re-asserted because create or replace does not
-- preserve a revoke, and this function's whole safety story is that
-- service_role and anon cannot call it. E8 was a missed revoke; this
-- is the same class of mistake one line later.
revoke all on function public.record_coach_memory(text, text, uuid) from public;
revoke all on function public.record_coach_memory(text, text, uuid) from anon;
revoke all on function public.record_coach_memory(text, text, uuid) from service_role;
grant execute on function public.record_coach_memory(text, text, uuid) to authenticated;

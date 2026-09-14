-- =============================================================
-- Migration 0194: coach_memories — storage and its access wall
--
-- The most sensitive table on the platform. What a person tells a
-- coach about their work, their manager, their doubts and their
-- intentions accumulates here, and the product's promise about it is
-- unusually strong. This migration is the wall that makes the promise
-- true rather than aspirational.
--
-- ---- DECISIONS, SETTLED IN THE WORKING SESSION ----------------
--
-- VISIBILITY IS PERSON-ONLY. The subject reads their own memory and
-- nobody else does. Not their aims_guide. Not their company_admin.
-- Not a portfolio_admin. NOT SYSTEM_ADMIN. This is the rare table
-- where the platform's highest role is refused, deliberately, and the
-- SELECT policy below has no role branch of any kind so there is
-- nowhere for one to be quietly added.
--
-- The promise also binds AiMS staff as an organizational commitment:
-- support and debugging work on METADATA (see coach_memory_metadata
-- below) or with the person's explicit consent, never by reading
-- content. Policy cannot bind a human with a database password; what
-- it can do is ensure no product surface, no role, and no service-
-- role code path is capable of it, so that reading memory requires a
-- person to deliberately step outside the system rather than click
-- something. That is what is built here.
--
-- NO company_id COLUMN, and this is load-bearing rather than an
-- omission. Memory belongs to a PERSON, not to a tenant. A company_id
-- would be the hook every future company-scoped read path hangs
-- itself on — "the admin can already see their company's rows" is an
-- argument that cannot even be formed against a table that does not
-- know what company anyone is in. A person who changes companies
-- keeps their memory, and a company that leaves keeps none of it.
--
-- APPEND-ONLY IN SPIRIT. No UPDATE policy exists for anyone, and
-- UPDATE is never granted, so an update is refused at the privilege
-- level (an error) rather than silently affecting zero rows. Deletion
-- is the subject's right and is a hard DELETE, landing in part 3.
--
-- ---- THE INSERT MECHANISM, AND WHY -----------------------------
--
-- Writes go through public.record_coach_memory(), a SECURITY DEFINER
-- function. The alternative considered and REJECTED was service-role
-- writes confined to one module with a static source check.
--
-- Rejected because of failure mode E5: app guards are courtesy, the
-- database is the boundary. A static check over application source is
-- an app guard wearing a test's clothing — it proves what today's
-- code says, not what the database will accept tomorrow, and the
-- first caller to import the wrong client is a leak the check finds
-- only if it is still looking in the right place.
--
-- The definer function makes the rule a database fact: profile_id is
-- forced to auth.uid() inside the function and is not a parameter, so
-- "you can only ever accumulate memory about yourself" is true of
-- every caller including one that has not been written yet. This is
-- available because the coach write path already runs as the caller
-- inside a request (createSupabaseServerClient in
-- src/app/api/coach/route.ts); there is no background summarization
-- path needing to write without a session, and if part 2 wants one it
-- has to come back here and say so in a migration.
--
-- ---- THE service_role HOLE, CLOSED ----------------------------
--
-- Every other table in this schema is protected by RLS alone, and
-- 0004's own comment records why that is enough there: "service_role
-- bypasses RLS via GRANT anyway". On this table it is not enough,
-- because "system_admin cannot read it" means nothing if any code
-- holding the service key can.
--
-- BYPASSRLS bypasses POLICIES. It does not bypass GRANTs. So all
-- privileges are revoked from service_role and anon below, and the
-- table is reachable only by `authenticated` through policies, plus
-- the two definer functions. A service-role client selecting from
-- this table gets "permission denied", not rows. Probed, not assumed.
-- =============================================================

create table if not exists public.coach_memories (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Which conversation produced it. Nulled rather than cascaded on
  -- conversation delete: the memory is the person's and outlives the
  -- thread it came from.
  conversation_ref uuid references public.coaching_conversations(id)
    on delete set null,
  kind text not null check (kind in ('said', 'inferred')),
  content text not null check (length(btrim(content)) > 0)
);

comment on table public.coach_memories is
  'What the coach remembers about a person. PERSON-ONLY VISIBILITY: the subject reads their own rows and no role can read anybody else''s, system_admin included. Deliberately carries NO company_id — memory belongs to a person, not a tenant, and a company_id would be the hook a company-scoped read path hangs itself on later. Privileges are revoked from service_role so BYPASSRLS cannot reach it.';

comment on column public.coach_memories.profile_id is
  'The subject. The only identity that can read or delete the row.';

comment on column public.coach_memories.kind is
  '''said'' = the person stated it. ''inferred'' = the coach concluded it. Kept distinct because an inference presented back as a quote is how a coaching record becomes something a person does not recognise as their own.';

create index if not exists coach_memories_profile_created_idx
  on public.coach_memories (profile_id, created_at desc);

alter table public.coach_memories enable row level security;
-- FORCE so the table owner is subject to policies too. On this table
-- that is not merely defensive: the definer function below runs as
-- the owner, and FORCE is what keeps it inside the same rule as
-- everybody else rather than above it.
alter table public.coach_memories force row level security;

-- ---- Privileges ------------------------------------------------
-- Explicit, never GRANT ALL. UPDATE is absent by construction.
revoke all on public.coach_memories from public;
revoke all on public.coach_memories from anon;
revoke all on public.coach_memories from service_role;
-- FROM authenticated TOO, and this line is the one that matters.
--
-- Supabase ships `alter default privileges in schema public grant all
-- on tables to anon, authenticated, service_role`, so a newly created
-- table arrives with ALL already granted to all three. Granting the
-- two verbs this table wants therefore ADDS NOTHING — the role
-- already had them, along with UPDATE and INSERT.
--
-- The harness caught it: the "no caller can UPDATE" probe expected a
-- 42501 privilege refusal and got 0 rows, because RLS filtered the
-- rows while the privilege was sitting right there. A policy-shaped
-- absence looked exactly like a privilege-shaped one, which is the
-- whole reason that probe demands a statement-level refusal.
revoke all on public.coach_memories from authenticated;
grant select, delete on public.coach_memories to authenticated;
-- NOTE: no `insert` grant to authenticated. Inserts arrive only
-- through record_coach_memory(), which runs as the owner.

-- ---- SELECT: the subject, full stop ----------------------------
-- No role branch. No admin branch. No guide branch. Nothing to read
-- except your own id, and no seam where an exception could be added
-- without rewriting the policy outright and explaining why.
create policy coach_memories_select on public.coach_memories
  for select to authenticated
  using (profile_id = (select auth.uid()));

-- ---- INSERT: only for yourself, only via the function -----------
-- The grant above withholds INSERT from authenticated, so this policy
-- governs the definer function's own write. Both walls say the same
-- thing, which is the point: the privilege stops the direct path and
-- the policy stops the function from being talked into writing a row
-- for somebody else.
create policy coach_memories_insert on public.coach_memories
  for insert to authenticated
  with check (profile_id = (select auth.uid()));

-- ---- UPDATE: no policy. Deliberately absent. -------------------
-- Do not add one. Memory is append-only; a correction is a delete and
-- a new row, which leaves the person's record honest about what was
-- remembered and when.

-- ---- DELETE: the subject's right -------------------------------
create policy coach_memories_delete on public.coach_memories
  for delete to authenticated
  using (profile_id = (select auth.uid()));

-- ---- The write path --------------------------------------------
-- profile_id is NOT a parameter. That is the whole design: there is
-- no argument a caller can pass to write into somebody else's memory,
-- so the rule holds for callers that do not exist yet.
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
  if p_kind not in ('said', 'inferred') then
    raise exception 'record_coach_memory: kind must be said or inferred';
  end if;

  insert into public.coach_memories (profile_id, conversation_ref, kind, content)
  values (v_uid, p_conversation_ref, p_kind, p_content)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_coach_memory(text, text, uuid) from public;
revoke all on function public.record_coach_memory(text, text, uuid) from anon;
revoke all on function public.record_coach_memory(text, text, uuid) from service_role;
grant execute on function public.record_coach_memory(text, text, uuid) to authenticated;

comment on function public.record_coach_memory(text, text, uuid) is
  'The only write path into coach_memories. Forces profile_id to auth.uid(): there is no parameter for whose memory to write, so no caller can write into anybody else''s. Chosen over service-role writes confined by a source check, because E5 says the boundary belongs in the database.';

-- ---- Support surface: metadata, zero content --------------------
-- Support needs to answer "does this person have memory, and how
-- much" without anybody at AiMS reading a word of it. This returns
-- counts and dates and nothing else; there is no content column in
-- its return type, so a support tool built on it cannot display
-- content by accident or by a later edit that forgets why.
create or replace function public.coach_memory_metadata(p_profile_id uuid)
returns table (
  memory_count integer,
  first_at timestamptz,
  last_at timestamptz,
  said_count integer,
  inferred_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The caller must be a system_admin (support) or the subject
  -- themselves. Everyone else gets an error rather than zeroes: a
  -- count of zero and "you may not ask" are different answers and
  -- should not look alike.
  if not (
    public.auth_role() = 'system_admin' or auth.uid() = p_profile_id
  ) then
    raise exception 'coach_memory_metadata: not permitted';
  end if;

  return query
  select
    count(*)::integer,
    min(m.created_at),
    max(m.created_at),
    count(*) filter (where m.kind = 'said')::integer,
    count(*) filter (where m.kind = 'inferred')::integer
  from public.coach_memories m
  where m.profile_id = p_profile_id;
end;
$$;

revoke all on function public.coach_memory_metadata(uuid) from public;
revoke all on function public.coach_memory_metadata(uuid) from anon;
revoke all on function public.coach_memory_metadata(uuid) from service_role;
grant execute on function public.coach_memory_metadata(uuid) to authenticated;

comment on function public.coach_memory_metadata(uuid) is
  'Counts and dates for support. Returns NO content and has no column that could carry any, so a support surface built on it cannot leak memory by a later edit. system_admin or the subject only.';

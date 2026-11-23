-- =============================================================
-- Migration 0329: who can see coaching calls, managed in the app;
-- the AiMS champion seat retired
--
-- WHY. Jason, 2026-11-23. The champion seat is not needed. What it
-- did that still matters is one thing: it was the only person at a
-- company, besides the coach, who could read the coach's calls
-- (0326). That becomes a list a coach or company admin manages from
-- the Coaching calls tab, and company admins see the calls
-- automatically.
--
-- WHO READS A COACHING CALL, from this migration:
--   (a) the company's assigned coaches (is_assigned_coach, 0326);
--   (b) the company's admins: an active company_admin of the company,
--       or a portfolio admin a system admin switched on as its admin
--       (0245). Read directly, never through is_admin_for() or
--       is_guide_for(), which admit every assigned portfolio admin;
--   (c) anyone on coaching_call_viewers for the company who is still
--       an active member of it. Leaving the company, or being made
--       inactive, ends their access with no row to tidy.
-- Still NOT an unassigned system admin, and never an assistant
-- session (Aimee and AI apps do not read coaching calls).
--
-- WHO MANAGES THE LIST: (a) and (b). Add and remove; nobody edits a
-- row in place.
--
-- THE CHAMPION SEAT. Each company's current champion is copied onto
-- the list (unless they are a company admin, who now sees the calls
-- anyway), so nobody loses access. Then:
--   * the trigger that emptied the seat and told admins "the seat is
--     empty" is dropped (it would keep raising that notice);
--   * the "aims_champion" agent access predicate is taken off every
--     agent, and company_admin added to that agent's roles where it
--     was missing, so the people it reached are company admins;
--   * Aimee's weekly debrief invitation is switched off in the app.
--     Pending invitations are marked superseded and their unread
--     notifications read, along with any "seat is empty" notices.
-- The column companies.aims_champion_profile_id stays for now: the
-- app running before this deploy still reads it. A later migration
-- drops it, with its membership trigger and its place in the
-- companies column guards.
--
-- Probes: scripts/rls-harness.ts, coachingCallReadProbes and
-- coachingCallAccessProbes.
-- =============================================================

-- ---- 1. The list ---------------------------------------------------

create table if not exists public.coaching_call_viewers (
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (company_id, profile_id)
);

create index if not exists coaching_call_viewers_profile_idx
  on public.coaching_call_viewers (profile_id);

comment on table public.coaching_call_viewers is
  'People at a company who may read its coaching calls besides its coaches and '
  'admins (0329). Managed from the Coaching calls tab by an assigned coach or a '
  'company admin. A row counts only while the person is an active member.';

alter table public.coaching_call_viewers enable row level security;
alter table public.coaching_call_viewers force row level security;
revoke all on public.coaching_call_viewers from public, anon, authenticated;
grant select, insert, delete on public.coaching_call_viewers to authenticated;
grant select, insert, update, delete on public.coaching_call_viewers to service_role;

-- ---- 2. The company's admins, for coaching calls --------------------
--
-- An active company_admin of the company, or a portfolio admin whose
-- assignment to it a system admin has switched on as company admin
-- (0245). Not is_admin_for(): that admits every assigned portfolio
-- admin, switched on or not (E19).
create or replace function public.is_coaching_call_admin(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null
    and not public.is_assistant()
    and p_company_id is not null
    and exists (
      select 1
        from public.profiles p
       where p.id = (select auth.uid())
         and p.status = 'active'
         and (
           (p.role = 'company_admin' and p.company_id = p_company_id)
           or (p.role = 'portfolio_admin' and exists (
             select 1
               from public.portfolio_assignments pa
              where pa.portfolio_admin_id = p.id
                and pa.company_id = p_company_id
                and pa.acts_as_company_admin
           ))
         )
    ),
    false)
$$;

revoke all on function public.is_coaching_call_admin(uuid) from public, anon;
grant execute on function public.is_coaching_call_admin(uuid) to authenticated, service_role;

-- Who may add and remove people: an assigned coach or a company admin.
create or replace function public.can_manage_coaching_call_access(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.is_assigned_coach(p_company_id)
    or public.is_coaching_call_admin(p_company_id),
    false)
$$;

revoke all on function public.can_manage_coaching_call_access(uuid) from public, anon;
grant execute on function public.can_manage_coaching_call_access(uuid) to authenticated, service_role;

-- ---- 3. Who reads a coaching call ------------------------------------
--
-- 0326's function with the champion branch replaced by (b) and (c).
-- Same signature, so the policies and meeting_passes_kind_boundary()
-- that call it are unchanged.
create or replace function public.can_read_coaching_call(
  p_company_id uuid,
  p_source_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null
    and not public.is_assistant()
    and (
      (p_company_id is not null and (
        public.is_assigned_coach(p_company_id)
        or public.is_coaching_call_admin(p_company_id)
        or exists (
          select 1
            from public.coaching_call_viewers v
            join public.profiles p on p.id = v.profile_id
           where v.company_id = p_company_id
             and v.profile_id = (select auth.uid())
             and p.company_id = p_company_id
             and p.status = 'active'
        )
      ))
      or (p_company_id is null and p_source_id is not null and exists (
        select 1
          from public.transcript_sources s
         where s.id = p_source_id
           and s.scope = 'coach'
           and s.owner_profile_id = (select auth.uid())
      ))
    ),
    false)
$$;

-- ---- 4. The list's rules -------------------------------------------

-- Reads: anyone who can read the company's coaching calls (an assigned
-- coach, a company admin, or someone on the list), so the tab can say
-- who else sees them.
drop policy if exists coaching_call_viewers_select on public.coaching_call_viewers;
create policy coaching_call_viewers_select on public.coaching_call_viewers
  for select to authenticated
  using (public.can_read_coaching_call(company_id));

-- Writes: an assigned coach (aims_guide or system_admin with a
-- guide_assignments row) or a company admin (an active company_admin
-- of the company, or a portfolio admin switched on as its admin).
-- Only an active member of the company may be added, and the row says
-- who added them.
drop policy if exists coaching_call_viewers_insert on public.coaching_call_viewers;
create policy coaching_call_viewers_insert on public.coaching_call_viewers
  for insert to authenticated
  with check (
    public.can_manage_coaching_call_access(company_id)
    and added_by = (select auth.uid())
    and exists (
      select 1
        from public.profiles p
       where p.id = profile_id
         and p.company_id = coaching_call_viewers.company_id
         and p.status = 'active'
    )
  );

-- Writes: an assigned coach or a company admin, as above.
drop policy if exists coaching_call_viewers_delete on public.coaching_call_viewers;
create policy coaching_call_viewers_delete on public.coaching_call_viewers
  for delete to authenticated
  using (public.can_manage_coaching_call_access(company_id));

drop policy if exists assistant_refused on public.coaching_call_viewers;
create policy assistant_refused on public.coaching_call_viewers
  as restrictive for all to authenticated
  using (not (select public.is_assistant()))
  with check (not (select public.is_assistant()));

-- ---- 5. The champion moves onto the list ---------------------------

insert into public.coaching_call_viewers (company_id, profile_id, added_by)
select c.id, c.aims_champion_profile_id, null
  from public.companies c
  join public.profiles p on p.id = c.aims_champion_profile_id
 where c.aims_champion_profile_id is not null
   and p.company_id = c.id
   and p.status = 'active'
   and p.role <> 'company_admin'
on conflict do nothing;

comment on column public.companies.aims_champion_profile_id is
  'Retired (0329). Nothing reads it; a later migration drops it. Coaching-call '
  'access is coaching_call_viewers.';

-- ---- 6. The seat's trigger and notices -----------------------------

drop trigger if exists profiles_clear_champion on public.profiles;
drop function if exists public.clear_champion_when_member_leaves();

-- ---- 7. The agent access predicate ---------------------------------

update public.agents
   set allowed_roles = case
         when 'company_admin' = any(allowed_roles) then allowed_roles
         else array_append(allowed_roles, 'company_admin')
       end,
       access_predicates = array_remove(access_predicates, 'aims_champion')
 where 'aims_champion' = any(access_predicates);

-- ---- 8. The weekly debrief invitation, off -------------------------

update public.guide_nudges
   set state = 'superseded'
 where state = 'pending';

update public.notifications
   set read_at = now()
 where kind in ('guide-nudge', 'champion-empty')
   and read_at is null;

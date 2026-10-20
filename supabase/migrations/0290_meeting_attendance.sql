-- 0290: who was at the weekly meeting.
--
-- WHY. Jason, 2026-10-19: the first thing on the meeting page's
-- check-in is the room's attendance, a tick beside each person's name
-- that shows they are present.
--
-- WHAT. meeting_attendance: one row per person marked present, per
-- company, per week (the Friday the week ends on, as headlines are,
-- 0288). AiMS records no meeting itself, so the week is the meeting:
-- one weekly meeting, and opening the page again that week shows the
-- same ticks. A row is "present"; un-ticking deletes it. The person
-- must be on the company's roster: one of its own people, or a guide
-- or portfolio admin assigned to it (lib/people/assignable.ts).
--
-- WHO READS AND WRITES. As meeting_headlines. Reads: the company's
-- own people, an assigned guide, a system admin, a portfolio admin.
-- Writes (insert and delete): the company's own people, a system
-- admin, and is_content_admin_for() (an assigned guide, or a
-- portfolio admin switched on as this company's admin). No update:
-- a row only says present. Outside AI apps are refused at birth by
-- 0270's event trigger.
--
-- Harness probe "attendance · one company's own".

create table if not exists public.meeting_attendance (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  week_ending date not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  marked_by uuid references public.profiles(id) on delete set null,
  marked_at timestamptz not null default now(),
  unique (company_id, week_ending, profile_id)
);

create index if not exists meeting_attendance_company_week
  on public.meeting_attendance (company_id, week_ending desc);

comment on table public.meeting_attendance is
  'A person marked present at a company''s weekly meeting, by the Friday the week ends on. No row means not marked (0290).';

-- Roles: none. Stamps the row; admits nobody. Security definer so it
-- can see every roster, whoever is asking: the policies below, not
-- this trigger, decide who may write where (as 0289 settled for
-- headlines). The person must be on the company's roster; who marked
-- it and when come from the database.
create or replace function public.stamp_meeting_attendance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.profile_id and p.company_id = new.company_id
  ) and not exists (
    select 1 from public.guide_assignments g
    where g.guide_id = new.profile_id and g.company_id = new.company_id
  ) and not exists (
    select 1 from public.portfolio_assignments a
    where a.portfolio_admin_id = new.profile_id and a.company_id = new.company_id
  ) then
    raise exception 'person % is not on company %''s roster', new.profile_id, new.company_id
      using errcode = 'check_violation';
  end if;
  new.marked_by := auth.uid();
  new.marked_at := now();
  return new;
end;
$$;

revoke all on function public.stamp_meeting_attendance() from public, anon, authenticated;

drop trigger if exists stamp_meeting_attendance on public.meeting_attendance;
create trigger stamp_meeting_attendance
  before insert on public.meeting_attendance
  for each row execute function public.stamp_meeting_attendance();

alter table public.meeting_attendance enable row level security;
alter table public.meeting_attendance force row level security;

revoke all on public.meeting_attendance from public, anon;
grant select, insert, delete on public.meeting_attendance to authenticated;
grant select, insert, update, delete on public.meeting_attendance to service_role;

-- Roles: the company's own people (any role with that company_id), an
-- assigned aims_guide, system_admin.
drop policy if exists meeting_attendance_select on public.meeting_attendance;
create policy meeting_attendance_select on public.meeting_attendance
  for select to authenticated
  using (
    (select public.auth_role()) = 'system_admin'
    or ((select public.auth_company_id()) is not null
        and (select public.auth_company_id()) = meeting_attendance.company_id)
    or public.is_guide_for(company_id)
  );

-- Roles: portfolio_admin, read only.
drop policy if exists meeting_attendance_select_portfolio on public.meeting_attendance;
create policy meeting_attendance_select_portfolio on public.meeting_attendance
  for select to authenticated
  using ((select public.is_portfolio_admin()));

-- Roles: the company's own people (any role with that company_id),
-- system_admin, and is_content_admin_for(): an assigned aims_guide, or
-- a portfolio admin a system admin switched on as this company's
-- admin. Never a portfolio_admin by its role alone.
drop policy if exists meeting_attendance_insert on public.meeting_attendance;
create policy meeting_attendance_insert on public.meeting_attendance
  for insert to authenticated
  with check (
    (select public.auth_role()) = 'system_admin'
    or ((select public.auth_company_id()) is not null
        and (select public.auth_company_id()) = meeting_attendance.company_id)
    or public.is_content_admin_for(company_id)
  );

-- Roles: as meeting_attendance_insert. Un-ticking a name.
drop policy if exists meeting_attendance_delete on public.meeting_attendance;
create policy meeting_attendance_delete on public.meeting_attendance
  for delete to authenticated
  using (
    (select public.auth_role()) = 'system_admin'
    or ((select public.auth_company_id()) is not null
        and (select public.auth_company_id()) = meeting_attendance.company_id)
    or public.is_content_admin_for(company_id)
  );

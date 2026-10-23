-- 0299: the weekly meeting's check-in notes, one page per week.
--
-- WHY. Jason, 2026-10-23: the check-in step suggests two positive
-- questions, then the room's answers are written down in one place,
-- big enough to hold them and formatted as rich text. It replaces the
-- commitments kept and the critical success factors on target, which
-- the step showed before.
--
-- WHAT. meeting_checkins: one row per company per week, keyed by the
-- Friday the week ends on, as meeting_headlines (0288) is. The body is
-- the editor's document (TipTap JSON, as classroom_trainings.body_json
-- is). The app keeps it under 60,000 bytes of JSON; the table allows
-- 80,000, because jsonb's own text form spaces the same document out.
-- The row belongs to the company's
-- meeting, not to a person: whoever is at the keyboard writes it, and
-- created_by only says who first did.
--
-- WHO READS AND WRITES. The same as a headline. Reads: the company's
-- own people, an assigned guide, a system admin, and a portfolio
-- admin (reads are wide on purpose). Writes: the company's own people,
-- a system admin, and whoever is_content_admin_for() admits (an
-- assigned guide, or a portfolio admin a system admin switched on as
-- this company's admin). No delete: cleared notes are an empty
-- document. Outside AI apps are refused at birth by 0270's event
-- trigger, and nothing here grants them anything.
--
-- Harness probe "check-in notes · one company's own": a member writes
-- and rewrites its own company's notes and not another company's; a
-- guide writes an assigned company's.

create table if not exists public.meeting_checkins (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  week_ending date not null,
  body jsonb not null default '{"type":"doc","content":[]}'::jsonb
    check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 80000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, week_ending)
);

comment on table public.meeting_checkins is
  'The weekly meeting''s check-in notes for one week (the Friday it ends on): what the room shared. Rich text, as TipTap JSON (0299).';

-- Roles: none. Stamps the row; admits nobody. The author stamp is the
-- signed-in person on insert and untouched after, and an update cannot
-- move the row to another company or week.
create or replace function public.stamp_meeting_checkin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.company_id := old.company_id;
    new.week_ending := old.week_ending;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stamp_meeting_checkin on public.meeting_checkins;
create trigger stamp_meeting_checkin
  before insert or update on public.meeting_checkins
  for each row execute function public.stamp_meeting_checkin();

alter table public.meeting_checkins enable row level security;
alter table public.meeting_checkins force row level security;

revoke all on public.meeting_checkins from public, anon;
grant select, insert, update on public.meeting_checkins to authenticated;
grant select, insert, update, delete on public.meeting_checkins to service_role;

-- Roles: the company's own people (any role with that company_id), an
-- assigned aims_guide, system_admin.
drop policy if exists meeting_checkins_select on public.meeting_checkins;
create policy meeting_checkins_select on public.meeting_checkins
  for select to authenticated
  using (
    (select public.auth_role()) = 'system_admin'
    or ((select public.auth_company_id()) is not null
        and (select public.auth_company_id()) = meeting_checkins.company_id)
    or public.is_guide_for(company_id)
  );

-- Roles: portfolio_admin, read only, like meeting_headlines_select_portfolio.
drop policy if exists meeting_checkins_select_portfolio on public.meeting_checkins;
create policy meeting_checkins_select_portfolio on public.meeting_checkins
  for select to authenticated
  using ((select public.is_portfolio_admin()));

-- Roles: the company's own people (any role with that company_id),
-- system_admin, and is_content_admin_for(): an assigned aims_guide, or
-- a portfolio admin a system admin switched on as this company's
-- admin. Never a portfolio_admin by its role alone.
drop policy if exists meeting_checkins_insert on public.meeting_checkins;
create policy meeting_checkins_insert on public.meeting_checkins
  for insert to authenticated
  with check (
    (select public.auth_role()) = 'system_admin'
    or ((select public.auth_company_id()) is not null
        and (select public.auth_company_id()) = meeting_checkins.company_id)
    or public.is_content_admin_for(company_id)
  );

-- Roles: as meeting_checkins_insert.
drop policy if exists meeting_checkins_update on public.meeting_checkins;
create policy meeting_checkins_update on public.meeting_checkins
  for update to authenticated
  using (
    (select public.auth_role()) = 'system_admin'
    or ((select public.auth_company_id()) is not null
        and (select public.auth_company_id()) = meeting_checkins.company_id)
    or public.is_content_admin_for(company_id)
  )
  with check (
    (select public.auth_role()) = 'system_admin'
    or ((select public.auth_company_id()) is not null
        and (select public.auth_company_id()) = meeting_checkins.company_id)
    or public.is_content_admin_for(company_id)
  );

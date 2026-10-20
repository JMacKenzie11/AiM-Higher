-- 0288: headlines, one per functional area per week.
--
-- WHY. Jeff, all-hands 2026-10-19: the second step of the weekly
-- meeting is each functional area's update. What happened last week,
-- what worked, what is coming, and what the area needs support on.
-- Headlines, not commitments or success factors, which have their own
-- steps. The meeting page (simplification review, change 5, under the
-- meeting-mode switch) shows last week's headline beside this week's
-- for every function, and the room writes this week's as it goes.
--
-- WHAT. meeting_headlines: one row per function per week, keyed by
-- the Friday the week ends on, as every other weekly record is
-- (lib/dates.ts, mondayOf). Free text, kept short. The row belongs to
-- the function, not to a person: whoever in the company is at the
-- keyboard writes it, and created_by only says who first did.
--
-- WHO READS AND WRITES. The same as an issue. Reads: the company's
-- own people, an assigned guide, a system admin, and a portfolio
-- admin (reads are wide on purpose). Writes: the company's own
-- people, a system admin, and whoever is_content_admin_for() admits
-- (an assigned guide, or a portfolio admin a system admin switched on
-- as this company's admin). No delete: a cleared headline is an empty
-- body. Outside AI apps are refused at birth by 0270's event trigger,
-- and nothing here grants them anything.
--
-- Harness probe "headlines · one company's own": a member writes its
-- own company's headline and not another company's; a guide writes an
-- assigned company's.

create table if not exists public.meeting_headlines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  function_id uuid not null references public.functions(id) on delete cascade,
  week_ending date not null,
  body text not null default '' check (char_length(body) <= 4000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (function_id, week_ending)
);

create index if not exists meeting_headlines_company_week
  on public.meeting_headlines (company_id, week_ending desc);

comment on table public.meeting_headlines is
  'A functional area''s headline for one week (the Friday it ends on): what happened, what worked, what is coming, what it needs. Written in the weekly meeting (0288).';

-- Roles: none. Stamps the row; admits nobody. The function must be in
-- the row's company, whatever the request said, and the author stamp
-- is the signed-in person on insert and untouched after.
create or replace function public.stamp_meeting_headline()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.functions f
    where f.id = new.function_id and f.company_id = new.company_id
  ) then
    raise exception 'function % is not in company %', new.function_id, new.company_id
      using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.company_id := old.company_id;
    new.function_id := old.function_id;
    new.week_ending := old.week_ending;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists stamp_meeting_headline on public.meeting_headlines;
create trigger stamp_meeting_headline
  before insert or update on public.meeting_headlines
  for each row execute function public.stamp_meeting_headline();

alter table public.meeting_headlines enable row level security;
alter table public.meeting_headlines force row level security;

revoke all on public.meeting_headlines from public, anon;
grant select, insert, update on public.meeting_headlines to authenticated;
grant select, insert, update, delete on public.meeting_headlines to service_role;

-- Roles: the company's own people (any role with that company_id), an
-- assigned aims_guide, system_admin.
drop policy if exists meeting_headlines_select on public.meeting_headlines;
create policy meeting_headlines_select on public.meeting_headlines
  for select to authenticated
  using (
    (select public.auth_role()) = 'system_admin'
    or ((select public.auth_company_id()) is not null
        and (select public.auth_company_id()) = meeting_headlines.company_id)
    or public.is_guide_for(company_id)
  );

-- Roles: portfolio_admin, read only, like issues_select_portfolio.
drop policy if exists meeting_headlines_select_portfolio on public.meeting_headlines;
create policy meeting_headlines_select_portfolio on public.meeting_headlines
  for select to authenticated
  using ((select public.is_portfolio_admin()));

-- Roles: the company's own people (any role with that company_id),
-- system_admin, and is_content_admin_for(): an assigned aims_guide, or
-- a portfolio admin a system admin switched on as this company's
-- admin. Never a portfolio_admin by its role alone.
drop policy if exists meeting_headlines_insert on public.meeting_headlines;
create policy meeting_headlines_insert on public.meeting_headlines
  for insert to authenticated
  with check (
    (select public.auth_role()) = 'system_admin'
    or ((select public.auth_company_id()) is not null
        and (select public.auth_company_id()) = meeting_headlines.company_id)
    or public.is_content_admin_for(company_id)
  );

-- Roles: as meeting_headlines_insert.
drop policy if exists meeting_headlines_update on public.meeting_headlines;
create policy meeting_headlines_update on public.meeting_headlines
  for update to authenticated
  using (
    (select public.auth_role()) = 'system_admin'
    or ((select public.auth_company_id()) is not null
        and (select public.auth_company_id()) = meeting_headlines.company_id)
    or public.is_content_admin_for(company_id)
  )
  with check (
    (select public.auth_role()) = 'system_admin'
    or ((select public.auth_company_id()) is not null
        and (select public.auth_company_id()) = meeting_headlines.company_id)
    or public.is_content_admin_for(company_id)
  );

-- =============================================================
-- Migration 0316: categories for a diagnostic's tasks
--
-- WHY. Jason, 2026-11-02: on Pre-flight's Tasks screen the lead adds
-- categories of work (Outreach, for example) and the tasks under each.
-- None are filled in for him: a diagnostic starts with no categories.
--
-- ADDITIVE ONLY. One new table and one new nullable column. No
-- existing column, constraint or policy changes.
--
--   diagnostic_task_categories  one category of work in a diagnostic,
--                               in the lead's order
--   diagnostic_tasks            category_id (null: no category)
--
-- SAME DIAGNOSTIC. A task's category must belong to the task's own
-- diagnostic. assert_diagnostic_task_category_same_diagnostic()
-- refuses anything else (23514), as 0298 does for systems.
--
-- DELETES. Removing a category keeps its tasks: category_id is ON
-- DELETE SET NULL, so they move to no category.
--
-- ACCESS. The same as the systems tables in 0298: system admin only,
-- for every verb granted, in the hoisted form; 0295's primary-instance
-- rule; authorship stamped by stamp_created_by(); outside assistants
-- refused from birth by 0270's event trigger; nothing granted to anon;
-- nothing written by the service role.
--
-- Harness probe "diagnostics · system admin only", extended to the
-- table, the same-diagnostic rule and the delete.
-- =============================================================

create table if not exists public.diagnostic_task_categories (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null references public.diagnostics(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  position integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists diagnostic_task_categories_diagnostic on public.diagnostic_task_categories (diagnostic_id);

comment on table public.diagnostic_task_categories is
  'Capacity Diagnostic (0316): one category of work the lead groups tasks under, such as Outreach. System admins only.';

alter table public.diagnostic_tasks
  add column if not exists category_id uuid references public.diagnostic_task_categories(id) on delete set null;

create index if not exists diagnostic_tasks_category on public.diagnostic_tasks (category_id);

-- ---- Same diagnostic ---------------------------------------------

create or replace function public.assert_diagnostic_task_category_same_diagnostic()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner uuid;
begin
  if new.category_id is null then
    return new;
  end if;
  select diagnostic_id into owner from public.diagnostic_task_categories where id = new.category_id;
  if owner is null then
    raise exception 'diagnostic_category_missing: category % not found', new.category_id using errcode = '23503';
  end if;
  if owner <> new.diagnostic_id then
    raise exception 'diagnostic_category_cross_diagnostic: category % belongs to another diagnostic', new.category_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.assert_diagnostic_task_category_same_diagnostic() from public, anon, authenticated;

drop trigger if exists diagnostic_tasks_category_same_diagnostic on public.diagnostic_tasks;
create trigger diagnostic_tasks_category_same_diagnostic
  before insert or update of category_id, diagnostic_id on public.diagnostic_tasks
  for each row execute function public.assert_diagnostic_task_category_same_diagnostic();

-- ---- Grants, row security, authorship ----------------------------

alter table public.diagnostic_task_categories enable row level security;
alter table public.diagnostic_task_categories force row level security;
revoke all on public.diagnostic_task_categories from public, anon, authenticated;
grant select, insert, update, delete on public.diagnostic_task_categories to authenticated;

drop trigger if exists stamp_created_by on public.diagnostic_task_categories;
create trigger stamp_created_by before insert on public.diagnostic_task_categories
  for each row execute function public.stamp_created_by();

-- Roles: system_admin only, for every verb granted.
drop policy if exists diagnostic_task_categories_select on public.diagnostic_task_categories;
create policy diagnostic_task_categories_select on public.diagnostic_task_categories
  for select to authenticated using ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_task_categories_insert on public.diagnostic_task_categories;
create policy diagnostic_task_categories_insert on public.diagnostic_task_categories
  for insert to authenticated with check ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_task_categories_update on public.diagnostic_task_categories;
create policy diagnostic_task_categories_update on public.diagnostic_task_categories
  for update to authenticated
  using ((select public.auth_role()) = 'system_admin')
  with check ((select public.auth_role()) = 'system_admin');
drop policy if exists diagnostic_task_categories_delete on public.diagnostic_task_categories;
create policy diagnostic_task_categories_delete on public.diagnostic_task_categories
  for delete to authenticated using ((select public.auth_role()) = 'system_admin');

-- HQ only (0295): every verb, restrictive.
drop policy if exists diagnostic_task_categories_primary_only on public.diagnostic_task_categories;
create policy diagnostic_task_categories_primary_only on public.diagnostic_task_categories
  as restrictive for all to authenticated
  using ((select public.is_primary_instance()))
  with check ((select public.is_primary_instance()));

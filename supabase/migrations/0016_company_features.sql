-- =============================================================
-- Merger Phase 1 — Migration 0016: company_features.
--   Subscription gate for the modular platform. Each row grants
--   a company access to one feature ('execution' | 'strengths' |
--   future modules). NavBand and page gates query this table to
--   hide surfaces the customer didn't buy.
--
--   RLS: system_admin manages entitlements; company members read
--   their own company's rows.
--
--   Backfills 'execution' for every existing company (they're all
--   already using AiMSHigher). Strengths entitlement gets added
--   per-company when SM data is migrated in Phase 4.
-- =============================================================

create table public.company_features (
  company_id uuid not null references public.companies(id) on delete cascade,
  feature text not null,
  enabled_at timestamptz not null default now(),
  primary key (company_id, feature)
);

create index company_features_by_feature_idx
  on public.company_features (feature);

alter table public.company_features enable row level security;
alter table public.company_features force row level security;

create policy company_features_select on public.company_features
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (ap.company_id is not null and ap.company_id = public.company_features.company_id)
  )
);

create policy company_features_insert on public.company_features
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy company_features_update on public.company_features
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy company_features_delete on public.company_features
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

-- Helper used by module-specific RLS policies (added in Phase 4).
-- security definer so a caller doesn't need direct company_features
-- SELECT permission — RLS on the module table gates access instead.
create or replace function public.company_has_feature(
  cid uuid,
  feat text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.company_features
    where company_id = cid and feature = feat
  );
$$;

grant execute on function public.company_has_feature(uuid, text) to authenticated;

-- Backfill: every existing company gets 'execution'. They're all
-- already using AiMSHigher.
insert into public.company_features (company_id, feature)
select id, 'execution' from public.companies
on conflict (company_id, feature) do nothing;

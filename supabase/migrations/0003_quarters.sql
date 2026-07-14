-- =============================================================
-- Phase 2 — Migration 0003: quarters (Section 4.2).
--   At most one open quarter per company; enforced with a partial
--   unique index. Closing a quarter does not modify its children;
--   it just removes it from "current" pickers.
-- =============================================================

create table public.quarters (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  label text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quarters_end_after_start check (end_date >= start_date)
);

create unique index quarters_label_unique on public.quarters (company_id, label);
create unique index quarters_one_open on public.quarters (company_id) where status = 'open';
create index quarters_company_id_idx on public.quarters (company_id);

create trigger quarters_set_updated_at
before update on public.quarters
for each row execute function public.set_updated_at();

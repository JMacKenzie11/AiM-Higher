-- =============================================================
-- Migration 0133 — coach_token_usage (Anthropic call log)
--
-- One row per Anthropic API call made by the coach product:
--   * per assistant turn (purpose = 'turn'), summed across the
--     tool loop iterations so a single row represents a single
--     user-visible response no matter how many tool round-trips
--     happened underneath
--   * per auto-title generation (purpose = 'title')
--   * per nightly themes clustering run (purpose = 'themes')
--
-- Powers the system-admin dashboard's cost-visibility card and
-- per-company usage rollup. Denormalizes company_id so the
-- per-company aggregate stays a single indexed group-by; the
-- conversation cascade is enough for cleanup either way.
--
-- Cost is stored as integer USD cents (cost_usd_cents) so per-
-- company + platform totals sum without float drift. Pricing
-- lookups live in src/lib/coach/usage.ts alongside the writer;
-- adjust there when Anthropic rates change.
--
-- Writes happen server-side via the admin client (bypasses RLS),
-- so no insert policy is defined — reads are system_admin only.
-- =============================================================

create table public.coach_token_usage (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.coaching_conversations(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  purpose text not null check (purpose in ('turn', 'title', 'themes', 'other')),
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_creation_input_tokens int not null default 0,
  cache_read_input_tokens int not null default 0,
  cost_usd_cents int not null default 0,
  created_at timestamptz not null default now()
);

create index coach_token_usage_company_created_idx
  on public.coach_token_usage (company_id, created_at desc);
create index coach_token_usage_created_idx
  on public.coach_token_usage (created_at desc);
create index coach_token_usage_conversation_idx
  on public.coach_token_usage (conversation_id)
  where conversation_id is not null;

alter table public.coach_token_usage enable row level security;
alter table public.coach_token_usage force row level security;

-- System admin only. Everything on this table is aggregated
-- operational data — never surfaced to end users or company
-- admins.
create policy coach_token_usage_select on public.coach_token_usage
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

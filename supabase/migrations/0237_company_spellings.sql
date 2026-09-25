-- =============================================================
-- Migration 0237 — company_spellings
--
-- The places and suppliers a company's recordings mishear, and how
-- the company spells them. Read by the meeting pipeline, which
-- corrects every generated string on the way into storage
-- (src/lib/transcripts/spelling.ts).
--
-- ---- WHY A TABLE AND NOT THE PROMPT ----------------------------
--
-- The prompt already says to spell names the company's way, and the
-- company block carries the purpose statement holding "Grand Manan".
-- A Benson summary still said "Graham and Ann", because the recording
-- says it five times and the right spelling appears nowhere in it.
-- Asking the model harder is not a fix. A lookup after generation is.
--
-- Not in the repo either: the entries are one client's place names
-- and suppliers, and code in this repo runs for every company.
--
-- ---- WHAT A ROW IS ---------------------------------------------
--
--   spelling   'Grand Manan'                 how the company writes it
--   heard_as   {'Graham and Ann','Grand Menan'}  what gets replaced
--
-- A row with an empty heard_as says "this spelling is correct as it
-- stands": the people check never corrects it toward a roster name
-- one letter away (a floor worker Kylie beside a user Kyle).
--
-- ---- WHO CAN REACH IT ------------------------------------------
--
-- Nobody signed in. The pipeline and scripts/spellings.ts use the
-- service key, and nothing in the app shows or edits the list, so
-- every privilege is revoked from anon and authenticated (E8: the
-- verb withheld, not just left without a policy). RLS is on with no
-- policies. portfolio_admin's closed write list is untouched.
-- =============================================================

create table if not exists public.company_spellings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  spelling text not null check (length(btrim(spelling)) >= 2),
  heard_as text[] not null default '{}',
  kind text not null default 'place' check (kind in ('place', 'supplier', 'person', 'term')),
  note text,
  created_at timestamptz not null default now(),
  unique (company_id, spelling)
);

comment on table public.company_spellings is
  'Per-company spellings the meeting pipeline enforces after generation. '
  'heard_as holds the misheard forms replaced by spelling; an empty '
  'heard_as marks spelling as correct as it stands. Service role only.';

alter table public.company_spellings enable row level security;

revoke all on public.company_spellings from public;
revoke all on public.company_spellings from anon;
revoke all on public.company_spellings from authenticated;

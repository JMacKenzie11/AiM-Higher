-- =============================================================
-- Phase 2 — Migration 0001: shared helper functions.
-- These are prerequisites for every subsequent migration in the app.
-- =============================================================

-- pgcrypto powers gen_random_uuid() for uuid primary keys.
create extension if not exists "pgcrypto";

-- Trigger function used by every table's updated_at column.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

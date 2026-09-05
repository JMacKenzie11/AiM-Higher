-- =============================================================
-- Migration 0169: the instance registry
--
-- One row per customer instance: the subdomain someone browses to,
-- and enough information to find the database behind it. This is
-- the control plane's table, read by src/lib/instances/registry.ts
-- and by nothing else yet.
--
-- What is NOT in here: keys. The row carries env_prefix, a name
-- like 'PROD' or 'ACME', and the process looks up
-- {PREFIX}_SUPABASE_URL / _ANON_KEY / _SERVICE_KEY at runtime. A
-- service-role key in a table is a service-role key in every
-- backup, every export and every screenshot of a query result;
-- keeping them in the environment means the registry can be read
-- without handing out the ability to connect.
--
-- RLS is enabled with no policies at all. That is not an oversight
-- and not a to-do: with RLS on and no policy, every role except
-- service_role is denied by default, which is exactly the reach
-- this table should have. Nothing signed in as a user should ever
-- see the list of other customers.
--
-- Today this table lives in the production project alongside
-- everything else. It is addressed through its own
-- CONTROL_PLANE_SUPABASE_* variables so moving it to a project of
-- its own later is an environment change rather than a code
-- change.
-- =============================================================

create table public.instances (
  id uuid primary key default gen_random_uuid(),
  -- The first label of the hostname: 'acme' in acme.example.com.
  -- Unique because it is what a request is resolved by.
  subdomain text not null unique,
  display_name text not null,
  -- Names the environment variables holding this instance's
  -- Supabase URL and keys. See the comment above.
  env_prefix text not null,
  -- 'active' | 'suspended'. Suspended instances still resolve; what
  -- suspension means is the application's decision, not this
  -- table's. Constrained because src/lib/instances/types.ts models
  -- this as a two-value union, so a third value would be a bug
  -- rather than a feature.
  status text not null default 'active'
    check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

-- Service-role only. See the header: RLS on with zero policies is
-- the point.
alter table public.instances enable row level security;

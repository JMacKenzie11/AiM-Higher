-- =============================================================
-- Migration 0164: three privilege holes from the 2026-09-01
-- security audit. None was exploited; all three are reachable by a
-- legitimately-signed-in user with the public anon key.
--
-- Deliberately NOT in this migration: the owner-scoped UPDATE
-- policies that let a user move their own row to another tenant
-- (strategic_focus_areas, annual_goals, priorities, commitments,
-- issues, coaching_conversations, strengths_assessments), and the
-- performance rewrite that wraps the RLS helpers in scalar
-- subselects. Both rewrite read/write paths on the tenant tables
-- that migration 0160-era app fixes just landed on. Stacking them
-- now means any isolation bug has two candidate causes instead of
-- one. Every change below only ever NARROWS access, so it cannot
-- open a path that was previously closed.
-- =============================================================

-- ---- 1. A guide could promote themselves --------------------
-- profiles_update_guide put `id <> auth.uid()` in USING but not in
-- WITH CHECK. Postgres OR's permissive WITH CHECK expressions, so a
-- guide's own row (admitted by profiles_update_self's USING) could
-- be written through this policy's WITH CHECK instead — setting
-- company_id to an assigned company and role to 'company_admin'.
-- is_guide_for() reads the pre-update snapshot, so the guide is
-- still a guide at check time and the write passes.
--
-- Net effect before this fix: a guide could convert themselves into
-- a permanent company_admin of a client, surviving unassignment.
-- Real impact is bounded (they already had admin-equivalent access
-- while assigned) but it is persistence past revocation, which is
-- exactly what unassigning is supposed to remove.
drop policy if exists profiles_update_guide on public.profiles;
create policy profiles_update_guide on public.profiles
for update to authenticated
using (
  public.profiles.company_id is not null
  and public.is_guide_for(public.profiles.company_id)
  and public.profiles.id <> auth.uid()
)
with check (
  public.profiles.company_id is not null
  and public.is_guide_for(public.profiles.company_id)
  and public.profiles.role in ('company_admin','team_member')
  -- The added line. Without it this policy is a self-write path.
  and public.profiles.id <> auth.uid()
);

-- ---- 2. A deactivated user could reactivate themselves ------
-- profiles_update_self pinned role and company_id but not status,
-- so an inactive (deliberately deactivated) or pending user could
-- set status='active' on their own row and walk back in.
--
-- Safe to pin: the only writes to a caller's own status come from
-- completeAcceptInvite and acceptInviteAction, both of which go
-- through the service-role client and are unaffected by this policy.
--
-- Needs its own helper. auth_profile() returns only (uid,
-- company_id, role), and its return type cannot be extended:
-- CREATE OR REPLACE FUNCTION can't change a signature, and dropping
-- it would mean dropping all 252 policies that depend on it. Reading
-- public.profiles directly from inside a profiles policy would
-- recurse, which is the whole reason auth_profile() is SECURITY
-- DEFINER (see the header comment in 0004). So: a second, additive
-- definer function that returns just the caller's status.
create or replace function public.auth_profile_status()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select p.status from public.profiles p where p.id = auth.uid()
$$;

revoke all on function public.auth_profile_status() from public;
grant execute on function public.auth_profile_status() to authenticated;

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (public.profiles.id = auth.uid())
with check (
  public.profiles.id = auth.uid()
  and public.profiles.role = (select ap.role from public.auth_profile() ap)
  and public.profiles.company_id is not distinct from (select ap.company_id from public.auth_profile() ap)
  -- The added line.
  and public.profiles.status = (select public.auth_profile_status())
);

-- ---- 3. OAuth refresh tokens were browser-readable ----------
-- oauth_credentials_select was widened to company_admin (0110) and
-- a guide mirror was added (0111), both for the WHOLE row — which
-- includes refresh_token and access_token. Those are long-lived
-- Google credentials for the client's Drive, readable with the
-- public anon key by anyone holding either role.
--
-- Both widening policies are removed and the table returns to the
-- system-admin-only read it had in 0109.
--
-- Verified safe before narrowing: every read of this table in the
-- app goes through createSupabaseAdminClient (service role), which
-- ignores RLS entirely. The only column any UI displays is
-- account_email, via getConnectedGoogleAccount — also on the admin
-- client. The comments in 0110 and 0111 say these policies exist so
-- the UI can show connection state, but the code never took that
-- route, so nothing depends on them.
--
-- Why not a column-level revoke, which would be the more surgical
-- tool: this project relies on Supabase's default table-level SELECT
-- grant to `authenticated`, and in Postgres a table-level grant
-- covers every column. REVOKE SELECT (col) removes only the
-- column-level privilege, so it would have been a no-op here while
-- looking like a fix. Getting there properly would mean revoking
-- table SELECT and re-granting a per-column list, which is more
-- moving parts than narrowing one policy, on a table nothing reads
-- through RLS anyway.
drop policy if exists oauth_credentials_select_guide on public.oauth_credentials;

drop policy if exists oauth_credentials_select on public.oauth_credentials;
create policy oauth_credentials_select on public.oauth_credentials
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

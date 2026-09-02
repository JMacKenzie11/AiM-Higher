-- =============================================================
-- Migration 0160: lock the similarity RPCs to the service role.
--
-- find_similar_open_commitment / find_similar_open_issue (0144)
-- are SECURITY DEFINER and take p_company_id as a parameter with
-- no membership check. They were granted to `authenticated`, so
-- any signed-in user could call them from the browser with the
-- public anon key and read another tenant's open commitment
-- descriptions and issue titles, one best-match per call.
--
-- The only caller is src/lib/transcripts/similarity.ts, which
-- runs through the admin (service-role) client. Revoke from every
-- non-service role; service_role keeps execute.
-- =============================================================

revoke execute on function public.find_similar_open_commitment(uuid, text, real, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.find_similar_open_issue(uuid, text, real, timestamptz)
  from public, anon, authenticated;

grant execute on function public.find_similar_open_commitment(uuid, text, real, timestamptz)
  to service_role;
grant execute on function public.find_similar_open_issue(uuid, text, real, timestamptz)
  to service_role;

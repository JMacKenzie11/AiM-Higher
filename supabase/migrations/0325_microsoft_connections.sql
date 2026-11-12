-- =============================================================
-- Migration 0325: a company can connect Microsoft 365, for Teams
-- meeting transcripts
--
-- WHY. Jason, 2026-11-06 and 2026-11-12: a client on Microsoft 365
-- has its weekly meeting transcribed by Teams, not dropped in a
-- Google Drive folder. AiMS now reads those transcripts straight from
-- Microsoft, as the person who connected the company's Microsoft 365
-- account (delegated; see src/lib/connections/microsoft.ts).
--
-- WHAT CHANGES. One word: 'microsoft' joins the connectors a company's
-- connections row may name. Its secret (refresh token and last access
-- token) goes in Supabase Vault through the same functions as Google's,
-- connection_put_service from the sign-in callback and
-- connection_refresh_secret from the reader.
--
-- WHAT DOES NOT. No policy and no function changes. Who may read a
-- company's connections (a system admin, its company admin, and
-- whoever is_content_admin_for() admits) is 0257's rule and holds for
-- the new connector as it does for the others: none of the rules or
-- functions looks at the connector's name. transcript_sources already
-- allowed provider 'teams' (0108), unused until now.
--
-- npm run scrub:dev removes every connection's secret on the dev
-- clone whatever its connector, so it covers this one too.
-- =============================================================

alter table public.connections
  drop constraint if exists connections_connector_check;

alter table public.connections
  add constraint connections_connector_check
  check (connector in ('google', 'hubspot', 'microsoft'));

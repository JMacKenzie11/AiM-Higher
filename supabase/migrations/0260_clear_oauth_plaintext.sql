-- =============================================================
-- Migration 0260: the plain-text Google tokens in oauth_credentials
-- are deleted, now that the vault has served a Saturday's pulls
--
-- External connections plan, phase 1, last step (docs/deployment.md,
-- "Moving the Google tokens into the vault", step 9). 0257 copied
-- every Google row into Supabase Vault and left oauth_credentials as
-- the way back. Saturday 2026-10-03's Sheets pulls ran from the vault
-- on production, so the way back is no longer needed, and the copies
-- are live client credentials sitting in plain text. Jason's go,
-- 2026-10-03.
--
-- DELETED, NOT NULLED, as scripts/scrub-dev-secrets.ts does on dev: a
-- row with no token looks like a connection and cannot work.
--
-- THE GUARD. Nothing is deleted unless every row's company has a
-- 'google' connection whose vault secret holds a refresh token. A
-- company missing from the vault stops the migration with nothing
-- changed, because its row would be the only copy of its token.
-- The secret is read inside the database and never printed.
--
-- The table stays, empty: nothing reads or writes it since 0257, and
-- dropping it is a separate change.
-- =============================================================

do $$
declare
  v_missing int;
begin
  select count(*) into v_missing
    from public.oauth_credentials o
   where not exists (
     select 1
       from public.connections c
       join vault.decrypted_secrets ds on ds.id = c.secret_id
      where c.company_id = o.company_id
        and c.connector = 'google'
        and left(btrim(ds.decrypted_secret), 1) = '{'
        and coalesce(ds.decrypted_secret::jsonb ->> 'refresh_token', '') <> ''
   );
  if v_missing > 0 then
    raise exception '0260: % oauth_credentials row(s) have no Google refresh token in the vault; nothing was cleared', v_missing;
  end if;

  delete from public.oauth_credentials;
end $$;

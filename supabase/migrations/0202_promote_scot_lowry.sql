-- Step 5 of the portfolio sequence, and the reason the other four
-- exist. Spec §1a.
--
-- A ONE-OFF, DELIBERATELY. Scot is the only person this applies to,
-- and there is no second case in sight, so this is a data change
-- rather than a feature. An earlier draft of this step shipped a
-- `promote_to_portfolio_admin()` function so the operation could be
-- performed from a form; it was dropped because a surface nobody can
-- reach is worse than no surface, and because a migration cannot call
-- it anyway — it runs as the owner, and the function's own
-- system_admin check would refuse the caller.
--
-- WHY A MIGRATION AND NOT A HAND-RUN STATEMENT. It is the only
-- sanctioned channel to a live database (failure mode E2), and it
-- leaves the change described by a file rather than by somebody's
-- memory of a psql session.
--
-- WHY THE APP CANNOT DO THIS. updateUserAction writes `role` and
-- never touches `company_id`, and profiles_portfolio_admin_has_no_company
-- (0190) is a CHECK: `role <> 'portfolio_admin' or company_id is
-- null`. Setting the role through the edit form is simply rejected.
-- The four parts below have to land together or not at all, which is
-- what a migration's transaction gives for free.
--
-- STATE READ BEFORE WRITING (PROMISEONE, 2026-09-15):
--   one profile named Scot Lowry, company_admin of "1 - Promise One",
--   status pending; zero portfolio_admins on the instance; zero rows
--   in portfolio_assignments.
--
-- NOT WHAT THIS FIXES: his status is `pending` and `invited_at` is
-- null. He has never been invited and still cannot sign in after
-- this runs. The promotion arranges what he will be when he does;
-- sending the invite is a separate act on the People page.
--
-- Runs as a no-op everywhere the profile does not exist, which is
-- every database except PROMISEONE — including PROD and the dev
-- clone, where the harness applies it.
do $$
declare
  scot          constant uuid := '689da76d-345d-47d0-a1f6-07d654814e5a';
  promise_one   constant uuid := '54bac6cf-aabb-4e7a-a083-eda16a8e5460';
  found_role    text;
  found_company uuid;
  found_name    text;
  ok            boolean;
begin
  select p.role, p.company_id, p.full_name
    into found_role, found_company, found_name
    from public.profiles p
   where p.id = scot
   for update;

  if found_role is null then
    raise notice '0202: no such profile on this database, nothing to do.';
    return;
  end if;

  -- Idempotent. Re-running after success must not re-null a home he
  -- may since have changed, or re-create an assignment he may since
  -- have removed.
  if found_role = 'portfolio_admin' then
    raise notice '0202: already a portfolio admin, nothing to do.';
    return;
  end if;

  -- POINTED AT THE WRONG ROW IS THE ONE FAILURE WORTH DYING ON. A
  -- hardcoded uuid is precise until a database exists where it means
  -- somebody else, and this migration changes what a person is. If
  -- the row is not the one that was read, stop and take the whole
  -- transaction with it.
  if found_name <> 'Scot Lowry' or found_company is distinct from promise_one then
    raise exception
      '0202: profile % is "%" in company %, not Scot Lowry in Promise One. Refusing.',
      scot, found_name, found_company;
  end if;

  -- ONE STATEMENT for role and company_id, because the CHECK above
  -- makes "portfolio_admin holding a company" a state the row may not
  -- pass through, let alone rest in.
  --
  -- The home is what stops this being a demotion in disguise. Without
  -- it he signs in and lands nowhere, because auth_company_id() reads
  -- company_id and that is now null.
  update public.profiles
     set role            = 'portfolio_admin',
         company_id      = null,
         home_company_id = promise_one,
         updated_at      = now()
   where id = scot;

  -- And this is what keeps him running the company he actually runs.
  -- Without it he becomes a portfolio admin who reads all twelve
  -- companies and administers none of them, Promise One included.
  insert into public.portfolio_assignments (portfolio_admin_id, company_id)
  values (scot, promise_one)
  on conflict do nothing;

  -- SELF-VERIFYING, because a data migration has no probe behind it.
  -- Asserting the end state inside the transaction means a wrong
  -- outcome rolls back rather than lands.
  select p.role = 'portfolio_admin'
     and p.company_id is null
     and p.home_company_id = promise_one
     and exists (
       select 1 from public.portfolio_assignments pa
        where pa.portfolio_admin_id = scot and pa.company_id = promise_one
     )
    into ok
    from public.profiles p
   where p.id = scot;

  if not ok then
    raise exception '0202: promotion did not produce the expected state. Rolled back.';
  end if;

  raise notice '0202: Scot Lowry is a portfolio admin, homed at Promise One, assigned to it.';
end;
$$;

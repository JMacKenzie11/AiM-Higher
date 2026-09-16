-- Steve Kessen and Sean Wenger become portfolio admins of the
-- Promise One instance, and keep running Promise One.
--
-- A ONE-OFF, like 0202. Two named people, no second case in sight,
-- so this is a data change rather than a feature. The surface that
-- would make it a feature now exists — the Company access card on
-- /portfolio — but it cannot mint the ROLE, only the assignments,
-- and minting this role is system_admin-only by design.
--
-- WHY THEY GET AN ASSIGNMENT AND SCOT'S PEERS DID NOT. Decision:
-- Jason, 2026-09-16, after the numbers below were read. Scot was
-- already the company admin of Promise One, so his assignment
-- PRESERVED what he had. Steve and Sean are team members, so theirs
-- GRANTS something new — and it is granted deliberately, because
-- promoting them without it would strand work they are doing today.
--
--   Steve Kessen  4 open commitments, all in Promise One
--   Sean Wenger   6 open commitments, all in Promise One
--
-- A portfolio admin's company_id must be null
-- (profiles_portfolio_admin_has_no_company), so promotion takes them
-- off Promise One's roster. Without an assignment their ten
-- commitments would keep owner_id pointing at them while
-- commitments_update_owner refused them — it requires
-- `auth_company_id() = company_id` and theirs would be null — so the
-- rows would render as "Unassigned" (the roster lookup no longer
-- finds them) and be unclaimable (owner_id is not actually null).
-- Ten live pieces of work, owned by people who could not resolve
-- them. The assignment is what makes the promotion free.
--
-- They can untick Promise One on /portfolio whenever they like, and
-- that path releases the commitments properly rather than stranding
-- them. This migration is the floor, not a ceiling.
do $$
declare
  promise_one constant uuid := '54bac6cf-aabb-4e7a-a083-eda16a8e5460';
  people constant uuid[] := array[
    '96cba0fc-9f08-4732-9a07-09ad880763e0',  -- Steve Kessen
    '52e077c5-6ee4-4cca-b4a4-a39b5bd6bfc5'   -- Sean Wenger
  ];
  names constant text[] := array['Steve Kessen', 'Sean Wenger'];
  person uuid;
  expected_name text;
  found_role text;
  found_company uuid;
  found_name text;
  owned_before int;
  owned_after int;
  ok boolean;
begin
  for i in 1..array_length(people, 1) loop
    person := people[i];
    expected_name := names[i];

    select p.role, p.company_id, p.full_name
      into found_role, found_company, found_name
      from public.profiles p
     where p.id = person
     for update;

    if found_role is null then
      raise notice '0207: % not on this database, skipping.', expected_name;
      continue;
    end if;

    if found_role = 'portfolio_admin' then
      raise notice '0207: % is already a portfolio admin, skipping.', expected_name;
      continue;
    end if;

    -- POINTED AT THE WRONG ROW IS THE ONE FAILURE WORTH DYING ON.
    -- A hardcoded uuid is precise until a database exists where it
    -- means somebody else, and this changes what a person is.
    if found_name <> expected_name
       or found_company is distinct from promise_one then
      raise exception
        '0207: profile % is "%" in company %, not % in Promise One. Refusing.',
        person, found_name, found_company, expected_name;
    end if;

    select count(*) into owned_before
      from public.commitments
     where owner_id = person and status = 'open' and deleted_at is null;

    -- ONE STATEMENT for role and company_id: the CHECK makes
    -- "portfolio_admin holding a company" a state the row may not
    -- pass through, let alone rest in.
    update public.profiles
       set role            = 'portfolio_admin',
           company_id      = null,
           home_company_id = promise_one,
           updated_at      = now()
     where id = person;

    -- The clause that keeps their work theirs.
    insert into public.portfolio_assignments (portfolio_admin_id, company_id)
    values (person, promise_one)
    on conflict do nothing;

    -- SELF-VERIFYING, because a data migration has no probe behind
    -- it. The commitment count is the claim that matters: promotion
    -- must not quietly detach anybody from their work.
    select p.role = 'portfolio_admin'
       and p.company_id is null
       and p.home_company_id = promise_one
       and exists (
         select 1 from public.portfolio_assignments pa
          where pa.portfolio_admin_id = person
            and pa.company_id = promise_one
       )
      into ok
      from public.profiles p
     where p.id = person;

    select count(*) into owned_after
      from public.commitments
     where owner_id = person and status = 'open' and deleted_at is null;

    if not ok then
      raise exception '0207: % did not end up a portfolio admin of Promise One. Rolled back.', expected_name;
    end if;
    if owned_after <> owned_before then
      raise exception
        '0207: % owned % open commitments before and % after. Rolled back.',
        expected_name, owned_before, owned_after;
    end if;

    raise notice '0207: % is a portfolio admin, homed at and assigned to Promise One, still owning % open commitment(s).',
      expected_name, owned_after;
  end loop;
end;
$$;

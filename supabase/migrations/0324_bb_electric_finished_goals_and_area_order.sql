-- B&B Electric: six finished goals leave the plan with the focus
-- areas they belonged to, and "SFA #1" sits above "SFA #2".
--
-- A ONE-OFF, like 0264 before it: one company, rows read on the day.
-- Decision: Jason, 2026-11-12 ("Can you archive them", "Can you
-- change the order of the two remaining strategic focus areas").
--
-- WHAT HAPPENED. At the quarter roll three focus areas were archived:
-- "The Gold Standard Electrical Employer", "We've Expanded Our Reach
-- Beyond Fairbanks" and "We've Secured Year-Round Work". Archiving an
-- area touched the area alone, so the six goals under them, every one
-- already complete, fell to "Goals without a focus area", which reads
-- as work waiting to be placed. The same PR makes archiving an area
-- take its completed goals with it from now on; this clears the six
-- that were left behind before it.
--
-- The two areas that remain were both created with sort_order 0 and
-- nothing in the app ever set it, so the plan showed them by creation
-- date: #2 first. The same PR adds the drag handles that set it.
--
-- WHAT THIS DOES, only where the rows still read as they did:
--   1. archives each of the six goals that is still active, still
--      complete, and still under an archived focus area;
--   2. numbers the two live areas 0 (SFA #1) and 1 (SFA #2), if they
--      are still the company's only live areas.
--
-- ANYWHERE ELSE, NOTHING. A database without B&B Electric, or whose
-- rows no longer read as above (the dev clone, copied before the
-- roll; a goal reopened or re-linked by hand meanwhile), gets a
-- notice and no change to that row. A goal id that names another
-- company's goal is the one failure worth stopping on.
do $$
declare
  bb constant uuid := '87c9cc5e-663f-4df7-b7b1-eb4e93418035';
  goals constant uuid[] := array[
    '09c7a0e2-8a1f-44f1-ba80-ab3829a742ae',  -- Every Foreman has a clear Development plan
    'ac6c47fb-059a-4f5a-82a5-8debcdf2f0ea',  -- Transition planning from PM's to Foreman
    'e0a82503-7fc2-4fc6-bfef-8b517595220c',  -- Create marketing and sales assets ...
    'd793763c-a73b-4c21-a091-c9f46d191369',  -- 5 Events, 2 contacts per event ...
    '8c99bcf9-2f52-4742-ab05-f9958339073d',  -- We Can If...
    'abdc7a30-df6b-4058-a470-9389011b05b2'   -- Develop and Incorporate Skills assessment ...
  ]::uuid[];
  strangers int;
  archived_now int;
  live_areas int;
  sfa1 uuid;
  sfa2 uuid;
  sfa1_count int;
  sfa2_count int;
begin
  if not exists (select 1 from public.companies where id = bb) then
    raise notice '0324: B&B Electric is not on this database, skipping.';
    return;
  end if;

  select count(*) into strangers
    from public.annual_goals
   where id = any (goals) and company_id <> bb;
  if strangers > 0 then
    raise exception
      '0324: % of the listed goals belong to a company other than B&B Electric. Refusing.',
      strangers;
  end if;

  -- 1. The finished goals whose focus area has left the plan.
  with done as (
    update public.annual_goals g
       set archived = true
     where g.id = any (goals)
       and g.company_id = bb
       and g.archived = false
       and g.status = 'complete'
       and exists (
             select 1 from public.strategic_focus_areas s
              where s.id = g.sfa_id and s.archived = true)
    returning 1
  )
  select count(*) into archived_now from done;

  -- SELF-VERIFYING: none of the six is still a finished goal on the
  -- plan under an area that is off it.
  if exists (
       select 1 from public.annual_goals g
         join public.strategic_focus_areas s on s.id = g.sfa_id
        where g.id = any (goals)
          and g.archived = false
          and g.status = 'complete'
          and s.archived = true) then
    raise exception '0324: a finished goal is still on the plan under an archived area. Rolled back.';
  end if;
  raise notice '0324: archived % of the six goals (the rest no longer read as they did, or are not here).', archived_now;

  -- 2. SFA #1 above SFA #2.
  select count(*) into live_areas
    from public.strategic_focus_areas
   where company_id = bb and archived = false;
  select count(*), (array_agg(id))[1] into sfa1_count, sfa1
    from public.strategic_focus_areas
   where company_id = bb and archived = false and title like 'SFA #1:%';
  select count(*), (array_agg(id))[1] into sfa2_count, sfa2
    from public.strategic_focus_areas
   where company_id = bb and archived = false and title like 'SFA #2:%';

  if live_areas <> 2 or sfa1_count <> 1 or sfa2_count <> 1 then
    raise notice
      '0324: B&B Electric''s live focus areas are not exactly "SFA #1" and "SFA #2" here (% live, % and % matching). Order left alone.',
      live_areas, sfa1_count, sfa2_count;
    return;
  end if;

  update public.strategic_focus_areas set sort_order = 0 where id = sfa1;
  update public.strategic_focus_areas set sort_order = 1 where id = sfa2;

  if (select sort_order from public.strategic_focus_areas where id = sfa1)
       >= (select sort_order from public.strategic_focus_areas where id = sfa2) then
    raise exception '0324: SFA #1 did not end up above SFA #2. Rolled back.';
  end if;

  raise notice '0324: B&B Electric shows SFA #1 above SFA #2.';
end $$;

-- =============================================================
-- One-off reset for B&B Electric.
--
-- Keeps:
--   • the company row
--   • strategic focus areas
--   • the profile named "Joel Burger"
--   • auth.users row for Joel
--   • foundation, marketing strategy, chart, features, etc.
--
-- Deletes:
--   • annual_goals (all)
--   • priorities (all — the 90-day items)
--   • commitments (all)
--   • every other profile in B&B + their auth.users row
--   • dependent rows that would otherwise block a profile delete
--     (coaching threads + messages, scorecard + measure entries,
--      strengths teams for those users)
--
-- Nulls out (via ON DELETE SET NULL cascades on the FKs):
--   • sponsor_id on remaining SFAs whose sponsor was deleted
--   • reports_to on Joel if his manager was deleted
--   • accountable_id on functional_areas whose accountable was deleted
--   • leader_id / track_id / decide_id on chart seats
--
-- Run in Supabase SQL editor. The DO block is atomic — if any
-- statement inside raises, the whole block rolls back. On success,
-- Supabase auto-commits. Row counts print via RAISE NOTICE.
-- =============================================================

do $$
declare
  v_company_id uuid;
  v_joel_id    uuid;
  v_count      int;
begin
  select id into v_company_id
    from public.companies
   where name ilike 'B&B Electric%'
   limit 1;
  if v_company_id is null then
    raise exception 'No company matches "B&B Electric%%" — aborting';
  end if;

  select id into v_joel_id
    from public.profiles
   where company_id = v_company_id
     and full_name ilike 'Joel Burger%'
   limit 1;
  if v_joel_id is null then
    raise exception 'No profile matches "Joel Burger%%" in B&B — aborting';
  end if;

  raise notice 'B&B company_id = %', v_company_id;
  raise notice 'Joel profile_id = %', v_joel_id;

  ---------------------------------------------------------------
  -- 1. Commitments (blocks priorities via ON DELETE RESTRICT)
  ---------------------------------------------------------------
  delete from public.commitments where company_id = v_company_id;
  get diagnostics v_count = row_count;
  raise notice 'commitments deleted: %', v_count;

  ---------------------------------------------------------------
  -- 2. Priorities (90-day) — annual_goal_id set null on parent delete
  ---------------------------------------------------------------
  delete from public.priorities where company_id = v_company_id;
  get diagnostics v_count = row_count;
  raise notice 'priorities deleted: %', v_count;

  ---------------------------------------------------------------
  -- 3. Annual goals — sfa_id set null on parent SFA delete
  ---------------------------------------------------------------
  delete from public.annual_goals where company_id = v_company_id;
  get diagnostics v_count = row_count;
  raise notice 'annual_goals deleted: %', v_count;

  ---------------------------------------------------------------
  -- 4. Clear rows that would block a non-Joel profile delete.
  --    These are all restrict-FKs on profiles.id.
  ---------------------------------------------------------------
  -- coaching_messages.created_by is RESTRICT on profiles, so nuke
  -- messages first (cascade from conversations would keep the
  -- restrict FK intact via the created_by column). Simplest safe
  -- move: wipe all coaching data for the company — Joel's threads
  -- about deleted people would be worthless anyway.
  delete from public.coaching_messages
   where conversation_id in (
     select id from public.coaching_conversations
      where company_id = v_company_id
   );
  get diagnostics v_count = row_count;
  raise notice 'coaching_messages deleted: %', v_count;

  delete from public.coaching_conversations
   where company_id = v_company_id;
  get diagnostics v_count = row_count;
  raise notice 'coaching_conversations deleted: %', v_count;

  delete from public.scorecard_entries
   where company_id = v_company_id
     and entered_by <> v_joel_id;
  get diagnostics v_count = row_count;
  raise notice 'scorecard_entries deleted: %', v_count;

  delete from public.success_measure_entries e
   using public.success_measures m,
         public.function_outcomes o,
         public.functions f
   where e.measure_id = m.id
     and m.outcome_id = o.id
     and o.function_id = f.id
     and f.company_id = v_company_id
     and e.entered_by <> v_joel_id;
  get diagnostics v_count = row_count;
  raise notice 'success_measure_entries deleted: %', v_count;

  -- strengths_teams.created_by is RESTRICT. Members + evaluations
  -- cascade off the team row. Wipe all teams for the company.
  delete from public.strengths_teams
   where company_id = v_company_id;
  get diagnostics v_count = row_count;
  raise notice 'strengths_teams deleted: %', v_count;

  ---------------------------------------------------------------
  -- 5. Delete non-Joel auth.users. profiles cascade via auth.
  ---------------------------------------------------------------
  delete from auth.users
   where id in (
     select id from public.profiles
      where company_id = v_company_id
        and id <> v_joel_id
   );
  get diagnostics v_count = row_count;
  raise notice 'auth.users (and their profiles) deleted: %', v_count;

  ---------------------------------------------------------------
  -- Sanity check
  ---------------------------------------------------------------
  select count(*) into v_count
    from public.profiles where company_id = v_company_id;
  raise notice 'profiles remaining in B&B: % (should be 1)', v_count;

  select count(*) into v_count
    from public.strategic_focus_areas where company_id = v_company_id;
  raise notice 'strategic_focus_areas remaining: %', v_count;
end $$;

-- If you see this message with no error above, the deletes committed.
-- To dry-run instead, wrap the DO block in `begin; ... rollback;`.

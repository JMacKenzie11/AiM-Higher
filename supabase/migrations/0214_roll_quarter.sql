-- =============================================================
-- Migration 0214: rolling a quarter, in one transaction
--
-- Closing a quarter and opening the next were two actions, and an
-- unfinished priority belonged to neither afterwards. Closing does
-- not touch its children (0003 says so deliberately), so a priority
-- at 60% kept its status and its quarter_id forever while the new
-- quarter started empty. If the team still wanted that work, somebody
-- retyped it.
--
-- Rolling is now one act: close the open quarter, open the next, and
-- move every priority that is not complete into it.
--
-- ---- WHY THIS IS A FUNCTION AND NOT THREE CALLS ---------------
--
-- Atomicity, and nothing else. PostgREST gives the app no transaction
-- across statements, so three calls from a server action can fail
-- between any two of them. The half-states are all worse than not
-- rolling at all:
--
--   closed, nothing opened     the company has no quarter, and
--                              quarters_one_open means the retry has
--                              to know it already closed one
--   opened, nothing moved      priorities orphaned in a closed
--                              quarter, which is the bug being fixed
--   moved, nothing closed      two quarters holding the same work,
--                              and the unique index prevents the
--                              close ever landing
--
-- A function body is one transaction. Either the whole roll happened
-- or none of it did.
--
-- ---- MOVE, NOT COPY -------------------------------------------
--
-- The priority keeps its id, so every commitment pointing at it stays
-- pointing at it. Copying would split a priority's work across two
-- rows and leave the team looking at a fresh one with none of the
-- history that explains where it got to.
--
-- priorities.quarter_id is `not null references quarters(id) on
-- delete restrict`, so the move is a plain update with no window
-- where a priority belongs to nothing.
--
-- ---- WHAT CARRIES ---------------------------------------------
--
-- Everything except 'complete', which includes 'ongoing'. An ongoing
-- priority is continuing by definition; leaving it behind would be
-- the orphaning this migration exists to end.
--
-- ---- ORDER --------------------------------------------------
--
-- Close before insert, because quarters_one_open is a partial unique
-- index on (company_id) where status = 'open' and the insert would
-- collide with the quarter still open.
-- =============================================================

create or replace function public.roll_quarter(
  p_company_id uuid,
  p_label text,
  p_start_date date,
  p_end_date date
)
returns table (closed_quarter uuid, opened_quarter uuid, moved integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old uuid;
  v_new uuid;
  v_moved integer := 0;
begin
  if v_uid is null then
    raise exception 'roll_quarter requires an authenticated caller';
  end if;

  -- The same set the quarter actions admit: system_admin, the
  -- company's own admin, or somebody assigned to it. is_guide_for
  -- covers assigned guides and portfolio admins.
  if not (
    public.auth_role() = 'system_admin'
    or (
      public.auth_role() = 'company_admin'
      and public.auth_company_id() = p_company_id
    )
    or public.is_guide_for(p_company_id)
  ) then
    raise exception 'roll_quarter: not permitted for this company'
      using errcode = '42501';
  end if;

  if p_label is null or btrim(p_label) = '' then
    raise exception 'roll_quarter: the new quarter needs a label';
  end if;
  if p_start_date is null or p_end_date is null then
    raise exception 'roll_quarter: the new quarter needs both dates';
  end if;
  if p_end_date < p_start_date then
    raise exception 'roll_quarter: the end date cannot come before the start date';
  end if;

  -- There may be none, and that is a normal state rather than an
  -- error: a company whose quarter was never opened, or one rolling
  -- after somebody closed by hand. Then this is simply an open.
  select id into v_old
    from public.quarters
   where company_id = p_company_id and status = 'open';

  if v_old is not null then
    update public.quarters set status = 'closed' where id = v_old;
  end if;

  insert into public.quarters (company_id, label, start_date, end_date, status)
  values (p_company_id, btrim(p_label), p_start_date, p_end_date, 'open')
  returning id into v_new;

  -- The carry-forward. Complete priorities stay where they were
  -- finished, which is what makes the closed quarter an honest record
  -- of what the team actually landed.
  if v_old is not null then
    update public.priorities
       set quarter_id = v_new
     where quarter_id = v_old
       and status <> 'complete';
    get diagnostics v_moved = row_count;
  end if;

  return query select v_old, v_new, v_moved;
end;
$$;

revoke all on function public.roll_quarter(uuid, text, date, date) from public;
revoke all on function public.roll_quarter(uuid, text, date, date) from anon;
revoke all on function public.roll_quarter(uuid, text, date, date) from service_role;
grant execute on function public.roll_quarter(uuid, text, date, date) to authenticated;

comment on function public.roll_quarter(uuid, text, date, date) is
  'Close the open quarter, open the next, and move every priority that is not complete into it. One transaction, because the half-states are each worse than not rolling: a company with no quarter, priorities orphaned in a closed one, or two quarters holding the same work. Moves rather than copies, so commitments keep pointing at the priority they were already attached to.';

-- 0266: a row stays in the company it was created in.
--
-- WHY. Ten update rules check who owns a row and nothing else on the
-- way out. Their USING clause requires the caller's own company (or an
-- assignment to it), but their WITH CHECK is only `owner_id =
-- auth.uid()` (or created_by, sponsor_id, recipient, user_id), so the
-- owner of a row could rewrite its company_id to any other company and
-- the row would land there:
--
--   commitments_update_owner, commitments_claim_unassigned,
--   issues_update_creator, priorities_update_owner,
--   annual_goals_update_owner, sfa_update_owner,
--   coaching_conversations_update, notifications_update,
--   guide_nudges_update, strengths_assessments_update
--
-- Measured on the dev clone before this migration: a commitment and an
-- Aimee conversation moved, as their owner and (for a commitment) as a
-- company admin. On issues, priorities, annual goals and focus areas
-- the move was refused, but only by accident: Postgres checks an
-- updated row against the select rules too, and those tables are read
-- by company, so a row moved out of the caller's company failed that
-- check. Commitments, conversations, notifications, guide nudges and
-- strengths assessments each have a select rule that follows the
-- person, so nothing stopped them.
--
-- Nothing in the app offers it and no row is known to have done it, so
-- the boundary was courtesy rather than structure (the same shape 0209
-- closed for a priority's parent). Found while scoping the outside
-- assistant work (Jason, 2026-10-13).
--
-- WHAT. A trigger on those nine tables refuses any change to
-- company_id made by a signed-in caller, whatever their role. Repeating
-- the company condition in each WITH CHECK would not be enough: a
-- guide or portfolio admin assigned to two companies could still move
-- a row between them, and a policy cannot compare a row with its old
-- self. A trigger can.
--
-- WHO IT DOES NOT STOP. The service role and migrations (current_user
-- is not `authenticated`), so a guarded one-off repair stays possible.
-- No app path changes company_id on these tables; meetings, which ARE
-- re-routed between companies by an admin, are deliberately not in the
-- list.

-- Roles: none. A trigger, not a write rule: it admits no write, it
-- refuses one kind of change for every role acting through a JWT.
create or replace function public.keep_company_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.company_id is distinct from old.company_id
     and current_user = 'authenticated' then
    raise exception 'company_id_fixed: a % row cannot move to another company', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.keep_company_id() from public;

drop trigger if exists commitments_keep_company_id on public.commitments;
create trigger commitments_keep_company_id
  before update of company_id on public.commitments
  for each row execute function public.keep_company_id();

drop trigger if exists issues_keep_company_id on public.issues;
create trigger issues_keep_company_id
  before update of company_id on public.issues
  for each row execute function public.keep_company_id();

drop trigger if exists priorities_keep_company_id on public.priorities;
create trigger priorities_keep_company_id
  before update of company_id on public.priorities
  for each row execute function public.keep_company_id();

drop trigger if exists annual_goals_keep_company_id on public.annual_goals;
create trigger annual_goals_keep_company_id
  before update of company_id on public.annual_goals
  for each row execute function public.keep_company_id();

drop trigger if exists sfa_keep_company_id on public.strategic_focus_areas;
create trigger sfa_keep_company_id
  before update of company_id on public.strategic_focus_areas
  for each row execute function public.keep_company_id();

drop trigger if exists coaching_conversations_keep_company_id on public.coaching_conversations;
create trigger coaching_conversations_keep_company_id
  before update of company_id on public.coaching_conversations
  for each row execute function public.keep_company_id();

drop trigger if exists notifications_keep_company_id on public.notifications;
create trigger notifications_keep_company_id
  before update of company_id on public.notifications
  for each row execute function public.keep_company_id();

drop trigger if exists guide_nudges_keep_company_id on public.guide_nudges;
create trigger guide_nudges_keep_company_id
  before update of company_id on public.guide_nudges
  for each row execute function public.keep_company_id();

drop trigger if exists strengths_assessments_keep_company_id on public.strengths_assessments;
create trigger strengths_assessments_keep_company_id
  before update of company_id on public.strengths_assessments
  for each row execute function public.keep_company_id();

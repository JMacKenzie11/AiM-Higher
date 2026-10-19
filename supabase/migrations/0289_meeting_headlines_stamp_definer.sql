-- 0289: the headline stamp trigger looks functions up with full sight.
--
-- WHY. 0288's stamp_meeting_headline() checks that a headline's
-- function is in the headline's company. It ran as the caller, so for
-- a member writing into another company it could not see that
-- company's functions and refused the row itself (23514). The refusal
-- was right, but it came from the trigger, ahead of the policies, so
-- the policies were never what stopped it and the harness could not
-- tell whether they would. Found by the probe "headlines · one
-- company's own" on the dev clone, before 0288 reached anywhere else.
--
-- WHAT. The same function, security definer. It reads public.functions
-- only to compare one function's company with the row's, and returns
-- nothing to the caller. Who may write where is the policies' to say
-- (0288, unchanged): another company's headline is now refused by
-- them (42501), and a row naming its own company with someone else's
-- function is still refused by this check (23514).

-- Roles: none. Stamps the row; admits nobody.
create or replace function public.stamp_meeting_headline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.functions f
    where f.id = new.function_id and f.company_id = new.company_id
  ) then
    raise exception 'function % is not in company %', new.function_id, new.company_id
      using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.company_id := old.company_id;
    new.function_id := old.function_id;
    new.week_ending := old.week_ending;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.stamp_meeting_headline() from public, anon, authenticated;

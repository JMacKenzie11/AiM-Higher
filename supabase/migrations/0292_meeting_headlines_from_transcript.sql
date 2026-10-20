-- 0292: a headline can come from the meeting's transcript.
--
-- WHY. Jason, 2026-10-20: when a meeting's transcript is analysed,
-- pull each functional area's headline out of it and fill the meeting
-- page's Headlines boxes as best we can (simplification review, change
-- 13, the "transcript-headlines" switch).
--
-- WHAT. meeting_headlines.source_meeting_id: the meeting whose
-- transcript wrote this headline, or null when a person wrote it. The
-- analysis (lib/transcripts/headlines.ts, as the service role) fills
-- only an area with no headline for that week, or an empty one, so it
-- never writes over what someone typed. The meeting page says which
-- ones came from the transcript.
--
-- The stamp trigger keeps the mark honest: a signed-in person's write,
-- insert or edit, always leaves it null. So a person cannot mark their
-- own words as the transcript's, and editing a filled-in headline
-- makes it theirs. Only a write with nobody signed in (the analysis)
-- keeps it.
--
-- WHO READS AND WRITES. Unchanged from 0288: no policy changes, no new
-- grant. The analysis writes as the service role, which RLS does not
-- apply to.
--
-- Harness probe "headlines · only the transcript marks one".

alter table public.meeting_headlines
  add column if not exists source_meeting_id uuid references public.meetings(id) on delete set null;

comment on column public.meeting_headlines.source_meeting_id is
  'The meeting whose transcript wrote this headline; null when a person wrote it. Cleared by any signed-in write (0292).';

-- Roles: none. Stamps the row; admits nobody. As 0289, plus: a write
-- by a signed-in person clears source_meeting_id.
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
  if auth.uid() is not null then
    new.source_meeting_id := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.stamp_meeting_headline() from public, anon, authenticated;

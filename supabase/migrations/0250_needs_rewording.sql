-- 0250: a commitment or an issue that mentions somebody's private life,
-- and could not be reworded without it, carries a mark until someone
-- rewords it.
--
-- WHY. Meeting analysis never drops a commitment or an issue for
-- mentioning somebody's health, family or private situation (Jason,
-- 2026-10-01: "A commitment must never be lost"). It rewords it; when
-- the rewrite still breaks the rule, the item is kept exactly as
-- written and marked needs_rewording in the meeting's record
-- (src/lib/transcripts/redact.ts, #382). This carries the same mark
-- onto the rows the item becomes on the Commitments and Issues pages,
-- so the people who can edit the text see that it needs rewording.
--
-- WHO SETS IT. Whoever creates the row: the analysis pipeline when it
-- creates commitments, and a company admin or assigned guide adding an
-- item from a meeting (src/lib/transcripts/routing-actions.ts), each
-- copying the mark from the meeting's record. No write policy changes:
-- the rows' existing insert rules decide who may create them.
--
-- WHO CLEARS IT. Nobody, directly. It clears when the text it is about
-- changes (a commitment's description, an issue's title), and an update
-- that leaves the text alone keeps it as it was, whatever the update
-- says. The trigger is the only way, so no write path can clear it
-- without rewording, and none can set it on an existing row.

alter table public.commitments
  add column if not exists needs_rewording boolean not null default false;
alter table public.issues
  add column if not exists needs_rewording boolean not null default false;

comment on column public.commitments.needs_rewording is
  'The description mentions somebody''s private life and could not be reworded '
  'automatically. Cleared by the trigger when the description changes (0250).';
comment on column public.issues.needs_rewording is
  'The title mentions somebody''s private life and could not be reworded '
  'automatically. Cleared by the trigger when the title changes (0250).';

-- Roles: none. A trigger, not a write rule: it runs for every role and
-- only ever lowers the mark, when the text changes.
create or replace function public.keep_needs_rewording()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'commitments' then
    new.needs_rewording := case
      when new.description is distinct from old.description then false
      else old.needs_rewording
    end;
  else
    new.needs_rewording := case
      when new.title is distinct from old.title then false
      else old.needs_rewording
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists commitments_keep_needs_rewording on public.commitments;
create trigger commitments_keep_needs_rewording
  before update on public.commitments
  for each row execute function public.keep_needs_rewording();

drop trigger if exists issues_keep_needs_rewording on public.issues;
create trigger issues_keep_needs_rewording
  before update on public.issues
  for each row execute function public.keep_needs_rewording();

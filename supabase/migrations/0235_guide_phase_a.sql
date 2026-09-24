-- =============================================================
-- Migration 0235 — the AiMS Guide, phase A
--
-- One trigger (a meeting's analysis completes), one recipient (the
-- company's AiMS champion), one action (an invitation to debrief).
-- No scheduling, no reminders, no signal-watching.
--
-- ---- THE FINDING THAT SHAPES ALL OF THIS -----------------------
--
-- coach_memories (0194) revokes every privilege from service_role
-- and writes only through record_coach_memory(), which RAISES when
-- auth.uid() is null. A background job has no JWT, so it cannot read
-- or write memory. Not "should not" — cannot.
--
-- So the Guide never converses from a job. It RAISES A NOTIFICATION,
-- and the conversation happens when the champion opens it, under
-- their own session, with memory, tools and RLS behaving normally.
-- Proactive in timing, never in acting without a person. See
-- docs/product-spec.md §14h and the investigation report.
--
-- ---- IDENTIFIERS ONLY ------------------------------------------
--
-- guide_nudges holds a meeting_id and a short headline. No
-- transcript text, no analysis content beyond that line. The row is
-- the Guide's memory of what it raised and what happened, which
-- nothing else can derive; it is not a copy of the meeting.
-- =============================================================

-- ---- 1. The champion -------------------------------------------

alter table public.companies
  add column if not exists aims_champion_profile_id uuid
    references public.profiles(id) on delete set null;

comment on column public.companies.aims_champion_profile_id is
  'The person Aimee works with on this company''s weekly rhythm. '
  'Guide nudges go to them and to nobody else. Null means no nudges '
  'are raised for this company at all, which is a valid state and '
  'the default. Must be a member of this company — enforced by the '
  'trigger below, because a foreign key cannot say it.';

create index if not exists companies_champion_idx
  on public.companies (aims_champion_profile_id)
  where aims_champion_profile_id is not null;

-- A FK proves the profile exists. It cannot prove the profile
-- belongs to THIS company, and a champion from another tenant would
-- be a cross-tenant leak wearing a settings control.
create or replace function public.champion_must_be_a_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  if new.aims_champion_profile_id is null then
    return new;
  end if;
  select company_id into v_company
    from public.profiles
   where id = new.aims_champion_profile_id;
  if v_company is null or v_company <> new.id then
    raise exception 'The AiMS champion must be a member of this company'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists companies_champion_membership on public.companies;
create trigger companies_champion_membership
before insert or update of aims_champion_profile_id on public.companies
for each row execute function public.champion_must_be_a_member();

-- ---- 2. The nudge record ---------------------------------------

create table if not exists public.guide_nudges (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Text rather than an enum: the next phase adds trigger kinds, and
  -- an enum change is a migration on a fleet. The only value this
  -- phase writes is 'meeting_analyzed'.
  trigger_kind text not null,
  meeting_id uuid references public.meetings(id) on delete cascade,
  -- The line shown in the notification. The ONLY analysis content
  -- this row carries.
  headline text not null,
  state text not null default 'pending'
    check (state in ('pending', 'opened', 'dismissed', 'superseded')),
  conversation_id uuid references public.coaching_conversations(id) on delete set null,
  raised_at timestamptz not null default now(),
  opened_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.guide_nudges is
  'What the Guide raised, to whom, and what happened next. Its own '
  'memory: nothing else in the schema can derive whether a leader was '
  'invited to debrief and whether they took it up. Identifiers and a '
  'headline only — never transcript or analysis content.';

-- The hot path is "this person's pending nudges, newest first".
create index if not exists guide_nudges_recipient_idx
  on public.guide_nudges (recipient_profile_id, raised_at desc);
-- And the supersede sweep: this company's pending ones.
create index if not exists guide_nudges_company_pending_idx
  on public.guide_nudges (company_id, state)
  where state = 'pending';

alter table public.guide_nudges enable row level security;
alter table public.guide_nudges force row level security;

-- ---- 3. RLS, Form D throughout ---------------------------------

drop policy if exists guide_nudges_select on public.guide_nudges;
create policy guide_nudges_select on public.guide_nudges
for select to authenticated
using (
  recipient_profile_id = (select auth.uid())
  or (select public.auth_role()) = 'system_admin'
  or (select public.is_admin_for(company_id))
);

-- The recipient moves their own nudge between states — opened when
-- they start the debrief, dismissed when they wave it away. Nothing
-- else about the row is theirs to change, and the WITH CHECK keeps
-- them from handing it to somebody else.
drop policy if exists guide_nudges_update on public.guide_nudges;
create policy guide_nudges_update on public.guide_nudges
for update to authenticated
using (recipient_profile_id = (select auth.uid()))
with check (recipient_profile_id = (select auth.uid()));

-- INSERT: no policy, and the verb withheld. Every row arrives from
-- the analysis hook through the admin client, exactly as
-- notifications do (0152): "authenticated users must never be able
-- to create notifications for anyone (including themselves), which
-- shuts down the entire spam vector." A nudge somebody can forge is
-- a message from Aimee somebody can forge.
--
-- E8: the verb is REVOKED, not merely left without a policy. A
-- policy-shaped absence is weaker than a privilege-shaped one.
revoke all on public.guide_nudges from public;
revoke all on public.guide_nudges from anon;
revoke all on public.guide_nudges from authenticated;

grant select, update on public.guide_nudges to authenticated;
-- service_role keeps its default access for the hook; no DELETE for
-- anybody, because a nudge that was raised stays raised. Ignoring
-- one is a state, not an erasure.

-- ---- 4. An empty seat is better than a stale one ---------------
--
-- A champion who is deactivated, or moved to another company, stops
-- being the right recipient the moment it happens. Left alone, the
-- seat still names them: nudges would be raised for somebody who
-- cannot sign in, sit pending forever, and read in the measurement
-- as a champion ignoring their invitations.
--
-- ---- WHY A TRIGGER AND NOT A LINE IN THE ACTION ----------------
--
-- "In the same operation" is the requirement, and a trigger is the
-- only place that is literally true. There is more than one path to
-- deactivation — the roster menu, a delete, a future import — and a
-- rule enforced in one of them is a rule the next one forgets. This
-- one cannot be routed around.
--
-- It also NOTIFIES the company admins, because a silently empty
-- seat produces a company that quietly stops hearing from Aimee and
-- nobody knowing why. Written through the same table the Guide uses,
-- by a definer function, since no user role may insert a
-- notification (0152).

create or replace function public.clear_champion_when_member_leaves()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_company_name text;
begin
  -- Only when this person actually stops being an active member of
  -- the company whose seat they hold.
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.company_id is not distinct from old.company_id then
    return new;
  end if;

  select id, name into v_company, v_company_name
    from public.companies
   where aims_champion_profile_id = old.id;
  if v_company is null then
    return coalesce(new, old);
  end if;

  -- Still active and still here: nothing to do.
  if tg_op = 'UPDATE'
     and new.status <> 'inactive'
     and new.company_id is not distinct from v_company then
    return new;
  end if;

  update public.companies
     set aims_champion_profile_id = null
   where id = v_company;

  insert into public.notifications
    (recipient_id, company_id, kind, eyebrow, title, href)
  select p.id,
         v_company,
         'champion-empty',
         'AiMS champion',
         'The AiMS champion seat is empty, so Aimee is not sending ' ||
           'weekly nudges. Choose someone in company settings.',
         '/admin/companies/' || v_company::text
    from public.profiles p
   where p.company_id = v_company
     and p.role = 'company_admin'
     and p.status = 'active';

  return coalesce(new, old);
end;
$$;

-- BEFORE, not AFTER, and the delete case is why.
--
-- The column is `on delete set null`, so on a DELETE the foreign
-- key empties the seat first and an AFTER trigger finds no company
-- holding this person. The seat still ends up empty — but the
-- notification is never raised, and the company quietly stops
-- hearing from Aimee with nothing on screen saying why. That is the
-- exact failure this trigger exists to prevent, surviving inside
-- the fix for it. Found by the harness probe below, which reported
-- "company admins notified: 0" beside a green tick.
drop trigger if exists profiles_clear_champion on public.profiles;
create trigger profiles_clear_champion
before update or delete on public.profiles
for each row execute function public.clear_champion_when_member_leaves();

comment on function public.clear_champion_when_member_leaves() is
  'Empties a company''s AiMS champion seat when that person is '
  'deactivated, moved to another company or deleted, and tells the '
  'company admins the seat is empty. A stale seat sends nudges to '
  'somebody who cannot read them and reads as an ignored invitation.';

-- ---- 5. A conversation knows which meeting it is about ---------
--
-- Mirrors revising_role_id (0224) exactly, and for the same reason:
-- the debrief is a NEW conversation, opened from a notification, and
-- nothing else on the row would say which meeting it came from. The
-- agent's one tool reads this column to fetch the analysis, so an
-- unpinned debrief has nothing to talk about.
--
-- ON DELETE set null: deleting a meeting should not take the
-- conversation about it away. The chat stays the champion's record
-- of their own thinking; it simply stops pointing at a meeting.
--
-- RLS is unchanged, per 0224: a person who can open the
-- conversation was already trusted with everything in it.

alter table public.coaching_conversations
  add column if not exists debriefing_meeting_id uuid
    references public.meetings(id) on delete set null;

create index if not exists coaching_conversations_debriefing_meeting_idx
  on public.coaching_conversations (debriefing_meeting_id)
  where debriefing_meeting_id is not null;

-- ---- 6. The agent itself ---------------------------------------
--
-- Seeded as a row so the Hub can edit its title, description and
-- prompt without a deploy, exactly like the other six. The registry
-- entry in src/lib/practices/registry.ts carries the code-side
-- defaults; this row carries identity and access.
--
-- ACCESS, and the one thing worth reading twice:
--
--   allowed_roles     company_admin, system_admin, aims_guide
--   access_predicates aims_champion
--
-- The predicate WIDENS. The champion is frequently a team_member,
-- and no list of platform roles can name "the person who runs the
-- rhythm here" — so the seat is named as a relationship, the way
-- function_lead is. It does not narrow the roles beside it: a
-- company_admin reaches the debrief whether or not they hold the
-- seat, because they can already read the meeting it is about. The
-- seat routes Aimee's attention; it is not an access boundary.

insert into public.agents
  (slug, category_id, title, description, sort_order,
   allowed_roles, access_predicates)
select v.slug, c.id, v.title, v.description,
       coalesce(
         (select max(sort_order) + 1 from public.agents a
           where a.category_id = c.id),
         0),
       v.allowed_roles, v.access_predicates
from (
  values (
    'guide-meeting-debrief',
    'facilitation',
    'Debrief a meeting',
    'Talk through what the last leadership meeting showed about how the team is working, and decide what to carry into the next one.',
    '{company_admin,system_admin,aims_guide}'::text[],
    '{aims_champion}'::text[]
  )
) as v(slug, category_slug, title, description,
       allowed_roles, access_predicates)
join public.agent_categories c on c.slug = v.category_slug
on conflict (slug) do nothing;

-- ---- 7. Who may name the champion ------------------------------
--
-- The company's own admins, and the guides who stand in for them.
--
-- This is a ROLE WIDENING and it ships with its probe, per the
-- convention. Until now a company_admin could change exactly one
-- column on their own company — `industry` (0176) — and the guard
-- below is a denylist for them precisely so a column added later is
-- refused until somebody decides otherwise. This is that decision.
--
-- ---- WHY IT IS THEIRS ------------------------------------------
--
-- The seat names the person who runs the meeting rhythm. It is not
-- a permission: holding it grants nothing that the company's admins
-- do not already have, and losing it takes nothing away. It routes
-- where Aimee's weekly nudge goes. A system_admin picking that for
-- a tenant they have never met is the wrong shape, and a support
-- request to change it is a worse one.
--
-- portfolio_admin is NOT added. Their branch is an allowlist of
-- four container columns and this is not a container column; the
-- role widens over packaging and never over a company's rhythm.
-- The closed list in CLAUDE.md is untouched either way: this grants
-- no new write policy to portfolio_admin anywhere.
--
-- The membership trigger in section 1 still applies on top, so the
-- widening cannot be used to point the seat at somebody in another
-- company.

create or replace function public.companies_restrict_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  caller_role := (select public.auth_role());

  -- The container role: five named columns, everything else refused.
  -- Unchanged from 0203, INCLUDING the omission of the champion
  -- seat. Packaging is theirs; the rhythm is not.
  if caller_role is not distinct from 'portfolio_admin' then
    if (to_jsonb(new) - 'name' - 'timezone' - 'industry' - 'status'
                      - 'sort_order' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'name' - 'timezone' - 'industry' - 'status'
                      - 'sort_order' - 'updated_at') then
      raise exception
        'A portfolio_admin may change only name, timezone, industry, status and sort_order on a company (attempted on company %)',
        old.id
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  if caller_role is distinct from 'company_admin'
     and caller_role is distinct from 'aims_guide' then
    return new;
  end if;

  -- 0176 plus the champion seat, and still not sort_order. Still a
  -- denylist: a column added to companies tomorrow is refused to
  -- these two the day it is added, which is the property worth
  -- keeping.
  if (to_jsonb(new) - 'industry' - 'aims_champion_profile_id' - 'updated_at')
     is distinct from
     (to_jsonb(old) - 'industry' - 'aims_champion_profile_id' - 'updated_at') then
    raise exception
      'Only industry and the AiMS champion may be changed on a company by a % (attempted on company %)',
      caller_role, old.id
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- The first draft of this section rebuilt the function from 0192's
-- body and silently dropped `sort_order`, which 0203 had added.
-- Nothing in the diff said so — it was a faithful copy of a file
-- that had been superseded. The harness said so: company-sort-order
-- went red on the run that applied it. Kept here because the next
-- person to `create or replace` a function in this schema will be
-- copying from somewhere too, and the lesson is to copy from the
-- LAST definition rather than the one the comments point at.

-- ---- 8. Is anybody taking these up? ----------------------------
--
-- The one question Phase A exists to answer. A Guide that raises
-- invitations nobody opens is worse than no Guide: it trains people
-- to ignore the notification bar, which the overdue-commitment
-- reminders also live in.
--
-- ---- ZERO OPENS IS NOT NO NUDGES -------------------------------
--
-- The distinction the shape is built around. A company with no row
-- for a week raised nothing that week — the champion seat is empty,
-- or no meeting was analysed. A company with `raised = 3, opened =
-- 0` was invited three times and declined to come. Those two look
-- identical in any count that starts from companies and joins
-- nudges, so this starts from the NUDGES and a week with none
-- simply has no row.
--
-- Weeks are Monday-based (date_trunc('week')) in UTC. The company's
-- own timezone would be more correct and is not worth the join: a
-- nudge landing on the far side of a Monday midnight moves one
-- weekly total by one, and nothing here is read to that precision.
--
-- A VIEW, not a table. Everything it reports is already in
-- guide_nudges; a second copy would be a second thing to keep true.

create or replace view public.guide_nudge_weekly as
select
  n.company_id,
  date_trunc('week', n.raised_at)::date as week_starting,
  count(*) as raised,
  count(*) filter (where n.state = 'opened') as opened,
  count(*) filter (where n.state = 'dismissed') as dismissed,
  count(*) filter (where n.state = 'superseded') as superseded,
  count(*) filter (where n.state = 'pending') as still_pending
from public.guide_nudges n
group by n.company_id, date_trunc('week', n.raised_at)::date;

comment on view public.guide_nudge_weekly is
  'Per company per week: how many nudges the Guide raised and what '
  'happened to them. A week with no row raised nothing; a week with '
  'raised > 0 and opened = 0 was invited and did not come. Those are '
  'different answers and the shape keeps them apart.';

-- security_invoker so the view is read under the caller's own
-- policies rather than its owner's. Without it a view over an
-- RLS-protected table is a hole in that table's RLS, and this one
-- would let any authenticated user count another company's nudges.
alter view public.guide_nudge_weekly set (security_invoker = on);

grant select on public.guide_nudge_weekly to authenticated;

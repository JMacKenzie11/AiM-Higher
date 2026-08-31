-- =============================================================
-- Migration 0155: archive coaching_conversations when the owning
-- company is soft-deleted, and backfill existing orphans.
--
-- The situation this closes: a sysadmin creates a chat while
-- scoped to Company X, then Company X gets deleted. The chat's
-- company_id still points at X (FK isn't nullified) but X is
-- hidden by the companies_hide_deleted RLS policy. The chat now
-- has no members visible in the share picker, and any surface
-- filtered by "chats belonging to companies you can see" would
-- treat it as an orphan.
--
-- Fix: on soft-delete of a company, mark all of its
-- coaching_conversations as archived. Archived rows already get
-- filtered out of /ask-aimee lists and the coach-insights slice
-- unless includeArchived is opted in, so this is enough to keep
-- them out of the way without dropping any data.
--
-- Runs both directions: a trigger for future deletes, and a
-- one-time UPDATE for chats that were already stranded before
-- this migration.
-- =============================================================

-- ---- Backfill existing orphans -----------------------------
update public.coaching_conversations
   set archived = true
 where archived = false
   and company_id in (
     select id from public.companies where deleted_at is not null
   );

-- ---- Trigger for future soft-deletes -----------------------
-- Fires only on the null → non-null transition so a repeated
-- update (e.g. touch to the same timestamp) doesn't re-run the
-- child update. SECURITY DEFINER so it can bypass RLS on the
-- child table — the caller has already passed the sysadmin gate
-- in deleteCompanyAction, and this trigger is only reachable
-- via that write path (companies.deleted_at is admin-only).
create or replace function public.archive_convos_on_company_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deleted_at is not null
     and (old.deleted_at is null or old.deleted_at <> new.deleted_at)
  then
    update public.coaching_conversations
       set archived = true
     where company_id = new.id
       and archived = false;
  end if;
  return new;
end;
$$;

revoke all on function public.archive_convos_on_company_soft_delete() from public;

drop trigger if exists companies_archive_convos_on_soft_delete on public.companies;
create trigger companies_archive_convos_on_soft_delete
  after update of deleted_at on public.companies
  for each row execute function public.archive_convos_on_company_soft_delete();

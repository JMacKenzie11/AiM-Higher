-- =============================================================
-- Migration 0148: Company soft delete
--
-- Adds public.companies.deleted_at (nullable timestamp). Rows with
-- a non-null deleted_at are hidden from every SELECT via a
-- RESTRICTIVE RLS policy, so we don't have to sweep dozens of
-- query sites app-wide — the row simply disappears everywhere.
--
-- The delete is a two-step: a company must be archived first
-- (setCompanyStatusAction), then soft-deleted (deleteCompanyAction).
-- Nothing under the company is touched — profiles, functions,
-- commitments, meetings, transcripts, coaching conversations all
-- stay in place. If you ever want to un-delete, clear deleted_at
-- directly in SQL. No user-facing recovery UI in this build.
-- =============================================================

alter table public.companies
  add column if not exists deleted_at timestamptz;

comment on column public.companies.deleted_at is
  'Soft-delete timestamp. Non-null rows are hidden from every UI via the companies_hide_deleted RLS policy. Archive a company (status=archived) before soft-deleting.';

-- Restrictive policies AND with the existing permissive ones, so
-- companies_select (system_admin all, others own company) still
-- decides WHO sees rows and this new policy adds the "and it must
-- not be soft-deleted" gate on top. Applies to every authenticated
-- caller including admins — deleted companies are meant to be gone
-- from the UI, not merely hidden from ordinary users.
drop policy if exists companies_hide_deleted on public.companies;
create policy companies_hide_deleted on public.companies
as restrictive
for select to authenticated
using (deleted_at is null);

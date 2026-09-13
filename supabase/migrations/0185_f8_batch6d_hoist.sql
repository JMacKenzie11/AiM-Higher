-- =============================================================
-- Migration 0185: F8 batch 6d — classroom.
--
-- Eighteen policies across classroom_categories, classroom_lessons,
-- classroom_tags, classroom_trainings, classroom_attachments and
-- classroom_lesson_tags. The _guide policies are untouched, as are
-- the two select policies that never called auth_profile()
-- (attachments and lesson_tags read through their parent alone).
--
-- Classroom is PLATFORM CONTENT, not tenant data: no table here has a
-- company_id. Writes are system_admin only. Reads are gated on the
-- CALLER's company holding the 'classroom' entitlement, which makes
-- every predicate here caller-only and fully hoistable — the first
-- batch where that is true of the whole table group.
--
-- THE 6c LESSON APPLIES AND IS ALREADY HANDLED. These are the same
-- shape as strengths_items: a gate on the caller's own company rather
-- than the row's, which is where a naive hoist turns deny into allow
-- for a caller with no profile row. It is safe here without adding
-- anything, because the original already leads with
-- `ap.company_id IS NOT NULL` — and `NULL is not null` is false, so
-- the profile-less caller is denied by the guard that is already
-- there. Transcribed unchanged; the deleted-user case proves it per
-- table rather than taking this paragraph's word for it.
--
-- THE published GUARDS ARE PRESERVED. A lesson or training that is
-- not published is invisible to everyone except system_admin, and on
-- trainings the guard applies twice: the training must be published
-- AND its lesson must be. Those are row-state conditions inside the
-- non-admin branch, not part of the tenant predicate, and they are
-- transcribed exactly.
-- =============================================================

-- ---- classroom_categories ----------------------------

drop policy if exists classroom_categories_select on public.classroom_categories;
create policy classroom_categories_select on public.classroom_categories
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and public.company_has_feature((select public.auth_company_id()), 'classroom')
  )
);

drop policy if exists classroom_categories_insert on public.classroom_categories;
create policy classroom_categories_insert on public.classroom_categories
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
);

drop policy if exists classroom_categories_update on public.classroom_categories;
create policy classroom_categories_update on public.classroom_categories
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
)
with check (
  (select public.auth_role()) = 'system_admin'
);

drop policy if exists classroom_categories_delete on public.classroom_categories;
create policy classroom_categories_delete on public.classroom_categories
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
);

-- ---- classroom_tags ----------------------------------

drop policy if exists classroom_tags_select on public.classroom_tags;
create policy classroom_tags_select on public.classroom_tags
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and public.company_has_feature((select public.auth_company_id()), 'classroom')
  )
);

drop policy if exists classroom_tags_insert on public.classroom_tags;
create policy classroom_tags_insert on public.classroom_tags
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
);

drop policy if exists classroom_tags_update on public.classroom_tags;
create policy classroom_tags_update on public.classroom_tags
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
)
with check (
  (select public.auth_role()) = 'system_admin'
);

drop policy if exists classroom_tags_delete on public.classroom_tags;
create policy classroom_tags_delete on public.classroom_tags
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
);

-- ---- classroom_lessons -------------------------------

drop policy if exists classroom_lessons_select on public.classroom_lessons;
create policy classroom_lessons_select on public.classroom_lessons
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and public.company_has_feature((select public.auth_company_id()), 'classroom')
    and public.classroom_lessons.published = true
  )
);

drop policy if exists classroom_lessons_insert on public.classroom_lessons;
create policy classroom_lessons_insert on public.classroom_lessons
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
);

drop policy if exists classroom_lessons_update on public.classroom_lessons;
create policy classroom_lessons_update on public.classroom_lessons
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
)
with check (
  (select public.auth_role()) = 'system_admin'
);

drop policy if exists classroom_lessons_delete on public.classroom_lessons;
create policy classroom_lessons_delete on public.classroom_lessons
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
);

-- ---- classroom_trainings -----------------------------

drop policy if exists classroom_trainings_select on public.classroom_trainings;
create policy classroom_trainings_select on public.classroom_trainings
for select to authenticated
using (
  (select public.auth_role()) = 'system_admin'
  or (
    (select public.auth_company_id()) is not null
    and public.company_has_feature((select public.auth_company_id()), 'classroom')
    and public.classroom_trainings.published = true
    and exists (
      select 1 from public.classroom_lessons l
      where l.id = public.classroom_trainings.lesson_id
        and l.published = true
    )
  )
);

drop policy if exists classroom_trainings_insert on public.classroom_trainings;
create policy classroom_trainings_insert on public.classroom_trainings
for insert to authenticated
with check (
  (select public.auth_role()) = 'system_admin'
);

drop policy if exists classroom_trainings_update on public.classroom_trainings;
create policy classroom_trainings_update on public.classroom_trainings
for update to authenticated
using (
  (select public.auth_role()) = 'system_admin'
)
with check (
  (select public.auth_role()) = 'system_admin'
);

drop policy if exists classroom_trainings_delete on public.classroom_trainings;
create policy classroom_trainings_delete on public.classroom_trainings
for delete to authenticated
using (
  (select public.auth_role()) = 'system_admin'
);

-- ---- classroom_attachments, classroom_lesson_tags -------------

drop policy if exists classroom_attachments_write on public.classroom_attachments;
create policy classroom_attachments_write on public.classroom_attachments
for all to authenticated
using (
  (select public.auth_role()) = 'system_admin'
)
with check (
  (select public.auth_role()) = 'system_admin'
);

drop policy if exists classroom_lesson_tags_write on public.classroom_lesson_tags;
create policy classroom_lesson_tags_write on public.classroom_lesson_tags
for all to authenticated
using (
  (select public.auth_role()) = 'system_admin'
)
with check (
  (select public.auth_role()) = 'system_admin'
);

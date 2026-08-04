-- =============================================================
-- Migration 0120: Classroom
--
-- A shared training library. Content is authored centrally by
-- system_admins and read by all authenticated members of a company
-- that has the 'classroom' feature. There's no per-company copy —
-- one lesson row is visible to every flag-enabled company.
--
-- Model:
--   * classroom_categories — single-select taxonomy on lessons.
--   * classroom_tags       — many-select taxonomy on lessons.
--   * classroom_lessons    — top-level content unit; belongs to a
--                            category; groups ordered trainings.
--   * classroom_lesson_tags — m2m between lessons and tags.
--   * classroom_trainings  — the actual video + rich text + slug.
--                            Slug is stable (never generated from
--                            title) so coaching/Aimee links survive
--                            renames and re-orgs.
--   * classroom_attachments — files hanging off a training.
--
-- RLS: system_admin has full read/write on every classroom_* table.
-- Other authenticated users have read-only, and only when:
--   * their company has 'classroom' in company_features, AND
--   * the row is published = true.
--
-- Storage: a private bucket classroom-attachments. Downloads happen
-- through server-generated signed URLs (see attachments loader in
-- src/lib/classroom/) so the same publication gate applies.
-- =============================================================

-- ---- Categories -----------------------------------------------

create table public.classroom_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index classroom_categories_sort_idx
  on public.classroom_categories (sort_order);

-- ---- Tags -----------------------------------------------------

create table public.classroom_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

-- ---- Lessons --------------------------------------------------

create table public.classroom_lessons (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.classroom_categories(id) on delete set null,
  title text not null,
  slug text not null unique,
  description text,
  sort_order integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index classroom_lessons_category_idx
  on public.classroom_lessons (category_id, sort_order);
create index classroom_lessons_published_idx
  on public.classroom_lessons (published);

-- ---- Lesson tags (m2m) ---------------------------------------

create table public.classroom_lesson_tags (
  lesson_id uuid not null references public.classroom_lessons(id) on delete cascade,
  tag_id uuid not null references public.classroom_tags(id) on delete cascade,
  primary key (lesson_id, tag_id)
);

create index classroom_lesson_tags_tag_idx
  on public.classroom_lesson_tags (tag_id);

-- ---- Trainings -----------------------------------------------

create table public.classroom_trainings (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.classroom_lessons(id) on delete cascade,
  title text not null,
  slug text not null unique,
  video_provider text not null check (video_provider in ('youtube','vimeo')),
  video_id text not null,
  video_url text not null,
  thumbnail_url text,
  -- TipTap JSON. Rendered server-side via @tiptap/html so the
  -- editor bundle never ships to consumers.
  body_json jsonb,
  sort_order integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index classroom_trainings_lesson_idx
  on public.classroom_trainings (lesson_id, sort_order);
create index classroom_trainings_published_idx
  on public.classroom_trainings (published);

-- ---- Attachments ---------------------------------------------

create table public.classroom_attachments (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references public.classroom_trainings(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  mime_type text,
  file_size bigint,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index classroom_attachments_training_idx
  on public.classroom_attachments (training_id, sort_order);

-- ============================================================
-- RLS
-- ============================================================

alter table public.classroom_categories     enable row level security;
alter table public.classroom_tags           enable row level security;
alter table public.classroom_lessons        enable row level security;
alter table public.classroom_lesson_tags    enable row level security;
alter table public.classroom_trainings      enable row level security;
alter table public.classroom_attachments    enable row level security;

alter table public.classroom_categories     force row level security;
alter table public.classroom_tags           force row level security;
alter table public.classroom_lessons        force row level security;
alter table public.classroom_lesson_tags    force row level security;
alter table public.classroom_trainings      force row level security;
alter table public.classroom_attachments    force row level security;

-- ---- Categories: sysadmin write; flag-enabled companies read ----

create policy classroom_categories_select on public.classroom_categories
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.company_id is not null
         and public.company_has_feature(ap.company_id, 'classroom')
       )
  )
);

create policy classroom_categories_insert on public.classroom_categories
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy classroom_categories_update on public.classroom_categories
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy classroom_categories_delete on public.classroom_categories
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

-- ---- Tags: same shape as categories ----

create policy classroom_tags_select on public.classroom_tags
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.company_id is not null
         and public.company_has_feature(ap.company_id, 'classroom')
       )
  )
);

create policy classroom_tags_insert on public.classroom_tags
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy classroom_tags_update on public.classroom_tags
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy classroom_tags_delete on public.classroom_tags
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

-- ---- Lessons: sysadmin sees all; consumers see published only ----

create policy classroom_lessons_select on public.classroom_lessons
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.company_id is not null
         and public.company_has_feature(ap.company_id, 'classroom')
         and public.classroom_lessons.published = true
       )
  )
);

create policy classroom_lessons_insert on public.classroom_lessons
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy classroom_lessons_update on public.classroom_lessons
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy classroom_lessons_delete on public.classroom_lessons
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

-- ---- Lesson tags: same visibility as their lesson ----

create policy classroom_lesson_tags_select on public.classroom_lesson_tags
for select to authenticated
using (
  exists (
    select 1 from public.classroom_lessons l
    where l.id = public.classroom_lesson_tags.lesson_id
    -- The lessons policy already gates by role + feature + published;
    -- if the caller can see the lesson, they can see its tags.
  )
);

create policy classroom_lesson_tags_write on public.classroom_lesson_tags
for all to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

-- ---- Trainings: sysadmin all; consumers only published trainings
-- ---- whose parent lesson is also published ----

create policy classroom_trainings_select on public.classroom_trainings
for select to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.company_id is not null
         and public.company_has_feature(ap.company_id, 'classroom')
         and public.classroom_trainings.published = true
         and exists (
           select 1 from public.classroom_lessons l
           where l.id = public.classroom_trainings.lesson_id
             and l.published = true
         )
       )
  )
);

create policy classroom_trainings_insert on public.classroom_trainings
for insert to authenticated
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy classroom_trainings_update on public.classroom_trainings
for update to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

create policy classroom_trainings_delete on public.classroom_trainings
for delete to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

-- ---- Attachments: same shape as trainings ----

create policy classroom_attachments_select on public.classroom_attachments
for select to authenticated
using (
  exists (
    select 1 from public.classroom_trainings t
    where t.id = public.classroom_attachments.training_id
    -- Delegates to the trainings policy above.
  )
);

create policy classroom_attachments_write on public.classroom_attachments
for all to authenticated
using (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
)
with check (
  exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

-- ============================================================
-- Storage bucket for attachments
-- ============================================================

-- Private bucket — no public read. Downloads happen through
-- signed URLs generated server-side by
-- src/lib/classroom/attachments.ts, which enforces feature + auth
-- before signing.
insert into storage.buckets (id, name, public)
values ('classroom-attachments', 'classroom-attachments', false)
on conflict (id) do nothing;

-- Read policy on storage.objects for this bucket. Same rule as the
-- classroom_attachments read policy: sysadmin OR flag-enabled
-- authenticated company member. The signed-URL flow doesn't strictly
-- need this (signed URLs bypass RLS), but keeping it defensive means
-- a leaked object path can't be fetched by a caller from a company
-- that shouldn't see the classroom at all.
create policy classroom_attachments_bucket_read on storage.objects
for select to authenticated
using (
  bucket_id = 'classroom-attachments'
  and exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
       or (
         ap.company_id is not null
         and public.company_has_feature(ap.company_id, 'classroom')
       )
  )
);

create policy classroom_attachments_bucket_write on storage.objects
for all to authenticated
using (
  bucket_id = 'classroom-attachments'
  and exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
)
with check (
  bucket_id = 'classroom-attachments'
  and exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

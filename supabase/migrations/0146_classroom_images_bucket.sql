-- =============================================================
-- Migration 0146: Classroom images bucket
--
-- Adds a public storage bucket for inline images embedded in
-- classroom_trainings.body_json. Unlike classroom-attachments
-- (private + signed URLs), these images live in the section body
-- as durable <img src="..."> URLs — signed URLs would expire
-- during a reader session and break the render. Public is the
-- right shape: the URLs are already discoverable to anyone with
-- Classroom enabled, and knowing an image URL grants no other
-- access.
--
-- Writes are still sysadmin-only. Uploads go through the server
-- action uploadClassroomImageAction which enforces role, mime,
-- and size before touching storage.
-- =============================================================

insert into storage.buckets (id, name, public)
values ('classroom-images', 'classroom-images', true)
on conflict (id) do update set public = excluded.public;

-- Public read is implicit for a public bucket, but define an
-- explicit write policy so only sysadmins can upload/replace/
-- delete. Storage RLS is a defence-in-depth layer over the
-- role check in the server action.
create policy classroom_images_bucket_write on storage.objects
for all to authenticated
using (
  bucket_id = 'classroom-images'
  and exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
)
with check (
  bucket_id = 'classroom-images'
  and exists (
    select 1 from public.auth_profile() ap
    where ap.role = 'system_admin'
  )
);

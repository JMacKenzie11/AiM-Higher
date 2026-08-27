-- =============================================================
-- Migration 0147: Profile avatars
--
-- Adds an avatar_url column to public.profiles and a public
-- storage bucket profile-avatars for uploaded images.
--
-- Storage layout: profile-avatars/<user_id>/<uuid>.<ext>. Writes
-- are gated so an authenticated caller can only touch objects
-- under their OWN user_id prefix; system_admin can touch any.
-- The public bucket serves durable <img src="..."> URLs — avatars
-- appear in the sidebar and on profile pages across sessions, so
-- signed URLs (which would expire) are wrong here.
-- =============================================================

alter table public.profiles
  add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('profile-avatars', 'profile-avatars', true)
on conflict (id) do update set public = excluded.public;

-- Writes: the first path segment must be the caller's user_id.
-- system_admin bypasses the prefix check so an admin can fix a
-- misuploaded avatar without impersonating.
create policy profile_avatars_bucket_write on storage.objects
for all to authenticated
using (
  bucket_id = 'profile-avatars'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.auth_profile() ap
      where ap.role = 'system_admin'
    )
  )
)
with check (
  bucket_id = 'profile-avatars'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (
      select 1 from public.auth_profile() ap
      where ap.role = 'system_admin'
    )
  )
);

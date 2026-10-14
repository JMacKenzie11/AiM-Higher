-- 0277: drop the retired Track and Decide seat columns.
--
-- WHY. Jason, 2026-10-14: Lead, Track and Decide are one seat, the
-- function's Lead. 0274 took track_id out of the measure-value rules and
-- the app stopped reading and writing both columns in the same release.
-- That release is live on every instance (0274 applied and deployed,
-- 2026-10-14), so nothing running selects them any more. This is Step 2.
--
-- WHAT. functions.track_id and functions.decide_id go, and with them
-- their indexes (functions_track_idx, functions_decide_idx, 0020) and
-- their foreign keys to profiles. Nothing else depends on them: no
-- policy, view, function or trigger (checked on the dev clone with
-- pg_depend before writing this). The few values they held were seed
-- data in Meridian Construction Group; the Lead of each function is
-- untouched.
--
-- No CASCADE, on purpose: if anything new had come to depend on either
-- column, this fails instead of silently dropping it.

drop index if exists public.functions_track_idx;
drop index if exists public.functions_decide_idx;

alter table public.functions drop column if exists track_id;
alter table public.functions drop column if exists decide_id;

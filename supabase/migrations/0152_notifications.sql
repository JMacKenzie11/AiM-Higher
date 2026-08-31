-- =============================================================
-- Migration 0151: event-based notifications.
--
-- Persistent counterpart to the state-derived triggers already in
-- lib/notifications/service.ts (overdue commitments, Friday
-- metrics). State-derived triggers can't represent "someone did X
-- to you" — once it happens, the state that caused it isn't
-- durable. Events are.
--
-- Shape:
--   * `kind` is an open-schema discriminator so new event types
--     drop in without another migration (chat_shared today;
--     meeting_analysis_ready, assignment_new, coach_reply etc.
--     later). No CHECK constraint on it for the same reason the
--     company_features column is open-schema.
--   * `payload jsonb` carries the kind-specific fields the header
--     might one day want (sender name, from/to access, etc.).
--     Rendering fields (`eyebrow`, `title`, `href`) are extracted
--     so the header can render without parsing payload.
--   * One-shot dismissal: `read_at` timestamp, single semantic
--     lifecycle. No re-fire, no "unread revival". The header
--     shows unread items; clicking marks read.
--
-- Insert boundary:
--   RLS forbids INSERT to `authenticated`. All inserts happen
--   from server code via the admin client — see
--   insertNotification() in lib/notifications/service.ts. This
--   prevents user-to-user spam entirely: even a malicious client
--   with a valid JWT cannot fabricate a notification for another
--   user because RLS blocks it before it reaches a policy check.
-- =============================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id)  on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  href text not null,
  eyebrow text,
  title text not null,
  read_at timestamptz,
  -- Who caused the event. Nullable so system-generated events
  -- (Friday reminders once persisted, meeting analysis complete)
  -- don't need to invent an actor.
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The bell's hot path is "unread items for this user, newest first".
-- Partial index lets that answer come from index alone without
-- touching read rows (which will dominate volume over time).
create index notifications_recipient_unread_idx
  on public.notifications (recipient_id, created_at desc)
  where read_at is null;

-- Full-history index for a future "all notifications" tray view.
-- Cheap to keep now; expensive to add later once volume grows.
create index notifications_recipient_all_idx
  on public.notifications (recipient_id, created_at desc);

-- ---- RLS -----------------------------------------------------
alter table public.notifications enable row level security;
alter table public.notifications force row level security;

-- SELECT: strictly the recipient. No admin peek, no manager peek.
-- If you didn't receive it, you can't see it.
create policy notifications_select on public.notifications
for select to authenticated
using (recipient_id = auth.uid());

-- UPDATE: recipient toggles read_at. WITH CHECK re-asserts
-- recipient_id so a hand-crafted UPDATE can't reassign a row to
-- someone else.
create policy notifications_update on public.notifications
for update to authenticated
using (recipient_id = auth.uid())
with check (recipient_id = auth.uid());

-- DELETE: recipient can clear a row (e.g., a future "clear all"
-- button). Owner-only; no admin cleanup path through RLS.
create policy notifications_delete on public.notifications
for delete to authenticated
using (recipient_id = auth.uid());

-- INSERT: no policy — every path in via the admin client from
-- trusted server code. This is intentional: authenticated users
-- must never be able to create notifications for anyone (including
-- themselves), which shuts down the entire spam vector.

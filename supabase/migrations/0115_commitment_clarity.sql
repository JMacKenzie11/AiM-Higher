-- =============================================================
-- Migration 0115: commitment clarity fields
--
-- Three booleans + a coaching note. Together they answer "is this
-- commitment clear?" against the AiMS clarity criteria:
--   * deliverable — both parties share the same picture of what
--     is being delivered
--   * timeline    — the deadline is stated and achievable
--   * success     — done looks like something specific
--
-- Nullable on purpose: null means "not yet assessed" — that's a
-- different state from an explicit false. The row indicator on the
-- commitment surface renders three shades accordingly:
--   green  — all three explicitly true
--   amber  — any explicitly false
--   muted  — any null (needs a look)
--
-- Both extraction (analyzer JSON) and manual assessment (UI) write
-- these fields.
-- =============================================================

alter table public.commitments
  add column if not exists clarity_deliverable boolean,
  add column if not exists clarity_timeline    boolean,
  add column if not exists clarity_success     boolean,
  add column if not exists clarity_note        text;

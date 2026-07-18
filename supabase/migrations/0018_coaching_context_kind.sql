-- =============================================================
-- Merger Phase 4 — Migration 0018: coaching context_kind.
--   Turns the coaching primitive into a shared surface across
--   modules. Existing rows are all execution-context (default);
--   Strengths Map coaching lands here in Phase 5 with
--   context_kind = 'strengths'. The API route picks a prompt file
--   and context assembler off this column.
--
--   RLS on coaching_conversations / coaching_messages is unchanged
--   — it already keys off created_by + role/company, which works
--   identically for either module.
-- =============================================================

alter table public.coaching_conversations
  add column if not exists context_kind text not null default 'execution'
    check (context_kind in ('execution', 'strengths'));

create index if not exists coaching_conversations_by_context_idx
  on public.coaching_conversations (context_kind);

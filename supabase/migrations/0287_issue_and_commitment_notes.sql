-- 0287: notes on an issue and on a commitment.
--
-- WHY. Jason, 2026-10-16: an issue and a commitment each get a notes
-- field, edited in the drawer with a small rich text editor (bold,
-- italic, bullet and numbered lists, links), for the context that
-- does not fit in a one-line description.
--
-- WHAT. One nullable jsonb column on each table, holding the editor's
-- document (TipTap JSON), never HTML. The app cleans every document
-- before it saves (src/lib/notes/clean.ts): only the five kinds of
-- formatting survive, and a link keeps an http, https or mailto
-- address or is dropped. The app draws notes itself from that tree
-- (src/components/notes/NotesView.tsx), so nothing stored is ever
-- handed to the browser as markup. The checks below are the
-- database's half: a document is an object, and it stays small.
--
-- WHO READS AND WRITES. Nobody new. A column carries its row's rules:
-- whoever can read the issue or commitment reads its notes (the
-- open-data principle), and whoever can edit it edits them. Outside
-- AI apps read notes with the rest of the row, by decision (Jason,
-- 2026-10-16: "Make note available to AI apps. It's fine."). Their
-- allow list (0270) is unchanged: they still cannot update either
-- table, so they read notes and never write them. The harness probe
-- "notes · follow the row" checks all of that.
--
-- No policy changes.

alter table public.issues
  add column if not exists notes jsonb;
alter table public.commitments
  add column if not exists notes jsonb;

alter table public.issues
  drop constraint if exists issues_notes_shape;
alter table public.issues
  add constraint issues_notes_shape check (
    notes is null
    or (jsonb_typeof(notes) = 'object' and octet_length(notes::text) <= 100000)
  );

alter table public.commitments
  drop constraint if exists commitments_notes_shape;
alter table public.commitments
  add constraint commitments_notes_shape check (
    notes is null
    or (jsonb_typeof(notes) = 'object' and octet_length(notes::text) <= 100000)
  );

comment on column public.issues.notes is
  'Notes, as a cleaned TipTap document: paragraphs, bold, italic, bullet and numbered lists, links (http, https, mailto). Null when empty (0287).';
comment on column public.commitments.notes is
  'Notes, as a cleaned TipTap document: paragraphs, bold, italic, bullet and numbered lists, links (http, https, mailto). Null when empty (0287).';

---
title: Classroom (admin)
roles: [system_admin]
---

# Classroom authoring

Create and update the shared training library. Every lesson and
training you publish here appears in every company that has the
Classroom feature turned on — there is no per-company copy.

## What you can do here

- **Add a category** — the top card. Categories are the primary
  grouping on the learner landing page; pick short, evergreen
  names.
- **Add a lesson** — *+ New lesson* inside a category drops in a
  draft you land on immediately to edit. Set the title,
  description, and flip *Published* on when ready.
- **Add a training to a lesson** — from the lesson edit page,
  *+ New training*. Give it a title and paste a YouTube or Vimeo
  URL; the thumbnail is fetched automatically at save time.
- **Author the training body** — rich text editor for context,
  prep questions, or key takeaways. Formatting includes
  headings, lists, blockquotes, and inline code.
- **Attach supporting files** — PDFs, decks, worksheets. Cap of
  25 MB per file. Files upload to a private bucket and download
  through short-lived signed URLs.
- **Reorder** — arrow buttons on both lesson and training rows.

## How to publish a lesson

1. Create the lesson under the right category.
2. Add the trainings — video URL + optional body + supporting
   files.
3. Preview the learner surface by loading it as any signed-in
   user.
4. Flip *Published* on for the lesson. Drafts (unpublished) stay
   hidden from every consumer company even when the flag is on.

## Common questions

**How are slugs handled?** Slugs are auto-generated from titles
but editable. Once a slug is in the wild (mentioned in Ask
Aimee recommendations, shared in a Slack link), think twice
before changing it — those references won't rewrite themselves.

**Can a company opt out of a specific lesson?** No — the library
is shared. Company-level scoping happens at the *Classroom*
feature flag: turn the whole module off for a company and none
of the library shows there.

**Why does a lesson not show up for a company?** Either the
lesson isn't published, or the company doesn't have the
Classroom feature enabled on its settings page.

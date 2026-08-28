---
title: Classroom (admin)
roles: [system_admin]
---

# Classroom authoring

Create and update the shared library. Every lesson you publish
appears in every company that has the Classroom feature turned on
— there is no per-company copy.

## What you can do here

- **Add a category** — the top card. Categories are the primary
  grouping on the learner landing page; pick short, evergreen
  names.
- **Rename a category** — click its title on the classroom admin
  page, edit, and press Enter (Escape cancels). Only the display
  name changes; the slug stays put so any Ask-Aimee reference or
  shared link keeps working.
- **Add a lesson** — *+ New lesson* inside a category drops in a
  draft you land on immediately to edit. Set the title,
  description, and flip *Published* on when ready.
- **Add a section to a lesson** — from the lesson edit page,
  *+ New section*. Title only — pick something short; that's what
  shows as the tab on the reader side.
- **Author the section body** — rich text editor for headings,
  lists, blockquotes, inline code, and **inline video embeds**.
  Two ways to insert a video:
    - Click the ▶ button in the toolbar and paste a YouTube or
      Vimeo share URL.
    - Or just paste a YouTube/Vimeo URL onto a blank line — the
      editor auto-detects it and swaps the URL for a thumbnail
      preview. Add a caption in the field beneath the thumbnail.
  The player never loads while editing; you see a static
  thumbnail so a section with 10 videos stays responsive.
- **Insert images** — click the 🖼 button in the toolbar to pick
  a file, paste a screenshot from your clipboard, or drag an
  image onto the editor. PNG, JPG, GIF, and WebP up to 8 MB.
  Click the image to select it, then drag the bottom-right
  handle to resize (aspect ratio is preserved) or use the S/M/L
  buttons for 33% / 66% / 100% container width.
- **Align text and images** — the ⇤ ⇔ ⇥ toolbar buttons set
  left / center / right alignment. With the caret in a paragraph
  or heading they align the text; with an image selected they
  align the image within the section.
- **Insert a hyperlink** — select the text you want to link, then
  click the 🔗 toolbar button and paste the URL. Only `https://`,
  `http://`, and `mailto:` URLs are accepted; a bare domain like
  `aims.institute` is auto-prefixed with `https://`. Click the
  button again on already-linked text to edit the URL, or clear
  the field to remove the link.
- **Walk between sections while editing** — the left rail shows
  the same tab list your readers will see, so click any sibling
  section to jump to its editor.
- **Attach supporting files** — PDFs, decks, worksheets. Cap of
  25 MB per file. Files upload to a private bucket and download
  through short-lived signed URLs.
- **Reorder** — arrow buttons on both lesson and section rows.

## How to publish a lesson

1. Create the lesson under the right category.
2. Add each section — title, body (with any inline videos),
   attachments.
3. Preview the learner surface by loading it as any signed-in
   user; the URL scheme is `/classroom/lessons/<lesson>` for the
   landing section and `/classroom/lessons/<lesson>/<section>`
   for a specific tab.
4. Flip *Published* on for both the lesson and each section.
   Drafts stay hidden from every consumer company even when the
   feature flag is on.

## Common questions

**How are slugs handled?** Slugs are auto-generated from titles
but editable. Once a slug is in the wild (mentioned in Ask
Aimee recommendations, shared in a Slack link), think twice
before changing it — those references won't rewrite themselves.

**Where do videos live now?** Videos are inline nodes inside the
section body — drop them wherever they belong in the flow. The
"one video at the top of a training" slot from the earlier
Classroom shape was retired in migration 0145; there's no
top-of-section video field anymore.

**Can a section have more than one video?** Yes — insert as many
as the reader needs. Each renders as its own thumbnail with a
click-to-play overlay so the initial page paint stays light.

**Can a company opt out of a specific lesson?** No — the library
is shared. Company-level scoping happens at the *Classroom*
feature flag: turn the whole module off for a company and none
of the library shows there.

**Why does a lesson not show up for a company?** Either the
lesson isn't published, or the company doesn't have the
Classroom feature enabled on its settings page.

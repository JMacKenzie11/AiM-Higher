# In-app help

Every user-facing page has a help doc here. The floating `?` widget
in the bottom-right of every authenticated page reads these files
and renders the one matching the current route + user role.

## Adding a help doc

**When you ship a new `page.tsx` under `src/app/(app)/`, add a
matching help doc in this folder.** CI enforces the pairing:

```bash
pnpm run check:help    # or npm run check:help — fails on missing
pnpm run check:help --write   # scaffolds skeletons for every missing doc
```

The `--write` variant creates a valid frontmatter + TODO body for
each missing route so you don't have to remember the naming
convention. Edit the scaffolded files with real content before
merging — a scaffolded doc still satisfies coverage, but shipping
one is a bit of a self-troll.

## File naming

Doc filenames mirror the route path, with `/` replaced by `.` and
dynamic segments (`[id]`) replaced by `_id`.

| Route                              | Doc filename                       |
| ---------------------------------- | ---------------------------------- |
| `/dashboard`                       | `dashboard.md`                     |
| `/plan`                            | `plan.md`                          |
| `/admin/companies`                 | `admin.companies.md`               |
| `/admin/companies/[id]`            | `admin.companies._id.md`           |
| `/plan/priority/[id]`              | `plan.priority._id.md`             |
| `/chart/function/[id]/role-description` | `chart.function._id.role-description.md` |
| `/chart/function/[id]/role-description/v/[n]` | `chart.function._id.role-description.v._version.md` |

The resolver tries the most specific filename first and falls back
to progressively less specific ones, so a `/plan/priority/xyz` URL
without a `plan.priority._id.md` will still render `plan.md`.

## Frontmatter

Each doc begins with YAML-ish frontmatter (kept minimal — no library
required to parse):

```md
---
title: Your dashboard
roles: [team_member, company_admin, system_admin, aims_guide]
---

# Your dashboard

Content in Markdown…
```

- `title` — shown as the panel header. Required.
- `roles` — which roles see this doc. Optional. Default: all roles.
  If a doc is admin-only, list only `company_admin`, `system_admin`,
  `aims_guide` (whichever combination applies).

Body is standard Markdown (GFM). Keep it short — this is a help
snippet, not documentation. Two or three paragraphs plus a short
list of common questions is the right shape.

## Role-scoped sections

The whole doc can be gated to specific roles via the `roles`
frontmatter. Sections **inside** a doc can be gated too, using
`::: role` fences:

```md
Shared intro that everyone sees.

::: role team_member
Content only team members see.
:::

::: role company_admin,aims_guide,system_admin
Admin- and guide-only content.
:::

Shared footer that everyone sees.
```

Rules:

- Opening fence: `::: role <comma-separated roles>` on its own line.
- Closing fence: `:::` on its own line.
- Non-matching sections are stripped **server-side** — other
  roles' content is never in the HTTP response.
- Anything outside a fence is visible to everyone. Default to
  outside-the-fence unless the section is clearly role-specific.
- Don't nest fences (parser doesn't support it).
- Every fence must close before EOF — an unclosed fence logs a
  warning and renders the whole doc unfiltered (fail-open).

## Standard template

Every help doc should follow this shape. It answers the two
questions every user has: *what can I do on this page* and *how
do I do the common things*.

```md
---
title: <Page name>
---

# <Page name>

<One sentence: what this page is for.>

## What you can do here

::: role team_member
As a team member, you can:

- <action>
- <action>
:::

::: role company_admin,aims_guide,system_admin
As an admin or guide, you can also:

- <action>
- <action>
:::

## How to <most common thing>

<Step-by-step, short. Use active voice.>

## How to <second most common thing>

<Step-by-step.>

## Common questions

**<Question 1>?** <Answer.>

**<Question 2>?** <Answer.>
```

## What to include

- What this page is *for* (one sentence).
- The 2–3 most common things a user does here, with the click path.
- Any gotchas that surprise new users.
- Link to a longer doc *only* if there's genuinely more to say.

## What to skip

- Anything a well-labelled button already communicates.
- Feature-by-feature walkthroughs — those age poorly. Keep the doc
  centred on user goals, not UI inventory.
- Screenshots. They rot every UI change.

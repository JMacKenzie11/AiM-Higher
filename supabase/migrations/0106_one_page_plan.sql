-- =============================================================
-- Migration 0106: One-Page Plan
--
-- Foundation becomes the One-Page Plan. Three schema shifts, all in
-- this file so the data migration cannot fail with rows stranded:
--
-- 1. Vision consolidates to a single text field. Prior schema split
--    it across vision_title / vision_tagline / vision_body, and
--    "vision milestones" lived as their own foundation_items rows.
--    Everything folds into one column called `vision`.
--
-- 2. foundation_items.kind swaps: 'vision_milestone' is retired,
--    'key_success_metric' is added.
--
-- 3. Milestone rows are deleted after their content has been merged
--    into the vision field.
--
-- Order matters: merge first (both intra-table columns AND the
-- milestone rows), THEN drop columns / rows / constraint values.
-- Reversing the order would either lose milestone content or violate
-- the new check constraint mid-migration.
-- =============================================================

-- ---- Step 1: fold every legacy vision field into vision_body ----
-- Concatenates title, tagline, body, and every milestone item's
-- title + body for that company, in a readable multi-paragraph
-- shape. Companies with sparse data get a clean single paragraph;
-- companies with the full split get a longer block they can edit
-- down as they see fit.

with milestone_text as (
  select
    company_id,
    string_agg(
      case
        when body is null or length(trim(body)) = 0 then title
        else title || E'\n' || body
      end,
      E'\n\n'
      order by sort_order, created_at
    ) as ms
  from public.foundation_items
  where kind = 'vision_milestone'
  group by company_id
)
update public.company_foundation cf
set vision_body = trim(both E'\n' from concat_ws(
  E'\n\n',
  nullif(trim(coalesce(cf.vision_title, '')), ''),
  nullif(trim(coalesce(cf.vision_tagline, '')), ''),
  nullif(trim(coalesce(cf.vision_body, '')), ''),
  (select ms from milestone_text mt where mt.company_id = cf.company_id)
));

-- ---- Step 2: drop the split columns and rename to `vision` ----
alter table public.company_foundation drop column if exists vision_title;
alter table public.company_foundation drop column if exists vision_tagline;
alter table public.company_foundation rename column vision_body to vision;

-- ---- Step 3: remove milestone rows now that their content is merged
delete from public.foundation_items where kind = 'vision_milestone';

-- ---- Step 4: swap the kind check constraint ----
-- Postgres names an unnamed check constraint after its column, so
-- we drop by discovery-safe name. The migration adds the new set:
-- core_value, differentiator, key_success_metric.

alter table public.foundation_items
  drop constraint if exists foundation_items_kind_check;

alter table public.foundation_items
  add constraint foundation_items_kind_check
    check (kind in ('core_value', 'differentiator', 'key_success_metric'));

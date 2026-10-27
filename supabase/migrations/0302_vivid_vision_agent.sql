-- 0302: the Vivid Vision Coach, and a Strategy category for it.
--
-- WHY. Jason, 2026-10-27: Jeff Bouwman's AiMS Vivid Vision Coach,
-- brought over from a custom GPT as an Aimee agent. It reads the
-- purpose, values, strengths and ideal customer from the One-Page
-- Plan, walks the leader (and their team) through the 10-year
-- vision, and the leader saves the finished document to the One-Page
-- Plan's Vision card. The registry entry and prompt are in code
-- (src/lib/practices/registry.ts, prompts/practices/vivid-vision.md);
-- this is the row the Agent Hub and the pickers read for its identity
-- and access, as 0235 did for the meeting debrief.
--
-- None of the three categories fits a company's long-range picture,
-- so Strategy joins them, last. A system admin may already have made
-- one from the Hub; on conflict keeps theirs.
--
-- Access: company_admin, system_admin, aims_guide, the people who can
-- edit the One-Page Plan. No feature gate. Data only: no table, rule
-- or function changes.

insert into public.agent_categories (name, slug, sort_order)
select 'Strategy', 'strategy',
       coalesce((select max(sort_order) + 1 from public.agent_categories), 0)
on conflict (slug) do nothing;

insert into public.agents
  (slug, category_id, title, description, sort_order,
   allowed_roles, access_predicates)
select v.slug, c.id, v.title, v.description,
       coalesce(
         (select max(sort_order) + 1 from public.agents a
           where a.category_id = c.id),
         0),
       v.allowed_roles, v.access_predicates
from (
  values (
    'vivid-vision',
    'strategy',
    'Vivid Vision Coach',
    'Create a 10-year Vivid Vision: a vivid picture of the company you''re building, written as if it''s already happening, and saved to your One-Page Plan.',
    '{company_admin,system_admin,aims_guide}'::text[],
    '{}'::text[]
  )
) as v(slug, category_slug, title, description,
       allowed_roles, access_predicates)
join public.agent_categories c on c.slug = v.category_slug
on conflict (slug) do nothing;

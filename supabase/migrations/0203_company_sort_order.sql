-- A portfolio's companies keep the order its owner puts them in.
--
-- Alphabetical is an accident of spelling, not a statement about the
-- business. "1 - Promise One" sorts first on this instance because
-- somebody prefixed it with a digit, which is what people do when the
-- only ordering available is the one they cannot change.
--
-- The order is a property of the DATA, not of a browser: one column
-- on the company row, written by the person who owns the portfolio,
-- read by everyone who sees a list of companies.

alter table public.companies
  add column if not exists sort_order integer;

comment on column public.companies.sort_order is
  'Display position among the companies on this instance, lowest '
  'first. NULL means never ordered, and sorts after everything that '
  'has a position, alphabetically among its peers: `order by '
  'sort_order nulls last, name`. Deliberately not unique and not '
  'contiguous. A reorder rewrites only the rows whose position '
  'changed, so ties and gaps are normal and resolve by name.';

-- ---------------------------------------------------------------
-- The column guard learns one word.
-- ---------------------------------------------------------------
--
-- READ THE SHAPE OF THIS BEFORE EDITING IT. The guard is an ALLOWLIST
-- for portfolio_admin and a DENYLIST BY CONSTRUCTION for company
-- admins and guides — it compares whole rows as jsonb minus the
-- permitted keys, so a column added to this table is refused to those
-- two roles the day it is added rather than the day somebody
-- remembers to refuse it.
--
-- That is why this migration adds `sort_order` in exactly one place.
-- A company admin and a guide are already refused it, for free, by a
-- guard written before the column existed. Only the container role
-- has to be told.
--
-- Ordering the portfolio is a container action, which is why it
-- belongs to the role whose scope is the container. A company admin
-- reordering the instance would be a company deciding where it sits
-- among its siblings.
--
-- `deleted_at` stays absent from every list here and remains refused
-- to portfolio_admin, which the harness asserts separately.
create or replace function public.companies_restrict_admin_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text;
begin
  caller_role := (select public.auth_role());

  -- The container role: five named columns, everything else refused.
  if caller_role is not distinct from 'portfolio_admin' then
    if (to_jsonb(new) - 'name' - 'timezone' - 'industry' - 'status'
                      - 'sort_order' - 'updated_at')
       is distinct from
       (to_jsonb(old) - 'name' - 'timezone' - 'industry' - 'status'
                      - 'sort_order' - 'updated_at') then
      raise exception
        'A portfolio_admin may change only name, timezone, industry, status and sort_order on a company (attempted on company %)',
        old.id
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- 0176, unchanged in behaviour: industry and nothing else. Which
  -- now also means: not sort_order.
  if caller_role is distinct from 'company_admin'
     and caller_role is distinct from 'aims_guide' then
    return new;
  end if;

  if (to_jsonb(new) - 'industry' - 'updated_at')
     is distinct from (to_jsonb(old) - 'industry' - 'updated_at') then
    raise exception
      'Only industry may be changed on a company by a % (attempted on company %)',
      caller_role, old.id
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

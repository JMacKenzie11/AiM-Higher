-- 0252: remove memories that record a judgment about somebody else.
--
-- WHY. Memory from a conversation about someone else keeps only what
-- the person asking is working on: what they intend, committed to,
-- decided and keep avoiding. Never what they, or Aimee, think of the
-- other person, who never agreed to a record (Jason, 2026-10-01;
-- docs/investigations/open-data.md, phase C). From this PR the prompt
-- says so and src/lib/coach/memory-shape.ts (aboutAnotherVerdict)
-- drops what gets through. This removes the ones written before.
--
-- WHICH. A memory from an about-mode conversation that names the
-- person the conversation was about (full name or first name, whole
-- word, any case) and does not open with the asker's own action.
-- The same test as aboutAnotherVerdict, written in SQL for this one
-- run; the verb list is copied from ASKER_ACTION.
--
-- COUNTED FIRST, read only, 2026-10-02, and shown to Jason: production
-- 4 of 7 about-mode memories (2 of them `inferred`), belonging to 2
-- people; PromiseOne none; the dev clone none.
--
-- GUARDED. It refuses to run if more than 10 rows match, so a
-- predicate that has gone wrong cannot empty people's memory: the
-- expected number is 4 at most on any instance. A memory is the
-- owner's alone (0194), and this runs as the migration owner, which
-- is the only way to remove one that is not your own.

do $$
declare
  v_matching integer;
begin
  create temporary table memories_to_remove on commit drop as
  select m.id
  from public.coach_memories m
  join public.coaching_conversations c on c.id = m.conversation_ref
  join public.profiles p on p.id = c.subject_profile_id
  where c.mode = 'about'
    and m.content ~* (
      '(^|[^[:alpha:]])('
      || regexp_replace(p.full_name, '([.*+?^${}()|\[\]\\])', '\\\1', 'g')
      || '|'
      || regexp_replace(split_part(p.full_name, ' ', 1), '([.*+?^${}()|\[\]\\])', '\\\1', 'g')
      || ')([^[:alpha:]]|$)'
    )
    and btrim(m.content) !~* '^(committed|commits|plans|plans to|planning|decided|decides|will|wants|intends|agreed|agrees|chose|chooses|is going to|is preparing|prepared|keeps|kept|avoids|is avoiding|has been avoiding|booked|scheduled|asked|is asking|practised|practiced|rehearsed|promised|offered)([^[:alpha:]]|$)';

  select count(*) into v_matching from memories_to_remove;
  if v_matching > 10 then
    raise exception '0252: % memories match, more than the 10 this was counted for; refusing', v_matching;
  end if;

  delete from public.coach_memories where id in (select id from memories_to_remove);
  raise notice '0252: removed % memories about another person', v_matching;
end;
$$;

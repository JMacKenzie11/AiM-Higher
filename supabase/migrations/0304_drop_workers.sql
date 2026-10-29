-- 0304: Workers is dropped.
--
-- WHY. Jason, 2026-10-29: "I don't see us going forward with the
-- worker functionality". 0303 said a later migration would drop its
-- tables if the prototype was dropped; this is that migration. The
-- pages, code, tests, harness probes and help page go in the same PR.
--
-- Saved passwords live in Vault, and dropping worker_secrets would not
-- fire its delete trigger, so the rows are deleted first and the
-- trigger (worker_secret_forget) takes each Vault entry with them.
--
-- coach_token_usage keeps 'worker_step' and 'worker_teach' in its
-- purpose check: the cost rows those runs logged stay as they were.
--
-- Access: none added or changed. Data only removed: every Workers
-- table, and the three functions that went with them.

do $$
begin
  if to_regclass('public.worker_secrets') is not null then
    delete from public.worker_secrets;
  end if;
end $$;

-- One statement, since worker_runs and worker_skills point at each other.
drop table if exists
  public.worker_secrets,
  public.worker_skills,
  public.worker_memories,
  public.worker_rules,
  public.worker_steps,
  public.worker_runs,
  public.workers;

drop function if exists public.worker_secret_forget();
drop function if exists public.worker_secret_save(uuid, text, text);
drop function if exists public.worker_secret_value(uuid, text);

-- 0271: nobody changes their own sign-in email through the Auth API.
-- An admin still can.
--
-- WHY. Jason, 2026-10-13: an outside assistant's token must not be able
-- to change a person's password or email, at any time after connecting.
-- The Auth API (/auth/v1/user) does not run as the token's role, so the
-- allow list (0270) cannot reach it, and it does not look at the
-- token's client_id either: tested on the dev project with a real
-- assistant token, a request to change the email was refused only by
-- the dev mailer, which a production mailer would not do. (Passwords
-- are closed by a project setting instead: "require current password",
-- which an assistant never has. See docs/deployment.md.)
--
-- The Auth API cannot tell an assistant's request from the person's,
-- so this closes the whole self-service path. AiMS has never offered
-- it: a person's email is changed by an admin on their People page
-- (updateUserAction, through the admin API), which sets the address
-- directly and never uses the pending-change column this trigger
-- watches. Confirming a change, which clears that column, is also left
-- alone, though after this there is never one to confirm.
--
-- HOW. Supabase records a requested change in auth.users.email_change
-- (and phone_change) while it waits for confirmation. This trigger
-- refuses any update that puts a value there. Supabase sends the
-- confirmation emails just before it writes that column, so a request
-- can still produce an email; its link does nothing, because the
-- change it would confirm was never recorded.

-- Roles: none. A trigger, not a write rule: it admits nothing and
-- refuses one kind of change for every caller, the Auth API included.
create or replace function public.refuse_self_service_contact_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(new.email_change, '') <> ''
     and new.email_change is distinct from old.email_change then
    raise exception 'email_change_refused: a sign-in email is changed by an admin in AiMS'
      using errcode = '42501';
  end if;
  if coalesce(new.phone_change, '') <> ''
     and new.phone_change is distinct from old.phone_change then
    raise exception 'phone_change_refused: a sign-in phone is changed by an admin in AiMS'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.refuse_self_service_contact_change() from public;

drop trigger if exists refuse_self_service_contact_change on auth.users;
create trigger refuse_self_service_contact_change
  before update of email_change, phone_change on auth.users
  for each row execute function public.refuse_self_service_contact_change();

-- Profiles: one row per account, made by a trigger when the user signs up.
-- Safe to run again: everything here is create if not exists or create or replace.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  username text,
  email text,
  theme text,
  checkin_time text not null default '20:00',
  plan text not null default 'trial',
  trial_ends_at timestamptz not null default now() + interval '10 days',
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_format check (username is null or username ~ '^[a-z0-9._]{3,20}$'),
  constraint profiles_theme check (theme is null or theme in ('light', 'dark', 'system')),
  constraint profiles_plan check (plan in ('trial', 'standard', 'pro'))
);
create unique index if not exists profiles_username_key on public.profiles (username);

alter table public.profiles enable row level security;
drop policy if exists "profiles: own row" on public.profiles;
create policy "profiles: own row" on public.profiles
  for all to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Is a username taken? Anyone may ask, including someone still signing up.
create or replace function public.username_taken(u text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where username = lower(u));
$$;
revoke all on function public.username_taken(text) from public;
grant execute on function public.username_taken(text) to anon, authenticated;

-- updated_at moves to now unless the row came in with its own newer stamp.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.updated_at is null then new.updated_at := now(); end if;
  elsif new.updated_at is null or new.updated_at = old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before insert or update on public.profiles
  for each row execute function public.touch_updated_at();

-- A new account gets its profile from what sign up sent, or from what Apple or Google gave.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  whole text;
  first text := coalesce(meta ->> 'first_name', '');
  last text := coalesce(meta ->> 'last_name', '');
  uname text := lower(coalesce(meta ->> 'username', ''));
begin
  if first = '' and last = '' then
    whole := btrim(coalesce(meta ->> 'full_name', meta ->> 'name', ''));
    first := split_part(whole, ' ', 1);
    last := btrim(substr(whole, length(first) + 1));
  end if;
  if uname !~ '^[a-z0-9._]{3,20}$' or exists (select 1 from public.profiles where username = uname) then
    uname := null;
  end if;
  insert into public.profiles (id, first_name, last_name, username, email)
  values (new.id, first, last, uname, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.profiles to authenticated;

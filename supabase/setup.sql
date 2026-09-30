-- Deka database setup. Made from supabase/migrations by scripts/setup-sql.js.
-- Run it once in the Supabase SQL Editor on a fresh project. Running it again is safe.

-- 0001_profiles.sql

-- Profiles: one row per account, made by a trigger when the user signs up.
-- Safe to run again: everything here is create if not exists or create or replace.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  username text,
  email text,
  theme text,
  checkin_time text,
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
-- A new account has no check in time until a device sets one, so signing in never replaces the
-- time a device already had. Safe on a project set up before this.
alter table public.profiles alter column checkin_time drop not null;
alter table public.profiles alter column checkin_time drop default;

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

-- 0002_dekas.sql

-- Dekas and everything in them. Every table carries user_id, a text id from the app,
-- updated_at for latest change wins, and deleted for a removal that other devices must see.
-- Only the primary key is required, so a deletion can arrive as just the key and the flag.

create table if not exists public.dekas (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  role text not null default 'current',
  status text not null default 'planning',
  start_date date,
  closed date,
  ended_day integer,
  summary text not null default '',
  summarized_up_to integer not null default 0,
  checked jsonb not null default '[]'::jsonb,
  checkin jsonb not null default '{}'::jsonb,
  reflection text not null default '',
  review text not null default '',
  review_opened date,
  off_streak integer not null default 0,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint dekas_role check (role in ('current', 'next', 'past')),
  constraint dekas_status check (status in ('planning', 'live', 'done'))
);
create index if not exists dekas_user_updated on public.dekas (user_id, updated_at);

create table if not exists public.goals (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  deka_id text not null default '',
  goal_id text not null default '',
  name text not null default '',
  type text not null default 'do',
  tag text not null default '',
  target integer not null default 1,
  icon text,
  category text,
  energy text,
  social text,
  fun text,
  time_of_day text,
  weekend text,
  position integer not null default 0,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists goals_user_updated on public.goals (user_id, updated_at);
create index if not exists goals_user_deka on public.goals (user_id, deka_id);

-- A session is one goal on one day. done and missed are its completion.
create table if not exists public.sessions (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  deka_id text not null default '',
  goal_id text not null default '',
  day integer not null default 1,
  done boolean not null default false,
  missed boolean not null default false,
  detail text not null default '',
  position integer not null default 0,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists sessions_user_updated on public.sessions (user_id, updated_at);
create index if not exists sessions_user_deka on public.sessions (user_id, deka_id);

create table if not exists public.notes (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  deka_id text not null default '',
  day integer not null default 1,
  text text not null default '',
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists notes_user_updated on public.notes (user_id, updated_at);

-- Chat messages. data holds the cards, attachments, feedback, check in state and the rest.
create table if not exists public.messages (
  user_id uuid not null references auth.users (id) on delete cascade,
  id text not null,
  deka_id text not null default '',
  role text not null default 'deka',
  text text not null default '',
  ts bigint not null default 0,
  data jsonb not null default '{}'::jsonb,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists messages_user_updated on public.messages (user_id, updated_at);
create index if not exists messages_user_deka on public.messages (user_id, deka_id, ts);

do $$
declare t text;
begin
  foreach t in array array['dekas', 'goals', 'sessions', 'notes', 'messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s: own rows" on public.%I', t, t);
    execute format('create policy "%s: own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t, t);
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before insert or update on public.%I for each row execute function public.touch_updated_at()', t, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- 0003_feedback_usage.sql

-- Written by the server with the service role. A person can read their own rows and nothing else.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id text not null default '',
  rating text,
  reason text not null default '',
  message text not null default '',
  created_at timestamptz not null default now(),
  constraint feedback_rating check (rating is null or rating in ('up', 'down'))
);
create index if not exists feedback_user_created on public.feedback (user_id, created_at);

-- One row per turn with Claude: tokens in and out, and what it cost. Limits count these.
create table if not exists public.usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  kind text not null default 'chat',
  model text not null default '',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_usd numeric(10, 6) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists usage_user_day on public.usage (user_id, day);

alter table public.feedback enable row level security;
alter table public.usage enable row level security;
drop policy if exists "feedback: read own" on public.feedback;
create policy "feedback: read own" on public.feedback for select to authenticated using (user_id = auth.uid());
drop policy if exists "usage: read own" on public.usage;
create policy "usage: read own" on public.usage for select to authenticated using (user_id = auth.uid());
grant select on public.feedback, public.usage to authenticated;

-- 0004_storage.sql

-- Attachments: a private bucket with one folder per person, named by their id.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 20971520, array['image/jpeg', 'application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "attachments: own folder" on storage.objects;
create policy "attachments: own folder" on storage.objects
  for all to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

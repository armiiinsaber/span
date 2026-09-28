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

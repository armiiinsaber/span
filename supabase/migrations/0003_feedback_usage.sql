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

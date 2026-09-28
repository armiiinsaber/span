-- A stand in for the parts of a Supabase project that setup.sql relies on, for a plain Postgres
-- in tests: the auth and storage schemas, the roles, auth.uid() and storage.foldername().
-- Never run this on a real project; Supabase provides all of it.

create schema if not exists auth;
create schema if not exists storage;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable
as $$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable
as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text not null,
  owner uuid,
  owner_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language plpgsql
as $$
declare parts text[];
begin
  select string_to_array(name, '/') into parts;
  return parts[1 : array_length(parts, 1) - 1];
end;
$$;

grant usage on schema auth, storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects, storage.buckets to anon, authenticated, service_role;

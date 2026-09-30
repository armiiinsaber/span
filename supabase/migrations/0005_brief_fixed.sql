-- Fixed commitments and goals with hours and a window, and the brief pinned at the top of the chat.
-- Safe to run again, and safe on a project set up before this.

alter table public.goals add column if not exists day integer;
alter table public.goals add column if not exists time text;
alter table public.goals add column if not exists hours numeric(4, 2);
alter table public.goals add column if not exists until_day integer;
alter table public.goals add column if not exists until_goal text;

-- The rules they have stated and the questions Deka is waiting on. Goals and fixed commitments
-- come from the goals table, so the brief and the plan never disagree.
alter table public.dekas add column if not exists brief jsonb not null default '{}'::jsonb;

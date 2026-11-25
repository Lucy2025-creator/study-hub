-- 学习台云同步：与数学站共用同一个 Supabase 项目/用户体系
create extension if not exists pgcrypto;

create table if not exists public.cet_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.study_plan (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  client_updated_at bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.cet_state enable row level security;
alter table public.study_plan enable row level security;

drop policy if exists "own cet state" on public.cet_state;
create policy "own cet state" on public.cet_state for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own study plan" on public.study_plan;
create policy "own study plan" on public.study_plan for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists cet_state_touch on public.cet_state;
create trigger cet_state_touch before update on public.cet_state
  for each row execute function public.touch_updated_at();

drop trigger if exists study_plan_touch on public.study_plan;
create trigger study_plan_touch before update on public.study_plan
  for each row execute function public.touch_updated_at();

do $$ begin
  alter publication supabase_realtime add table public.cet_state;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.study_plan;
exception when duplicate_object then null; end $$;

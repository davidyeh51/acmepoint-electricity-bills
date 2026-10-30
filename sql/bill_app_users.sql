create table if not exists public.bill_app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z][a-z0-9_]{2,31}$'),
  role text not null check (role in ('admin','user')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.bill_app_users enable row level security;
revoke all on public.bill_app_users from anon, authenticated;
grant select on public.bill_app_users to authenticated;
grant all on public.bill_app_users to service_role;
drop policy if exists bill_users_read_self on public.bill_app_users;
create policy bill_users_read_self on public.bill_app_users
for select to authenticated using (user_id = (select auth.uid()));
alter table public.electricity_bills add column if not exists parse_warnings jsonb not null default '[]'::jsonb;
create index if not exists electricity_bills_file_hash_idx on public.electricity_bills(file_hash);

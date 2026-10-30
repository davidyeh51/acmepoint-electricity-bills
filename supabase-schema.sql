-- ==============================================================================
-- 進金生能源 6692 ｜ 客戶太陽能電費單管理系統 (Supabase PostgreSQL Schema & RLS)
-- ==============================================================================
-- 說明：請登入 Supabase Console (https://supabase.com)，進入專案左側選單的「SQL Editor」，
--      全選貼上以下內容並點擊「Run」執行即可！
-- ==============================================================================

-- 1. 建立電費單主資料表 (public.electricity_bills)
CREATE TABLE IF NOT EXISTS public.electricity_bills (
    id BIGSERIAL PRIMARY KEY,
    filename TEXT UNIQUE NOT NULL,
    file_url TEXT,
    file_size BIGINT,
    file_hash TEXT,
    electric_number TEXT,
    contract_number TEXT,
    site_name TEXT,
    customer_name TEXT,
    customer_address TEXT,
    tax_id TEXT,
    bill_year_month TEXT,
    bill_year_month_ad TEXT,
    billing_period TEXT,
    billing_start_ad DATE,
    billing_end_ad DATE,
    plant_location TEXT,
    city TEXT,
    district TEXT,
    installed_capacity_kw NUMERIC,
    grid_capacity_kw NUMERIC,
    total_kwh NUMERIC,
    fit_rate NUMERIC,
    purchase_amount NUMERIC,
    tax_amount NUMERIC,
    total_bill_amount NUMERIC,
    meter_rental_amount NUMERIC,
    net_payable_amount NUMERIC,
    payment_account TEXT,
    taipower_branch TEXT,
    taipower_tel TEXT,
    meter_read_last TEXT,
    meter_read_curr TEXT,
    meter_read_next TEXT,
    machines_json JSONB,
    raw_text TEXT,
    extraction_mode TEXT,
    status TEXT DEFAULT 'PARSED',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. 建立案場名稱永久對照表 (public.site_mappings)
CREATE TABLE IF NOT EXISTS public.site_mappings (
    electric_number TEXT PRIMARY KEY,
    site_name TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. 建立效能索引 (Performance Indexes)
CREATE INDEX IF NOT EXISTS idx_eb_electric_no ON public.electricity_bills(electric_number);
CREATE INDEX IF NOT EXISTS idx_eb_contract_no ON public.electricity_bills(contract_number);
CREATE INDEX IF NOT EXISTS idx_eb_site_name ON public.electricity_bills(site_name);
CREATE INDEX IF NOT EXISTS idx_eb_customer ON public.electricity_bills(customer_name);
CREATE INDEX IF NOT EXISTS idx_eb_bill_month ON public.electricity_bills(bill_year_month);
CREATE INDEX IF NOT EXISTS idx_eb_city ON public.electricity_bills(city);

-- 4. 啟用 RLS 行級安全防護 (Row Level Security)
ALTER TABLE public.electricity_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_mappings ENABLE ROW LEVEL SECURITY;


insert into storage.buckets(id,name,public) values('bills','bills',false) on conflict(id) do update set public=false;

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

alter table public.electricity_bills add column if not exists bill_type text not null default 'FIT' check (bill_type in ('FIT','CONSUMPTION'));
alter table public.electricity_bills add column if not exists consumption_amount numeric;

-- App membership is checked live; disabling an account immediately blocks database writes.
drop policy if exists "允許公開讀取電費單" on public.electricity_bills;
drop policy if exists "允許寫入電費單" on public.electricity_bills;
drop policy if exists "允許公開讀取案場對照" on public.site_mappings;
drop policy if exists "允許寫入案場對照" on public.site_mappings;
revoke all on public.electricity_bills, public.site_mappings from anon, authenticated;
grant select, insert, update, delete on public.electricity_bills, public.site_mappings to authenticated;
revoke all on sequence public.electricity_bills_id_seq from anon, authenticated;
grant usage, select on sequence public.electricity_bills_id_seq to authenticated;

alter table public.electricity_bills enable row level security;
drop policy if exists bill_members_read on public.electricity_bills;
create policy bill_members_read on public.electricity_bills for select to authenticated using (exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists bill_members_insert on public.electricity_bills;
create policy bill_members_insert on public.electricity_bills for insert to authenticated with check (exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists bill_members_update on public.electricity_bills;
create policy bill_members_update on public.electricity_bills for update to authenticated using (exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active)) with check (exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists bill_admin_delete on public.electricity_bills;
create policy bill_admin_delete on public.electricity_bills for delete to authenticated using (exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active and m.role = 'admin'));

alter table public.site_mappings enable row level security;
drop policy if exists bill_members_read on public.site_mappings;
create policy bill_members_read on public.site_mappings for select to authenticated using (exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists bill_members_insert on public.site_mappings;
create policy bill_members_insert on public.site_mappings for insert to authenticated with check (exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists bill_members_update on public.site_mappings;
create policy bill_members_update on public.site_mappings for update to authenticated using (exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active)) with check (exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists bill_admin_delete on public.site_mappings;
create policy bill_admin_delete on public.site_mappings for delete to authenticated using (exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active and m.role = 'admin'));
drop policy if exists "允許公開檢視電費單檔案" on storage.objects;
drop policy if exists "允許上傳電費單檔案" on storage.objects;
drop policy if exists "允許更新電費單檔案" on storage.objects;
update storage.buckets set public=false where id='bills';
drop policy if exists bill_members_read_files on storage.objects;
create policy bill_members_read_files on storage.objects for select to authenticated using (bucket_id='bills' and exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists bill_members_upload_files on storage.objects;
create policy bill_members_upload_files on storage.objects for insert to authenticated with check (bucket_id='bills' and exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists bill_members_update_files on storage.objects;
create policy bill_members_update_files on storage.objects for update to authenticated using (bucket_id='bills' and exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active)) with check (bucket_id='bills' and exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active));
drop policy if exists bill_admin_delete_files on storage.objects;
create policy bill_admin_delete_files on storage.objects for delete to authenticated using (bucket_id='bills' and exists (select 1 from public.bill_app_users m where m.user_id = (select auth.uid()) and m.active and m.role = 'admin'));

alter table public.electricity_bills add column if not exists consumption_kwh numeric;

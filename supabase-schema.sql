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

-- 5. 制定 RLS 存取政策 (Policies)
-- (A) 允許公開讀取 (任何人皆可檢索電費單與案場)
DROP POLICY IF EXISTS "允許公開讀取電費單" ON public.electricity_bills;
CREATE POLICY "允許公開讀取電費單" ON public.electricity_bills FOR SELECT USING (true);

DROP POLICY IF EXISTS "允許公開讀取案場對照" ON public.site_mappings;
CREATE POLICY "允許公開讀取案場對照" ON public.site_mappings FOR SELECT USING (true);

-- (B) 允許新增與更新 (支援前端或 Python 本地腳本同步)
DROP POLICY IF EXISTS "允許寫入電費單" ON public.electricity_bills;
CREATE POLICY "允許寫入電費單" ON public.electricity_bills FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "允許寫入案場對照" ON public.site_mappings;
CREATE POLICY "允許寫入案場對照" ON public.site_mappings FOR ALL USING (true) WITH CHECK (true);

-- 6. 建立檔案儲存桶 (Storage Bucket: bills)
INSERT INTO storage.buckets (id, name, public)
VALUES ('bills', 'bills', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 7. 儲存桶存取政策 (Storage Policies)
DROP POLICY IF EXISTS "允許公開檢視電費單檔案" ON storage.objects;
CREATE POLICY "允許公開檢視電費單檔案" ON storage.objects FOR SELECT USING (bucket_id = 'bills');

DROP POLICY IF EXISTS "允許上傳電費單檔案" ON storage.objects;
CREATE POLICY "允許上傳電費單檔案" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'bills');

DROP POLICY IF EXISTS "允許更新電費單檔案" ON storage.objects;
CREATE POLICY "允許更新電費單檔案" ON storage.objects FOR UPDATE USING (bucket_id = 'bills');

-- 8. 預置現有種子資料 (Initial Seed Data)
INSERT INTO public.site_mappings (electric_number, site_name)
VALUES 
    ('08-40-8620-12-7', '美傢家具鹿港廠1'),
    ('10-56-4770-02-1', '賴侯淑貞')
ON CONFLICT (electric_number) DO UPDATE SET site_name = excluded.site_name;

INSERT INTO public.electricity_bills (
    filename, electric_number, contract_number, site_name, customer_name, customer_address,
    tax_id, bill_year_month, bill_year_month_ad, billing_period, billing_start_ad, billing_end_ad,
    plant_location, city, district, installed_capacity_kw, grid_capacity_kw, total_kwh, fit_rate,
    purchase_amount, tax_amount, total_bill_amount, meter_rental_amount, net_payable_amount,
    payment_account, taipower_branch, taipower_tel, meter_read_curr, status
) VALUES 
(
    '08-40-8620-12-7_211307_1.pdf',
    '08-40-8620-12-7',
    '08-PV-109-0339',
    '美傢家具鹿港廠1',
    '中租迪和股份有限公司',
    '114 台北市內湖區瑞光路362號8樓至12樓',
    '05072925',
    '115年10月',
    '2026-10',
    '115年09月01日~115年09月30日',
    '2026-09-01',
    '2026-09-30',
    '彰化縣鹿港鎮上林段598、599地號',
    '彰化縣',
    '鹿港鎮',
    1628.9,
    1628.9,
    231396,
    4.2444,
    982137,
    49107,
    1031244,
    -1628,
    1029616,
    '彰化商業銀行民生分行95106999900835號帳戶',
    '彰化區營業處核算（收費）課',
    '(04)7256461',
    '115年10月01日',
    'PARSED'
),
(
    '10-56-4770-02-1_211458_1.pdf',
    '10-56-4770-02-1',
    '10-PV-106-0047',
    '賴侯淑貞',
    '中租迪和股份有限公司',
    '114 台北市內湖區瑞光路362號8樓至12樓',
    '05072925',
    '115年10月',
    '2026-10',
    '115年09月04日~115年10月05日',
    '2026-09-04',
    '2026-10-05',
    '台南市安南區公學路五段656巷198號',
    '台南市',
    '安南區',
    196.62,
    196.62,
    28062,
    4.8111,
    135009,
    6750,
    141759,
    -249,
    141510,
    '永豐商業銀行營業部99717300000067號帳戶',
    '台南區營業處核算（收費）課',
    '(06)2160121',
    '115年10月06日',
    'PARSED'
)
ON CONFLICT (filename) DO UPDATE SET 
    site_name = excluded.site_name,
    net_payable_amount = excluded.net_payable_amount,
    total_kwh = excluded.total_kwh;

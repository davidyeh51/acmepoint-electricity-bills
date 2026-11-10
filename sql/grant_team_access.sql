-- 進金生能源 6692 - 電費單管理系統團隊免配置共享存取權限腳本
-- 請於 Supabase Dashboard > SQL Editor 執行此腳本，即可讓團隊成員免繁瑣設定、免帳號登入即可即時同步電費單

-- 1. 解除資料表之存取封鎖 (相容團隊免登入開箱即用模式)
ALTER TABLE IF EXISTS public.electricity_bills DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.site_mappings DISABLE ROW LEVEL SECURITY;

-- 2. 授權 anon (匿名訪客/團隊前端) 與 authenticated 完整讀寫與序列權限
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON TABLE public.electricity_bills TO anon, authenticated;
GRANT ALL ON TABLE public.site_mappings TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- 3. 將 Storage 存儲桶 'bills' 設定為公開可讀取
INSERT INTO storage.buckets (id, name, public) 
VALUES ('bills', 'bills', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 4. 開放 Storage 存儲桶上傳與讀取權限
DROP POLICY IF EXISTS "允許團隊公開上傳電費單檔案" ON storage.objects;
CREATE POLICY "允許團隊公開上傳電費單檔案" ON storage.objects FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'bills');

DROP POLICY IF EXISTS "允許團隊公開讀取電費單檔案" ON storage.objects;
CREATE POLICY "允許團隊公開讀取電費單檔案" ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'bills');

DROP POLICY IF EXISTS "允許團隊公開更新電費單檔案" ON storage.objects;
CREATE POLICY "允許團隊公開更新電費單檔案" ON storage.objects FOR UPDATE TO anon, authenticated USING (bucket_id = 'bills');

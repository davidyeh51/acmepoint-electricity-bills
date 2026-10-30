
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

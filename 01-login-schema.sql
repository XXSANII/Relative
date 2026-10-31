-- รันใน Supabase SQL Editor หลังสำรองข้อมูลแล้ว
-- ผูกข้อมูลบุคคลเข้ากับบัญชี Supabase Auth
alter table public.person
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

alter table public.person enable row level security;

-- สำคัญ: ตรวจสอบ RLS policies เดิมก่อนใช้งานจริง
-- อย่าให้ anon สามารถ insert/update/delete ข้อมูล person ได้โดยไม่จำกัด
-- ผู้ใช้ที่ล็อกอินอ่านข้อมูลญาติได้ (ระบบค้นหาจำเป็นต้องอ่านรายชื่อ)
drop policy if exists "authenticated can read family people" on public.person;
create policy "authenticated can read family people"
  on public.person for select to authenticated using (true);

-- บัญชีที่ล็อกอินเพิ่มข้อมูลของตัวเองได้เท่านั้น
-- การสร้างแถวบุคคลใช้ auth_user_id ของบัญชีที่ล็อกอินอยู่
 drop policy if exists "authenticated can insert own person" on public.person;
create policy "authenticated can insert own person"
  on public.person for insert to authenticated
  with check (auth_user_id = auth.uid());

 drop policy if exists "authenticated can update own person" on public.person;
create policy "authenticated can update own person"
  on public.person for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

 drop policy if exists "authenticated can delete own person" on public.person;
create policy "authenticated can delete own person"
  on public.person for delete to authenticated
  using (auth_user_id = auth.uid());

-- หมายเหตุ: หากมี policy เดิมแบบ USING (true) สำหรับ anon/authenticated
-- บน INSERT/UPDATE/DELETE ต้องลบหรือปิด policy เหล่านั้นด้วย เพราะ policies รวมกันแบบ OR

-- สิทธิ์อัปโหลดรูปโปรไฟล์ใน Storage bucket "family-avatars"
-- แก้ error "new row violates row-level security policy" ตอนแนบรูป
-- รันใน Supabase SQL Editor (รันซ้ำได้)
--
-- กติกา: ไฟล์ต้องอยู่ในโฟลเดอร์ชื่อ person.id ของตัวเอง (เช่น 12/avatar-1700000000000.jpg)
--        เพิ่ม/แก้/ลบได้เฉพาะรูปของบุคคลที่ผูกกับบัญชีที่ล็อกอินอยู่
-- หมายเหตุ: bucket ต้องตั้งเป็น Public เพื่อให้แสดงรูปผ่าน getPublicUrl() ได้ (Storage > family-avatars > Edit bucket)

drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'family-avatars'
    and exists (
      select 1 from public.person p
       where p.auth_user_id = auth.uid()
         and p.id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'family-avatars'
    and exists (
      select 1 from public.person p
       where p.auth_user_id = auth.uid()
         and p.id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'family-avatars'
    and exists (
      select 1 from public.person p
       where p.auth_user_id = auth.uid()
         and p.id::text = (storage.foldername(name))[1]
    )
  );

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'family-avatars'
    and exists (
      select 1 from public.person p
       where p.auth_user_id = auth.uid()
         and p.id::text = (storage.foldername(name))[1]
    )
  );

-- ผู้ที่ล็อกอินแล้วอ่าน/ค้นรายการรูปใน bucket นี้ได้ (การลบรูปเก่าต้องอ่านวัตถุก่อน)
drop policy if exists "avatars authenticated read" on storage.objects;
create policy "avatars authenticated read" on storage.objects
  for select to authenticated
  using (bucket_id = 'family-avatars');

-- แยกที่อยู่เป็นหลายคอลัมน์ (บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์)
-- รันใน Supabase SQL Editor (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
-- คอลัมน์ address เดิมยังอยู่ — หน้าเว็บเก็บที่อยู่ที่ประกอบเป็นข้อความเต็มไว้ที่นี่ด้วย

alter table public.person
  add column if not exists house_no     text,
  add column if not exists road         text,
  add column if not exists subdistrict  text,
  add column if not exists district     text,
  add column if not exists province     text,
  add column if not exists postal_code  text;

alter table public.person drop constraint if exists person_postal_code_chk;
alter table public.person
  add constraint person_postal_code_chk
  check (postal_code is null or postal_code ~ '^[0-9]{5}$');

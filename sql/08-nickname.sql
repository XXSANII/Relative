-- ชื่อเล่น แสดงต่อท้ายชื่อ-นามสกุล เช่น แสนพล สุนทรนนท์ (แสน)
-- รันใน Supabase SQL Editor (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้

alter table public.person
  add column if not exists nickname text;

alter table public.person drop constraint if exists person_nickname_chk;
alter table public.person
  add constraint person_nickname_chk
  check (nickname is null or char_length(btrim(nickname)) between 1 and 40);

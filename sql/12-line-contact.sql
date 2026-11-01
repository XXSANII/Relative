-- ช่องทางติดต่อ LINE ID ในข้อมูลบุคคล (แสดงในโปรไฟล์เหมือนเบอร์โทร)
-- รันใน Supabase SQL Editor หลัง 11-family-circles.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- กติกา:
--   * ไม่บังคับ; ว่างได้
--   * รูปแบบ 4–20 ตัว ใช้ได้เฉพาะ a-z 0-9 . _ - (รูปแบบ LINE ID ที่ LINE กำหนด)
--   * การมองเห็นเท่ากับเบอร์โทร: คนในวงครอบครัวเดียวกันเห็นได้ตามนโยบาย RLS ของ person (11-family-circles.sql)

alter table public.person
  add column if not exists line_id text;

alter table public.person drop constraint if exists person_line_id_chk;
alter table public.person
  add constraint person_line_id_chk
  check (line_id is null or line_id ~ '^[a-zA-Z0-9._-]{4,20}$');

-- เบอร์โทรศัพท์ไม่บังคับ (ตอนลงทะเบียนและแก้โปรไฟล์ปล่อยว่างได้)
-- รันใน Supabase SQL Editor หลัง 14-deceased.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- กติกา: person.phone เป็น null ได้ บัญชีที่ไม่มีเบอร์จะใช้ ชื่อจริง+นามสกุล สร้างอีเมลภายในแทน (ดู accountEmail ใน common.js)

alter table public.person
  alter column phone drop not null;
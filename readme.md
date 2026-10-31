
# ทะเบียนเครือญาติ (Demo)

## ไฟล์เว็บ (เก็บไว้โฟลเดอร์เดียวกัน)

- index.html : โครงหน้าเว็บ
- style.css  : หน้าตา
- config.js  : ตั้งค่า Supabase URL และ key
- app.js     : ตรรกะทั้งหมด

## SQL (รันใน Supabase > SQL Editor ตามลำดับ)

1. sql/01-table.sql                  สร้างตาราง
2. sql/02-rls-login.sql              ล็อกสิทธิ์ (เปิด RLS)
3. sql/03-demo-anon-policies.sql     เปิดสิทธิ์ demo แบบไม่ต้อง login
4. sql/04-seed-data.sql              ข้อมูลตัวอย่าง
5. sql/05-function-ancestors.sql     (ทางเลือก)

เปิด index.html ใน browser เพื่อใช้งาน
เมื่อเลิก demo: รันบล็อกคอมเมนต์ท้ายไฟล์ 03 เพื่อปิดสิทธิ์ anon

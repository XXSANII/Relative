# ทะเบียนเครือญาติ — Register / Login / Home / Profile

## ไฟล์
- `index.html`: เปิดเว็บแล้วไปหน้า Register
- `register.html`, `register.js`: สมัครสมาชิก; ถ้าพบชื่อบุคคลเดิม จะต้องใช้ Claim Code
- `login.html`, `login.js`: เข้าสู่ระบบด้วย Username = ชื่อจริง และ Password = เบอร์โทรศัพท์
- `main.html`, `main.js`: ค้นหาบุคคล
- `profile.html`, `profile.js`: ดูข้อมูลบุคคล; แก้ไข/ลบได้เฉพาะข้อมูลที่เชื่อมกับบัญชีตนเอง
- `common.js`: ฟังก์ชันร่วม
- `config.js`: Supabase URL และ publishable/anon key
- `02-claim-function-patch.sql`: ฟังก์ชัน Claim Code ที่ตรวจชื่อด้วย
- `04-relation-names.sql`: เก็บชื่อพ่อ/แม่/คู่สมรส และเชื่อมเป็นลิงก์อัตโนมัติเมื่อบุคคลนั้นลงทะเบียน
- `05-address-fields.sql`: คอลัมน์ที่อยู่แบบแยกส่วน (บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์)
- `address.js`, `th-address.json`: ตัวเลือกที่อยู่ไทย (77 จังหวัด 930 อำเภอ/เขต 7,436 ตำบล/แขวง พร้อมรหัสไปรษณีย์) ย่อจาก github.com/kongvut/thai-province-data

## ขั้นตอนติดตั้ง
1. เปิด `config.js` ตรวจสอบ Supabase URL และ publishable/anon key ให้เป็นของโปรเจกต์คุณ
2. ตรวจว่าได้สร้าง `person_claim_codes` และ `claim_existing_person(text)` ตาม SQL ที่ทำไว้ก่อนหน้าแล้ว
3. รัน `02-claim-function-patch.sql` ใน Supabase SQL Editor เพื่อสร้างฟังก์ชัน `claim_existing_person_by_name(text,text)` ซึ่งหน้า Register เรียกใช้
4. รัน `04-relation-names.sql` (ต้องรันก่อน deploy หน้าเว็บเวอร์ชันนี้ เพราะหน้าเว็บบันทึกคอลัมน์ `father_name`, `mother_name`, `spouse_name`)
5. รัน `05-address-fields.sql` (ต้องรันก่อน deploy หน้าเว็บเวอร์ชันนี้)
6. ตรวจว่า RLS บน `person` มี SELECT สำหรับ authenticated และ INSERT/UPDATE/DELETE เฉพาะ `auth_user_id = auth.uid()` เท่านั้น และไม่มี policy anon แบบเปิดกว้างหลงเหลือ
7. ใน Supabase Auth หากใช้ username ที่แปลงเป็นอีเมลภายใน ให้ปิด Confirm email สำหรับเดโมนี้ มิฉะนั้นต้องทำ flow ยืนยันบัญชีให้ครบก่อนเชื่อมข้อมูล
8. ตั้ง Storage bucket `family-avatars` เป็น public เพื่อให้ `getPublicUrl()` ใช้ได้ หรือปรับโค้ดเป็น signed URLs และกำหนด Storage policies ให้ปลอดภัย
9. เปิดผ่าน VS Code Live Server หรือเว็บเซิร์ฟเวอร์ ไม่แนะนำ `file://`

## การเชื่อมบุคคลเดิม
ผู้ดูแลสร้าง Claim Code สำหรับ `person.id` ที่ยืนยันตัวบุคคลแล้ว และส่งให้เจ้าตัวผ่านช่องทางที่เชื่อถือได้ รหัสมีอายุจำกัดและใช้ได้ครั้งเดียว อย่าออก Claim Code โดยอาศัยชื่ออย่างเดียว

## ข้อจำกัด/ความปลอดภัย
- Supabase Auth ไม่มี username แบบกำหนดเองโดยตรง โค้ดสร้างอีเมลภายในจาก hash ของ `ชื่อจริง|เบอร์โทร` (`accountEmail()` ใน `common.js`) จึงมีชื่อจริงซ้ำกันได้ถ้าเบอร์ต่างกัน
- เบอร์โทรถูก normalize เป็นตัวเลขล้วน (`081-234-5678`, `+66812345678` → `0812345678`) ทั้งตอนสมัครและล็อกอิน
- บัญชีที่สมัครด้วยระบบเดิม (Username = ชื่อ-นามสกุล) ยังล็อกอินได้โดยพิมพ์ชื่อ-นามสกุลเต็มในช่อง Username
- `supabase/functions/username-auth` ไม่ได้ถูกใช้โดยหน้าเว็บ และยังไม่ได้ deploy
- ตัวอย่างนี้ใช้เบอร์โทรศัพท์เป็น password ตามความต้องการเดิม แต่เบอร์โทรเดาได้ง่าย ไม่เหมาะกับระบบใช้งานจริง ควรให้ตั้งรหัสผ่านแยกหรือใช้ OTP
- ถ้าการสมัคร Auth สำเร็จแล้วแต่ขั้นตอนเชื่อมข้อมูลล้มเหลว บัญชี Auth อาจยังคงอยู่; ให้แก้สาเหตุแล้วเข้าสู่ระบบด้วยบัญชีนั้น ไม่ควรสมัครซ้ำ
- ลบแถว `person` ไม่ได้ลบบัญชี Auth อัตโนมัติ
- ห้ามนำ Supabase service_role key มาใส่ในไฟล์หน้าเว็บ

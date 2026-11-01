-- ล้างข้อมูลทั้งหมด เพื่อเริ่มใช้ระบบ Login ใหม่
-- รันใน Supabase SQL Editor ทีละส่วน (เลือกข้อความทีละ STEP แล้วกด Run)
-- คำเตือน: STEP 2 ลบข้อมูลถาวร ต้องทำ STEP 1 ให้สำเร็จก่อน

-- =========================================================
-- STEP 1: สำรองข้อมูลไว้ใน schema "backup" (ยังไม่ลบอะไร)
-- =========================================================
create schema if not exists backup;
revoke all on schema backup from anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['person','person_birth','person_child','person_claim_codes','username_accounts'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop table if exists backup.%I', t||'_20261101');
      execute format('create table backup.%I as table public.%I', t||'_20261101', t);
    end if;
  end loop;
end $$;

drop table if exists backup.auth_users_20261101;
create table backup.auth_users_20261101 as
  select id, email, phone, raw_user_meta_data, created_at from auth.users;

-- ตรวจว่าสำรองครบ: จำนวนแถวต้องเท่ากับตารางจริง
select 'person' as tbl, (select count(*) from public.person) as live,
       (select count(*) from backup.person_20261101) as backup
union all
select 'auth.users', (select count(*) from auth.users),
       (select count(*) from backup.auth_users_20261101);

-- =========================================================
-- STEP 2: ลบข้อมูลทั้งหมด (ถาวร)
-- =========================================================
do $$
declare t text;
begin
  foreach t in array array['person_child','person_birth','person_claim_codes','username_accounts','person'] loop
    if to_regclass('public.'||t) is not null then
      execute format('truncate table public.%I restart identity cascade', t);
    end if;
  end loop;
end $$;

-- ลบบัญชีผู้ใช้ทั้งหมดใน Supabase Auth (session/identity ถูกลบตามไปด้วย)
delete from auth.users;

-- =========================================================
-- STEP 3: ปิด policy เดโมเดิม ให้เหลือเฉพาะ 4 policy ของระบบ Login
-- =========================================================
-- ดู policy ที่มีอยู่ก่อน
select policyname, cmd, roles from pg_policies where schemaname='public' and tablename='person';

do $$
declare p text;
begin
  for p in
    select policyname from pg_policies
     where schemaname='public' and tablename='person'
       and policyname not in ('authenticated can read family people',
                              'authenticated can insert own person',
                              'authenticated can update own person',
                              'authenticated can delete own person')
  loop
    execute format('drop policy %I on public.person', p);
  end loop;
end $$;

-- จากนั้นรัน 01-login-schema.sql อีกครั้ง เพื่อให้แน่ใจว่า 4 policy มีครบ

-- =========================================================
-- STEP 4: ตรวจผล
-- =========================================================
select (select count(*) from public.person) as person_rows,
       (select count(*) from auth.users)    as auth_users;   -- ต้องเป็น 0 ทั้งคู่
-- ถ้ารัน 07-birthdates-children.sql แล้ว ตารางวันเกิด/บุตรธิดาต้องว่างด้วย
select (select count(*) from public.person_birth) as birth_rows,
       (select count(*) from public.person_child) as child_rows;
select policyname, cmd, roles from pg_policies where schemaname='public' and tablename='person';

-- =========================================================
-- กู้คืน (ถ้าต้องการ): ข้อมูลอยู่ใน backup.person_20261101 ฯลฯ
-- เมื่อมั่นใจว่าไม่ใช้แล้ว ลบสำรองได้ด้วย: drop schema backup cascade;
-- =========================================================

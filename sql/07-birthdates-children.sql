-- วันเกิด (ตัวเอง/พ่อ/แม่), บุตร/ธิดา และการเข้าสู่ระบบด้วยรหัสผ่านวันเกิด
-- รันใน Supabase SQL Editor หลัง 04-relation-names.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- กติกา:
--   * วันเกิดเก็บแยกตาราง person_birth และ person_child.birth_date อ่าน/แก้ได้เฉพาะเจ้าของข้อมูล
--   * คนอื่นเห็นแค่ "อายุ" ผ่านฟังก์ชัน person_family_info() ไม่เห็นวันเกิดจริง
--   * อายุคำนวณจากวันที่ปัจจุบัน (เวลาไทย) ทุกครั้งที่เรียก ไม่เก็บอายุลงตาราง
--   * วันที่เก็บเป็น ค.ศ.; หน้าเว็บรับ/แสดงปีเป็น พ.ศ. และรหัสผ่านเป็น DDMMYYYY (ปี พ.ศ.)
--   * รหัสผ่านอยู่ใน Supabase Auth เท่านั้น (hash) ไม่มีคอลัมน์รหัสผ่านในตารางใด

create table if not exists public.person_birth (
  person_id         bigint primary key references public.person(id) on delete cascade,
  birth_date        date,
  father_birth_date date,
  mother_birth_date date,
  constraint person_birth_range_chk check (
        coalesce(birth_date,        '1900-01-01') >= '1800-01-01'
    and coalesce(father_birth_date, '1900-01-01') >= '1800-01-01'
    and coalesce(mother_birth_date, '1900-01-01') >= '1800-01-01')
);

create table if not exists public.person_child (
  id         bigint generated always as identity primary key,
  person_id  bigint not null references public.person(id) on delete cascade,
  relation   text not null check (relation in ('son','daughter')),
  name       text not null check (btrim(name) <> ''),
  birth_date date check (birth_date is null or birth_date >= '1800-01-01'),
  created_at timestamptz not null default now()
);
create index if not exists person_child_person_idx on public.person_child (person_id);

alter table public.person_birth enable row level security;
alter table public.person_child enable row level security;

-- เจ้าของข้อมูล = บัญชีที่ผูกกับ person นั้น
create or replace function public.owns_person(p_person_id bigint)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$ select exists (select 1 from public.person where id = p_person_id and auth_user_id = auth.uid()) $$;
revoke all on function public.owns_person(bigint) from public, anon;
grant execute on function public.owns_person(bigint) to authenticated;

drop policy if exists "owner manages birth dates" on public.person_birth;
create policy "owner manages birth dates" on public.person_birth
  for all to authenticated
  using (public.owns_person(person_id))
  with check (public.owns_person(person_id));

drop policy if exists "owner manages children" on public.person_child;
create policy "owner manages children" on public.person_child
  for all to authenticated
  using (public.owns_person(person_id))
  with check (public.owns_person(person_id));

revoke all on public.person_birth, public.person_child from anon;

-- อายุเต็มปี ณ วันนี้ (เวลาไทย) นับว่าวันเกิดปีนี้ผ่านมาแล้วหรือยัง; ไม่มีวันเกิด → null (หน้าเว็บแสดง "ไม่ระบุ")
create or replace function public.age_years(d date)
returns integer language sql stable
as $$ select case when d is null then null
                  else date_part('year', age((now() at time zone 'Asia/Bangkok')::date, d))::integer end $$;

-- ข้อมูลที่หน้าโปรไฟล์ใช้แสดง: อายุของบุคคล พ่อ แม่ และรายชื่อบุตร/ธิดาพร้อมอายุ (ไม่มีวันเกิดจริง)
create or replace function public.person_family_info(p_person_id bigint)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'age',        public.age_years(b.birth_date),
    'father_age', public.age_years(b.father_birth_date),
    'mother_age', public.age_years(b.mother_birth_date),
    'children',   coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'relation', c.relation, 'name', c.name,
                                            'age', public.age_years(c.birth_date)) order by c.id)
          from public.person_child c where c.person_id = p.id), '[]'::jsonb))
    from public.person p
    left join public.person_birth b on b.person_id = p.id
   where p.id = p_person_id and auth.uid() is not null
$$;
revoke all on function public.person_family_info(bigint) from public, anon;
grant execute on function public.person_family_info(bigint) to authenticated;

-- หน้า Login: หาอีเมลภายในของบัญชีจาก Username (ชื่อจริง หรือชื่อ-นามสกุลของบัญชีระบบเดิม)
-- แล้วหน้าเว็บลองเข้าสู่ระบบด้วยรหัสผ่านที่กรอกกับแต่ละบัญชี (อีเมลเป็น hash ไม่ใช่ข้อมูลส่วนตัว)
create or replace function public.login_emails(p_username text)
returns setof text language sql stable security definer
set search_path = pg_catalog, public
as $$
  select u.email::text
    from public.person p
    join auth.users u on u.id = p.auth_user_id
   where public.norm_name(p_username) is not null
     and (split_part(public.norm_name(p.full_name), ' ', 1) = public.norm_name(p_username)
          or public.norm_name(p.full_name) = public.norm_name(p_username))
   order by p.id
   limit 5
$$;
revoke all on function public.login_emails(text) from public;
grant execute on function public.login_emails(text) to anon, authenticated;

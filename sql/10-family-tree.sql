-- คำนำหน้า, เบอร์คู่สมรส, สถานะมีชีวิตของพ่อ/แม่ และข้อมูลสำหรับแผนภาพต้นไม้ครอบครัว
-- รันใน Supabase SQL Editor หลัง 09-child-links.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- กติกา:
--   * prefix เก็บแยกจากชื่อ ใช้แสดงผลเท่านั้น (นำหน้าชื่อ-นามสกุล) ไม่เกี่ยวกับการเชื่อมความสัมพันธ์
--     ความสัมพันธ์ทั้งหมดอ้างอิง person.id (father_id / mother_id / spouse_id / person_child.child_person_id)
--   * father_alive / mother_alive: true = มีชีวิต, false = เสียชีวิต, null = ไม่มีข้อมูล (แถวเดิมเป็น null)
--   * เบอร์คู่สมรสเก็บในตาราง person_private อ่าน/แก้ได้เฉพาะเจ้าของข้อมูล (RLS)
--   * family_tree_data() คืนเฉพาะความสัมพันธ์ที่ผูกกับบุคคลในระบบแล้ว (มี id) ไม่เดาจากนามสกุล

alter table public.person
  add column if not exists prefix text,
  add column if not exists father_alive boolean,
  add column if not exists mother_alive boolean;

alter table public.person drop constraint if exists person_prefix_chk;
alter table public.person
  add constraint person_prefix_chk
  check (prefix is null or char_length(btrim(prefix)) between 1 and 20);

create table if not exists public.person_private (
  person_id    bigint primary key references public.person(id) on delete cascade,
  spouse_phone text check (spouse_phone is null or spouse_phone ~ '^0[0-9]{8,9}$')
);

alter table public.person_private enable row level security;

drop policy if exists "owner manages private info" on public.person_private;
create policy "owner manages private info" on public.person_private
  for all to authenticated
  using (public.owns_person(person_id))
  with check (public.owns_person(person_id));

revoke all on public.person_private from anon;

-- หน้าโปรไฟล์: เพิ่ม prefix ของบุตร/ธิดาที่เชื่อมแล้ว (นอกนั้นเหมือน 09-child-links.sql)
create or replace function public.person_family_info(p_person_id bigint)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'age',        public.age_years(b.birth_date),
    'father_age', public.age_years(b.father_birth_date),
    'mother_age', public.age_years(b.mother_birth_date),
    'children',   coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'relation', c.relation, 'name', c.name,
                 'person_id', cp.id, 'prefix', cp.prefix, 'full_name', cp.full_name, 'nickname', cp.nickname,
                 'age', public.age_years(coalesce(c.birth_date, cb.birth_date))) order by c.id)
          from public.person_child c
          left join public.person cp on cp.id = c.child_person_id
          left join public.person_birth cb on cb.person_id = cp.id
         where c.person_id = p.id), '[]'::jsonb))
    from public.person p
    left join public.person_birth b on b.person_id = p.id
   where p.id = p_person_id and auth.uid() is not null
$$;
revoke all on function public.person_family_info(bigint) from public, anon;
grant execute on function public.person_family_info(bigint) to authenticated;

-- แผนภาพต้นไม้: บุคคลทั้งหมด + ลิงก์ บิดา/มารดา/คู่สมรส (จาก person) + ลิงก์บุตร/ธิดา (จาก person_child)
-- person_child อ่านตรง ๆ ไม่ได้ (RLS เจ้าของเท่านั้น) จึงคืนเฉพาะคู่ id ที่เชื่อมแล้ว ไม่มีวันเกิดหรือชื่อที่ยังไม่ลงทะเบียน
create or replace function public.family_tree_data()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'people', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', p.id, 'prefix', p.prefix, 'full_name', p.full_name, 'nickname', p.nickname,
                 'gender', p.gender, 'avatar_path', p.avatar_path,
                 'father_id', p.father_id, 'mother_id', p.mother_id, 'spouse_id', p.spouse_id,
                 'father_alive', p.father_alive, 'mother_alive', p.mother_alive) order by p.id)
          from public.person p), '[]'::jsonb),
    'child_links', coalesce((
        select jsonb_agg(jsonb_build_object('parent_id', c.person_id, 'child_id', c.child_person_id))
          from public.person_child c
         where c.child_person_id is not null), '[]'::jsonb))
   where auth.uid() is not null
$$;
revoke all on function public.family_tree_data() from public, anon;
grant execute on function public.family_tree_data() to authenticated;

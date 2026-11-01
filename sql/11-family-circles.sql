-- แยก "วงครอบครัว": ผู้ใช้เห็นเฉพาะคนในวงของตัวเอง ไม่เห็นรายชื่อของสกุลอื่นที่ไม่เกี่ยวข้อง
-- รันใน Supabase SQL Editor หลัง 10-family-tree.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- วงของผู้ใช้ = (1) คนที่นามสกุลเดียวกัน
--            + (2) คนที่เชื่อมถึงกันด้วยความสัมพันธ์ที่ผูก id แล้ว (บิดา/มารดา/คู่สมรส/บุตรธิดา) ต่อเนื่องจากตัวผู้ใช้
--   ข้อ (2) ทำให้คู่สมรสและญาติฝั่งอื่นที่ต่างนามสกุลยังอยู่ในต้นไม้ได้
--   ข้อ (1) ใช้เพื่อกำหนดว่าใครมองเห็นใครเท่านั้น ไม่ได้สร้างความสัมพันธ์ในแผนภาพ
--   ข้อ (2) เริ่มนับจากตัวผู้ใช้เท่านั้น ไม่ขยายต่อจากคนสกุลเดียวกัน กันวงบานข้ามตระกูล
-- นามสกุล = ข้อความหลังคำแรกของชื่อ-นามสกุล (ชื่อจริงเป็นคำเดียวตามที่ระบบบังคับ)
-- ผู้ใช้ที่ยังไม่มีข้อมูลบุคคลจะเห็นแต่แถวของตัวเอง

create or replace function public.surname_of(t text)
returns text language sql immutable
as $$
  select case when public.norm_name(t) like '% %'
              then substr(public.norm_name(t), position(' ' in public.norm_name(t)) + 1) end
$$;

create or replace function public.visible_person_ids()
returns setof bigint language sql stable security definer
set search_path = pg_catalog, public
as $$
  with recursive
  me as (
    select id, public.surname_of(full_name) as sn
      from public.person where auth_user_id = auth.uid()),
  edges as (
    select id as a, father_id as b from public.person where father_id is not null
    union all select id, mother_id from public.person where mother_id is not null
    union all select id, spouse_id from public.person where spouse_id is not null
    union all select person_id, child_person_id from public.person_child where child_person_id is not null),
  sym as (select a, b from edges union select b, a from edges),
  reach(id) as (
    select id from me
    union
    select s.b from reach r join sym s on s.a = r.id)
  select id from reach
  union
  select p.id from public.person p join me on me.sn is not null and public.surname_of(p.full_name) = me.sn
$$;
revoke all on function public.visible_person_ids() from public, anon;
grant execute on function public.visible_person_ids() to authenticated;

-- แทนที่ policy เดิม "อ่านได้ทุกคน" ด้วย "อ่านได้เฉพาะวงของตัวเอง"
-- (แถวของตัวเองต้องอ่านได้เสมอ เพื่อให้ insert ... returning หลังสมัครใช้ได้)
drop policy if exists "authenticated can read family people" on public.person;
drop policy if exists "read own family circle" on public.person;
create policy "read own family circle" on public.person
  for select to authenticated
  using (auth_user_id = auth.uid() or id in (select public.visible_person_ids()));

-- หน้าลงทะเบียน: เช็กว่ามีชื่อนี้ในทะเบียนแล้วหรือไม่ โดยไม่เปิดรายชื่อ (ผู้สมัครใหม่ยังไม่มีวงของตัวเอง)
create or replace function public.person_name_taken(p_name text)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.person where public.norm_name(full_name) = public.norm_name(p_name))
$$;
revoke all on function public.person_name_taken(text) from public, anon;
grant execute on function public.person_name_taken(text) to authenticated;

-- อายุ/บุตรธิดาในหน้าโปรไฟล์: ดูได้เฉพาะคนในวงของตัวเอง (นอกนั้นเหมือน 10-family-tree.sql)
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
     and p.id in (select public.visible_person_ids())
$$;
revoke all on function public.person_family_info(bigint) from public, anon;
grant execute on function public.person_family_info(bigint) to authenticated;

-- แผนภาพต้นไม้: เฉพาะบุคคลและลิงก์ในวงของตัวเอง (นอกนั้นเหมือน 10-family-tree.sql)
create or replace function public.family_tree_data()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  with vis as (select public.visible_person_ids() as id)
  select jsonb_build_object(
    'people', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', p.id, 'prefix', p.prefix, 'full_name', p.full_name, 'nickname', p.nickname,
                 'gender', p.gender, 'avatar_path', p.avatar_path,
                 'father_id', p.father_id, 'mother_id', p.mother_id, 'spouse_id', p.spouse_id,
                 'father_alive', p.father_alive, 'mother_alive', p.mother_alive) order by p.id)
          from public.person p where p.id in (select id from vis)), '[]'::jsonb),
    'child_links', coalesce((
        select jsonb_agg(jsonb_build_object('parent_id', c.person_id, 'child_id', c.child_person_id))
          from public.person_child c
         where c.child_person_id is not null
           and c.person_id in (select id from vis)
           and c.child_person_id in (select id from vis)), '[]'::jsonb))
   where auth.uid() is not null
$$;
revoke all on function public.family_tree_data() from public, anon;
grant execute on function public.family_tree_data() to authenticated;

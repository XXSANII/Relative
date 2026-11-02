-- สถานะเสียชีวิตของบุคคล (แสดงในแผนภาพเป็นสีเทา)
-- รันใน Supabase SQL Editor หลัง 13-tree-age.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- กติกา: ไม่บังคับ; null/false = ยังมีชีวิต (แถวเดิมทั้งหมดเป็น false)
--        แก้ได้เฉพาะเจ้าของข้อมูล (ผ่าน RLS เดิมของ person)

alter table public.person
  add column if not exists deceased boolean not null default false;

-- family_tree_data(): เพิ่ม deceased (โครงสร้างเดิมจาก 13-tree-age.sql)
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
                 'father_alive', p.father_alive, 'mother_alive', p.mother_alive,
                 'deceased', p.deceased,
                 'age', public.age_years(b.birth_date)) order by p.id)
          from public.person p
          left join public.person_birth b on b.person_id = p.id
         where p.id in (select id from vis)), '[]'::jsonb),
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

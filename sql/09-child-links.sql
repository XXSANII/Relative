-- เชื่อมบุตร/ธิดากับบุคคลในระบบจากชื่อ แบบเดียวกับพ่อ/แม่/คู่สมรส (04-relation-names.sql)
-- รันใน Supabase SQL Editor หลัง 04, 07 และ 08 (รันซ้ำได้)
--
-- กติกา:
--   * ชื่อบุตร/ธิดาตรงกับบุคคลในระบบ "คนเดียว" → ใส่ child_person_id ให้ หน้าโปรไฟล์กดเข้าไปดูได้
--   * ยังไม่มีในระบบ → child_person_id เป็น null แสดงเป็นข้อความ
--   * เมื่อบุคคลนั้นลงทะเบียนภายหลัง → เชื่อมให้อัตโนมัติ
--   * ชื่อซ้ำมากกว่า 1 คน → ไม่เชื่อมใหม่ (กันเชื่อมผิดคน) แต่ลิงก์ที่มีอยู่แล้วจะคงไว้
--   * บุคคลที่เชื่อมอยู่เปลี่ยนชื่อ → ชื่อในรายการบุตร/ธิดาเปลี่ยนตาม

alter table public.person_child
  add column if not exists child_person_id bigint references public.person(id) on delete set null;
create index if not exists person_child_child_idx on public.person_child (child_person_id);

-- ก่อนบันทึก: แปลงชื่อเป็น id ทุกครั้ง (ค่า child_person_id ที่ส่งมาเองจะถูกเก็บไว้ก็ต่อเมื่อชื่อตรงกันเท่านั้น)
create or replace function public.person_child_resolve()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  new.child_person_id := public.relation_id(new.name, new.child_person_id, new.person_id);
  return new;
end $$;

drop trigger if exists person_child_resolve on public.person_child;
create trigger person_child_resolve
  before insert or update on public.person_child
  for each row execute function public.person_child_resolve();

-- หลังเพิ่มคน/เปลี่ยนชื่อ: อัปเดตรายการบุตร/ธิดาของคนอื่น (ข้าม RLS เพราะเป็นข้อมูลของคนอื่น)
create or replace function public.person_link_children()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE' then
    update public.person_child set name = new.full_name where child_person_id = new.id;
  end if;
  update public.person_child c set child_person_id = public.person_id_by_name(c.name, c.person_id)
   where c.child_person_id is null and public.norm_name(c.name) = public.norm_name(new.full_name);
  return null;
end $$;

drop trigger if exists person_link_children on public.person;
create trigger person_link_children
  after insert or update of full_name on public.person
  for each row execute function public.person_link_children();

-- เมื่อลบคน: ลิงก์ถูกตั้งเป็น null (FK on delete set null) ชื่อยังอยู่
-- ถ้ามีคนอื่นชื่อเดียวกันเหลือเพียงคนเดียว → เชื่อมไปที่คนนั้น
create or replace function public.person_child_relink_after_delete()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  update public.person_child c set child_person_id = public.person_id_by_name(c.name, c.person_id)
   where c.child_person_id is null and public.norm_name(c.name) = public.norm_name(old.full_name);
  return null;
end $$;

drop trigger if exists person_child_relink_after_delete on public.person;
create trigger person_child_relink_after_delete
  after delete on public.person
  for each row execute function public.person_child_relink_after_delete();

revoke all on function public.person_child_resolve() from public, anon, authenticated;
revoke all on function public.person_link_children() from public, anon, authenticated;
revoke all on function public.person_child_relink_after_delete() from public, anon, authenticated;

-- หน้าโปรไฟล์: เพิ่ม id/ชื่อ/ชื่อเล่นของบุตร/ธิดาที่เชื่อมแล้ว
-- อายุใช้วันเกิดที่ผู้ปกครองกรอก ถ้าไม่ได้กรอกใช้วันเกิดของบุตร/ธิดาที่ลงทะเบียนเอง (ยังคืนเฉพาะอายุ)
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
                 'person_id', cp.id, 'full_name', cp.full_name, 'nickname', cp.nickname,
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

-- เชื่อมรายการบุตร/ธิดาที่มีอยู่แล้ว (ทริกเกอร์ก่อนบันทึกจะหา id จากชื่อ)
update public.person_child set name = name;

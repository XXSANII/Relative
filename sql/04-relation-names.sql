-- เก็บชื่อพ่อ/แม่/คู่สมรสเป็นข้อความ แล้วเชื่อมเป็นลิงก์ (id) อัตโนมัติเมื่อบุคคลนั้นมีในระบบ
-- รันใน Supabase SQL Editor หลัง 01-login-schema.sql (รันซ้ำได้)
--
-- กติกา:
--   * ผู้ใช้กรอกชื่อ-นามสกุลของพ่อ/แม่/คู่สมรส → บันทึกใน father_name / mother_name / spouse_name
--   * ถ้ามีชื่อนั้นในระบบ "คนเดียว" → ใส่ father_id / mother_id / spouse_id ให้ทันที (หน้าเว็บกดเข้าไปดูได้)
--   * ถ้ายังไม่มี → id เป็น null (หน้าเว็บแสดงเป็นข้อความ กดไม่ได้)
--   * เมื่อบุคคลนั้นลงทะเบียนภายหลัง → ทุกคนที่กรอกชื่อนี้ไว้จะถูกเชื่อมให้อัตโนมัติ
--   * ถ้าชื่อซ้ำกันมากกว่า 1 คน จะไม่เชื่อมใหม่ (กันเชื่อมผิดคน) แต่ลิงก์ที่มีอยู่แล้วจะคงไว้
--   * ถ้าบุคคลเปลี่ยนชื่อ ลิงก์เดิมยังอยู่ และชื่อที่ผู้อื่นกรอกไว้จะเปลี่ยนตาม

alter table public.person
  add column if not exists father_name text,
  add column if not exists mother_name text,
  add column if not exists spouse_name text;

create or replace function public.norm_name(t text)
returns text language sql immutable
as $$ select nullif(lower(regexp_replace(btrim(coalesce(t,'')), '\s+', ' ', 'g')), '') $$;

create index if not exists person_full_name_norm_idx on public.person (public.norm_name(full_name));

-- คืน id ของบุคคลที่ชื่อตรงกันเพียงคนเดียว (ไม่รวมตัวเอง) มิฉะนั้นคืน null
create or replace function public.person_id_by_name(p_name text, p_exclude bigint)
returns bigint language sql stable security definer
set search_path = pg_catalog, public
as $$
  select case when count(*) = 1 then min(id) end
    from public.person
   where public.norm_name(full_name) = public.norm_name(p_name)
     and id is distinct from p_exclude
$$;
revoke all on function public.person_id_by_name(text, bigint) from public, anon, authenticated;

-- ถ้า id ปัจจุบันชี้ไปที่คนชื่อนี้อยู่แล้วให้คงไว้ (กรณีชื่อซ้ำแต่เคยเชื่อมถูกคนแล้ว) มิฉะนั้นหาใหม่จากชื่อ
create or replace function public.relation_id(p_name text, p_current bigint, p_self bigint)
returns bigint language sql stable security definer
set search_path = pg_catalog, public
as $$
  select case
    when public.norm_name(p_name) is null then null
    when exists (select 1 from public.person
                  where id = p_current and id is distinct from p_self
                    and public.norm_name(full_name) = public.norm_name(p_name)) then p_current
    else public.person_id_by_name(p_name, p_self)
  end
$$;
revoke all on function public.relation_id(text, bigint, bigint) from public, anon, authenticated;

-- ก่อนบันทึกแถว: แปลงชื่อพ่อ/แม่/คู่สมรสเป็น id
create or replace function public.person_resolve_relations()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  new.father_name := nullif(btrim(regexp_replace(new.father_name, '\s+', ' ', 'g')), '');
  new.mother_name := nullif(btrim(regexp_replace(new.mother_name, '\s+', ' ', 'g')), '');
  new.spouse_name := nullif(btrim(regexp_replace(new.spouse_name, '\s+', ' ', 'g')), '');
  new.father_id := public.relation_id(new.father_name, new.father_id, new.id);
  new.mother_id := public.relation_id(new.mother_name, new.mother_id, new.id);
  new.spouse_id := public.relation_id(new.spouse_name, new.spouse_id, new.id);
  return new;
end $$;

drop trigger if exists person_resolve_relations on public.person;
create trigger person_resolve_relations
  before insert or update of father_name, mother_name, spouse_name on public.person
  for each row execute function public.person_resolve_relations();

-- หลังเพิ่มคน/เปลี่ยนชื่อ: อัปเดตแถวของคนอื่น (ข้าม RLS เพราะแถวเป็นของคนอื่น)
create or replace function public.person_link_waiting()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  -- เปลี่ยนชื่อ: คนที่เชื่อมกับคนนี้อยู่แล้ว ให้ชื่อที่เก็บไว้เปลี่ยนตาม (ลิงก์ยังอยู่)
  if tg_op = 'UPDATE' then
    update public.person set father_name = new.full_name where father_id = new.id;
    update public.person set mother_name = new.full_name where mother_id = new.id;
    update public.person set spouse_name = new.full_name where spouse_id = new.id;
  end if;
  -- คนที่กรอกชื่อนี้ไว้แต่ยังไม่มีลิงก์ → เชื่อมให้ (ถ้าชื่อไม่ซ้ำ)
  update public.person c set father_id = public.person_id_by_name(c.father_name, c.id)
   where c.father_id is null and public.norm_name(c.father_name) = public.norm_name(new.full_name);
  update public.person c set mother_id = public.person_id_by_name(c.mother_name, c.id)
   where c.mother_id is null and public.norm_name(c.mother_name) = public.norm_name(new.full_name);
  update public.person c set spouse_id = public.person_id_by_name(c.spouse_name, c.id)
   where c.spouse_id is null and public.norm_name(c.spouse_name) = public.norm_name(new.full_name);
  return null;
end $$;

drop trigger if exists person_link_waiting on public.person;
create trigger person_link_waiting
  after insert or update of full_name on public.person
  for each row execute function public.person_link_waiting();

-- เมื่อลบคน: ลิงก์ที่ชี้มาถูกตั้งเป็น null (FK on delete set null) ชื่อยังเก็บไว้
-- ถ้ามีคนอื่นชื่อเดียวกันเหลือเพียงคนเดียว → เชื่อมไปที่คนนั้น
create or replace function public.person_relink_after_delete()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  update public.person c set father_id = public.person_id_by_name(c.father_name, c.id)
   where c.father_id is null and public.norm_name(c.father_name) = public.norm_name(old.full_name);
  update public.person c set mother_id = public.person_id_by_name(c.mother_name, c.id)
   where c.mother_id is null and public.norm_name(c.mother_name) = public.norm_name(old.full_name);
  update public.person c set spouse_id = public.person_id_by_name(c.spouse_name, c.id)
   where c.spouse_id is null and public.norm_name(c.spouse_name) = public.norm_name(old.full_name);
  return null;
end $$;

drop trigger if exists person_relink_after_delete on public.person;
create trigger person_relink_after_delete
  after delete on public.person
  for each row execute function public.person_relink_after_delete();

revoke all on function public.person_resolve_relations() from public, anon, authenticated;
revoke all on function public.person_link_waiting() from public, anon, authenticated;
revoke all on function public.person_relink_after_delete() from public, anon, authenticated;

-- เติมชื่อให้แถวเดิมที่มี id อยู่แล้วแต่ยังไม่มีชื่อ
update public.person c set father_name = p.full_name from public.person p
 where c.father_id = p.id and c.father_name is null;
update public.person c set mother_name = p.full_name from public.person p
 where c.mother_id = p.id and c.mother_name is null;
update public.person c set spouse_name = p.full_name from public.person p
 where c.spouse_id = p.id and c.spouse_name is null;

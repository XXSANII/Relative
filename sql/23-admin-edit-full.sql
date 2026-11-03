-- ผู้ดูแลตระกูล (หรือผู้ดูแลสูงสุด) แก้ไขข้อมูลของสมาชิกหลักได้ครบทุกอย่าง รวมถึงบุตร/ธิดา
-- รันใน Supabase SQL Editor หลัง 18-admin-edit-linked.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
--   * ระดับสิทธิ์ใช้ clan_person_level() เดิม: เฉพาะระดับ 'full' (สมาชิกหลักของตระกูลที่ดูแล / ผู้ดูแลสูงสุด)
--     ที่อ่านและแก้วันเกิด วันเกิดพ่อ/แม่ เบอร์คู่สมรส และรายชื่อบุตร/ธิดาได้
--   * ระดับ 'basic' (ผู้เชื่อมโยง) ยังแก้ได้เฉพาะข้อมูลพื้นฐานเหมือนเดิม

-- ข้อมูลที่ใช้เติมฟอร์มแก้ไข: เพิ่มวันเกิด วันเกิดพ่อ/แม่ เบอร์คู่สมรส และบุตร/ธิดา (เฉพาะระดับ full)
create or replace function public.clan_get_person(p_person_id bigint)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare lvl text := public.clan_person_level(p_person_id);
begin
  if lvl is null then raise exception 'ไม่มีสิทธิ์ดูข้อมูลบุคคลนี้'; end if;
  return (select jsonb_build_object('level', lvl)
          || jsonb_build_object('prefix', p.prefix, 'full_name', p.full_name, 'nickname', p.nickname,
                                'gender', p.gender, 'deceased', p.deceased)
          || case when lvl = 'full' then jsonb_build_object(
               'phone', p.phone, 'line_id', p.line_id, 'father_name', p.father_name,
               'mother_name', p.mother_name, 'spouse_name', p.spouse_name, 'house_no', p.house_no,
               'road', p.road, 'subdistrict', p.subdistrict, 'district', p.district,
               'province', p.province, 'postal_code', p.postal_code,
               'father_alive', p.father_alive, 'mother_alive', p.mother_alive,
               'birth_date', b.birth_date, 'father_birth_date', b.father_birth_date,
               'mother_birth_date', b.mother_birth_date, 'spouse_phone', pp.spouse_phone,
               'children', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', c.id, 'relation', c.relation, 'name', c.name, 'birth_date', c.birth_date) order by c.id)
                  from public.person_child c where c.person_id = p.id), '[]'::jsonb))
             else '{}'::jsonb end
            from public.person p
            left join public.person_birth b on b.person_id = p.id
            left join public.person_private pp on pp.person_id = p.id
           where p.id = p_person_id);
end $$;
revoke all on function public.clan_get_person(bigint) from public, anon;
grant execute on function public.clan_get_person(bigint) to authenticated;

-- แก้ไขข้อมูล: เพิ่ม father_birth_date, mother_birth_date, spouse_phone (ระดับ full เท่านั้น)
-- และ children = [{id?, relation, name, birth_date}] ทั้งรายการ (ไม่ส่ง = ไม่แตะ), removed_children = [id, ...]
create or replace function public.clan_update_person(p_person_id bigint, p_patch jsonb)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare k text; c jsonb; cid bigint;
  lvl text := public.clan_person_level(p_person_id);
  basic constant text[] := array['prefix','nickname','gender'];
  more  constant text[] := array['phone','line_id','house_no','road','subdistrict','district','province',
                                 'postal_code','father_name','mother_name','spouse_name'];
begin
  if lvl is null then raise exception 'ไม่มีสิทธิ์แก้ไขข้อมูลบุคคลนี้'; end if;
  if lvl = 'basic' then
    for k in select jsonb_object_keys(p_patch) loop
      if k <> all (basic || array['full_name','deceased','birth_date']) then
        raise exception 'ผู้เชื่อมโยงแก้ไขได้เฉพาะ คำนำหน้า ชื่อ-นามสกุล ชื่อเล่น เพศ วันเกิด และสถานะเสียชีวิต';
      end if;
    end loop;
  end if;
  foreach k in array (case when lvl = 'full' then basic || more else basic end) loop
    if p_patch ? k then
      execute format('update public.person set %I = nullif(btrim($1), '''') where id = $2', k)
        using p_patch ->> k, p_person_id;
    end if;
  end loop;
  if p_patch ? 'full_name' and nullif(btrim(p_patch ->> 'full_name'), '') is not null then
    update public.person set full_name = btrim(p_patch ->> 'full_name') where id = p_person_id;
  end if;
  if lvl = 'full' and p_patch ? 'father_alive' then
    update public.person set father_alive = (p_patch ->> 'father_alive')::boolean where id = p_person_id; end if;
  if lvl = 'full' and p_patch ? 'mother_alive' then
    update public.person set mother_alive = (p_patch ->> 'mother_alive')::boolean where id = p_person_id; end if;
  if p_patch ? 'deceased' then
    update public.person set deceased = coalesce((p_patch ->> 'deceased')::boolean, false) where id = p_person_id; end if;

  if p_patch ? 'birth_date' then
    insert into public.person_birth (person_id, birth_date)
    values (p_person_id, nullif(btrim(p_patch ->> 'birth_date'), '')::date)
    on conflict (person_id) do update set birth_date = excluded.birth_date;
  end if;
  if lvl = 'full' and p_patch ? 'father_birth_date' then
    insert into public.person_birth (person_id, father_birth_date)
    values (p_person_id, nullif(btrim(p_patch ->> 'father_birth_date'), '')::date)
    on conflict (person_id) do update set father_birth_date = excluded.father_birth_date;
  end if;
  if lvl = 'full' and p_patch ? 'mother_birth_date' then
    insert into public.person_birth (person_id, mother_birth_date)
    values (p_person_id, nullif(btrim(p_patch ->> 'mother_birth_date'), '')::date)
    on conflict (person_id) do update set mother_birth_date = excluded.mother_birth_date;
  end if;
  if lvl = 'full' and p_patch ? 'spouse_phone' then
    insert into public.person_private (person_id, spouse_phone)
    values (p_person_id, nullif(btrim(p_patch ->> 'spouse_phone'), ''))
    on conflict (person_id) do update set spouse_phone = excluded.spouse_phone;
  end if;

  -- บุตร/ธิดา: ลบตาม removed_children, แล้วอัปเดต/เพิ่มตามรายการ (ลิงก์ id จากชื่อทำโดยทริกเกอร์ person_child_resolve)
  if lvl = 'full' and p_patch ? 'removed_children' then
    delete from public.person_child
     where person_id = p_person_id
       and id in (select (jsonb_array_elements_text(p_patch -> 'removed_children'))::bigint);
  end if;
  if lvl = 'full' and p_patch ? 'children' then
    for c in select * from jsonb_array_elements(p_patch -> 'children') loop
      if c ->> 'relation' not in ('son','daughter') or nullif(btrim(c ->> 'name'), '') is null then
        raise exception 'ข้อมูลบุตร/ธิดาไม่ถูกต้อง';
      end if;
      cid := nullif(c ->> 'id', '')::bigint;
      if cid is not null then
        update public.person_child
           set relation = c ->> 'relation', name = btrim(c ->> 'name'),
               birth_date = nullif(btrim(c ->> 'birth_date'), '')::date
         where id = cid and person_id = p_person_id;
        if not found then raise exception 'ไม่พบรายการบุตร/ธิดาที่จะแก้ไข'; end if;
      else
        insert into public.person_child (person_id, relation, name, birth_date)
        values (p_person_id, c ->> 'relation', btrim(c ->> 'name'),
                nullif(btrim(c ->> 'birth_date'), '')::date);
      end if;
    end loop;
  end if;
end $$;
revoke all on function public.clan_update_person(bigint, jsonb) from public, anon;
grant execute on function public.clan_update_person(bigint, jsonb) to authenticated;

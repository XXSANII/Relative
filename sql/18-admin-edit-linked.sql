-- ผู้ดูแลแก้ไขข้อมูล "ผู้เชื่อมโยง" ได้ด้วย (นอกจากสมาชิกหลัก)
-- รันใน Supabase SQL Editor หลัง 17-clan-tree.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- ระดับสิทธิ์ต่อบุคคล (clan_person_level)
--   full  = เป็นสมาชิกหลักของตระกูลที่ฉันดูแล (หรือฉันเป็นผู้ดูแลสูงสุด): แก้ได้ทุกฟิลด์เหมือนเดิม
--   basic = เป็นผู้เชื่อมโยงของตระกูลที่ฉันดูแล: แก้ได้เฉพาะ คำนำหน้า ชื่อ-นามสกุล ชื่อเล่น เพศ วันเกิด สถานะเสียชีวิต
--           ไม่เห็น/ไม่แก้ เบอร์โทร LINE ที่อยู่ และชื่อพ่อแม่/คู่สมรส (ข้อมูลเหล่านี้เป็นของตระกูลต้นทางของเขา
--           และชื่อพ่อแม่/คู่สมรสเป็นตัวกำหนดความเชื่อมโยง ไม่ควรให้ตระกูลอื่นเปลี่ยน)

create or replace function public.clan_person_level(p_person_id bigint)
returns text language sql stable security definer
set search_path = pg_catalog, public
as $$
  select case
    when auth.uid() is null then null
    when public.is_super_admin() then 'full'
    when exists (select 1 from public.clan_member m
                  where m.person_id = p_person_id and m.role = 'member' and public.is_clan_admin(m.clan_id)) then 'full'
    when exists (select 1 from public.clan_member m
                  where m.person_id = p_person_id and m.role = 'linked' and public.is_clan_admin(m.clan_id)) then 'basic'
  end
$$;
revoke all on function public.clan_person_level(bigint) from public, anon;
grant execute on function public.clan_person_level(bigint) to authenticated;

-- ข้อมูลที่ใช้เติมฟอร์มแก้ไข (ผู้ดูแลอ่านผู้เชื่อมโยงผ่าน RLS ของ person ไม่ได้ จึงอ่านผ่านฟังก์ชันนี้ตามระดับสิทธิ์)
-- วันเกิดไม่คืนค่า (อยู่ในตารางที่เจ้าของเท่านั้นอ่านได้) หน้าเว็บเว้นว่างไว้ ใส่เฉพาะตอนต้องการแก้
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
               'father_alive', p.father_alive, 'mother_alive', p.mother_alive)
             else '{}'::jsonb end
            from public.person p where p.id = p_person_id);
end $$;
revoke all on function public.clan_get_person(bigint) from public, anon;
grant execute on function public.clan_get_person(bigint) to authenticated;

-- แทนฟังก์ชันเดิมจาก 16-clans.sql: ตรวจระดับสิทธิ์ และจำกัดคีย์ตามระดับ
create or replace function public.clan_update_person(p_person_id bigint, p_patch jsonb)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare k text;
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
end $$;
revoke all on function public.clan_update_person(bigint, jsonb) from public, anon;
grant execute on function public.clan_update_person(bigint, jsonb) to authenticated;

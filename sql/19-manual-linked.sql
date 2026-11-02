-- ผู้ดูแลเพิ่ม "ผู้เชื่อมโยง" เองได้ (นอกจากที่ระบบคำนวณจากความสัมพันธ์)
-- รันใน Supabase SQL Editor หลัง 18-admin-edit-linked.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- กติกา
--   * clan_member.manual = true คือผู้เชื่อมโยงที่ผู้ดูแลเพิ่มเอง การคำนวณใหม่ (clan_rebuild_links) จะไม่ลบแถวนี้
--   * ผู้ดูแลสูงสุดเพิ่มใครก็ได้; ผู้ดูแลตระกูลเพิ่มได้เฉพาะคนที่ตัวเองมองเห็นอยู่แล้ว (เหมือน clan_add_member)
--     กันการเพิ่มคนแปลกหน้าเพื่อให้ได้สิทธิ์แก้ข้อมูลพื้นฐานของเขา (ผู้เชื่อมโยงแก้ฟิลด์พื้นฐานได้ ดู 18-)
--   * เอาออกได้เฉพาะที่เพิ่มเอง; ผู้เชื่อมโยงที่เกิดจากความสัมพันธ์ต้องแก้ที่ความสัมพันธ์ของเขา

alter table public.clan_member add column if not exists manual boolean not null default false;

create or replace function public.clan_rebuild_links()
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.clan_member where role = 'linked' and not manual;
  insert into public.clan_member (clan_id, person_id, role)
  with edges as (
    select id as a, father_id as b from public.person where father_id is not null
    union select id, mother_id from public.person where mother_id is not null
    union select id, spouse_id from public.person where spouse_id is not null
    union select person_id, child_person_id from public.person_child where child_person_id is not null),
  sym as (select a, b from edges union select b, a from edges)
  select distinct m.clan_id, s.a, 'linked'::text
    from sym s
    join public.clan_member m on m.person_id = s.b and m.role = 'member'
   where s.a <> s.b
     and not exists (select 1 from public.clan_member x
                      where x.clan_id = m.clan_id and x.person_id = s.a and x.role = 'member')
  on conflict (clan_id, person_id) do nothing;
end $$;
revoke all on function public.clan_rebuild_links() from public, anon, authenticated;

create or replace function public.clan_add_linked(p_clan_id bigint, p_person_id bigint)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_clan_admin(p_clan_id) then raise exception 'ไม่มีสิทธิ์'; end if;
  if not public.is_super_admin() and p_person_id not in (select public.tree_person_ids()) then
    raise exception 'ไม่พบบุคคลนี้ในแผนผังของคุณ';
  end if;
  if exists (select 1 from public.clan_member where clan_id = p_clan_id and person_id = p_person_id and role = 'member') then
    raise exception 'บุคคลนี้เป็นสมาชิกหลักของตระกูลนี้อยู่แล้ว';
  end if;
  insert into public.clan_member (clan_id, person_id, role, manual) values (p_clan_id, p_person_id, 'linked', true)
  on conflict (clan_id, person_id) do update set manual = true;
end $$;

create or replace function public.clan_remove_linked(p_clan_id bigint, p_person_id bigint)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_clan_admin(p_clan_id) then raise exception 'ไม่มีสิทธิ์'; end if;
  if not exists (select 1 from public.clan_member
                  where clan_id = p_clan_id and person_id = p_person_id and role = 'linked' and manual) then
    raise exception 'ผู้เชื่อมโยงนี้เกิดจากความสัมพันธ์ในข้อมูล จึงเอาออกไม่ได้ (ต้องแก้ความสัมพันธ์ของเขา)';
  end if;
  delete from public.clan_member where clan_id = p_clan_id and person_id = p_person_id and role = 'linked';
  perform public.clan_rebuild_links();
end $$;

-- รายชื่อสมาชิก: เพิ่ม manual (นิยามเดิมจาก 16-clans.sql)
create or replace function public.clan_members_list(p_clan_id bigint)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', p.id, 'prefix', p.prefix, 'full_name', p.full_name, 'nickname', p.nickname,
           'role', m.role, 'manual', m.manual,
           'is_admin', exists (select 1 from public.clan_admin a
                                where a.clan_id = m.clan_id and a.user_id = p.auth_user_id),
           'has_account', p.auth_user_id is not null) order by m.role, p.full_name), '[]'::jsonb)
    from public.clan_member m join public.person p on p.id = m.person_id
   where public.is_clan_admin(p_clan_id) and m.clan_id = p_clan_id
$$;

revoke all on function public.clan_add_linked(bigint, bigint), public.clan_remove_linked(bigint, bigint),
  public.clan_members_list(bigint) from public, anon;
grant execute on function public.clan_add_linked(bigint, bigint), public.clan_remove_linked(bigint, bigint),
  public.clan_members_list(bigint) to authenticated;

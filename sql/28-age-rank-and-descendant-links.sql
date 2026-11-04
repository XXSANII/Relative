-- (1) ป้ายในแผนภาพเรียงตามอายุ แต่หน้าโปรไฟล์ไม่แสดงอายุของผู้เสียชีวิต
-- (2) ผู้เชื่อมโยง: ถ้าพ่อและแม่เป็นคนในตระกูลเดียวกัน (สมาชิกหลักหรือผู้เชื่อมโยง) ลูกก็เป็นผู้เชื่อมโยงของตระกูลนั้นด้วย
-- รันใน Supabase SQL Editor หลัง 27-name-taken-by-parents.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- (1) family_tree_data() เพิ่ม sort_rank = ลำดับอายุ (1 = อายุมากสุด; ไม่มีวันเกิด = null)
--     ใช้เรียงป้ายแทนอายุเต็มปี จึงแยกลำดับของคนที่อายุเท่ากันได้ และเรียงคนที่เสียชีวิตตามวันเกิดเดิมได้
--     ไม่เปิดเผยวันเกิดจริง (ได้แค่ลำดับสัมพัทธ์) ส่วน person_family_info() คืนอายุเป็น null ถ้าเสียชีวิตแล้ว

create or replace function public.person_family_info(p_person_id bigint)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'age',        case when p.deceased then null else public.age_years(b.birth_date) end,
    'father_age', public.age_years(b.father_birth_date),
    'mother_age', public.age_years(b.mother_birth_date),
    'children',   coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', c.id, 'relation', c.relation, 'name', c.name,
                 'person_id', cp.id, 'prefix', cp.prefix, 'full_name', cp.full_name, 'nickname', cp.nickname,
                 'deceased', coalesce(cp.deceased, false),
                 'age', case when cp.deceased then null
                             else public.age_years(coalesce(c.birth_date, cb.birth_date)) end) order by c.id)
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

create or replace function public.family_tree_data(p_clan_id bigint default null)
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then return null; end if;
  if p_clan_id is not null and p_clan_id not in (select public.viewable_clan_ids()) then
    raise exception 'ไม่มีสิทธิ์ดูต้นไม้ของตระกูลนี้';
  end if;

  return (with vis as (
    select id from (
      select public.direct_family_ids() as id where p_clan_id is null
      union
      select person_id from public.clan_member where clan_id = p_clan_id) s),
  mem as (select person_id as id from public.clan_member where clan_id = p_clan_id and role = 'member'),
  openable as (select public.visible_person_ids() as id),
  ranked as (
    select p.*, b.birth_date,
           case when b.birth_date is null then null
                else dense_rank() over (order by b.birth_date asc nulls last) end as rk
      from public.person p
      left join public.person_birth b on b.person_id = p.id
     where p.id in (select id from vis))
  select jsonb_build_object(
    'people', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', p.id, 'prefix', p.prefix, 'full_name', p.full_name, 'nickname', p.nickname,
                 'gender', p.gender, 'avatar_path', p.avatar_path,
                 'father_id', case when p.father_id in (select id from vis) then p.father_id end,
                 'mother_id', case when p.mother_id in (select id from vis) then p.mother_id end,
                 'spouse_id', case when p.spouse_id in (select id from vis) then p.spouse_id end,
                 'father_alive', p.father_alive, 'mother_alive', p.mother_alive,
                 'deceased', p.deceased,
                 'can_open', p.id in (select id from openable),
                 'is_member', p_clan_id is null or p.id in (select id from mem),
                 'age', public.age_years(p.birth_date),
                 'sort_rank', p.rk) order by p.id)
          from ranked p), '[]'::jsonb),
    'child_links', coalesce((
        select jsonb_agg(jsonb_build_object('parent_id', c.person_id, 'child_id', c.child_person_id))
          from public.person_child c
         where c.child_person_id is not null
           and c.person_id in (select id from vis)
           and c.child_person_id in (select id from vis)), '[]'::jsonb)));
end $$;
revoke all on function public.family_tree_data(bigint) from public, anon;
grant execute on function public.family_tree_data(bigint) to authenticated;

-- (2) คำนวณผู้เชื่อมโยงใหม่: กติกาเดิม (ต่อกับสมาชิกหลักทางพ่อแม่/คู่สมรส/บุตรธิดา) + ลูกของพ่อแม่ที่อยู่ในตระกูลทั้งคู่
--     วนซ้ำจนนิ่ง จึงต่อไปถึงหลานเป็นทอด ๆ; คนที่ผู้ดูแลเอาออก (clan_link_block) ไม่ถูกเชื่อมกลับ
create or replace function public.clan_rebuild_links()
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare n bigint;
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
     and not exists (select 1 from public.clan_link_block k
                      where k.clan_id = m.clan_id and k.person_id = s.a)
  on conflict (clan_id, person_id) do nothing;

  loop
    insert into public.clan_member (clan_id, person_id, role)
    with par as (
      select id as child, father_id as parent from public.person where father_id is not null
      union select id, mother_id from public.person where mother_id is not null
      union select child_person_id, person_id from public.person_child where child_person_id is not null)
    select m.clan_id, par.child, 'linked'::text
      from par
      join public.clan_member m on m.person_id = par.parent
     where par.child <> par.parent
       and not exists (select 1 from public.clan_member x
                        where x.clan_id = m.clan_id and x.person_id = par.child)
       and not exists (select 1 from public.clan_link_block k
                        where k.clan_id = m.clan_id and k.person_id = par.child)
     group by m.clan_id, par.child
    having count(distinct par.parent) >= 2
    on conflict (clan_id, person_id) do nothing;
    get diagnostics n = row_count;
    exit when n = 0;
  end loop;
end $$;
revoke all on function public.clan_rebuild_links() from public, anon, authenticated;

select public.clan_rebuild_links();

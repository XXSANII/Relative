-- แผนผังต้นไม้แยกตามตระกูล + สิทธิ์ดูตระกูลอื่นที่ผู้ดูแลเป็นคนอนุญาต
-- รันใน Supabase SQL Editor หลัง 16-clans.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- กติกา
--   * family_tree_data(p_clan_id) คืนแผนผังของ "ตระกูลเดียว" = สมาชิกหลัก + ผู้เชื่อมโยงของตระกูลนั้น ไม่รวมตระกูลอื่น
--   * ดูแผนผังของตระกูลได้เมื่อ (1) เป็นสมาชิกหลักของตระกูลนั้น (2) ผู้ดูแลของตระกูลนั้นอนุญาต (clan_view_grant)
--     หรือ (3) เป็นผู้ดูแลสูงสุด เท่านั้น
--   * p_clan_id = null → "ครอบครัวสายตรงของฉัน" (ตัวเอง พ่อ แม่ คู่สมรส บุตรธิดา) ใช้กับคนที่ยังไม่มีตระกูล
--   * ผู้ที่ได้รับสิทธิ์ดูตระกูลอื่นเห็นเฉพาะแผนผัง (ชื่อ รูป อายุ ความสัมพันธ์) กดเปิดโปรไฟล์ไม่ได้
--     (คืน can_open ต่อคน บอกว่าเปิดโปรไฟล์ได้หรือไม่)

create table if not exists public.clan_view_grant (
  clan_id    bigint not null references public.clan(id) on delete cascade,
  person_id  bigint not null references public.person(id) on delete cascade,
  granted_by uuid,
  created_at timestamptz not null default now(),
  primary key (clan_id, person_id)
);
alter table public.clan_view_grant enable row level security;
revoke all on public.clan_view_grant from anon, authenticated;

-- ญาติสายตรงของผู้ใช้ (รวมตัวเอง)
create or replace function public.direct_family_ids()
returns setof bigint language sql stable security definer
set search_path = pg_catalog, public
as $$
  with me as (select id, father_id, mother_id, spouse_id from public.person where auth_user_id = auth.uid())
  select id from me
  union select father_id from me where father_id is not null
  union select mother_id from me where mother_id is not null
  union select spouse_id from me where spouse_id is not null
  union select c.id from public.person c join me on c.father_id = me.id or c.mother_id = me.id
  union select p.id from public.person p join me on p.spouse_id = me.id
  union select pc.child_person_id from public.person_child pc join me on pc.person_id = me.id
         where pc.child_person_id is not null
  union select pc.person_id from public.person_child pc join me on pc.child_person_id = me.id
$$;
revoke all on function public.direct_family_ids() from public, anon;
grant execute on function public.direct_family_ids() to authenticated;

-- สิทธิ์อ่านข้อมูลเต็ม (RLS ของ person) = ญาติสายตรง + สมาชิกหลักของตระกูลที่ตัวเองเป็นสมาชิกหลัก (+ทุกคนถ้าเป็นผู้ดูแลสูงสุด)
-- ผลเท่าเดิมกับ 16-clans.sql แค่ย้ายส่วนญาติสายตรงมาใช้ฟังก์ชันร่วมกัน
create or replace function public.visible_person_ids()
returns setof bigint language sql stable security definer
set search_path = pg_catalog, public
as $$
  select public.direct_family_ids()
  union select person_id from public.clan_member
         where role = 'member' and clan_id in (select public.my_member_clan_ids())
  union select id from public.person where public.is_super_admin()
$$;
revoke all on function public.visible_person_ids() from public, anon;
grant execute on function public.visible_person_ids() to authenticated;

-- ตระกูลที่ผู้ใช้ดูแผนผังได้: เป็นสมาชิกหลัก / ได้รับสิทธิ์ / (ผู้ดูแลสูงสุด = ทุกตระกูล)
create or replace function public.viewable_clan_ids()
returns setof bigint language sql stable security definer
set search_path = pg_catalog, public
as $$
  select public.my_member_clan_ids()
  union select g.clan_id from public.clan_view_grant g
          join public.person p on p.id = g.person_id where p.auth_user_id = auth.uid()
  union select id from public.clan where public.is_super_admin()
$$;
revoke all on function public.viewable_clan_ids() from public, anon;
grant execute on function public.viewable_clan_ids() to authenticated;

-- รายการตัวเลือกตระกูลของหน้าต้นไม้ (kind: member = ตระกูลของฉัน, granted = ได้รับสิทธิ์, all = ผู้ดูแลสูงสุด)
create or replace function public.tree_clans()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name,
           'kind', case when c.id in (select public.my_member_clan_ids()) then 'member'
                        when public.is_super_admin() then 'all' else 'granted' end)
           order by (c.id in (select public.my_member_clan_ids())) desc, c.name), '[]'::jsonb)
    from public.clan c
   where auth.uid() is not null and c.id in (select public.viewable_clan_ids())
$$;
revoke all on function public.tree_clans() from public, anon;
grant execute on function public.tree_clans() to authenticated;

-- แทนฟังก์ชันเดิมที่ไม่มีพารามิเตอร์ (ถ้าเหลือไว้ จะเรียก rpc("family_tree_data") แล้วกำกวม)
drop function if exists public.family_tree_data();

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
  openable as (select public.visible_person_ids() as id)
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
                 'age', public.age_years(b.birth_date)) order by p.id)
          from public.person p
          left join public.person_birth b on b.person_id = p.id
         where p.id in (select id from vis)), '[]'::jsonb),
    'child_links', coalesce((
        select jsonb_agg(jsonb_build_object('parent_id', c.person_id, 'child_id', c.child_person_id))
          from public.person_child c
         where c.child_person_id is not null
           and c.person_id in (select id from vis)
           and c.child_person_id in (select id from vis)), '[]'::jsonb)));
end $$;
revoke all on function public.family_tree_data(bigint) from public, anon;
grant execute on function public.family_tree_data(bigint) to authenticated;

-- ผู้ดูแลตระกูล: อนุญาต/เพิกถอนให้บุคคลดูแผนผังของตระกูลนี้
create or replace function public.clan_view_grant_set(p_clan_id bigint, p_person_id bigint, p_on boolean)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_clan_admin(p_clan_id) then raise exception 'ไม่มีสิทธิ์'; end if;
  if p_on then
    if not exists (select 1 from public.person where id = p_person_id) then
      raise exception 'ไม่พบบุคคลนี้';
    end if;
    insert into public.clan_view_grant (clan_id, person_id, granted_by)
    values (p_clan_id, p_person_id, auth.uid()) on conflict do nothing;
  else
    delete from public.clan_view_grant where clan_id = p_clan_id and person_id = p_person_id;
  end if;
end $$;

create or replace function public.clan_view_grants_list(p_clan_id bigint)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', p.id, 'prefix', p.prefix, 'full_name', p.full_name, 'nickname', p.nickname)
           order by p.full_name), '[]'::jsonb)
    from public.clan_view_grant g join public.person p on p.id = g.person_id
   where public.is_clan_admin(p_clan_id) and g.clan_id = p_clan_id
$$;

-- ผู้ดูแลค้นหาบุคคลเพื่อให้สิทธิ์ดู (คืนเฉพาะ id + ชื่อ ไม่ต้องอยู่ในตระกูลของผู้ดูแล)
-- ใช้เฉพาะผู้ดูแล และจำกัดผลลัพธ์ กันการไล่ดูรายชื่อทั้งระบบ
create or replace function public.clan_search_people(p_q text)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', x.id, 'prefix', x.prefix, 'full_name', x.full_name, 'nickname', x.nickname)), '[]'::jsonb)
    from (select id, prefix, full_name, nickname from public.person
           where auth.uid() is not null
             and (public.is_super_admin() or exists (select 1 from public.clan_admin where user_id = auth.uid()))
             and char_length(btrim(coalesce(p_q, ''))) >= 2
             and public.norm_name(full_name) like '%' || public.norm_name(replace(replace(p_q, '%', ''), '_', '')) || '%'
           order by full_name limit 15) x
$$;

revoke all on function public.clan_view_grant_set(bigint, bigint, boolean),
  public.clan_view_grants_list(bigint), public.clan_search_people(text) from public, anon;
grant execute on function public.clan_view_grant_set(bigint, bigint, boolean),
  public.clan_view_grants_list(bigint), public.clan_search_people(text) to authenticated;

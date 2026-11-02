-- แผนผังของตระกูล: บอกว่าแต่ละคนเป็น "สมาชิกหลัก" ของตระกูลที่เลือกหรือไม่ (is_member)
-- รันใน Supabase SQL Editor หลัง 19-manual-linked.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- โหมด "ดูทั้งหมด" ของหน้าต้นไม้ใช้ is_member กรองให้เหลือเฉพาะสมาชิกหลัก ไม่แสดงคนนอกตระกูล (ผู้เชื่อมโยง)
-- โหมด "เฉพาะที่เกี่ยวข้อง" ยังเห็นผู้เชื่อมโยงที่ต่อกับคนที่เลือกโดยตรง (เช่น คู่สมรส)
-- p_clan_id = null (ครอบครัวสายตรง) ทุกคน is_member = true; นอกนั้นเหมือน 17-clan-tree.sql

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
                 'is_member', p_clan_id is null or p.id in (select id from mem),
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

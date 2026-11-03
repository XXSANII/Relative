-- สมาชิกหลัก "และผู้เชื่อมโยง" ดูแผนผังและเปิดโปรไฟล์ญาติในตระกูล (ต้นไม้) เดียวกันได้
-- รันใน Supabase SQL Editor หลัง 23-admin-edit-full.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- เดิม: เฉพาะสมาชิกหลักที่เห็นคนในตระกูลของตัวเอง ผู้เชื่อมโยงเห็นแค่ญาติสายตรง
-- ใหม่: ตระกูลของฉัน = ตระกูลที่ฉันเป็นสมาชิกหลักหรือผู้เชื่อมโยง
--   * เปิดโปรไฟล์ได้ทุกคนในตระกูลเหล่านั้น (ทั้งสมาชิกหลักและผู้เชื่อมโยง)
--   * เลือกดูแผนผังของตระกูลเหล่านั้นได้
--   * คนที่ได้รับสิทธิ์ดูจากผู้ดูแล (clan_view_grant) ยังเห็นเฉพาะแผนผัง เปิดโปรไฟล์ไม่ได้ เหมือนเดิม
--   * วันเกิดจริงและเบอร์คู่สมรสยังเห็นได้เฉพาะเจ้าของ (ไม่เปลี่ยน)

-- ตระกูลที่ฉันอยู่ (สมาชิกหลักหรือผู้เชื่อมโยง)
create or replace function public.my_clan_ids()
returns setof bigint language sql stable security definer
set search_path = pg_catalog, public
as $$
  select m.clan_id from public.clan_member m
    join public.person p on p.id = m.person_id
   where p.auth_user_id = auth.uid()
$$;
revoke all on function public.my_clan_ids() from public, anon;
grant execute on function public.my_clan_ids() to authenticated;

create or replace function public.visible_person_ids()
returns setof bigint language sql stable security definer
set search_path = pg_catalog, public
as $$
  select public.direct_family_ids()
  union select person_id from public.clan_member
         where clan_id in (select public.my_clan_ids())
  union select id from public.person where public.is_super_admin()
$$;
revoke all on function public.visible_person_ids() from public, anon;
grant execute on function public.visible_person_ids() to authenticated;

create or replace function public.viewable_clan_ids()
returns setof bigint language sql stable security definer
set search_path = pg_catalog, public
as $$
  select public.my_clan_ids()
  union select g.clan_id from public.clan_view_grant g
          join public.person p on p.id = g.person_id where p.auth_user_id = auth.uid()
  union select id from public.clan where public.is_super_admin()
$$;
revoke all on function public.viewable_clan_ids() from public, anon;
grant execute on function public.viewable_clan_ids() to authenticated;

-- ตัวเลือกตระกูลของหน้าต้นไม้: ตระกูลของฉัน (kind = member) รวมที่ฉันเป็นผู้เชื่อมโยง
create or replace function public.tree_clans()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'name', c.name,
           'kind', case when c.id in (select public.my_clan_ids()) then 'member'
                        when public.is_super_admin() then 'all' else 'granted' end)
           order by (c.id in (select public.my_member_clan_ids())) desc,
                    (c.id in (select public.my_clan_ids())) desc, c.name), '[]'::jsonb)
    from public.clan c
   where auth.uid() is not null and c.id in (select public.viewable_clan_ids())
$$;
revoke all on function public.tree_clans() from public, anon;
grant execute on function public.tree_clans() to authenticated;

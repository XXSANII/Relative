-- ผู้ดูแลตระกูลแก้ไขข้อมูลของ "ผู้เชื่อมโยง" ได้ครบทุกอย่างเหมือนสมาชิกหลัก
-- รันใน Supabase SQL Editor หลัง 25-demote-member.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- แทนกติกาเดิมใน 18-admin-edit-linked.sql ที่จำกัดผู้เชื่อมโยงไว้เฉพาะข้อมูลพื้นฐาน (basic)
-- clan_get_person / clan_update_person (23-admin-edit-full.sql) ใช้ระดับ 'full' อยู่แล้ว จึงไม่ต้องแก้

create or replace function public.clan_person_level(p_person_id bigint)
returns text language sql stable security definer
set search_path = pg_catalog, public
as $$
  select case
    when auth.uid() is null then null
    when public.is_super_admin() then 'full'
    when exists (select 1 from public.clan_member m
                  where m.person_id = p_person_id and m.role in ('member', 'linked')
                    and public.is_clan_admin(m.clan_id)) then 'full'
  end
$$;
revoke all on function public.clan_person_level(bigint) from public, anon;
grant execute on function public.clan_person_level(bigint) to authenticated;

-- ผู้ดูแลลดสมาชิกหลักเป็น "ผู้เชื่อมโยง" ของตระกูลเดิมได้ (ไม่ต้องเอาออกแล้วเพิ่มใหม่)
-- รันใน Supabase SQL Editor หลัง 24-tree-view-linked.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
--   * ถ้าเขาเป็นผู้ดูแลตระกูลนี้ จะถอดสิทธิ์ผู้ดูแลด้วย (ตระกูลต้องเหลือผู้ดูแลอย่างน้อย 1 คน ยกเว้นผู้ดูแลสูงสุดทำเอง)
--   * บันทึกเป็นผู้เชื่อมโยงแบบ manual จึงอยู่ต่อแม้ไม่มีความสัมพันธ์ทางสายเลือดกับสมาชิกหลักคนอื่น
--   * เลื่อนกลับเป็นสมาชิกหลักได้ด้วย clan_add_member เดิม

create or replace function public.clan_demote_member(p_clan_id bigint, p_person_id bigint)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_user uuid;
begin
  if not public.is_clan_admin(p_clan_id) then raise exception 'ไม่มีสิทธิ์'; end if;
  if not exists (select 1 from public.clan_member where clan_id = p_clan_id and person_id = p_person_id and role = 'member') then
    raise exception 'บุคคลนี้ไม่ใช่สมาชิกหลักของตระกูลนี้';
  end if;
  select auth_user_id into v_user from public.person where id = p_person_id;
  if v_user is not null and exists (select 1 from public.clan_admin where clan_id = p_clan_id and user_id = v_user) then
    if not public.is_super_admin()
       and (select count(*) from public.clan_admin where clan_id = p_clan_id and user_id <> v_user) = 0 then
      raise exception 'ตระกูลต้องมีผู้ดูแลอย่างน้อย 1 คน';
    end if;
    delete from public.clan_admin where clan_id = p_clan_id and user_id = v_user;
  end if;
  update public.clan_member set role = 'linked', manual = true
   where clan_id = p_clan_id and person_id = p_person_id;
  delete from public.clan_link_block where clan_id = p_clan_id and person_id = p_person_id;
  perform public.clan_rebuild_links();
end $$;
revoke all on function public.clan_demote_member(bigint, bigint) from public, anon;
grant execute on function public.clan_demote_member(bigint, bigint) to authenticated;

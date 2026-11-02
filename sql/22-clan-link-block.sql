-- เอาออกจากตระกูลให้ออกจริง: ไม่ถูกเชื่อมกลับมาเป็นผู้เชื่อมโยงอัตโนมัติ + เอาผู้เชื่อมโยงออกได้ทุกคน
-- รันใน Supabase SQL Editor หลัง 21-auto-clan-on-signup.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- ปัญหาเดิม: ผู้เชื่อมโยงถูกคำนวณจากความสัมพันธ์ (พ่อ/แม่/คู่สมรส/ลูก) ใหม่ทุกครั้ง
--   เอาสมาชิกหลักออกแล้วเขากลับมาเป็นผู้เชื่อมโยงทันที และผู้เชื่อมโยงที่ระบบเชื่อมให้เอาออกไม่ได้
-- ทางแก้: ตาราง clan_link_block จดคู่ (ตระกูล, บุคคล) ที่ผู้ดูแลไม่ต้องการให้เชื่อมอัตโนมัติ
--   * เอาสมาชิกหลักออก / เอาผู้เชื่อมโยงออก → จดลง block (ความสัมพันธ์จริงในข้อมูลไม่เปลี่ยน แค่ไม่โผล่ในตระกูลนี้)
--   * เพิ่มกลับเป็นสมาชิกหลัก/ผู้เชื่อมโยง (หรือย้ายเข้าตระกูลนี้) → ลบ block ออก

create table if not exists public.clan_link_block (
  clan_id   bigint not null references public.clan(id) on delete cascade,
  person_id bigint not null references public.person(id) on delete cascade,
  primary key (clan_id, person_id)
);
alter table public.clan_link_block enable row level security;
revoke all on public.clan_link_block from anon, authenticated;

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
     and not exists (select 1 from public.clan_link_block k
                      where k.clan_id = m.clan_id and k.person_id = s.a)
  on conflict (clan_id, person_id) do nothing;
end $$;
revoke all on function public.clan_rebuild_links() from public, anon, authenticated;

create or replace function public.clan_remove_member(p_clan_id bigint, p_person_id bigint)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_user uuid;
begin
  if not public.is_clan_admin(p_clan_id) then raise exception 'ไม่มีสิทธิ์'; end if;
  select auth_user_id into v_user from public.person where id = p_person_id;
  if v_user is not null and exists (select 1 from public.clan_admin where clan_id = p_clan_id and user_id = v_user) then
    if not public.is_super_admin()
       and (select count(*) from public.clan_admin where clan_id = p_clan_id and user_id <> v_user) = 0 then
      raise exception 'ตระกูลต้องมีผู้ดูแลอย่างน้อย 1 คน';
    end if;
    delete from public.clan_admin where clan_id = p_clan_id and user_id = v_user;
  end if;
  delete from public.clan_member where clan_id = p_clan_id and person_id = p_person_id and role = 'member';
  insert into public.clan_link_block (clan_id, person_id) values (p_clan_id, p_person_id) on conflict do nothing;
  perform public.clan_rebuild_links();
end $$;

-- เอาผู้เชื่อมโยงออกได้ทุกคน (ทั้งที่เพิ่มเองและที่ระบบเชื่อมให้จากความสัมพันธ์)
create or replace function public.clan_remove_linked(p_clan_id bigint, p_person_id bigint)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_clan_admin(p_clan_id) then raise exception 'ไม่มีสิทธิ์'; end if;
  if not exists (select 1 from public.clan_member
                  where clan_id = p_clan_id and person_id = p_person_id and role = 'linked') then
    raise exception 'บุคคลนี้ไม่ใช่ผู้เชื่อมโยงของตระกูลนี้';
  end if;
  delete from public.clan_member where clan_id = p_clan_id and person_id = p_person_id and role = 'linked';
  insert into public.clan_link_block (clan_id, person_id) values (p_clan_id, p_person_id) on conflict do nothing;
  perform public.clan_rebuild_links();
end $$;

create or replace function public.clan_add_member(p_clan_id bigint, p_person_id bigint)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_clan_admin(p_clan_id) then raise exception 'ไม่มีสิทธิ์'; end if;
  if not public.is_super_admin() and p_person_id not in (select public.tree_person_ids()) then
    raise exception 'ไม่พบบุคคลนี้ในแผนผังของคุณ';
  end if;
  delete from public.clan_link_block where clan_id = p_clan_id and person_id = p_person_id;
  insert into public.clan_member (clan_id, person_id, role) values (p_clan_id, p_person_id, 'member')
  on conflict (clan_id, person_id) do update set role = 'member';
  perform public.clan_rebuild_links();
end $$;

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
  delete from public.clan_link_block where clan_id = p_clan_id and person_id = p_person_id;
  insert into public.clan_member (clan_id, person_id, role, manual) values (p_clan_id, p_person_id, 'linked', true)
  on conflict (clan_id, person_id) do update set manual = true;
end $$;

create or replace function public.clan_move_member(p_person_id bigint, p_from bigint, p_to bigint)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if p_from = p_to then return; end if;
  if not (public.is_clan_admin(p_from) and public.is_clan_admin(p_to)) then raise exception 'ไม่มีสิทธิ์'; end if;
  if not exists (select 1 from public.clan_member where clan_id = p_from and person_id = p_person_id and role = 'member') then
    raise exception 'บุคคลนี้ไม่ใช่สมาชิกหลักของตระกูลต้นทาง';
  end if;
  perform public.clan_remove_member(p_from, p_person_id);
  delete from public.clan_link_block where clan_id = p_to and person_id = p_person_id;
  insert into public.clan_member (clan_id, person_id, role) values (p_to, p_person_id, 'member')
  on conflict (clan_id, person_id) do update set role = 'member';
  perform public.clan_rebuild_links();
end $$;

revoke all on function public.clan_remove_member(bigint, bigint), public.clan_remove_linked(bigint, bigint),
  public.clan_add_member(bigint, bigint), public.clan_add_linked(bigint, bigint),
  public.clan_move_member(bigint, bigint, bigint) from public, anon;
grant execute on function public.clan_remove_member(bigint, bigint), public.clan_remove_linked(bigint, bigint),
  public.clan_add_member(bigint, bigint), public.clan_add_linked(bigint, bigint),
  public.clan_move_member(bigint, bigint, bigint) to authenticated;

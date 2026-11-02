-- ระบบ "ตระกูล" + ผู้ดูแล (แทนการเดาวงครอบครัวจากนามสกุลของ 11-family-circles.sql)
-- รันใน Supabase SQL Editor หลัง 15-optional-phone.sql (รันซ้ำได้) แล้วทำ "ขั้นตอนหลังรัน" ท้ายไฟล์
--
-- แนวคิด
--   * ตระกูล (clan) มีสมาชิก 2 บทบาทใน clan_member
--       member = สมาชิกหลัก   เห็นข้อมูลและแผนผังของตระกูลครบ
--       linked = ผู้เชื่อมโยง  คนจากตระกูลอื่นที่ต่อกันด้วย บิดา/มารดา/คู่สมรส/บุตรธิดา ตรง ๆ กับสมาชิกหลัก
--                (เช่น สะใภ้ในตระกูลสามี) เห็นเฉพาะในแผนผัง ด้วยข้อมูลย่อ (ชื่อ รูป ความสัมพันธ์) ไม่เห็นเบอร์/ที่อยู่
--                บทบาทนี้คำนวณเองทั้งหมดจากความสัมพันธ์ (clan_rebuild_links) ไม่มีใครแก้ด้วยมือ
--   * ผู้ใช้เห็นข้อมูลเต็ม (RLS ของ person) = ตัวเอง + สมาชิกหลักของตระกูลที่ตัวเองเป็นสมาชิกหลัก
--                + ญาติสายตรง (พ่อ แม่ คู่สมรส บุตรธิดา) ของตัวเอง
--     ผู้ใช้เห็นในแผนผัง = กลุ่มข้างบน + ผู้เชื่อมโยงของตระกูลที่ตัวเองเป็นสมาชิกหลัก
--     ไม่เดินต่อจากคู่สมรสไปหาพ่อแม่/พี่น้องของคู่สมรส จึงไม่เห็นโครงสร้างอีกฝั่ง
--   * ผู้ดูแลสูงสุด (super_admin) เห็นและจัดการได้ทุกตระกูล ผู้ดูแลตระกูล (clan_admin) จัดการได้เฉพาะตระกูลตัวเอง
--     ผู้ดูแลตระกูลต้องเป็นสมาชิกหลักของตระกูลนั้น
--   * คำขอ (clan_request): kind = 'join' ขอเป็นสมาชิก (ผู้ดูแลตระกูลนั้นหรือผู้ดูแลสูงสุดอนุมัติ)
--                          kind = 'admin' ขอเป็นผู้ดูแลตระกูล (ผู้ดูแลสูงสุดอนุมัติเท่านั้น)
--   * ผู้สมัครใหม่ไม่เข้าตระกูลเอง ต้องขอเข้า (กันคนนอกพิมพ์นามสกุล/ชื่อพ่อแม่ให้ตรงแล้วเห็นทั้งตระกูล)
--     ข้อมูลเดิมที่มีอยู่ตอนรันไฟล์นี้ ถูกจัดเข้าตระกูลตามนามสกุลครั้งเดียว (ผู้ดูแลสูงสุดปรับ/ย้ายได้ทีหลัง)
--   * ตารางใหม่ปิดไม่ให้ผู้ใช้อ่าน/เขียนตรง ๆ ทั้งหมด ใช้ผ่านฟังก์ชันด้านล่างเท่านั้น

-- ===== ตาราง =====
create table if not exists public.clan (
  id         bigint generated always as identity primary key,
  name       text not null check (btrim(name) <> ''),
  created_at timestamptz not null default now()
);
create unique index if not exists clan_name_norm_idx on public.clan (public.norm_name(name));

create table if not exists public.clan_member (
  clan_id   bigint not null references public.clan(id) on delete cascade,
  person_id bigint not null references public.person(id) on delete cascade,
  role      text not null default 'member' check (role in ('member','linked')),
  primary key (clan_id, person_id)
);
create index if not exists clan_member_person_idx on public.clan_member (person_id);

create table if not exists public.clan_admin (
  clan_id bigint not null references public.clan(id) on delete cascade,
  user_id uuid   not null references auth.users(id) on delete cascade,
  primary key (clan_id, user_id)
);

create table if not exists public.super_admin (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table if not exists public.clan_request (
  id         bigint generated always as identity primary key,
  kind       text   not null check (kind in ('join','admin')),
  person_id  bigint not null references public.person(id) on delete cascade,
  clan_id    bigint not null references public.clan(id) on delete cascade,
  note       text check (note is null or char_length(note) <= 300),
  status     text   not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz
);
create unique index if not exists clan_request_pending_idx
  on public.clan_request (person_id, clan_id, kind) where status = 'pending';

alter table public.clan         enable row level security;
alter table public.clan_member  enable row level security;
alter table public.clan_admin   enable row level security;
alter table public.super_admin  enable row level security;
alter table public.clan_request enable row level security;
revoke all on public.clan, public.clan_member, public.clan_admin, public.super_admin, public.clan_request
  from anon, authenticated;

-- ===== ตัวช่วยตรวจสิทธิ์ =====
create or replace function public.is_super_admin()
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$ select auth.uid() is not null and exists (select 1 from public.super_admin where user_id = auth.uid()) $$;

create or replace function public.is_clan_admin(p_clan_id bigint)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and (
    public.is_super_admin()
    or exists (select 1 from public.clan_admin where clan_id = p_clan_id and user_id = auth.uid()))
$$;

-- ตระกูลที่ผู้ใช้เป็นสมาชิกหลัก
create or replace function public.my_member_clan_ids()
returns setof bigint language sql stable security definer
set search_path = pg_catalog, public
as $$
  select m.clan_id from public.clan_member m
    join public.person p on p.id = m.person_id
   where p.auth_user_id = auth.uid() and m.role = 'member'
$$;

revoke all on function public.is_super_admin(), public.is_clan_admin(bigint), public.my_member_clan_ids()
  from public, anon;
grant execute on function public.is_super_admin(), public.is_clan_admin(bigint), public.my_member_clan_ids()
  to authenticated;

-- ===== ผู้ที่เห็นข้อมูลเต็ม (ใช้ใน RLS ของ person) =====
create or replace function public.visible_person_ids()
returns setof bigint language sql stable security definer
set search_path = pg_catalog, public
as $$
  with me as (select id, father_id, mother_id, spouse_id from public.person where auth_user_id = auth.uid())
  select id from me
  union select person_id from public.clan_member
         where role = 'member' and clan_id in (select public.my_member_clan_ids())
  union select father_id from me where father_id is not null
  union select mother_id from me where mother_id is not null
  union select spouse_id from me where spouse_id is not null
  union select c.id from public.person c join me on c.father_id = me.id or c.mother_id = me.id
  union select p.id from public.person p join me on p.spouse_id = me.id
  union select pc.child_person_id from public.person_child pc join me on pc.person_id = me.id
         where pc.child_person_id is not null
  union select pc.person_id from public.person_child pc join me on pc.child_person_id = me.id
  union select id from public.person where public.is_super_admin()
$$;
revoke all on function public.visible_person_ids() from public, anon;
grant execute on function public.visible_person_ids() to authenticated;

-- ผู้ที่ปรากฏในแผนผัง = เห็นเต็ม + ผู้เชื่อมโยงของตระกูลที่เป็นสมาชิกหลัก (ข้อมูลย่อ)
create or replace function public.tree_person_ids()
returns setof bigint language sql stable security definer
set search_path = pg_catalog, public
as $$
  select public.visible_person_ids()
  union select person_id from public.clan_member
         where role = 'linked' and clan_id in (select public.my_member_clan_ids())
$$;
revoke all on function public.tree_person_ids() from public, anon;
grant execute on function public.tree_person_ids() to authenticated;

-- policy อ่านของ person ใช้ visible_person_ids() ตัวใหม่ (นิยามเดิมจาก 11-family-circles.sql)
drop policy if exists "read own family circle" on public.person;
create policy "read own family circle" on public.person
  for select to authenticated
  using (auth_user_id = auth.uid() or id in (select public.visible_person_ids()));

-- แผนผังต้นไม้: เฉพาะคนในแผนผังของตัวเอง; id พ่อ/แม่/คู่สมรสที่อยู่นอกขอบเขตถูกตัดเป็น null
-- (ผู้เชื่อมโยงคืนเฉพาะฟิลด์ย่อเหมือนคนอื่น ไม่มีเบอร์/ที่อยู่ในผลลัพธ์นี้อยู่แล้ว)
create or replace function public.family_tree_data()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  with vis as (select public.tree_person_ids() as id)
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
                 'age', public.age_years(b.birth_date)) order by p.id)
          from public.person p
          left join public.person_birth b on b.person_id = p.id
         where p.id in (select id from vis)), '[]'::jsonb),
    'child_links', coalesce((
        select jsonb_agg(jsonb_build_object('parent_id', c.person_id, 'child_id', c.child_person_id))
          from public.person_child c
         where c.child_person_id is not null
           and c.person_id in (select id from vis)
           and c.child_person_id in (select id from vis)), '[]'::jsonb))
   where auth.uid() is not null
$$;
revoke all on function public.family_tree_data() from public, anon;
grant execute on function public.family_tree_data() to authenticated;

-- ===== คำนวณผู้เชื่อมโยงใหม่จากความสัมพันธ์ =====
-- คู่ความสัมพันธ์ (บิดา/มารดา/คู่สมรส/บุตรธิดา) a—b: a เป็นผู้เชื่อมโยงในตระกูลที่ b เป็นสมาชิกหลัก (ถ้า a ยังไม่เป็นสมาชิกหลักที่นั่น) และกลับกัน
create or replace function public.clan_rebuild_links()
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.clan_member where role = 'linked';
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
                      where x.clan_id = m.clan_id and x.person_id = s.a and x.role = 'member');
end $$;
revoke all on function public.clan_rebuild_links() from public, anon, authenticated;

create or replace function public.clan_links_trigger()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$ begin perform public.clan_rebuild_links(); return null; end $$;
revoke all on function public.clan_links_trigger() from public, anon, authenticated;

drop trigger if exists person_clan_links on public.person;
create trigger person_clan_links
  after insert or delete or update of father_id, mother_id, spouse_id on public.person
  for each statement execute function public.clan_links_trigger();

drop trigger if exists person_child_clan_links on public.person_child;
create trigger person_child_clan_links
  after insert or delete or update of child_person_id, person_id on public.person_child
  for each statement execute function public.clan_links_trigger();

-- ===== ข้อมูลเดิม: จัดเข้าตระกูลตามนามสกุลครั้งเดียว (ข้ามถ้ามีสมาชิกหลักอยู่แล้ว จึงรันซ้ำได้) =====
do $$
begin
  if not exists (select 1 from public.clan_member where role = 'member') then
    insert into public.clan (name)
    select min(sn) from (
      select btrim(substr(n, position(' ' in n) + 1)) as sn
        from (select btrim(regexp_replace(full_name, '\s+', ' ', 'g')) as n from public.person) t
       where n like '% %') s
     group by public.norm_name(sn)
    on conflict do nothing;

    insert into public.clan_member (clan_id, person_id, role)
    select c.id, p.id, 'member'
      from public.person p
      join public.clan c on public.norm_name(c.name) = public.surname_of(p.full_name)
    on conflict do nothing;
  end if;
  perform public.clan_rebuild_links();
end $$;

-- ===== ฟังก์ชันสำหรับหน้าเว็บ =====

-- รายชื่อตระกูล (ชื่ออย่างเดียว) ใช้เลือกตอนขอเข้า/ขอเป็นผู้ดูแล
create or replace function public.clan_directory()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb)
    from public.clan where auth.uid() is not null
$$;

-- ตระกูลของฉัน: บทบาท + เป็นผู้ดูแลหรือไม่ (ผู้ดูแลสูงสุดเห็นทุกตระกูลเป็นผู้ดูแล)
create or replace function public.my_clans()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'super', public.is_super_admin(),
    'clans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name,
               'role', (select m.role from public.clan_member m join public.person p on p.id = m.person_id
                         where m.clan_id = c.id and p.auth_user_id = auth.uid()),
               'is_admin', public.is_clan_admin(c.id)) order by c.name)
        from public.clan c
       where public.is_super_admin()
          or c.id in (select m.clan_id from public.clan_member m join public.person p on p.id = m.person_id
                       where p.auth_user_id = auth.uid())), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'clan_id', r.clan_id, 'status', r.status)
                       order by r.id desc)
        from public.clan_request r join public.person p on p.id = r.person_id
       where p.auth_user_id = auth.uid()), '[]'::jsonb))
   where auth.uid() is not null
$$;

create or replace function public.clan_request_create(p_kind text, p_clan_id bigint, p_note text default null)
returns bigint language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_person bigint; v_is_member boolean; v_id bigint;
begin
  select id into v_person from public.person where auth_user_id = auth.uid();
  if v_person is null then raise exception 'ไม่พบข้อมูลบุคคลของบัญชีนี้'; end if;
  if p_kind not in ('join','admin') then raise exception 'ประเภทคำขอไม่ถูกต้อง'; end if;
  if not exists (select 1 from public.clan where id = p_clan_id) then raise exception 'ไม่พบตระกูลนี้'; end if;
  select exists (select 1 from public.clan_member where clan_id = p_clan_id and person_id = v_person and role = 'member')
    into v_is_member;
  if p_kind = 'join' and v_is_member then raise exception 'คุณเป็นสมาชิกของตระกูลนี้อยู่แล้ว'; end if;
  if p_kind = 'admin' and not v_is_member then raise exception 'ต้องเป็นสมาชิกหลักของตระกูลก่อนจึงขอเป็นผู้ดูแลได้'; end if;
  if p_kind = 'admin' and exists (select 1 from public.clan_admin where clan_id = p_clan_id and user_id = auth.uid()) then
    raise exception 'คุณเป็นผู้ดูแลตระกูลนี้อยู่แล้ว';
  end if;
  insert into public.clan_request (kind, person_id, clan_id, note)
  values (p_kind, v_person, p_clan_id, nullif(btrim(p_note), ''))
  returning id into v_id;
  return v_id;
exception when unique_violation then
  raise exception 'มีคำขอที่รอพิจารณาอยู่แล้ว';
end $$;

-- คำขอที่รอพิจารณา: 'join' ของตระกูลที่ฉันดูแล, 'admin' เฉพาะผู้ดูแลสูงสุด
create or replace function public.clan_requests_pending()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'kind', r.kind, 'clan_id', r.clan_id, 'clan_name', c.name,
           'person_id', r.person_id, 'full_name', p.full_name, 'prefix', p.prefix,
           'note', r.note, 'created_at', r.created_at) order by r.id), '[]'::jsonb)
    from public.clan_request r
    join public.clan c on c.id = r.clan_id
    join public.person p on p.id = r.person_id
   where auth.uid() is not null and r.status = 'pending'
     and ((r.kind = 'join' and public.is_clan_admin(r.clan_id))
       or (r.kind = 'admin' and public.is_super_admin()))
$$;

create or replace function public.clan_request_decide(p_id bigint, p_approve boolean)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare r public.clan_request; v_user uuid;
begin
  select * into r from public.clan_request where id = p_id and status = 'pending' for update;
  if not found then raise exception 'ไม่พบคำขอที่รอพิจารณา'; end if;
  if r.kind = 'join'  and not public.is_clan_admin(r.clan_id) then raise exception 'ไม่มีสิทธิ์'; end if;
  if r.kind = 'admin' and not public.is_super_admin()         then raise exception 'ไม่มีสิทธิ์'; end if;

  if p_approve then
    if r.kind = 'join' then
      insert into public.clan_member (clan_id, person_id, role) values (r.clan_id, r.person_id, 'member')
      on conflict (clan_id, person_id) do update set role = 'member';
    else
      select auth_user_id into v_user from public.person where id = r.person_id;
      if v_user is null or not exists (select 1 from public.clan_member
                                        where clan_id = r.clan_id and person_id = r.person_id and role = 'member') then
        raise exception 'ผู้ขอไม่ใช่สมาชิกหลักของตระกูลนี้แล้ว';
      end if;
      insert into public.clan_admin (clan_id, user_id) values (r.clan_id, v_user) on conflict do nothing;
    end if;
    perform public.clan_rebuild_links();
  end if;
  update public.clan_request
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
end $$;

-- รายชื่อสมาชิกของตระกูล (ผู้ดูแลตระกูลนั้นเท่านั้น)
create or replace function public.clan_members_list(p_clan_id bigint)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'person_id', p.id, 'prefix', p.prefix, 'full_name', p.full_name, 'nickname', p.nickname,
           'role', m.role,
           'is_admin', exists (select 1 from public.clan_admin a
                                where a.clan_id = m.clan_id and a.user_id = p.auth_user_id),
           'has_account', p.auth_user_id is not null) order by m.role, p.full_name), '[]'::jsonb)
    from public.clan_member m join public.person p on p.id = m.person_id
   where public.is_clan_admin(p_clan_id) and m.clan_id = p_clan_id
$$;

-- ตั้ง/ถอดผู้ดูแลร่วม (ผู้ดูแลตระกูลนั้น); ผู้ดูแลตระกูลต้องเหลืออย่างน้อย 1 คนเสมอ ยกเว้นผู้ดูแลสูงสุดเป็นคนทำ
create or replace function public.clan_set_admin(p_clan_id bigint, p_person_id bigint, p_on boolean)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_user uuid;
begin
  if not public.is_clan_admin(p_clan_id) then raise exception 'ไม่มีสิทธิ์'; end if;
  select auth_user_id into v_user from public.person where id = p_person_id;
  if p_on then
    if v_user is null or not exists (select 1 from public.clan_member
                                      where clan_id = p_clan_id and person_id = p_person_id and role = 'member') then
      raise exception 'ตั้งเป็นผู้ดูแลได้เฉพาะสมาชิกหลักที่มีบัญชีผู้ใช้';
    end if;
    insert into public.clan_admin (clan_id, user_id) values (p_clan_id, v_user) on conflict do nothing;
  else
    if not public.is_super_admin()
       and (select count(*) from public.clan_admin where clan_id = p_clan_id and user_id <> coalesce(v_user, auth.uid())) = 0 then
      raise exception 'ตระกูลต้องมีผู้ดูแลอย่างน้อย 1 คน';
    end if;
    delete from public.clan_admin where clan_id = p_clan_id and user_id = v_user;
  end if;
end $$;

-- เพิ่มคนเข้าตระกูลเป็นสมาชิกหลัก: ผู้ดูแลสูงสุดเพิ่มใครก็ได้;
-- ผู้ดูแลตระกูลเพิ่มได้เฉพาะคนที่ตัวเองมองเห็นอยู่แล้ว (เช่น เลื่อนผู้เชื่อมโยงเป็นสมาชิกหลัก)
create or replace function public.clan_add_member(p_clan_id bigint, p_person_id bigint)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_clan_admin(p_clan_id) then raise exception 'ไม่มีสิทธิ์'; end if;
  if not public.is_super_admin() and p_person_id not in (select public.tree_person_ids()) then
    raise exception 'ไม่พบบุคคลนี้ในแผนผังของคุณ';
  end if;
  insert into public.clan_member (clan_id, person_id, role) values (p_clan_id, p_person_id, 'member')
  on conflict (clan_id, person_id) do update set role = 'member';
  perform public.clan_rebuild_links();
end $$;

-- เอาสมาชิกหลักออกจากตระกูล (ไม่ลบบัญชี/ข้อมูลบุคคล) และถอดสิทธิ์ผู้ดูแลของเขาในตระกูลนี้
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
  perform public.clan_rebuild_links();
end $$;

-- ย้ายสมาชิกหลักไปตระกูลอื่น (ต้องเป็นผู้ดูแลทั้งสองตระกูล หรือผู้ดูแลสูงสุด)
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
  insert into public.clan_member (clan_id, person_id, role) values (p_to, p_person_id, 'member')
  on conflict (clan_id, person_id) do update set role = 'member';
  perform public.clan_rebuild_links();
end $$;

-- ผู้ดูแลสูงสุดเท่านั้น: สร้าง/เปลี่ยนชื่อตระกูล
create or replace function public.clan_create(p_name text)
returns bigint language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_id bigint;
begin
  if not public.is_super_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  insert into public.clan (name) values (btrim(p_name)) returning id into v_id;
  return v_id;
exception when unique_violation then raise exception 'มีตระกูลชื่อนี้แล้ว';
end $$;

create or replace function public.clan_rename(p_clan_id bigint, p_name text)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_super_admin() then raise exception 'ไม่มีสิทธิ์'; end if;
  update public.clan set name = btrim(p_name) where id = p_clan_id;
exception when unique_violation then raise exception 'มีตระกูลชื่อนี้แล้ว';
end $$;

-- ผู้ดูแลแก้ข้อมูลสมาชิกหลักของตระกูลตัวเอง ผ่านรายการฟิลด์ที่อนุญาตเท่านั้น
-- (ไม่แตะ auth_user_id/id ฯลฯ; ชื่อพ่อ/แม่/คู่สมรสผ่าน trigger เดิมที่แปลงเป็น id ให้)
-- p_patch ใส่เฉพาะคีย์ที่ต้องการแก้; ค่าว่าง = ล้างค่า (ยกเว้น full_name ที่ล้างไม่ได้)
-- คีย์ข้อความ: prefix nickname gender phone line_id house_no road subdistrict district province postal_code
--              father_name mother_name spouse_name   บูลีน: father_alive mother_alive deceased
--              full_name   วันเกิด (YYYY-MM-DD ค.ศ.): birth_date
create or replace function public.clan_update_person(p_person_id bigint, p_patch jsonb)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare k text;
  t constant text[] := array['prefix','nickname','gender','phone','line_id','house_no','road','subdistrict',
                             'district','province','postal_code','father_name','mother_name','spouse_name'];
begin
  if auth.uid() is null or not exists (
       select 1 from public.clan_member m
        where m.person_id = p_person_id and m.role = 'member' and public.is_clan_admin(m.clan_id)) then
    raise exception 'ไม่มีสิทธิ์แก้ไขข้อมูลบุคคลนี้';
  end if;
  foreach k in array t loop
    if p_patch ? k then
      execute format('update public.person set %I = nullif(btrim($1), '''') where id = $2', k)
        using p_patch ->> k, p_person_id;
    end if;
  end loop;
  if p_patch ? 'full_name' and nullif(btrim(p_patch ->> 'full_name'), '') is not null then
    update public.person set full_name = btrim(p_patch ->> 'full_name') where id = p_person_id;
  end if;
  if p_patch ? 'father_alive' then
    update public.person set father_alive = (p_patch ->> 'father_alive')::boolean where id = p_person_id; end if;
  if p_patch ? 'mother_alive' then
    update public.person set mother_alive = (p_patch ->> 'mother_alive')::boolean where id = p_person_id; end if;
  if p_patch ? 'deceased' then
    update public.person set deceased = coalesce((p_patch ->> 'deceased')::boolean, false) where id = p_person_id; end if;
  if p_patch ? 'birth_date' then
    insert into public.person_birth (person_id, birth_date)
    values (p_person_id, nullif(btrim(p_patch ->> 'birth_date'), '')::date)
    on conflict (person_id) do update set birth_date = excluded.birth_date;
  end if;
end $$;

revoke all on function
  public.clan_directory(), public.my_clans(), public.clan_request_create(text, bigint, text),
  public.clan_requests_pending(), public.clan_request_decide(bigint, boolean),
  public.clan_members_list(bigint), public.clan_set_admin(bigint, bigint, boolean),
  public.clan_add_member(bigint, bigint), public.clan_remove_member(bigint, bigint),
  public.clan_move_member(bigint, bigint, bigint), public.clan_create(text), public.clan_rename(bigint, text),
  public.clan_update_person(bigint, jsonb)
  from public, anon;
grant execute on function
  public.clan_directory(), public.my_clans(), public.clan_request_create(text, bigint, text),
  public.clan_requests_pending(), public.clan_request_decide(bigint, boolean),
  public.clan_members_list(bigint), public.clan_set_admin(bigint, bigint, boolean),
  public.clan_add_member(bigint, bigint), public.clan_remove_member(bigint, bigint),
  public.clan_move_member(bigint, bigint, bigint), public.clan_create(text), public.clan_rename(bigint, text),
  public.clan_update_person(bigint, jsonb)
  to authenticated;

-- ===== ขั้นตอนหลังรัน: ตั้งผู้ดูแลสูงสุดคนแรก (รันเอง 1 ครั้ง แก้ชื่อ-นามสกุลให้ตรงกับของคุณ) =====
-- ต้องเป็นคนที่สมัครและมีบัญชีล็อกอินแล้ว เพิ่มคนต่อไปได้ด้วยคำสั่งเดียวกัน
--
--   insert into public.super_admin (user_id)
--   select auth_user_id from public.person
--    where public.norm_name(full_name) = public.norm_name('ชื่อ นามสกุล') and auth_user_id is not null
--   on conflict do nothing;
--
-- ตรวจผล:  select c.name, count(*) filter (where m.role='member') as members,
--                 count(*) filter (where m.role='linked') as linked
--            from public.clan c left join public.clan_member m on m.clan_id = c.id group by c.name order by 1;

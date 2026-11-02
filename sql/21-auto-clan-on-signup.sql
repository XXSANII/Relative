-- จัดเข้าตระกูลอัตโนมัติตั้งแต่ตอนสมัครจากนามสกุล + นามสกุลบิดา/มารดา
-- รันใน Supabase SQL Editor หลัง 20-tree-is-member.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- กติกา (ทำงานใน trigger ของตาราง person จึงใช้ได้กับทุกช่องทางที่เพิ่มแถวบุคคล)
--   1) สมัครใหม่: นามสกุลของ user ตรงกับตระกูลที่มีอยู่ → เป็น "สมาชิกหลัก" ของตระกูลนั้นทันที
--      ถ้ายังไม่มีตระกูลชื่อนั้น → สร้างตระกูลใหม่ให้และเป็นสมาชิกหลัก (ยังไม่เป็นผู้ดูแล)
--   2) ชื่อบิดา/มารดา (ตอนสมัคร หรือเมื่อแก้ชื่อบิดา/มารดาภายหลัง): ถ้านามสกุลของ user ไม่ตรงกับของบิดา/มารดา
--      และมีตระกูลชื่อตามนามสกุลของบิดา/มารดาอยู่ → เป็น "สมาชิกหลัก" ของตระกูลนั้นด้วย
--      (จึงเป็นสมาชิกหลักได้หลายตระกูล เช่น ตระกูลตามนามสกุลตัวเอง + ตระกูลของบิดา/มารดา)
--      ใช้ได้แม้บิดา/มารดายังไม่ได้ลงทะเบียน; ถ้าไม่มีตระกูลนั้นอยู่ ไม่สร้างให้
--   * การเปลี่ยนนามสกุลภายหลังไม่ย้ายตระกูลเอง (กันการเปลี่ยนชื่อเพื่อเข้าตระกูล) ผู้ดูแลย้ายได้
--   * ข้อควรรู้: ทุกคนที่สมัครด้วยนามสกุลที่ตรงกับตระกูล (หรือกรอกบิดา/มารดาที่มีนามสกุลตรงกับตระกูล)
--     จะเห็นข้อมูลสมาชิกของตระกูลนั้นทันที ผู้ดูแลต้องตรวจรายชื่อใหม่ในหน้า admin และเอาออก/ย้ายคนที่ไม่ใช่ญาติ

create or replace function public.clan_auto_assign()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_sn text := public.surname_of(new.full_name);
  v_name text := btrim(regexp_replace(coalesce(new.full_name, ''), '\s+', ' ', 'g'));
  v_clan bigint; v_pclan bigint; v_psn text; r text;
begin
  if tg_op = 'INSERT' and v_sn is not null then
    select id into v_clan from public.clan where public.norm_name(name) = v_sn;
    if v_clan is null then
      insert into public.clan (name) values (btrim(substr(v_name, position(' ' in v_name) + 1)))
      on conflict do nothing;
      select id into v_clan from public.clan where public.norm_name(name) = v_sn;
    end if;
    if v_clan is not null then
      insert into public.clan_member (clan_id, person_id, role) values (v_clan, new.id, 'member')
      on conflict (clan_id, person_id) do update set role = 'member';
    end if;
  end if;

  foreach r in array array[new.father_name, new.mother_name] loop
    v_psn := public.surname_of(r);
    if v_psn is not null and v_psn is distinct from v_sn then
      select id into v_pclan from public.clan where public.norm_name(name) = v_psn;
      if v_pclan is not null then
        insert into public.clan_member (clan_id, person_id, role) values (v_pclan, new.id, 'member')
        on conflict (clan_id, person_id) do update set role = 'member';
      end if;
    end if;
  end loop;
  return null;
end $$;
revoke all on function public.clan_auto_assign() from public, anon, authenticated;

-- แยก 2 trigger: สมัครใหม่ และ "ชื่อบิดา/มารดาเปลี่ยนจริง" เท่านั้น
-- (บันทึกโปรไฟล์ทุกครั้งส่งทุกคอลัมน์มา ถ้าไม่เช็กว่าค่าเปลี่ยนจริง การเอาคนออกจากตระกูลโดยผู้ดูแลจะถูกเพิ่มกลับทุกครั้งที่บันทึก)
drop trigger if exists person_clan_auto_assign on public.person;
drop trigger if exists person_clan_auto_assign_ins on public.person;
drop trigger if exists person_clan_auto_assign_upd on public.person;
create trigger person_clan_auto_assign_ins
  after insert on public.person
  for each row execute function public.clan_auto_assign();
create trigger person_clan_auto_assign_upd
  after update of father_name, mother_name on public.person
  for each row
  when (old.father_name is distinct from new.father_name or old.mother_name is distinct from new.mother_name)
  execute function public.clan_auto_assign();

-- (ไม่บังคับ) จัดคนที่สมัครไว้แล้วแต่ยังไม่มีตระกูลเข้าตามนามสกุล ข้ามถ้าไม่ต้องการ
-- ระวัง: จะรวมคนที่ผู้ดูแลเอาออกจากตระกูลไปแล้วด้วย
--
--   insert into public.clan_member (clan_id, person_id, role)
--   select c.id, p.id, 'member' from public.person p
--     join public.clan c on public.norm_name(c.name) = public.surname_of(p.full_name)
--    where not exists (select 1 from public.clan_member m where m.person_id = p.id and m.role = 'member')
--   on conflict (clan_id, person_id) do update set role = 'member';
--   select public.clan_rebuild_links();

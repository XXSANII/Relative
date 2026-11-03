-- สมัครได้ แม้ชื่อ-นามสกุลซ้ำกับที่มีในทะเบียน ถ้าข้อมูลบิดา/มารดาต่างกัน (ถือเป็นคนละคน)
-- รันใน Supabase SQL Editor หลัง 26-admin-edit-linked-full.sql (รันซ้ำได้) ก่อน deploy หน้าเว็บเวอร์ชันนี้
--
-- กติกา: ชื่อ "ซ้ำ" (ต้องใช้รหัสยืนยันเชื่อมข้อมูลเดิม) เมื่อมีคนชื่อเดียวกันที่ "ไม่ได้ต่างกันที่พ่อแม่"
--   ต่างกัน = เทียบชื่อบิดา/มารดาได้อย่างน้อย 1 คู่ (ทั้งสองฝั่งมีข้อมูล) และ "ทุกคู่ที่เทียบได้ไม่ตรงกัน"
--   * บิดาตรงกัน แต่มารดาต่างกัน → ยังถือว่าซ้ำ (น่าจะเป็นคนเดิมที่สะกดต่างกัน) ต้องเชื่อมข้อมูลเดิม
--   * ฝั่งใดฝั่งหนึ่งไม่มีข้อมูลพ่อแม่ → เทียบไม่ได้ ถือว่าซ้ำ (กันสร้างข้อมูลซ้ำโดยไม่ตั้งใจ)
--   ถ้ามีคนชื่อซ้ำหลายคน ต้อง "ต่างจากทุกคน" จึงจะสมัครใหม่ได้
-- หมายเหตุ: เมื่อมีชื่อซ้ำกันหลายคน ระบบจะไม่เชื่อมความสัมพันธ์จากชื่ออัตโนมัติ (กันเชื่อมผิดคน)
--   ผู้ดูแลต้องช่วยตรวจ/แก้ความสัมพันธ์ของคนชื่อซ้ำ

create or replace function public.person_name_taken(p_name text, p_father text default null, p_mother text default null)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and exists (
    select 1 from public.person p
     where public.norm_name(p.full_name) = public.norm_name(p_name)
       and not (
         (public.norm_name(p_father) is not null and public.norm_name(p.father_name) is not null
          or public.norm_name(p_mother) is not null and public.norm_name(p.mother_name) is not null)
         and coalesce(public.norm_name(p_father) is null or public.norm_name(p.father_name) is null
                      or public.norm_name(p_father) <> public.norm_name(p.father_name), true)
         and coalesce(public.norm_name(p_mother) is null or public.norm_name(p.mother_name) is null
                      or public.norm_name(p_mother) <> public.norm_name(p.mother_name), true)))
$$;
revoke all on function public.person_name_taken(text, text, text) from public, anon;
grant execute on function public.person_name_taken(text, text, text) to authenticated;

-- ลบฟังก์ชันเดิมแบบ 1 พารามิเตอร์ (ถ้าเหลือไว้ rpc จะกำกวมเมื่อส่งเฉพาะ p_name)
drop function if exists public.person_name_taken(text);

-- รันหลังจากสร้าง person_claim_codes และ claim_existing_person(text) แล้ว
-- ฟังก์ชันนี้ตรวจสอบชื่อ-นามสกุลด้วย เพื่อป้องกันการใช้ Claim Code ผิดคน
CREATE OR REPLACE FUNCTION public.claim_existing_person_by_name(
    p_claim_code text,
    p_full_name text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
DECLARE
    v_user_id uuid;
    v_person_id bigint;
    v_code_hash bytea;
    v_stored_name text;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'กรุณาเข้าสู่ระบบก่อนเชื่อมข้อมูลบุคคล';
    END IF;

    IF p_claim_code IS NULL OR btrim(p_claim_code) = ''
       OR p_full_name IS NULL OR btrim(p_full_name) = '' THEN
        RAISE EXCEPTION 'กรุณากรอกชื่อและรหัสยืนยัน';
    END IF;

    v_code_hash := extensions.digest(convert_to(btrim(p_claim_code), 'UTF8'), 'sha256');

    SELECT c.person_id, p.full_name
      INTO v_person_id, v_stored_name
    FROM public.person_claim_codes c
    JOIN public.person p ON p.id = c.person_id
    WHERE c.code_hash = v_code_hash
      AND c.used_at IS NULL
      AND c.expires_at > now()
    FOR UPDATE OF c, p;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'รหัสยืนยันไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว';
    END IF;

    IF lower(regexp_replace(btrim(v_stored_name), '\s+', ' ', 'g'))
       <> lower(regexp_replace(btrim(p_full_name), '\s+', ' ', 'g')) THEN
        RAISE EXCEPTION 'ชื่อไม่ตรงกับบุคคลที่รหัสนี้อนุญาตให้เชื่อม';
    END IF;

    UPDATE public.person
       SET auth_user_id = v_user_id
     WHERE id = v_person_id
       AND auth_user_id IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'บุคคลนี้มีบัญชีเชื่อมอยู่แล้ว';
    END IF;

    UPDATE public.person_claim_codes SET used_at = now() WHERE code_hash = v_code_hash;
    RETURN v_person_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_existing_person_by_name(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_existing_person_by_name(text, text) TO authenticated;

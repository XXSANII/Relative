(async () => {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (session) {
    location.href = "main.html";
    return;
  }
  const addrPicker = await initAddressPicker("", "addressBox").catch((e) => {
    showMessage("message", e.message);
    return null;
  });
  // วันเกิดบังคับ เว้นแต่ติ๊กเสียชีวิตแล้ว (ตรวจใน readFamily)
  const birth = birthDateInput("birthBox", { label: "วันเดือนปีเกิด" });
  bindBirthRequired("birthBox", "deceased");
  const fatherBirth = optionalBirthDate("fatherBirthBox", {
    toggleLabel: "วันเดือนปีเกิดของบิดา",
    label: "วันเกิดของบิดา",
  });
  const motherBirth = optionalBirthDate("motherBirthBox", {
    toggleLabel: "วันเดือนปีเกิดของมารดา",
    label: "วันเกิดของมารดา",
  });
  const fatherAlive = aliveSwitch("fatherAliveBox", "บิดา");
  const motherAlive = aliveSwitch("motherAliveBox", "มารดา");
  const kids = childrenEditor("childrenBox");
  // อ่านและตรวจวันเกิด/บุตรธิดาจากฟอร์ม
  const pick = (r) => {
    if (r.error) {
      $(r.focus).focus();
      throw new Error(r.error);
    }
    return r;
  };
  const readFamily = () => ({
    birth_date: (() => {
      const v = pick(birth.get()).value;
      pick(checkBirthOrDeceased("birthBox", "deceased", v));
      return v;
    })(),
    deceased: $("deceased").checked,
    father_birth_date: pick(fatherBirth.get()).value,
    mother_birth_date: pick(motherBirth.get()).value,
    kids: pick(kids.get()),
    nickname: $("nickname").value.trim().replace(/\s+/g, " ") || null,
    prefix: $("prefix").value.trim().replace(/\s+/g, " ") || null,
    spouse_phone: pick(readSpousePhone("spousePhone")).value,
    father_alive: fatherAlive.get(!!$("father").value.trim()),
    mother_alive: motherAlive.get(!!$("mother").value.trim()),
  });
  // ข้อมูลเดิม (Claim) ไม่ได้บันทึกชื่อพ่อแม่จากฟอร์ม จึงไม่บันทึกวันเกิดพ่อแม่ด้วย
  const saveFamily = async (personId, f, isNew) => {
    await saveBirthDates(
      personId,
      isNew
        ? {
            birth_date: f.birth_date,
            father_birth_date: f.father_birth_date,
            mother_birth_date: f.mother_birth_date,
          }
        : { birth_date: f.birth_date },
    );
    await saveChildren(personId, f.kids);
    if (f.spouse_phone) await savePrivate(personId, { spouse_phone: f.spouse_phone });
    // ข้อมูลเดิม (Claim): บันทึกคำนำหน้า/ชื่อเล่นที่กรอกตอนสมัครลงแถวเดิม
    if (!isNew && (f.nickname || f.prefix || f.deceased)) {
      const patch = {};
      if (f.deceased) patch.deceased = true;
      if (f.nickname) patch.nickname = f.nickname;
      if (f.prefix) patch.prefix = f.prefix;
      const { error } = await sb.from("person").update(patch).eq("id", personId);
      if (error) throw error;
    }
  };

  $("avatar").addEventListener("change", async () => {
    const f = $("avatar").files[0];
    if (!f) {
      $("preview").hidden = true;
      return;
    }
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(f.type) ||
      f.size > 5 * 1024 * 1024
    ) {
      $("avatar").value = "";
      showMessage("message", "รูปต้องเป็น JPG, PNG หรือ WebP และไม่เกิน 5 MB");
      $("preview").hidden = true;
      return;
    }
    const cropped = await cropIntoInput($("avatar"), f);
    if (!cropped) {
      $("preview").hidden = true;
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      $("preview").src = r.result;
      $("preview").hidden = false;
    };
    r.readAsDataURL(cropped);
  });

  let pendingClaim = false;
  let pendingFullName = "";
  $("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showMessage("message", "");
    const btn = $("submitBtn");
    btn.disabled = true;
    if (pendingClaim) {
      try {
        const code = $("claimCode").value.trim();
        if (!code) throw new Error("กรุณากรอกรหัสยืนยันจากผู้ดูแล");
        const family = readFamily();
        const { data: personId, error } = await sb.rpc(
          "claim_existing_person_by_name",
          { p_claim_code: code, p_full_name: pendingFullName },
        );
        if (error) throw error;
        await saveFamily(personId, family, false);
        location.href = "main.html";
      } catch (err) {
        showMessage("message", err.message || "เชื่อมข้อมูลไม่สำเร็จ");
      } finally {
        btn.disabled = false;
      }
      return;
    }
    let createdAuth = false;
    try {
      const firstName = $("firstName").value.trim().replace(/\s+/g, " ");
      const lastName = $("lastName").value.trim().replace(/\s+/g, " ");
      const name = `${firstName} ${lastName}`;
      const phone = normalizePhone($("phone").value);
      const gender = $("gender").value || null;
      const addr = addrPicker ? addrPicker.get() : { values: {} };
      if (addr.error) {
        $(addr.focus).focus();
        throw new Error(addr.error);
      }
      const claimCode = $("claimCode").value.trim();
      if (firstName.length < 2 || /\s/.test(firstName))
        throw new Error("กรุณากรอกชื่อจริงเป็นคำเดียว (ไม่ต้องใส่นามสกุล)");
      if (lastName.length < 2) throw new Error("กรุณากรอกนามสกุลให้ถูกต้อง");
      if (phone && !validPhone(phone))
        throw new Error("กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง เช่น 0812345678");
      const rel = (k) => $(k).value.trim().replace(/\s+/g, " ") || null;
      const father_name = rel("father"),
        mother_name = rel("mother"),
        spouse_name = rel("spouse");
      if (
        [father_name, mother_name, spouse_name].some(
          (n) => n && normalize(n) === normalize(name),
        )
      )
        throw new Error("ชื่อพ่อ แม่ หรือคู่สมรส ต้องไม่ใช่ชื่อของตัวเอง");
      const family = readFamily();
      // รหัสผ่าน = วันเดือนปีเกิด DDMMYYYY (ปี พ.ศ.) ส่งให้ Supabase Auth เก็บแบบ hash เท่านั้น
      // ไม่ได้กรอกวันเกิด (เช่น เสียชีวิตแล้ว) → ใช้รหัสผ่าน 00000000
      const password = family.birth_date
        ? birthPassword(family.birth_date)
        : NO_BIRTH_PASSWORD;

      // Username (ชื่อจริง) + เบอร์โทร ถูกแปลงเป็นอีเมลภายในสำหรับ Supabase Auth
      const email = await accountEmail(firstName, phone, lastName);
      let { data: authData, error: authError } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: firstName,
            first_name: firstName,
            last_name: lastName,
          },
        },
      });
      if (authError && /already registered/i.test(authError.message)) {
        // มีบัญชีใน Auth อยู่แล้ว (เช่น ลบแถวใน person แต่ไม่ได้ลบผู้ใช้ใน Auth) → ลองเข้าสู่ระบบด้วยวันเกิด หรือเบอร์โทร (บัญชีระบบเดิม)
        let { data: signIn, error: signInError } =
          await sb.auth.signInWithPassword({ email, password });
        if (signInError && phone) {
          ({ data: signIn, error: signInError } =
            await sb.auth.signInWithPassword({ email, password: phone }));
          if (!signInError && !(await currentPerson()))
            await sb.auth.updateUser({ password });
        }
        if (signInError || !signIn.session)
          throw new Error(
            "ชื่อจริงและเบอร์โทรนี้มีบัญชีอยู่แล้ว กรุณาไปหน้าเข้าสู่ระบบ",
          );
        if (await currentPerson()) {
          await sb.auth.signOut();
          throw new Error(
            "ชื่อจริงและเบอร์โทรนี้มีบัญชีอยู่แล้ว กรุณาไปหน้าเข้าสู่ระบบ",
          );
        }
        authData = signIn;
        authError = null; // บัญชีค้างที่ไม่มีข้อมูลบุคคล → สร้างข้อมูลบุคคลต่อบนบัญชีเดิม
      }
      if (authError) throw authError;
      if (!authData.user) throw new Error("สร้างบัญชีไม่สำเร็จ");
      createdAuth = true;
      if (!authData.session)
        throw new Error(
          "บัญชีถูกสร้างแล้ว แต่ยังไม่มี session กรุณาปิด Confirm email ใน Supabase Auth หรือใช้ flow ยืนยันบัญชีที่ตั้งค่าไว้",
        );

      // ตรวจชื่อซ้ำ (ชื่อเดียวกันแต่บิดา/มารดาต่างกัน ถือเป็นคนละคน: 27-name-taken-by-parents.sql) ผ่านฟังก์ชัน เพราะผู้สมัครใหม่ยังไม่มีวงครอบครัวจึงอ่านรายชื่อโดยตรงไม่ได้ (11-family-circles.sql)
      // Never link by name alone.
      const { data: nameTaken, error: matchError } = await sb.rpc(
        "person_name_taken",
        { p_name: name, p_father: father_name, p_mother: mother_name },
      );
      if (matchError) throw matchError;
      let personId = null;

      if (nameTaken) {
        if (!claimCode) {
          showMessage(
            "message",
            "พบชื่อในทะเบียนเดิม บัญชีถูกสร้างแล้วแต่ยังไม่ได้เชื่อมข้อมูล กรุณากรอกรหัสยืนยันจากผู้ดูแลในช่องด้านบน แล้วกดปุ่มนี้อีกครั้งไม่ได้ เพราะบัญชีถูกสร้างแล้ว ให้ไปหน้า Login แล้วใช้รหัสผ่านที่ตั้งไว้ หรือขอให้ผู้ดูแลช่วยดำเนินการต่อ",
            "error",
          );
          // Keep the authenticated session and expose a claim-only continuation button.
          pendingClaim = true;
          pendingFullName = name;
          $("submitBtn").textContent = "เชื่อมข้อมูลเดิม";
          $("submitBtn").disabled = false;
          return;
        }
        const { data, error } = await sb.rpc("claim_existing_person_by_name", {
          p_claim_code: claimCode,
          p_full_name: name,
        });
        if (error) throw error;
        personId = data;
        await saveFamily(personId, family, false);
      } else {
        // No existing person with this normalized name: create a new record for this account.
        // เก็บชื่อพ่อแม่/คู่สมรสเป็นข้อความ ฐานข้อมูลจะเชื่อมเป็นลิงก์ให้เมื่อบุคคลนั้นมีในระบบ (04-relation-names.sql)
        const { data: person, error: personError } = await sb
          .from("person")
          .insert({
            full_name: name,
            prefix: family.prefix,
            nickname: family.nickname,
            phone: phone || null,
            deceased: family.deceased,
            gender,
            ...addr.values,
            father_name,
            mother_name,
            spouse_name,
            father_alive: family.father_alive,
            mother_alive: family.mother_alive,
            auth_user_id: authData.user.id,
          })
          .select("id")
          .single();
        if (personError) throw personError;
        personId = person.id;
        await saveFamily(personId, family, true);
      }

      const file = $("avatar").files[0];
      if (file && personId) {
        const ext = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
        }[file.type];
        const path = `${personId}/avatar-${Date.now()}.${ext}`;
        const { error: uploadError } = await sb.storage
          .from(AVATAR_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
        const { error: updateError } = await sb
          .from("person")
          .update({ avatar_path: path })
          .eq("id", personId);
        if (updateError) throw updateError;
      }
      location.href = "main.html";
    } catch (err) {
      console.error(err);
      showMessage(
        "message",
        (createdAuth ? "บัญชีอาจถูกสร้างแล้ว: " : "") +
          (err.message || "ลงทะเบียนไม่สำเร็จ"),
      );
    } finally {
      btn.disabled = false;
    }
  });
})();

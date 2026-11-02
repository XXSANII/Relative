(async () => {
  let person = null,
    me = null;
  const id = Number(new URLSearchParams(location.search).get("id"));
  try {
    me = await currentPerson();
    if (!me) {
      location.href = "login.html";
      return;
    }
    if (!id) {
      location.replace(`profile.html?id=${me.id}`);
      return;
    }
    const { data, error } = await sb
      .from("person")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("ไม่พบข้อมูลบุคคล");
    person = data;
    const own = person.id === me.id;
    $("avatar").src = avatarUrl(person.avatar_path);
    $("name").textContent = displayName(person);
    $("ownerLabel").textContent = own ? "โปรไฟล์ของคุณ" : "ข้อมูลญาติ";
    $("gender").textContent = GENDER[person.gender] || "ไม่ระบุ";
    $("phone").textContent = person.phone || "-";
    $("line").textContent = person.line_id || "-";
    $("address").textContent = composeAddress(person) || person.address || "-";
    // อายุคำนวณในฐานข้อมูลจากวันที่ปัจจุบัน หน้าเว็บไม่ได้รับวันเกิดจริงของผู้อื่น
    const { data: info, error: infoError } = await sb.rpc(
      "person_family_info",
      { p_person_id: person.id },
    );
    if (infoError) throw infoError;
    $("age").textContent = ageText(info?.age);
    $("deceasedRow").hidden = !person.deceased;
    // มี id = ลงทะเบียนแล้ว กดเข้าไปดูได้ / มีแต่ชื่อ = ยังไม่ได้ลงทะเบียน แสดงเป็นข้อความ
    const linkPerson = async (relId, relName, field, withAge, age, alive) => {
      // alive: true/false = สถานะมีชีวิต/เสียชีวิต (พ่อ/แม่) ; null/undefined = ไม่มีข้อมูล ไม่แสดง
      const ageHtml =
        (withAge && alive !== false
          ? ` <span class="age-tag">อายุ ${esc(ageText(age))}</span>`
          : "") +
        (alive === false ? ' <span class="age-tag deceased">เสียชีวิต</span>' : "");
      if (relId) {
        const { data, error } = await sb
          .from("person")
          .select("id,prefix,full_name,nickname")
          .eq("id", relId)
          .maybeSingle();
        if (error) throw error;
        if (data) {
          $(field).innerHTML =
            `<button class="relation" data-person="${data.id}">${esc(displayName(data))}</button>${ageHtml}`;
          return;
        }
      }
      $(field).innerHTML = relName
        ? `<span class="pending">${esc(relName)}<small>(ยังไม่ได้ลงทะเบียน)</small></span>${ageHtml}`
        : "-";
    };
    await linkPerson(
      person.father_id,
      person.father_name,
      "father",
      true,
      info?.father_age,
      person.father_alive,
    );
    await linkPerson(
      person.mother_id,
      person.mother_name,
      "mother",
      true,
      info?.mother_age,
      person.mother_alive,
    );
    await linkPerson(person.spouse_id, person.spouse_name, "spouse", false);
    // เบอร์คู่สมรสเห็นได้เฉพาะเจ้าของข้อมูล (RLS ของ person_private)
    let spousePhone = null;
    if (own) {
      const { data: priv, error: privError } = await sb
        .from("person_private")
        .select("spouse_phone")
        .eq("person_id", person.id)
        .maybeSingle();
      if (privError) throw privError;
      spousePhone = priv?.spouse_phone || null;
      $("spousePhoneRow").hidden = !spousePhone;
      $("spousePhone").textContent = spousePhone || "-";
    }
    // บุตร/ธิดาที่ลงทะเบียนแล้ว (person_id) กดเข้าไปดูได้ เหมือนพ่อ/แม่ (09-child-links.sql)
    const kidsInfo = info?.children || [];
    const childName = (c) =>
      c.person_id
        ? `<button class="relation" data-person="${c.person_id}">${esc(displayName(c))}</button>`
        : `<span class="pending">${esc(c.name)}<small>(ยังไม่ได้ลงทะเบียน)</small></span>`;
    $("children").innerHTML = kidsInfo.length
      ? `<table class="family-table"><thead><tr><th>ความสัมพันธ์</th><th>ชื่อ</th><th>อายุ</th></tr></thead><tbody>${kidsInfo.map((c) => `<tr><td>${esc(CHILD_RELATION[c.relation] || "-")}</td><td>${childName(c)}</td><td>${esc(ageText(c.age))}</td></tr>`).join("")}</tbody></table>`
      : '<p class="muted">-</p>';
    document
      .querySelectorAll("[data-person]")
      .forEach((b) =>
        b.addEventListener(
          "click",
          () => (location.href = `profile.html?id=${b.dataset.person}`),
        ),
      );
    $("ownerActions").hidden = !own;
    let addrPicker = null,
      birthIn = null,
      fatherBirth = null,
      motherBirth = null,
      kidsEd = null,
      fatherAlive = null,
      motherAlive = null;
    const [firstName, ...rest] = String(person.full_name || "")
      .trim()
      .split(/\s+/);
    $("editBtn").onclick = async () => {
      $("view").hidden = true;
      $("editForm").hidden = false;
      $("e_prefix").value = person.prefix || "";
      $("e_first").value = firstName || "";
      $("e_last").value = rest.join(" ");
      $("e_nickname").value = person.nickname || "";
      $("e_phone").value = person.phone || "";
      $("e_line").value = person.line_id || "";
      $("e_deceased").checked = !!person.deceased;
      $("e_gender").value = person.gender || "";
      if (!addrPicker)
        addrPicker = await initAddressPicker("e_", "e_addressBox");
      addrPicker.set(person);
      $("e_father").value = person.father_name || "";
      $("e_mother").value = person.mother_name || "";
      $("e_spouse").value = person.spouse_name || "";
      $("e_spousePhone").value = spousePhone || "";
      if (!birthIn) {
        birthIn = birthDateInput("e_birthBox", { label: "วันเดือนปีเกิด" });
        fatherBirth = optionalBirthDate("e_fatherBirthBox", {
          toggleLabel: "วันเดือนปีเกิดของบิดา",
          label: "วันเกิดของบิดา",
        });
        motherBirth = optionalBirthDate("e_motherBirthBox", {
          toggleLabel: "วันเดือนปีเกิดของมารดา",
          label: "วันเกิดของมารดา",
        });
        kidsEd = childrenEditor("e_childrenBox");
        fatherAlive = aliveSwitch("e_fatherAliveBox", "บิดา");
        motherAlive = aliveSwitch("e_motherAliveBox", "มารดา");
      }
      fatherAlive.set(person.father_alive);
      motherAlive.set(person.mother_alive);
      // วันเกิดจริงอ่านได้เฉพาะเจ้าของข้อมูล (RLS ใน 07-birthdates-children.sql)
      const [{ data: b, error: bError }, { data: kids, error: kError }] =
        await Promise.all([
          sb
            .from("person_birth")
            .select("birth_date,father_birth_date,mother_birth_date")
            .eq("person_id", person.id)
            .maybeSingle(),
          sb
            .from("person_child")
            .select("id,relation,name,birth_date")
            .eq("person_id", person.id)
            .order("id"),
        ]);
      if (bError || kError) {
        showMessage("message", (bError || kError).message);
      }
      birthIn.set(b?.birth_date);
      fatherBirth.set(b?.father_birth_date);
      motherBirth.set(b?.mother_birth_date);
      kidsEd.set(kids || []);
      $("e_resetPwd").checked = false;
      $("e_avatar").value = "";
      $("e_preview").hidden = true;
      const { data } = await sb
        .from("person")
        .select("full_name")
        .neq("id", person.id)
        .order("full_name");
      $("peopleList").innerHTML = (data || [])
        .map((p) => `<option value="${esc(p.full_name)}"></option>`)
        .join("");
    };
    $("cancelBtn").onclick = () => {
      $("editForm").hidden = true;
      $("view").hidden = false;
      showMessage("message", "");
    };
    $("e_avatar").onchange = () => {
      const f = $("e_avatar").files[0];
      if (!f) {
        $("e_preview").hidden = true;
        return;
      }
      if (
        !["image/jpeg", "image/png", "image/webp"].includes(f.type) ||
        f.size > 5 * 1024 * 1024
      ) {
        $("e_avatar").value = "";
        showMessage(
          "message",
          "รูปต้องเป็น JPG, PNG หรือ WebP และไม่เกิน 5 MB",
        );
        return;
      }
      const r = new FileReader();
      r.onload = () => {
        $("e_preview").src = r.result;
        $("e_preview").hidden = false;
      };
      r.readAsDataURL(f);
    };
    $("editForm").onsubmit = async (e) => {
      e.preventDefault();
      showMessage("message", "");
      const btn = $("saveBtn");
      btn.disabled = true;
      try {
        const first = $("e_first").value.trim().replace(/\s+/g, " "),
          last = $("e_last").value.trim().replace(/\s+/g, " "),
          phone = normalizePhone($("e_phone").value);
        if (first.length < 2 || /\s/.test(first))
          throw new Error("กรุณากรอกชื่อจริงเป็นคำเดียว (ไม่ต้องใส่นามสกุล)");
        if (last.length < 2) throw new Error("กรุณากรอกนามสกุลให้ถูกต้อง");
        if (!validPhone(phone))
          throw new Error("กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง เช่น 0812345678");
        const lineId = $("e_line").value.trim() || null;
        if (lineId && !validLineId(lineId))
          throw new Error("LINE ID ต้องมี 4–20 ตัวอักษร ใช้ได้เฉพาะ a-z 0-9 . _ -");
        const name = `${first} ${last}`;
        const addr = addrPicker.get();
        if (addr.error) {
          $(addr.focus).focus();
          throw new Error(addr.error);
        }
        const pick = (r) => {
          if (r.error) {
            $(r.focus).focus();
            throw new Error(r.error);
          }
          return r;
        };
        const birth_date = pick(birthIn.get()).value,
          father_birth_date = pick(fatherBirth.get()).value,
          mother_birth_date = pick(motherBirth.get()).value,
          kids = pick(kidsEd.get()),
          spouse_phone = pick(readSpousePhone("e_spousePhone")).value;
        // เปลี่ยนรหัสผ่านเป็นวันเกิดเฉพาะเมื่อเลือกและยืนยันเท่านั้น (แก้วันเกิดอย่างเดียวไม่เปลี่ยนรหัสผ่าน)
        const resetPwd = own && $("e_resetPwd").checked;
        if (resetPwd && !birth_date)
          throw new Error("กรุณากรอกวันเดือนปีเกิดก่อนตั้งเป็นรหัสผ่าน");
        if (
          resetPwd &&
          !confirm(
            "ยืนยันเปลี่ยนรหัสผ่านเป็นวันเดือนปีเกิด (DDMMYYYY ปี พ.ศ.) หรือไม่?\nครั้งต่อไปต้องเข้าสู่ระบบด้วยรหัสผ่านใหม่",
          )
        )
          throw new Error("ยกเลิกการเปลี่ยนรหัสผ่าน ยังไม่ได้บันทึกข้อมูล");
        const rel = (k) => $(k).value.trim().replace(/\s+/g, " ") || null;
        const patch = {
          prefix: $("e_prefix").value.trim().replace(/\s+/g, " ") || null,
          full_name: name,
          nickname: $("e_nickname").value.trim().replace(/\s+/g, " ") || null,
          phone,
          line_id: lineId,
          deceased: $("e_deceased").checked,
          gender: $("e_gender").value || null,
          ...addr.values,
          father_name: rel("e_father"),
          mother_name: rel("e_mother"),
          spouse_name: rel("e_spouse"),
        };
        // ไม่มีชื่อพ่อ/แม่ = ยังไม่มีข้อมูล จึงไม่ระบุสถานะ
        patch.father_alive = fatherAlive.get(!!patch.father_name);
        patch.mother_alive = motherAlive.get(!!patch.mother_name);
        if (
          [patch.father_name, patch.mother_name, patch.spouse_name].some(
            (n) => n && normalize(n) === normalize(name),
          )
        )
          throw new Error("ชื่อพ่อ แม่ หรือคู่สมรส ต้องไม่ใช่ชื่อของตัวเอง");
        // ชื่อจริงหรือเบอร์เปลี่ยน → อัปเดตอีเมลภายในของบัญชี Supabase Auth; รหัสผ่านเปลี่ยนผ่าน Auth API เมื่อยืนยันแล้วเท่านั้น
        if (own) {
          const {
            data: { user },
          } = await sb.auth.getUser();
          const email = await accountEmail(first, phone),
            auth = {};
          if (user.email !== email) {
            auth.email = email;
            auth.data = { username: first, first_name: first, last_name: last };
          }
          if (resetPwd) auth.password = birthPassword(birth_date);
          if (Object.keys(auth).length) {
            let { error: authError } = await sb.auth.updateUser(auth);
            if (authError?.code === "same_password") {
              delete auth.password;
              ({ error: authError } = Object.keys(auth).length
                ? await sb.auth.updateUser(auth)
                : { error: null });
            }
            if (authError)
              throw new Error(
                /already|registered|exists/i.test(authError.message)
                  ? "มีบัญชีที่ใช้ชื่อจริงและเบอร์โทรนี้อยู่แล้ว"
                  : "อัปเดตข้อมูลเข้าสู่ระบบไม่สำเร็จ: " + authError.message,
              );
          }
        }
        const file = $("e_avatar").files[0];
        if (file) {
          const ext = {
              "image/jpeg": "jpg",
              "image/png": "png",
              "image/webp": "webp",
            }[file.type],
            path = `${person.id}/avatar-${Date.now()}.${ext}`;
          const { error: uploadError } = await sb.storage
            .from(AVATAR_BUCKET)
            .upload(path, file, { contentType: file.type });
          if (uploadError) throw uploadError;
          patch.avatar_path = path;
        }
        const { error } = await sb
          .from("person")
          .update(patch)
          .eq("id", person.id);
        if (error) throw error;
        await saveBirthDates(person.id, {
          birth_date,
          father_birth_date,
          mother_birth_date,
        });
        await saveChildren(person.id, kids);
        await savePrivate(person.id, { spouse_phone });
        if (patch.avatar_path && person.avatar_path)
          await sb.storage.from(AVATAR_BUCKET).remove([person.avatar_path]);
        location.reload();
      } catch (err) {
        showMessage("message", err.message || "บันทึกไม่สำเร็จ");
      } finally {
        btn.disabled = false;
      }
    };
    $("deleteBtn").onclick = async () => {
      if (
        !confirm(
          "ยืนยันลบข้อมูลของคุณหรือไม่? การลบข้อมูลบุคคลไม่สามารถย้อนกลับได้",
        )
      )
        return;
      const btn = $("deleteBtn");
      btn.disabled = true;
      try {
        if (person.avatar_path)
          await sb.storage.from(AVATAR_BUCKET).remove([person.avatar_path]);
        const { error } = await sb.from("person").delete().eq("id", person.id);
        if (error) throw error;
        await sb.auth.signOut();
        location.href = "register.html";
      } catch (err) {
        showMessage("message", err.message || "ลบข้อมูลไม่สำเร็จ");
        btn.disabled = false;
      }
    };
  } catch (e) {
    showMessage("message", e.message || "โหลดโปรไฟล์ไม่สำเร็จ");
  }
})();

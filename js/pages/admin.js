/* หน้าผู้ดูแลตระกูล: เรียกฟังก์ชันใน sql/16-clans.sql ทั้งหมด (สิทธิ์ตรวจที่ฝั่งฐานข้อมูล หน้านี้เป็นแค่ตัวช่วยกด) */
(async () => {
  const call = async (fn, args) => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message);
    return data;
  };
  const say = (msg, type = "error") => showMessage("message", msg, type);
  const run = async (fn) => {
    try {
      say("");
      await fn();
    } catch (e) {
      say(e.message || "ทำรายการไม่สำเร็จ");
    }
  };

  let clans = [],
    isSuper = false,
    clanId = null;
  const clanName = (id) => clans.find((c) => c.id === id)?.name || "";

  const person = await currentPerson();
  if (!person) {
    await sb.auth.signOut();
    location.href = "login.html";
    return;
  }
  const loadClans = async () => {
    const mine = await call("my_clans");
    isSuper = !!mine.super;
    clans = (mine.clans || []).filter((c) => c.is_admin);
    if (!isSuper && !clans.length) {
      location.href = "main.html";
      return false;
    }
    if (!clans.some((c) => c.id === clanId)) clanId = clans[0]?.id ?? null;
    $("clanSelect").innerHTML = clans
      .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
      .join("");
    $("clanSelect").value = clanId ?? "";
    $("superTools").hidden = !isSuper;
    return true;
  };

  const loadRequests = async () => {
    const list = await call("clan_requests_pending");
    $("requestsCard").hidden = !list.length;
    $("requests").innerHTML = list
      .map(
        (r) => `<div class="member-row" data-req="${r.id}">
          <div class="member-info"><strong>${esc(displayName(r))}</strong>
            <span class="muted">${r.kind === "admin" ? "ขอเป็นผู้ดูแล" : "ขอเข้าตระกูล"} ${esc(r.clan_name)}</span>
            ${r.note ? `<span class="muted">“${esc(r.note)}”</span>` : ""}</div>
          <div class="member-actions">
            <button data-act="approve">อนุมัติ</button>
            <button data-act="reject" class="danger">ปฏิเสธ</button></div></div>`,
      )
      .join("");
  };

  const loadMembers = async () => {
    if (clanId == null) {
      $("members").innerHTML = '<p class="muted">ยังไม่มีตระกูล</p>';
      return;
    }
    const list = await call("clan_members_list", { p_clan_id: clanId });
    $("members").innerHTML = list.length
      ? list
          .map((m) => {
            const main = m.role === "member";
            return `<div class="member-row" data-id="${m.person_id}">
              <div class="member-info">
                <a href="profile.html?id=${m.person_id}"><strong>${esc(displayName(m))}</strong></a>
                <span>${main ? '<span class="badge">สมาชิกหลัก</span>' : '<span class="badge soft">ผู้เชื่อมโยง</span>'}${m.is_admin ? ' <span class="badge admin">ผู้ดูแล</span>' : ""}</span>
              </div>
              <div class="member-actions">${
                main
                  ? `<button data-act="edit" class="ghost">แก้ไข</button>
                     <button data-act="move" class="ghost">ย้าย</button>
                     ${m.has_account ? `<button data-act="${m.is_admin ? "unadmin" : "admin"}" class="ghost">${m.is_admin ? "ถอดผู้ดูแล" : "ตั้งเป็นผู้ดูแล"}</button>` : ""}
                     <button data-act="remove" class="danger">เอาออก</button>`
                  : '<button data-act="promote" class="ghost">เลื่อนเป็นสมาชิกหลัก</button>'
              }</div></div>`;
          })
          .join("")
      : '<p class="muted">ยังไม่มีสมาชิก</p>';
  };
  const loadGrants = async () => {
    if (clanId == null) {
      $("grants").innerHTML = "";
      return;
    }
    const list = await call("clan_view_grants_list", { p_clan_id: clanId });
    $("grants").innerHTML = list.length
      ? list
          .map(
            (g) => `<div class="member-row" data-grant="${g.person_id}">
              <div class="member-info"><strong>${esc(displayName(g))}</strong></div>
              <div class="member-actions"><button data-act="revoke" class="danger">เพิกถอน</button></div></div>`,
          )
          .join("")
      : '<p class="muted">ยังไม่มีใครได้รับสิทธิ์ดูจากภายนอกตระกูล</p>';
  };
  const refresh = () => Promise.all([loadRequests(), loadMembers(), loadGrants()]);

  if (!(await loadClans())) return;
  await run(refresh);

  $("clanSelect").addEventListener("change", () => {
    clanId = Number($("clanSelect").value);
    run(() => Promise.all([loadMembers(), loadGrants()]));
  });
  $("createClanBtn").addEventListener("click", () =>
    run(async () => {
      const name = (prompt("ชื่อตระกูลใหม่ (นามสกุล)") || "").trim();
      if (!name) return;
      clanId = await call("clan_create", { p_name: name });
      await loadClans();
      await refresh();
      say("สร้างตระกูลแล้ว", "success");
    }),
  );
  $("renameClanBtn").addEventListener("click", () =>
    run(async () => {
      const name = (prompt("ชื่อตระกูลใหม่", clanName(clanId)) || "").trim();
      if (!name || name === clanName(clanId)) return;
      await call("clan_rename", { p_clan_id: clanId, p_name: name });
      await loadClans();
      say("เปลี่ยนชื่อแล้ว", "success");
    }),
  );

  // คำขอ: อนุมัติ/ปฏิเสธ
  $("requests").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    const id = Number(b?.closest("[data-req]")?.dataset.req);
    if (!b || !id) return;
    run(async () => {
      await call("clan_request_decide", {
        p_id: id,
        p_approve: b.dataset.act === "approve",
      });
      await loadClans();
      await refresh();
      say(b.dataset.act === "approve" ? "อนุมัติแล้ว" : "ปฏิเสธแล้ว", "success");
    });
  });

  // สมาชิก: แก้ไข / ย้าย / เอาออก / ผู้ดูแล
  let target = null;
  $("members").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    const row = b?.closest("[data-id]");
    if (!b || !row) return;
    const id = Number(row.dataset.id);
    const name = row.querySelector("strong").textContent;
    const act = b.dataset.act;
    run(async () => {
      if (act === "edit") return openEdit(id, name);
      if (act === "move") return openMove(id, name);
      if (act === "remove") {
        if (!confirm(`เอา ${name} ออกจากตระกูล ${clanName(clanId)}?\n(ไม่ลบบัญชีหรือข้อมูลของเขา)`)) return;
        await call("clan_remove_member", { p_clan_id: clanId, p_person_id: id });
      } else if (act === "admin" || act === "unadmin") {
        await call("clan_set_admin", { p_clan_id: clanId, p_person_id: id, p_on: act === "admin" });
      } else if (act === "promote") {
        await call("clan_add_member", { p_clan_id: clanId, p_person_id: id });
      }
      await loadClans();
      await refresh();
      say("บันทึกแล้ว", "success");
    });
  });

  // เพิ่มสมาชิกโดยค้นหาชื่อ (เห็นได้เฉพาะคนที่สิทธิ์ของคุณอนุญาต)
  let timer;
  $("addSearch").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(
      () =>
        run(async () => {
          const q = $("addSearch").value.trim().replace(/[%_,]/g, "");
          if (!q) {
            $("addResults").innerHTML = "";
            return;
          }
          const { data, error } = await sb
            .from("person")
            .select("id,prefix,full_name,nickname")
            .ilike("full_name", `%${q}%`)
            .order("full_name")
            .limit(20);
          if (error) throw error;
          $("addResults").innerHTML = data.length
            ? data
                .map(
                  (x) =>
                    `<div class="member-row" data-add="${x.id}"><div class="member-info"><strong>${esc(displayName(x))}</strong></div><div class="member-actions"><button data-act="add" class="ghost">เพิ่มเป็นสมาชิกหลัก</button></div></div>`,
                )
                .join("")
            : '<p class="muted">ไม่พบรายชื่อที่ตรงกัน</p>';
        }),
      200,
    );
  });
  $("addResults").addEventListener("click", (e) => {
    const id = Number(e.target.closest("[data-add]")?.dataset.add);
    if (!id || !e.target.closest("[data-act]")) return;
    run(async () => {
      await call("clan_add_member", { p_clan_id: clanId, p_person_id: id });
      await refresh();
      say("เพิ่มสมาชิกแล้ว", "success");
    });
  });

  // สิทธิ์ดูต้นไม้: ค้นหาแล้วอนุญาต / เพิกถอน
  let gTimer;
  $("grantSearch").addEventListener("input", () => {
    clearTimeout(gTimer);
    gTimer = setTimeout(
      () =>
        run(async () => {
          const q = $("grantSearch").value.trim();
          if (q.length < 2) {
            $("grantResults").innerHTML = "";
            return;
          }
          const list = await call("clan_search_people", { p_q: q });
          $("grantResults").innerHTML = list.length
            ? list
                .map(
                  (x) =>
                    `<div class="member-row" data-grantadd="${x.person_id}"><div class="member-info"><strong>${esc(displayName(x))}</strong></div><div class="member-actions"><button data-act="grant" class="ghost">อนุญาตให้ดู</button></div></div>`,
                )
                .join("")
            : '<p class="muted">ไม่พบรายชื่อที่ตรงกัน</p>';
        }),
      250,
    );
  });
  $("grantResults").addEventListener("click", (e) => {
    const id = Number(e.target.closest("[data-grantadd]")?.dataset.grantadd);
    if (!id || !e.target.closest("[data-act]")) return;
    run(async () => {
      await call("clan_view_grant_set", { p_clan_id: clanId, p_person_id: id, p_on: true });
      $("grantSearch").value = "";
      $("grantResults").innerHTML = "";
      await loadGrants();
      say("อนุญาตแล้ว", "success");
    });
  });
  $("grants").addEventListener("click", (e) => {
    const id = Number(e.target.closest("[data-grant]")?.dataset.grant);
    if (!id || !e.target.closest("[data-act]")) return;
    run(async () => {
      await call("clan_view_grant_set", { p_clan_id: clanId, p_person_id: id, p_on: false });
      await loadGrants();
      say("เพิกถอนแล้ว", "success");
    });
  });

  // ----- ย้ายตระกูล -----
  const openMove = (id, name) => {
    const others = clans.filter((c) => c.id !== clanId);
    if (!others.length) throw new Error("ไม่มีตระกูลอื่นที่คุณเป็นผู้ดูแลให้ย้ายไป");
    target = id;
    $("moveWho").textContent = `${name}: ${clanName(clanId)} → ?`;
    $("moveTo").innerHTML = others
      .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
      .join("");
    $("moveDialog").showModal();
  };
  $("moveCancel").addEventListener("click", () => $("moveDialog").close());
  $("moveForm").addEventListener("submit", (e) => {
    e.preventDefault();
    run(async () => {
      await call("clan_move_member", {
        p_person_id: target,
        p_from: clanId,
        p_to: Number($("moveTo").value),
      });
      $("moveDialog").close();
      await loadClans();
      await refresh();
      say("ย้ายแล้ว", "success");
    });
  });

  // ----- แก้ไขข้อมูล: ส่งเฉพาะช่องที่เปลี่ยน -----
  const TEXT = [
    "prefix", "full_name", "nickname", "phone", "line_id", "father_name",
    "mother_name", "spouse_name", "house_no", "road", "subdistrict",
    "district", "province", "postal_code",
  ];
  let original = null;
  const openEdit = async (id, name) => {
    const { data, error } = await sb.from("person").select("*").eq("id", id).single();
    if (error) throw error;
    target = id;
    original = data;
    $("editTitle").textContent = `แก้ไขข้อมูล: ${name}`;
    for (const k of TEXT) $("f_" + k).value = data[k] ?? "";
    $("f_gender").value = data.gender ?? "";
    $("f_deceased").checked = !!data.deceased;
    $("f_birth_date").value = "";
    showMessage("editMessage", "");
    $("editDialog").showModal();
  };
  $("editCancel").addEventListener("click", () => $("editDialog").close());
  $("editForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const patch = {};
    for (const k of [...TEXT, "gender"]) {
      const v = $("f_" + k).value.trim();
      if (v !== String(original[k] ?? "").trim()) patch[k] = v;
    }
    if ($("f_deceased").checked !== !!original.deceased)
      patch.deceased = $("f_deceased").checked;
    if ($("f_birth_date").value) patch.birth_date = $("f_birth_date").value;
    if ("full_name" in patch && !patch.full_name) {
      showMessage("editMessage", "ชื่อ-นามสกุลต้องไม่ว่าง");
      return;
    }
    if (!Object.keys(patch).length) {
      $("editDialog").close();
      return;
    }
    $("editSave").disabled = true;
    try {
      await call("clan_update_person", { p_person_id: target, p_patch: patch });
      $("editDialog").close();
      await refresh();
      say("บันทึกข้อมูลแล้ว", "success");
    } catch (err) {
      showMessage("editMessage", err.message);
    } finally {
      $("editSave").disabled = false;
    }
  });
})().catch((e) => showMessage("message", e.message || "โหลดข้อมูลไม่สำเร็จ"));

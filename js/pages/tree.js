(async () => {
  try {
    const me = await currentPerson();
    if (!me) {
      location.href = "login.html";
      return;
    }
    $("profileBtn").onclick = () => (location.href = `profile.html?id=${me.id}`);
    const { data: payload, error } = await sb.rpc("family_tree_data");
    if (error) throw error;
    const { connected } = buildTreeData(payload || {});
    if (connected.length < 2) {
      $("emptyState").hidden = false;
      return;
    }
    // เริ่มจาก ?id= ถ้ามี ไม่เช่นนั้นเริ่มจากตัวเอง (ถ้ามีความสัมพันธ์) หรือคนแรกในรายการ
    const ids = new Set(connected.map((d) => d.id));
    const wanted = String(new URLSearchParams(location.search).get("id") || "");
    const start = ids.has(wanted)
      ? wanted
      : ids.has(String(me.id))
        ? String(me.id)
        : connected[0].id;

    const byId = new Map(connected.map((d) => [d.id, d]));
    const people = [...connected].sort((a, b) =>
      a.data.name.localeCompare(b.data.name, "th"),
    );
    const search = $("treeSearch");
    const results = $("treeResults");
    search.value = byId.get(start).data.name;
    $("treeTools").hidden = false;
    $("FamilyChart").hidden = false;

    const chart = f3.createChart("#FamilyChart", connected);
    chart
      .setCardYSpacing(130)
      .setCardXSpacing(250)
      .setShowSiblingsOfMain(true)
      .setTransitionTime(400);
    chart
      .setCardHtml()
      .setCardDisplay([(d) => esc(d.data.name)])
      .setOnCardClick((e, d) => {
        location.href = `profile.html?id=${d.data.id}`;
      });
    chart.updateMainId(start);
    chart.updateTree({ initial: true });
    // ค้นหาจากชื่อหรือชื่อเล่น แสดงผลลัพธ์เฉพาะเมื่อพิมพ์ (เหมือนหน้า Home) เลือกแล้วย้ายแผนภาพไปที่คนนั้น
    const pick = (id) => {
      search.value = byId.get(id).data.name;
      results.innerHTML = "";
      chart.updateMainId(id);
      chart.updateTree({ initial: false });
    };
    search.addEventListener("input", () => {
      const q = normalize(search.value);
      const list = q
        ? people.filter((d) =>
            [d.data.name, d.data.nickname].some((s) =>
              normalize(s).includes(q),
            ),
          )
        : [];
      results.innerHTML = list.length
        ? list
            .slice(0, 30)
            .map(
              (d) =>
                `<button class="person-result" data-id="${d.id}"><img class="avatar small" src="${esc(d.data.avatar || DEFAULT_AVATAR)}" alt=""><span><strong>${esc(d.data.name)}</strong>${d.data.nickname ? `<br><span class="muted">(${esc(d.data.nickname)})</span>` : ""}</span></button>`,
            )
            .join("")
        : q
          ? '<p class="muted">ไม่พบรายชื่อที่ตรงกัน</p>'
          : "";
    });
    results.addEventListener("click", (e) => {
      const b = e.target.closest("[data-id]");
      if (b) pick(b.dataset.id);
    });
  } catch (e) {
    showMessage("message", e.message || "โหลดต้นไม้ครอบครัวไม่สำเร็จ");
  }
})();

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

    const select = $("startFrom");
    select.innerHTML = [...connected]
      .sort((a, b) => a.data.name.localeCompare(b.data.name, "th"))
      .map((d) => `<option value="${d.id}">${esc(d.data.name)}</option>`)
      .join("");
    select.value = start;
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
    select.addEventListener("change", () => {
      chart.updateMainId(select.value);
      chart.updateTree({ initial: false });
    });
  } catch (e) {
    showMessage("message", e.message || "โหลดต้นไม้ครอบครัวไม่สำเร็จ");
  }
})();

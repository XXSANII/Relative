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
    const people = [...connected].sort(compareByAge);
    const search = $("treeSearch");
    const results = $("treeResults");
    search.value = byId.get(start).data.name;
    $("treeTools").hidden = false;
    $("treeCanvas").hidden = false;

    // แผนภาพ: แต่ละรุ่นเป็นแถว เรียงอายุมาก → น้อยจากซ้ายไปขวาทั้งแถว (tree-layout.js)
    const layout = computeTreeLayout(connected);
    const el = $("treeCanvas");
    const svg = d3
      .select(el)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("role", "img")
      .attr("aria-label", "แผนภาพต้นไม้ครอบครัว");
    const g = svg.append("g");
    const zoom = d3
      .zoom()
      .scaleExtent([0.2, 3])
      .on("zoom", (e) => g.attr("transform", e.transform));
    svg.call(zoom).on("dblclick.zoom", null);

    g.append("g")
      .selectAll("path")
      .data(layout.edges)
      .join("path")
      .attr("class", (d) => `edge ${d.type}`)
      .attr("d", (d) => d.d);

    const cards = g
      .append("g")
      .selectAll("g")
      .data(layout.nodes)
      .join("g")
      .attr("class", "node")
      .attr("transform", (d) => `translate(${d.x},${d.y})`)
      .on("click", (e, d) => {
        location.href = `profile.html?id=${d.id}`;
      });
    cards
      .append("rect")
      .attr("class", (d) => {
        // เสียชีวิตแล้ว = สีเทา; ไม่งั้นใช้สีตามเพศ
        const kind = d.data.deceased
          ? "deceased"
          : d.data.gender === "F"
            ? "female"
            : d.data.gender === "M"
              ? "male"
              : "unknown";
        return `card-bg ${kind}`;
      })
      .attr("width", layout.cardW)
      .attr("height", layout.cardH)
      .attr("rx", 10);
    cards
      .append("foreignObject")
      .attr("width", layout.cardW)
      .attr("height", layout.cardH)
      .html(
        (d) =>
          `<div class="tree-card"><img class="tree-avatar" src="${esc(d.data.avatar || DEFAULT_AVATAR)}" alt=""><span>${esc(d.data.name)}</span></div>`,
      );

    // โฟกัสที่สมาชิกหนึ่งคน: จัดให้อยู่กลางพื้นที่ และไฮไลต์การ์ด
    const focus = (id, animate) => {
      const n = layout.nodes.find((x) => x.id === id);
      if (!n) return;
      cards.classed("selected", (d) => d.id === id);
      const k = d3.zoomTransform(svg.node()).k || 1;
      const t = d3.zoomIdentity
        .translate(
          el.clientWidth / 2 - k * (n.x + layout.cardW / 2),
          el.clientHeight / 2 - k * (n.y + layout.cardH / 2),
        )
        .scale(k);
      const target = animate ? svg.transition().duration(400) : svg;
      target.call(zoom.transform, t);
    };
    focus(start, false);

    // ค้นหาจากชื่อหรือชื่อเล่น แสดงผลลัพธ์เฉพาะเมื่อพิมพ์ (เหมือนหน้า Home) เลือกแล้วย้ายแผนภาพไปที่คนนั้น
    const pick = (id) => {
      search.value = byId.get(id).data.name;
      results.innerHTML = "";
      focus(id, true);
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
                `<button class="person-result" data-id="${d.id}"><img class="avatar small" src="${esc(d.data.avatar || DEFAULT_AVATAR)}" alt=""><span><strong>${esc(d.data.name)}</strong>${d.data.age != null ? `<br><span class="muted">อายุ ${d.data.age} ปี</span>` : ""}</span></button>`,
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

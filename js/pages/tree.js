(async () => {
  try {
    const me = await currentPerson();
    if (!me) {
      location.href = "login.html";
      return;
    }
    $("profileBtn").onclick = () => (location.href = `profile.html?id=${me.id}`);
    // แผนผังแยกตามตระกูล: ?clan=<id> (ว่าง = ครอบครัวสายตรงของฉัน) ตัวเลือกมีเฉพาะตระกูลที่ดูได้
    const { data: clanList, error: clanError } = await sb.rpc("tree_clans");
    if (clanError) throw clanError;
    const params = new URLSearchParams(location.search);
    const asked = params.get("clan");
    const clan = (clanList || []).find((c) => String(c.id) === asked)
      ? Number(asked)
      : asked === ""
        ? null
        : ((clanList || []).find((c) => c.kind === "member") || (clanList || [])[0])?.id ?? null;
    const sel = $("clanSelect");
    sel.innerHTML =
      '<option value="">ครอบครัวสายตรงของฉัน</option>' +
      (clanList || [])
        .map(
          (c) =>
            `<option value="${c.id}">ตระกูล ${esc(c.name)}${c.kind === "granted" ? " (ได้รับสิทธิ์ดู)" : ""}</option>`,
        )
        .join("");
    sel.value = clan ?? "";
    $("clanBar").hidden = false;
    sel.addEventListener("change", () => {
      location.search = `?clan=${sel.value}`;
    });
    const { data: payload, error } = await sb.rpc("family_tree_data", {
      p_clan_id: clan,
    });
    if (error) throw error;
    const { connected } = buildTreeData(payload || {});
    if (connected.length < 2) {
      $("emptyState").hidden = false;
      return;
    }
    // เริ่มจาก ?id= ถ้ามี ไม่เช่นนั้นเริ่มจากตัวเอง (ถ้ามีความสัมพันธ์) หรือคนแรกในรายการ
    const ids = new Set(connected.map((d) => d.id));
    const wanted = String(new URLSearchParams(location.search).get("id") || "");
    let current = ids.has(wanted)
      ? wanted
      : ids.has(String(me.id))
        ? String(me.id)
        : connected[0].id;

    const byId = new Map(connected.map((d) => [d.id, d]));
    const people = [...connected].sort(compareByAge);
    const search = $("treeSearch");
    const results = $("treeResults");
    const viewAllBtn = $("viewAllBtn");
    const info = $("treeInfo");
    const el = $("treeCanvas");
    search.value = byId.get(current).data.name;
    $("treeTools").hidden = false;
    el.hidden = false;

    const svg = d3
      .select(el)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("role", "img")
      .attr("aria-label", "แผนภาพต้นไม้ครอบครัว");
    // สีไล่เฉดของการ์ด (อ้างอิงใน style.css ด้วย fill:url(#g-...))
    const defs = svg.append("defs");
    const gradient = (id, from, to) => {
      const gr = defs
        .append("linearGradient")
        .attr("id", id)
        .attr("x1", 0)
        .attr("y1", 0)
        .attr("x2", 1)
        .attr("y2", 1);
      gr.append("stop").attr("offset", "0%").attr("stop-color", from);
      gr.append("stop").attr("offset", "100%").attr("stop-color", to);
    };
    gradient("g-male", "#3f7df0", "#6a4de0");
    gradient("g-female", "#f2709c", "#d9488f");
    gradient("g-unknown", "#7b80a5", "#575c80");
    const g = svg.append("g");
    const zoom = d3
      .zoom()
      .scaleExtent([0.2, 3])
      .on("zoom", (e) => g.attr("transform", e.transform));
    svg.call(zoom).on("dblclick.zoom", null);

    // วาดแผนภาพจากรายชื่อที่ส่งมา (แถวต่อรุ่น เรียงอายุมาก → น้อย: tree-layout.js)
    let layout = null,
      cards = null,
      shownKey = null,
      viewAll = false;
    const draw = (items) => {
      layout = computeTreeLayout(items);
      g.selectAll("*").remove();
      g.append("g")
        .selectAll("path")
        .data(layout.edges)
        .join("path")
        .attr("class", (d) => `edge ${d.type}`)
        .attr("d", (d) => d.d);
      cards = g
        .append("g")
        .selectAll("g")
        .data(layout.nodes)
        .join("g")
        .attr("class", "node")
        .style("animation-delay", (d, i) => `${Math.min(i * 35, 700)}ms`)
        .attr("transform", (d) => `translate(${d.x},${d.y})`)
        .classed("locked", (d) => !d.data.canOpen)
        .on("click", (e, d) => {
          if (d.data.canOpen) location.href = `profile.html?id=${d.id}`;
        });
      cards
        .append("rect")
        .attr("class", (d) => {
          const kind =
            d.data.gender === "F"
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
            `<div class="tree-card"><img class="tree-avatar" src="${esc(d.data.avatar || DEFAULT_AVATAR)}" alt=""><span>${esc(d.data.name)}${d.data.deceased ? " (เสียชีวิต)" : ""}</span></div>`,
        );
    };

    const transformFor = (n, k) =>
      d3.zoomIdentity
        .translate(
          el.clientWidth / 2 - k * (n.x + layout.cardW / 2),
          el.clientHeight / 2 - k * (n.y + layout.cardH / 2),
        )
        .scale(k);
    const apply = (t, animate) =>
      (animate ? svg.transition().duration(450) : svg).call(zoom.transform, t);

    // เลื่อนไปที่สมาชิกหนึ่งคน ไฮไลต์การ์ด และในโหมดดูทั้งหมดให้วงแหวนกะพริบบอกตำแหน่ง
    const focus = (id, animate, k) => {
      const n = layout.nodes.find((x) => x.id === id);
      if (!n) return;
      cards.classed("selected", (d) => d.id === id).classed("pulse", false);
      if (viewAll) {
        setTimeout(() => cards.classed("pulse", (d) => d.id === id), 30);
      }
      apply(transformFor(n, k ?? (d3.zoomTransform(svg.node()).k || 1)), animate);
    };
    // ย่อให้เห็นทั้งต้นไม้ในหน้าเดียว (ไม่เล็กกว่า 0.35 และไม่ขยายเกินของจริง)
    const fitAll = (animate) => {
      const k = Math.max(
        0.35,
        Math.min(1, el.clientWidth / layout.width, el.clientHeight / layout.height),
      );
      const t = d3.zoomIdentity
        .translate(
          (el.clientWidth - k * layout.width) / 2,
          (el.clientHeight - k * layout.height) / 2,
        )
        .scale(k);
      apply(t, animate);
      cards.classed("selected", (d) => d.id === current);
    };

    // แสดงผลตามโหมด: ดูทั้งหมด หรือเฉพาะคนที่เกี่ยวข้องกับ current
    const render = (animate, mode) => {
      const key = viewAll ? "all" : current;
      if (shownKey !== key) {
        draw(viewAll ? connected : relatedItems(connected, current));
        shownKey = key;
      }
      info.textContent = viewAll
        ? `แสดงทั้งหมด ${layout.nodes.length} คน`
        : `แสดง ${layout.nodes.length} จาก ${connected.length} คน (เฉพาะที่เกี่ยวข้องกับคนที่เลือก)`;
      if (mode === "fit") fitAll(animate);
      else focus(current, animate, viewAll ? undefined : 1);
    };
    render(false);

    viewAllBtn.addEventListener("click", () => {
      viewAll = !viewAll;
      viewAllBtn.setAttribute("aria-pressed", String(viewAll));
      viewAllBtn.textContent = viewAll ? "🎯 ดูเฉพาะที่เกี่ยวข้อง" : "🌐 ดูทั้งหมด";
      render(true, viewAll ? "fit" : undefined);
    });

    // ค้นหาจากชื่อหรือชื่อเล่น แสดงผลลัพธ์เฉพาะเมื่อพิมพ์ (เหมือนหน้า Home)
    // โหมดเฉพาะที่เกี่ยวข้อง: วาดใหม่เฉพาะคนที่เกี่ยวข้อง / โหมดดูทั้งหมด: คงภาพรวมแล้วชี้ตำแหน่งคนนั้น
    const pick = (id) => {
      current = id;
      search.value = byId.get(id).data.name;
      results.innerHTML = "";
      render(true);
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

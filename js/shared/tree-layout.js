/* เลย์เอาต์ต้นไม้ครอบครัวแบบแถวต่อรุ่น (ไม่ขึ้นกับ library แสดงผล)
   - รุ่น: ผู้ที่ไม่มีพ่อแม่ในข้อมูลคือรุ่นที่ 0; ลูกอยู่รุ่นถัดจากพ่อแม่; คู่สมรสอยู่รุ่นเดียวกัน
   - ทุกแถว (รุ่น) เรียงอายุมาก → น้อยจากซ้ายไปขวาแบบบังคับ; ไม่มีวันเกิดอยู่ท้ายสุด
   - ไม่ใช้นามสกุลในการจัดความสัมพันธ์ ใช้เฉพาะ rels ที่ผูกด้วย id แล้ว
   รับ items รูปแบบจาก buildTreeData() และคืนตำแหน่งพิกเซล (มุมซ้ายบนของการ์ด) */

const CARD_W = 200,
  CARD_H = 64,
  GAP_X = 28,
  ROW_GAP = 120,
  MARGIN = 40;

// เรียงอายุมาก → น้อย; ไม่มีวันเกิดอยู่ท้าย; อายุเท่ากันเรียงตามชื่อ
function compareByAge(a, b) {
  const x = a.data.age,
    y = b.data.age;
  if (x == null && y == null) return a.data.name.localeCompare(b.data.name, "th");
  if (x == null) return 1;
  if (y == null) return -1;
  return y - x || a.data.name.localeCompare(b.data.name, "th");
}

// หารุ่นของทุกคน: วนซ้ำจนนิ่ง (จำกัดรอบเพื่อกันข้อมูลวนลูป)
function assignGenerations(items) {
  const byId = new Map(items.map((d) => [d.id, d]));
  const gen = new Map(items.map((d) => [d.id, 0]));
  for (let round = 0; round <= items.length; round++) {
    let changed = false;
    for (const d of items) {
      for (const c of d.rels.children || []) {
        if (!byId.has(c)) continue;
        if (gen.get(c) < gen.get(d.id) + 1) {
          gen.set(c, gen.get(d.id) + 1);
          changed = true;
        }
      }
      for (const s of d.rels.spouses || []) {
        if (!byId.has(s)) continue;
        const g = Math.max(gen.get(d.id), gen.get(s));
        if (gen.get(d.id) !== g || gen.get(s) !== g) {
          gen.set(d.id, g);
          gen.set(s, g);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return gen;
}

function computeTreeLayout(items) {
  const byId = new Map(items.map((d) => [d.id, d]));
  const gen = assignGenerations(items);

  // 1) หน่วยครอบครัว: คู่สมรสรวมเป็นหน่วยเดียว คนโสดเป็นหน่วยของตัวเอง; สมาชิกในหน่วยเรียงอายุมาก → น้อย
  const unitOf = new Map();
  const units = [];
  for (const d of items) {
    if (unitOf.has(d.id)) continue;
    const u = { members: [], parents: new Set(), children: new Set() };
    const stack = [d.id];
    unitOf.set(d.id, u);
    while (stack.length) {
      const m = byId.get(stack.pop());
      u.members.push(m);
      for (const s of m.rels.spouses || []) {
        if (!byId.has(s) || unitOf.has(s)) continue;
        unitOf.set(s, u);
        stack.push(s);
      }
    }
    u.members.sort(compareByAge);
    units.push(u);
  }
  for (const u of units) {
    for (const m of u.members) {
      for (const p of m.rels.parents || []) {
        if (byId.has(p) && unitOf.get(p) !== u) u.parents.add(unitOf.get(p));
      }
      for (const c of m.rels.children || []) {
        if (byId.has(c) && unitOf.get(c) !== u) {
          u.children.add(unitOf.get(c));
          unitOf.get(c).parents.add(u);
        }
      }
    }
  }

  // 2) จัดลำดับหน่วยแบบ depth-first: พ่อแม่คู่ไหนมาก่อน ลูกของคู่นั้นก็มาก่อนลูกของคู่ถัดไป
  //    ลูกในกลุ่มเดียวกันเรียงอายุมาก → น้อย ทำให้ครอบครัวอยู่ติดกันในทุกรุ่น
  const cmpUnits = (a, b) => compareByAge(a.members[0], b.members[0]);
  const order = [];
  const placed = new Set();
  const visit = (u) => {
    if (placed.has(u)) return;
    placed.add(u);
    order.push(u);
    [...u.children].sort(cmpUnits).forEach(visit);
  };
  units.filter((u) => u.parents.size === 0).sort(cmpUnits).forEach(visit);
  units.slice().sort(cmpUnits).forEach(visit); // กรณีข้อมูลวนลูป: ไม่มีหน่วยใดหลุด

  // 3) วางแถวตามรุ่น โดยเรียงตามลำดับ depth-first ข้างบน
  const rows = new Map();
  for (const u of order) {
    for (const m of u.members) {
      const g = gen.get(m.id);
      if (!rows.has(g)) rows.set(g, []);
      rows.get(g).push(m);
    }
  }
  const genKeys = [...rows.keys()].sort((a, b) => a - b);
  const rowWidth = (n) => n * CARD_W + Math.max(0, n - 1) * GAP_X;
  const maxW = Math.max(...genKeys.map((g) => rowWidth(rows.get(g).length)));

  const nodes = [];
  const pos = new Map();
  for (const g of genKeys) {
    const row = rows.get(g);
    const x0 = (maxW - rowWidth(row.length)) / 2;
    row.forEach((d, i) => {
      const node = {
        id: d.id,
        data: d.data,
        gen: g,
        x: MARGIN + x0 + i * (CARD_W + GAP_X),
        y: MARGIN + g * (CARD_H + ROW_GAP),
      };
      nodes.push(node);
      pos.set(d.id, node);
    });
  }

  // เส้นเชื่อมแบบ "สายสกุล": ทุกคู่ที่มีลูกจะมีเส้นแนวตั้งหนึ่งเส้นลงมาจากจุดกึ่งกลางคู่
  // แล้วแตกเป็นเส้นนอนและเส้นย่อยไปหาลูกแต่ละคน ลดการไขว้ของเส้นเมื่อครอบครัวใหญ่
  const edges = [];
  const busGap = ROW_GAP / 2;
  const cx = (n) => n.x + CARD_W / 2;
  for (const u of units) {
    const parents = u.members.map((m) => pos.get(m.id)).filter(Boolean);
    const kids = new Map();
    for (const m of u.members) {
      for (const c of m.rels.children || []) {
        const child = pos.get(c);
        if (child) kids.set(c, child);
      }
    }
    if (!parents.length || !kids.size) continue;
    const sorted = [...kids.values()].sort((a, b) => a.x - b.x);
    const px = (Math.min(...parents.map(cx)) + Math.max(...parents.map(cx))) / 2;
    const py = parents[0].y + CARD_H;
    const busY = py + busGap;
    const lo = Math.min(px, cx(sorted[0]));
    const hi = Math.max(px, cx(sorted[sorted.length - 1]));
    let d = `M${px},${py} V${busY} M${lo},${busY} H${hi}`;
    for (const c of sorted) d += ` M${cx(c)},${busY} V${c.y}`;
    edges.push({ type: "parent", d });
  }

  // เส้นคู่สมรส: คู่ที่ติดกันเป็นเส้นนอนสั้นระหว่างการ์ด คู่ที่ห่างกันเป็นโค้งเหนือแถว
  for (const u of units) {
    const ms = u.members
      .map((m) => pos.get(m.id))
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
    for (let i = 1; i < ms.length; i++) {
      const left = ms[i - 1],
        right = ms[i];
      const gap = right.x - (left.x + CARD_W);
      if (gap <= GAP_X + 1) {
        const y = left.y + CARD_H / 2;
        edges.push({
          type: "spouse",
          d: `M${left.x + CARD_W},${y} H${right.x}`,
        });
      } else {
        const x1 = cx(left),
          x2 = cx(right),
          y = Math.min(left.y, right.y),
          lift = 28 + Math.min(120, Math.abs(x2 - x1) / 6);
        edges.push({
          type: "spouse",
          d: `M${x1},${y} C${x1},${y - lift} ${x2},${y - lift} ${x2},${y}`,
        });
      }
    }
  }

  const width = maxW + MARGIN * 2;
  const height = MARGIN * 2 + genKeys.length * CARD_H + (genKeys.length - 1) * ROW_GAP;
  return { nodes, edges, width, height, cardW: CARD_W, cardH: CARD_H };
}

// เฉพาะคนที่เกี่ยวข้องกับ id: ตัวเอง บรรพบุรุษทุกรุ่น ลูกหลานทุกรุ่น พี่น้อง และคู่สมรสของทุกคนที่เลือก
// ใช้โหมด "เฉพาะที่เกี่ยวข้อง" ของหน้าต้นไม้ (โหมด "ดูทั้งหมด" ใช้ items ทั้งหมด)
function relatedItems(items, id) {
  const byId = new Map(items.map((d) => [d.id, d]));
  if (!byId.has(id)) return items;
  const keep = new Set([id]);
  const walk = (start, key) => {
    const stack = [start];
    while (stack.length) {
      const d = byId.get(stack.pop());
      for (const x of d?.rels[key] || []) {
        if (byId.has(x) && !keep.has(x)) {
          keep.add(x);
          stack.push(x);
        }
      }
    }
  };
  walk(id, "parents");
  walk(id, "children");
  for (const p of byId.get(id).rels.parents || []) {
    for (const c of byId.get(p)?.rels.children || []) if (byId.has(c)) keep.add(c);
  }
  for (const k of [...keep]) {
    for (const sp of byId.get(k).rels.spouses || []) if (byId.has(sp)) keep.add(sp);
  }
  return items.filter((d) => keep.has(d.id));
}

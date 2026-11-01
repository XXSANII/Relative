/* เลย์เอาต์ต้นไม้ครอบครัวแบบแถวต่อรุ่น (ไม่ขึ้นกับ library แสดงผล)
   - รุ่น: ผู้ที่ไม่มีพ่อแม่ในข้อมูลคือรุ่นที่ 0; ลูกอยู่รุ่นถัดจากพ่อแม่; คู่สมรสอยู่รุ่นเดียวกัน
   - ทุกแถว (รุ่น) เรียงอายุมาก → น้อยจากซ้ายไปขวาแบบบังคับ; ไม่มีวันเกิดอยู่ท้ายสุด
   - ไม่ใช้นามสกุลในการจัดความสัมพันธ์ ใช้เฉพาะ rels ที่ผูกด้วย id แล้ว
   รับ items รูปแบบจาก buildTreeData() และคืนตำแหน่งพิกเซล (มุมซ้ายบนของการ์ด) */

const CARD_W = 170,
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

  // จัดแถวตามรุ่น แล้วเรียงทั้งแถวตามอายุ
  const rows = new Map();
  for (const d of items) {
    const g = gen.get(d.id);
    if (!rows.has(g)) rows.set(g, []);
    rows.get(g).push(d);
  }
  const genKeys = [...rows.keys()].sort((a, b) => a - b);
  const rowWidth = (n) => n * CARD_W + Math.max(0, n - 1) * GAP_X;
  const maxW = Math.max(...genKeys.map((g) => rowWidth(rows.get(g).length)));

  const nodes = [];
  const pos = new Map();
  for (const g of genKeys) {
    const row = rows.get(g).sort(compareByAge);
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

  const edges = [];
  // เส้นพ่อแม่ → ลูก (โค้งแนวดิ่ง)
  for (const d of items) {
    const child = pos.get(d.id);
    for (const p of d.rels.parents || []) {
      const parent = pos.get(p);
      if (!parent) continue;
      const x1 = parent.x + CARD_W / 2,
        y1 = parent.y + CARD_H,
        x2 = child.x + CARD_W / 2,
        y2 = child.y,
        my = (y1 + y2) / 2;
      edges.push({
        type: "parent",
        d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`,
      });
    }
  }
  // เส้นคู่สมรส: โค้งเหนือการ์ดสองใบ (ไม่ตัดผ่านคนอื่นในแถว)
  const seen = new Set();
  for (const d of items) {
    for (const s of d.rels.spouses || []) {
      const key = [d.id, s].sort().join("|");
      if (seen.has(key) || !pos.has(s)) continue;
      seen.add(key);
      const a = pos.get(d.id),
        b = pos.get(s),
        left = a.x <= b.x ? a : b,
        right = left === a ? b : a,
        x1 = left.x + CARD_W / 2,
        x2 = right.x + CARD_W / 2,
        y = Math.min(left.y, right.y),
        lift = 28 + Math.min(120, Math.abs(x2 - x1) / 6);
      edges.push({
        type: "spouse",
        d: `M${x1},${y} C${x1},${y - lift} ${x2},${y - lift} ${x2},${y}`,
      });
    }
  }

  const width = maxW + MARGIN * 2;
  const height = MARGIN * 2 + genKeys.length * CARD_H + (genKeys.length - 1) * ROW_GAP;
  return { nodes, edges, width, height, cardW: CARD_W, cardH: CARD_H };
}

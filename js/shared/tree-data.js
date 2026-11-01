/* แปลงข้อมูลจาก family_tree_data() (10-family-tree.sql) เป็นรูปแบบของ family-chart
   ใช้เฉพาะความสัมพันธ์ที่ผูกกับบุคคลในระบบแล้ว (father_id / mother_id / spouse_id / บุตรธิดาที่เชื่อมแล้ว)
   ไม่ใช้นามสกุลหรือชื่อในการเดาความสัมพันธ์ — แยกจากส่วนแสดงผลเพื่อเปลี่ยน library ภายหลังได้ */
function buildTreeData({ people = [], child_links = [] }) {
  const byId = new Map(people.map((p) => [String(p.id), p]));
  const parents = new Map(),
    spouses = new Map();
  const set = (m, k) => m.get(k) || m.set(k, new Set()).get(k);
  const isAncestor = (anc, of) => {
    // anc เป็นบรรพบุรุษของ of หรือไม่ (กันข้อมูลวนลูปทำให้แผนภาพค้าง)
    const stack = [of],
      seen = new Set();
    while (stack.length) {
      const cur = stack.pop();
      if (cur === anc) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      stack.push(...(parents.get(cur) || []));
    }
    return false;
  };
  const addParent = (childId, parentId) => {
    childId = String(childId);
    parentId = String(parentId);
    if (childId === parentId || !byId.has(childId) || !byId.has(parentId))
      return;
    const cur = set(parents, childId);
    if (cur.has(parentId) || cur.size >= 2) return; // family-chart รองรับพ่อแม่ได้ 2 คน
    if (isAncestor(childId, parentId)) return;
    cur.add(parentId);
  };
  // บิดา/มารดาที่ระบุในโปรไฟล์ของลูกมาก่อน แล้วจึงเติมจากรายการบุตร/ธิดาที่พ่อแม่เป็นคนระบุ
  for (const p of people) {
    if (p.father_id) addParent(p.id, p.father_id);
    if (p.mother_id) addParent(p.id, p.mother_id);
  }
  for (const l of child_links) addParent(l.child_id, l.parent_id);
  for (const p of people) {
    const a = String(p.id),
      b = p.spouse_id == null ? null : String(p.spouse_id);
    if (b && a !== b && byId.has(b)) {
      set(spouses, a).add(b);
      set(spouses, b).add(a);
    }
  }
  const children = new Map();
  for (const [c, ps] of parents) for (const pa of ps) set(children, pa).add(c);

  // family-chart ต้องการเพศ M/F; ไม่ระบุ → เดาจากบทบาทพ่อ/แม่ในข้อมูล ไม่ได้ก็ใช้ M
  const roleGender = new Map();
  for (const p of people) {
    if (p.father_id) roleGender.set(String(p.father_id), "M");
    if (p.mother_id) roleGender.set(String(p.mother_id), "F");
  }
  const gender = (p) =>
    p.gender === "female"
      ? "F"
      : p.gender === "male"
        ? "M"
        : roleGender.get(String(p.id)) || "M";

  const arr = (m, k) => [...(m.get(k) || [])];
  const data = people.map((p) => {
    const id = String(p.id);
    return {
      id,
      data: {
        gender: gender(p),
        name: displayName(p),
        nickname: p.nickname || "",
        avatar: p.avatar_path ? avatarUrl(p.avatar_path) : "",
        age: p.age ?? null,
      },
      rels: {
        parents: arr(parents, id),
        spouses: arr(spouses, id),
        children: arr(children, id),
      },
    };
  });
  const connected = data.filter(
    (d) => d.rels.parents.length || d.rels.spouses.length || d.rels.children.length,
  );
  return { data, connected };
}

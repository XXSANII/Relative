/* วันเกิด (วัน / เดือน / ปี พ.ศ.), สวิตช์เปิด-ปิดช่องวันเกิด และรายชื่อบุตร/ธิดา — ใช้ในหน้า Register และ Profile
   ฐานข้อมูลเก็บวันที่เป็น ค.ศ. รูปแบบ YYYY-MM-DD (07-birthdates-children.sql); หน้าเว็บรับปีเป็น พ.ศ. */
const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];
const BE_OFFSET = 543;
const CHILD_RELATION = { son: "บุตร", daughter: "ธิดา" };
const todayBangkok = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }); // YYYY-MM-DD
const pad2 = (n) => String(n).padStart(2, "0");
const ageText = (age) => (age == null ? "ไม่ระบุ" : `${age} ปี`);

// รหัสผ่านจากวันเกิด: DDMMYYYY โดย YYYY เป็นปี พ.ศ. เช่น 2004-03-22 → 22032547
function birthPassword(iso) {
  const [y, m, d] = iso.split("-");
  return d + m + (Number(y) + BE_OFFSET);
}

// ช่องกรอกวันเกิดใน box (id หรือ element) → {get(), set(iso)}
// get() คืน {value: 'YYYY-MM-DD' | null} หรือ {error, focus}
let birthSeq = 0;
function birthDateInput(box, { label, required = false } = {}) {
  box = typeof box === "string" ? $(box) : box;
  const p = `bd${++birthSeq}_`;
  box.innerHTML = `<label for="${p}d">${esc(label)}${required ? " *" : ""}</label>
    <div class="date-row">
      <select id="${p}d" aria-label="วัน"><option value="">วัน</option>${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}</select>
      <select id="${p}m" aria-label="เดือน"><option value="">เดือน</option>${THAI_MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join("")}</select>
      <input id="${p}y" inputmode="numeric" maxlength="4" placeholder="ปี พ.ศ." aria-label="ปี พ.ศ." autocomplete="off">
    </div>`;
  const d = $(p + "d"),
    m = $(p + "m"),
    y = $(p + "y");
  y.addEventListener("input", () => {
    y.value = y.value.replace(/\D/g, "").slice(0, 4);
  });
  return {
    set(iso) {
      const [yy, mm, dd] = iso ? iso.split("-").map(Number) : [];
      d.value = dd || "";
      m.value = mm || "";
      y.value = yy ? yy + BE_OFFSET : "";
    },
    get() {
      if (!d.value && !m.value && !y.value.trim())
        return required
          ? { error: `กรุณากรอก${label}`, focus: d.id }
          : { value: null };
      if (!d.value) return { error: `กรุณาเลือกวันของ${label}`, focus: d.id };
      if (!m.value) return { error: `กรุณาเลือกเดือนของ${label}`, focus: m.id };
      const be = Number(y.value),
        thisBE = Number(todayBangkok().slice(0, 4)) + BE_OFFSET;
      if (!/^\d{4}$/.test(y.value) || be < 2400 || be > thisBE)
        return {
          error: `ปีของ${label}ต้องเป็นปี พ.ศ. 4 หลัก (2400–${thisBE})`,
          focus: y.id,
        };
      const ce = be - BE_OFFSET,
        dt = new Date(Date.UTC(ce, Number(m.value) - 1, Number(d.value)));
      if (dt.getUTCMonth() !== Number(m.value) - 1)
        return {
          error: `${label}ไม่ถูกต้อง: ${THAI_MONTHS[m.value - 1]} ${be} ไม่มีวันที่ ${d.value}`,
          focus: d.id,
        };
      const iso = `${ce}-${pad2(m.value)}-${pad2(d.value)}`;
      if (iso > todayBangkok())
        return { error: `${label}ต้องไม่เป็นวันในอนาคต`, focus: d.id };
      return { value: iso };
    },
  };
}

// สวิตช์เปิด-ปิด: <label class="switch"> พร้อม checkbox role="switch"
const switchHtml = (id, label) =>
  `<label class="switch" for="${id}"><input type="checkbox" id="${id}" role="switch"><span class="track" aria-hidden="true"></span><span>${esc(label)}</span></label>`;

// สวิตช์ + ช่องวันเกิดที่ไม่บังคับ (วันเกิดพ่อ/แม่)
// ปิดสวิตช์ = ซ่อนช่อง; ถ้ามีวันเกิดที่บันทึกไว้แล้ว จะลบเมื่อผู้ใช้ยืนยันเท่านั้น
function optionalBirthDate(boxId, { toggleLabel, label }) {
  const box = $(boxId),
    sw = boxId + "_on";
  box.innerHTML = `${switchHtml(sw, toggleLabel)}<div class="switch-body" hidden></div><p class="hint" hidden></p>`;
  const body = box.querySelector(".switch-body"),
    note = box.querySelector(".hint"),
    input = birthDateInput(body, { label });
  let saved = null,
    clearOnSave = false;
  const render = () => {
    const on = $(sw).checked;
    body.hidden = !on;
    note.hidden = on || !saved;
    note.textContent = clearOnSave
      ? `จะลบ${label}ที่บันทึกไว้เมื่อกดบันทึก`
      : `ซ่อนช่องไว้ ${label}ที่บันทึกไว้ยังคงอยู่`;
  };
  $(sw).addEventListener("change", () => {
    if ($(sw).checked) clearOnSave = false;
    else if (saved)
      clearOnSave = confirm(
        `ต้องการลบ${label}ที่บันทึกไว้ด้วยหรือไม่?\n\nตกลง = ลบเมื่อกดบันทึก\nยกเลิก = ซ่อนช่องแต่เก็บข้อมูลเดิมไว้`,
      );
    render();
  });
  return {
    set(iso) {
      saved = iso || null;
      clearOnSave = false;
      input.set(saved);
      $(sw).checked = !!saved;
      render();
    },
    get() {
      if ($(sw).checked) return input.get();
      return { value: saved && !clearOnSave ? saved : null };
    },
  };
}

// รายชื่อบุตร/ธิดา: เพิ่ม/แก้/ลบได้หลายคน พร้อมสวิตช์เปิดช่องวันเกิดของบุตร/ธิดา
// get() คืน {children:[{id?,relation,name,birth_date}], removedIds:[]} หรือ {error, focus}
function childrenEditor(boxId) {
  const box = $(boxId),
    sw = boxId + "_on";
  box.innerHTML = `<h3 class="subhead">บุตร/ธิดา</h3>${switchHtml(sw, "วันเดือนปีเกิดของบุตร/ธิดา")}<p class="hint" hidden></p>
    <div class="child-list"></div><button type="button" class="ghost add-child">+ เพิ่มบุตร/ธิดา</button>
    <p class="hint">กรอกชื่อ-นามสกุลให้ตรงกับในระบบ หน้าโปรไฟล์จะกดเข้าไปดูข้อมูลได้ ถ้ายังไม่ได้ลงทะเบียน ระบบจะเชื่อมให้เมื่อลงทะเบียน</p>`;
  const list = box.querySelector(".child-list"),
    note = box.querySelector(".hint");
  let rows = [],
    removedIds = [],
    clearOnSave = false;
  const hasSaved = () => rows.some((r) => r.saved);
  const render = () => {
    const on = $(sw).checked;
    rows.forEach((r) => {
      r.birthBox.hidden = !on;
    });
    note.hidden = on || !hasSaved();
    note.textContent = clearOnSave
      ? "จะลบวันเกิดของบุตร/ธิดาที่บันทึกไว้เมื่อกดบันทึก"
      : "ซ่อนช่องไว้ วันเกิดของบุตร/ธิดาที่บันทึกไว้ยังคงอยู่";
  };
  function addRow(c = {}) {
    const el = document.createElement("div");
    el.className = "child-row";
    const n = ++birthSeq;
    el.innerHTML = `<div class="child-fields">
        <div><label for="cr${n}">ความสัมพันธ์</label><select id="cr${n}"><option value="son">บุตร</option><option value="daughter">ธิดา</option></select></div>
        <div><label for="cn${n}">ชื่อ *</label><input id="cn${n}" list="peopleList" maxlength="120" autocomplete="off" placeholder="ชื่อ-นามสกุล"></div>
      </div><div class="child-birth"></div><button type="button" class="danger remove-child">ลบรายการนี้</button>`;
    list.appendChild(el);
    const r = {
      el,
      id: c.id || null,
      saved: c.birth_date || null,
      relation: $("cr" + n),
      name: $("cn" + n),
      birthBox: el.querySelector(".child-birth"),
    };
    r.birth = birthDateInput(r.birthBox, { label: "วันเกิดของบุตร/ธิดา" });
    r.relation.value = c.relation || "son";
    r.name.value = c.name || "";
    r.birth.set(r.saved);
    el.querySelector(".remove-child").onclick = () => {
      if (
        r.id &&
        !confirm(
          `ลบ "${r.name.value || "บุตร/ธิดา"}" ออกจากรายการหรือไม่? (ลบจริงเมื่อกดบันทึก)`,
        )
      )
        return;
      if (r.id) removedIds.push(r.id);
      rows = rows.filter((x) => x !== r);
      el.remove();
      render();
    };
    rows.push(r);
    render();
    return r;
  }
  box.querySelector(".add-child").onclick = () => addRow().name.focus();
  $(sw).addEventListener("change", () => {
    if ($(sw).checked) clearOnSave = false;
    else if (hasSaved())
      clearOnSave = confirm(
        "ต้องการลบวันเกิดของบุตร/ธิดาที่บันทึกไว้ด้วยหรือไม่?\n\nตกลง = ลบเมื่อกดบันทึก\nยกเลิก = ซ่อนช่องแต่เก็บข้อมูลเดิมไว้",
      );
    render();
  });
  return {
    set(children) {
      list.innerHTML = "";
      rows = [];
      removedIds = [];
      clearOnSave = false;
      (children || []).forEach(addRow);
      $(sw).checked = hasSaved();
      render();
    },
    get() {
      const on = $(sw).checked,
        children = [];
      for (const r of rows) {
        const name = r.name.value.trim().replace(/\s+/g, " ");
        let birth_date = r.saved && !clearOnSave ? r.saved : null;
        if (on) {
          const b = r.birth.get();
          if (b.error) return b;
          birth_date = b.value;
        }
        if (!name) {
          if (!r.id && !(on && birth_date)) continue; // แถวว่างที่เพิ่มแล้วไม่ได้กรอก → ข้าม
          return { error: "กรุณากรอกชื่อบุตร/ธิดา", focus: r.name.id };
        }
        children.push({
          id: r.id,
          relation: r.relation.value,
          name,
          birth_date,
        });
      }
      return { children, removedIds: [...removedIds] };
    },
  };
}

// บันทึกวันเกิด (เฉพาะคอลัมน์ที่ส่งมา) ลง person_birth
async function saveBirthDates(personId, values) {
  const { error } = await sb
    .from("person_birth")
    .upsert({ person_id: personId, ...values }, { onConflict: "person_id" });
  if (error) throw error;
}

// บันทึกรายชื่อบุตร/ธิดาตามผลของ childrenEditor().get()
async function saveChildren(personId, { children, removedIds }) {
  if (removedIds.length) {
    const { error } = await sb
      .from("person_child")
      .delete()
      .eq("person_id", personId)
      .in("id", removedIds);
    if (error) throw error;
  }
  for (const c of children.filter((c) => c.id)) {
    const { error } = await sb
      .from("person_child")
      .update({ relation: c.relation, name: c.name, birth_date: c.birth_date })
      .eq("id", c.id)
      .eq("person_id", personId);
    if (error) throw error;
  }
  const fresh = children
    .filter((c) => !c.id)
    .map((c) => ({
      person_id: personId,
      relation: c.relation,
      name: c.name,
      birth_date: c.birth_date,
    }));
  if (fresh.length) {
    const { error } = await sb.from("person_child").insert(fresh);
    if (error) throw error;
  }
}

(async () => {
  try {
    const p = await currentPerson();
    if (!p) {
      await sb.auth.signOut();
      location.href = "login.html";
      return;
    }
    $("profileBtn").onclick = () => (location.href = `profile.html?id=${p.id}`);
    let timer;
    const search = async () => {
      const q = $("search").value.trim();
      const box = $("results");
      box.innerHTML = "";
      showMessage("message", "");
      if (!q) return;
      const { data, error } = await sb
        .from("person")
        .select("id,full_name,nickname,gender,avatar_path")
        .ilike("full_name", `%${q.replace(/[%_,]/g, "")}%`)
        .order("full_name")
        .limit(30);
      if (error) throw error;
      if (!data.length) {
        box.innerHTML = '<p class="muted">ไม่พบรายชื่อที่ตรงกัน</p>';
        return;
      }
      box.innerHTML = data
        .map(
          (x) =>
            `<button class="person-result" data-id="${x.id}"><img class="avatar small" src="${avatarUrl(x.avatar_path)}" alt=""><span><strong>${esc(displayName(x))}</strong><br><span class="muted">${esc(GENDER[x.gender] || "ไม่ระบุ")}</span></span></button>`,
        )
        .join("");
    };
    $("search").addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(
        () => search().catch((e) => showMessage("message", e.message)),
        180,
      );
    });
    $("results").addEventListener("click", (e) => {
      const b = e.target.closest("[data-id]");
      if (b) location.href = `profile.html?id=${b.dataset.id}`;
    });
  } catch (e) {
    showMessage("message", e.message || "โหลดข้อมูลไม่สำเร็จ");
  }
})();

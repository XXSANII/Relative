(async () => {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (session) {
    location.href = "main.html";
    return;
  }
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    showMessage("message", "");
    const btn = $("submitBtn");
    btn.disabled = true;
    try {
      const username = $("username").value.trim().replace(/\s+/g, " "),
        rawPassword = $("password").value.trim();
      if (!username || !rawPassword)
        throw new Error("กรุณากรอก Username และ Password");
      // วันเกิด "22/03/2547" หรือเบอร์ "081-234-5678" (บัญชีระบบเดิม) → ตัวเลขล้วน
      const password = /^[\d\s\-\/.+]+$/.test(rawPassword)
        ? normalizePhone(rawPassword)
        : rawPassword;
      // หาบัญชีจากชื่อจริง (07-birthdates-children.sql) แล้วลองรหัสผ่านกับแต่ละบัญชีที่ชื่อจริงตรงกัน
      const { data: emails, error: lookupError } = await sb.rpc(
        "login_emails",
        { p_username: username },
      );
      if (lookupError)
        throw new Error("ตรวจสอบบัญชีไม่สำเร็จ: " + lookupError.message);
      let error = true;
      for (const email of emails || []) {
        ({ error } = await sb.auth.signInWithPassword({ email, password }));
        // บัญชีระบบเดิมบางบัญชีตั้งรหัสเป็นเบอร์แบบมีขีดตามที่พิมพ์
        if (error && rawPassword !== password)
          ({ error } = await sb.auth.signInWithPassword({
            email,
            password: rawPassword,
          }));
        if (!error) break;
      }
      // บัญชีที่สมัครด้วยระบบเดิม (Username = ชื่อ-นามสกุล, Password = เบอร์ตามที่พิมพ์ตอนสมัคร)
      if (error)
        ({ error } = await sb.auth.signInWithPassword({
          email: await usernameEmail(username),
          password: rawPassword,
        }));
      if (error) throw new Error("ชื่อจริงหรือรหัสผ่านไม่ถูกต้อง");
      const p = await currentPerson();
      if (!p) {
        await sb.auth.signOut();
        throw new Error(
          "บัญชีนี้ยังไม่มีข้อมูลบุคคลที่เชื่อมโยง กรุณาติดต่อผู้ดูแลระบบ",
        );
      }
      location.href = "main.html";
    } catch (err) {
      showMessage("message", err.message || "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      btn.disabled = false;
    }
  });
})();

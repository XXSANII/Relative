const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const GENDER = { male: "ชาย", female: "หญิง", other: "อื่น ๆ" };
const AVATAR_BUCKET = "family-avatars";
const DEFAULT_AVATAR =
  "data:image/svg+xml;charset=UTF-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="100%" height="100%" fill="#eef1f7"/><circle cx="80" cy="58" r="30" fill="#aab5c8"/><path d="M25 150c5-34 25-49 55-49s50 15 55 49" fill="#aab5c8"/></svg>',
  );
if (!window.supabase || !SUPABASE_URL || !SUPABASE_ANON_KEY)
  throw new Error("กรุณาตั้งค่า Supabase ใน config.js");
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
function normalize(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("th");
}
// เบอร์โทรเหลือแต่ตัวเลข และแปลง +66 เป็น 0 เพื่อให้ "081-234-5678" กับ "+66812345678" เป็นค่าเดียวกัน
function normalizePhone(s) {
  let d = String(s || "").replace(/\D/g, "");
  if (d.startsWith("66") && d.length === 11) d = "0" + d.slice(2);
  return d;
}
function validPhone(phone) {
  return /^0\d{8,9}$/.test(phone);
}
// LINE ID: 4–20 ตัว ใช้ได้เฉพาะ a-z 0-9 . _ - (ตรงกับ check constraint ใน 12-line-contact.sql)
function validLineId(id) {
  return /^[a-zA-Z0-9._-]{4,20}$/.test(id);
}
async function sha256Hex(text) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
// Supabase Auth รับ username โดยตรงไม่ได้ จึงสร้างอีเมลภายในจาก hash ของ ชื่อจริง+เบอร์โทร
// ชื่อจริงซ้ำกันได้ ถ้าเบอร์โทรต่างกัน; ถ้าไม่มีเบอร์ (ไม่บังคับ) ใช้ ชื่อจริง+นามสกุลแทน
async function accountEmail(firstName, phone, lastName) {
  const p = normalizePhone(phone);
  const seed = p
    ? normalize(firstName) + "|" + p
    : normalize(firstName) + "|" + normalize(lastName) + "|nophone";
  const hex = await sha256Hex(seed);
  return `f-${hex.slice(0, 60)}@example.com`;
}
// รหัสผ่านของบัญชีที่ไม่ได้กรอกวันเดือนปีเกิด
const NO_BIRTH_PASSWORD = "00000000";
// รูปแบบเดิม (V4): hash ของชื่อ-นามสกุล ใช้สำหรับบัญชีที่สมัครไว้ก่อนเปลี่ยนระบบ
async function usernameEmail(username) {
  const hex = await sha256Hex(normalize(username));
  return `u-${hex.slice(0, 60)}@example.com`;
}
async function currentPerson() {
  const {
    data: { user },
    error,
  } = await sb.auth.getUser();
  if (error || !user) return null;
  const { data, error: dbError } = await sb
    .from("person")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (dbError) throw dbError;
  return data || null;
}
// คำนำหน้า ชื่อ-นามสกุล และชื่อเล่นในวงเล็บ เช่น "นาย แสนพล สุนทรนนท์ (แสน)"
// คำนำหน้าใช้แสดงผลเท่านั้น ไม่ใช้เชื่อมความสัมพันธ์
function displayName(p) {
  const name = p?.full_name
    ? [p.prefix, p.full_name].filter(Boolean).join(" ")
    : "-";
  return p?.nickname ? `${name} (${p.nickname})` : name;
}
function avatarUrl(path) {
  if (!path) return DEFAULT_AVATAR;
  return sb.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}
function showMessage(id, msg, type = "error") {
  const el = $(id);
  if (!el) return;
  el.hidden = !msg;
  el.className = type;
  el.textContent = msg || "";
}
async function signOut() {
  await sb.auth.signOut();
  location.href = "login.html";
}
function home() {
  location.href = "main.html";
}
function setNav() {
  const btn = $("homeBtn");
  if (btn) btn.addEventListener("click", home);
  const out = $("logoutBtn");
  if (out) out.addEventListener("click", signOut);
}
setNav();

// ไอคอนต้นไม้ในแถบเมนูเป็นทางเข้าหน้าผู้ดูแล แสดงเฉพาะผู้ดูแลตระกูล/ผู้ดูแลสูงสุด (คนอื่นไม่เห็นอะไรเพิ่ม)
async function initAdminLink() {
  const wrap = document.querySelector(".banner .wrap");
  if (!wrap) return;
  try {
    const {
      data: { session },
    } = await sb.auth.getSession();
    if (!session) return;
    const { data } = await sb.rpc("my_clans");
    if (!data || !(data.super || (data.clans || []).some((c) => c.is_admin))) return;
    const a = document.createElement("a");
    a.className = "admin-tree";
    a.href = "admin.html";
    a.textContent = "🌳";
    a.title = "จัดการตระกูล";
    a.setAttribute("aria-label", "จัดการตระกูล");
    wrap.prepend(a);
    wrap.classList.add("has-admin");
  } catch {
    /* ยังไม่ได้รัน sql/16 หรือเครือข่ายขัดข้อง: ไม่แสดงไอคอน */
  }
}
initAdminLink();

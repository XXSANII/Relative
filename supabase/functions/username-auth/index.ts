import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function normalizeUsername(username: string) {
  return username
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("th");
}

// แปลงเบอร์โทรศัพท์ไทยเป็นรูปแบบ +66 สำหรับ Supabase Auth
function normalizePhone(phone: string) {
  const value = phone.trim().replace(/[\s()-]/g, "");

  if (value.startsWith("+")) {
    return value;
  }

  if (value.startsWith("0") && value.length === 10) {
    return "+66" + value.slice(1);
  }

  return value;
}

function validPhone(phone: string) {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return response({ error: "Method not allowed" }, 405);
  }

  try {
    const body = await req.json();

    const action = String(body.action ?? "");
    const username = String(body.username ?? "").trim();
    const normalizedUsername = normalizeUsername(username);
    const password = String(body.password ?? "");

    if (username.length < 2 || username.length > 100) {
      return response(
        { error: "กรุณากรอก Username ให้ถูกต้อง" },
        400,
      );
    }

    if (password.length < 6 || password.length > 128) {
      return response(
        { error: "Password ต้องมีความยาว 6–128 ตัวอักษร" },
        400,
      );
    }

    // =========================
    // REGISTER
    // =========================
    if (action === "register") {
      const phone = normalizePhone(
        String(body.phone ?? password),
      );

      if (!validPhone(phone)) {
        return response(
          {
            error:
              "เบอร์โทรศัพท์ไม่ถูกต้อง กรุณากรอกเบอร์ไทย 10 หลัก",
          },
          400,
        );
      }

      // ตรวจสอบ Username ซ้ำ
      const { data: existing, error: lookupError } = await admin
        .from("username_accounts")
        .select("id")
        .eq("username_normalized", normalizedUsername)
        .maybeSingle();

      if (lookupError) {
        console.error("Username lookup error:", lookupError.message);
        return response(
          { error: "ไม่สามารถตรวจสอบ Username ได้" },
          500,
        );
      }

      if (existing) {
        return response(
          { error: "Username นี้ถูกใช้งานแล้ว" },
          409,
        );
      }

      // สร้างบัญชี Supabase Auth
      // วิธีนี้ข้าม OTP จึงไม่ได้ยืนยันว่าเป็นเจ้าของเบอร์จริง
      const { data: created, error: createError } =
        await admin.auth.admin.createUser({
          phone,
          password,
          phone_confirm: true,
          user_metadata: {
            username,
          },
        });

      if (createError || !created.user) {
        console.error("Create user error:", createError?.message);
        return response(
          {
            error:
              "สร้างบัญชีไม่สำเร็จ เบอร์โทรศัพท์อาจถูกใช้งานแล้ว",
          },
          400,
        );
      }

      // เชื่อม Username กับ Auth User
      const { error: mappingError } = await admin
        .from("username_accounts")
        .insert({
          username,
          username_normalized: normalizedUsername,
          auth_user_id: created.user.id,
        });

      if (mappingError) {
        // ลบบัญชีที่สร้างไปแล้วหากบันทึก Username ไม่สำเร็จ
        await admin.auth.admin.deleteUser(created.user.id);

        console.error("Mapping error:", mappingError.message);

        return response(
          { error: "บันทึก Username ไม่สำเร็จ" },
          500,
        );
      }

      // Login เพื่อรับ Session
      const { data: login, error: loginError } =
        await authClient.auth.signInWithPassword({
          phone,
          password,
        });

      if (loginError || !login.session) {
        console.error("Register login error:", loginError?.message);

        return response(
          {
            error:
              "สร้างบัญชีสำเร็จ แต่เข้าสู่ระบบไม่สำเร็จ กรุณาลอง Login อีกครั้ง",
          },
          500,
        );
      }

      return response({
        success: true,
        message: "สมัครสมาชิกสำเร็จ",
        session: login.session,
        user: login.user,
      });
    }

    // =========================
    // LOGIN
    // =========================
    if (action === "login") {
      // ค้นหาบัญชีด้วย Username
      const { data: account, error: lookupError } = await admin
        .from("username_accounts")
        .select("auth_user_id")
        .eq("username_normalized", normalizedUsername)
        .maybeSingle();

      if (lookupError) {
        console.error("Login lookup error:", lookupError.message);
        return response(
          { error: "ไม่สามารถเข้าสู่ระบบได้" },
          500,
        );
      }

      if (!account) {
        return response(
          { error: "Username หรือ Password ไม่ถูกต้อง" },
          401,
        );
      }

      // อ่านเบอร์โทรศัพท์ของบัญชีจาก Supabase Auth
      const { data: authUser, error: userError } =
        await admin.auth.admin.getUserById(account.auth_user_id);

      const phone = authUser.user?.phone;

      if (userError || !phone) {
        return response(
          { error: "Username หรือ Password ไม่ถูกต้อง" },
          401,
        );
      }

      // ให้ Supabase Auth ตรวจสอบ Password
      const { data: login, error: loginError } =
        await authClient.auth.signInWithPassword({
          phone,
          password,
        });

      if (loginError || !login.session) {
        return response(
          { error: "Username หรือ Password ไม่ถูกต้อง" },
          401,
        );
      }

      return response({
        success: true,
        message: "เข้าสู่ระบบสำเร็จ",
        session: login.session,
        user: login.user,
      });
    }

    return response(
      { error: "action ต้องเป็น login หรือ register" },
      400,
    );
  } catch (error) {
    console.error("Unexpected error:", error);

    return response(
      { error: "เกิดข้อผิดพลาดภายในระบบ" },
      500,
    );
  }
});
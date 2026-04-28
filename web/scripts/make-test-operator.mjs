import { createClient } from "@supabase/supabase-js";

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const email = "operator-test@dino.local";
const password = "OpTest!2026";

const { data, error } = await sb.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: "Operator Test" },
});

let uid = data?.user?.id;
if (error) {
  if (!String(error.message).toLowerCase().includes("already")) {
    console.error("createUser:", error.message);
    process.exit(1);
  }
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  uid = list.users.find((u) => u.email === email)?.id;
  if (uid) {
    await sb.auth.admin.updateUserById(uid, { password, email_confirm: true });
  }
}

console.log("uid:", uid);
const { error: pErr } = await sb.from("profiles").upsert({
  id: uid,
  email,
  full_name: "Operator Test",
  role: "operator",
  disabled_at: null,
});
console.log("profile err:", pErr?.message);
console.log(`creds: ${email} / ${password}`);

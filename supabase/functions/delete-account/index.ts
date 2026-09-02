// Suppression de compte in-app (App Store 5.1.1 / 2.1).
// JWT utilisateur obligatoire (verify_jwt = true dans config.toml).
// Secrets injectés par la plateforme : SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (jamais dans le client).
//
// Deploy : npx supabase functions deploy delete-account
// JWT vérifié à l'entrée (ne pas désactiver la vérif).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method" });
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(authHeader)) {
    return json(401, { ok: false, error: "unauthorized" });
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !anon || !service) {
    return json(500, { ok: false, error: "config" });
  }

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user?.id) {
    return json(401, { ok: false, error: "unauthorized" });
  }
  if (user.is_anonymous) {
    return json(400, { ok: false, error: "guest" });
  }

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) {
    console.error("delete-account:", delErr.message);
    return json(500, { ok: false, error: "delete_failed" });
  }

  return json(200, { ok: true });
});

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

  // Audit compte n°1 : Supabase n'efface pas les fichiers d'un compte supprimé
  // (et le SQL ne peut pas les effacer). Sans ça, la photo restait publique.
  // Après deleteUser : si l'effacement échoue, le compte est quand même supprimé.
  const avatar = await deleteAvatarFile(admin, user.id);

  // Audit achats n°5 : le client RevenueCat restait rattaché au compte supprimé
  // (achats bloqués sur un compte qui n'existe plus, données gardées). Suppression
  // côté RevenueCat, en option (REVENUECAT_DELETE_ON_ACCOUNT_DELETE=true), sans
  // bloquer la suppression du compte si RevenueCat ne répond pas.
  const revenuecat = await deleteRevenueCatCustomer(user.id);

  return json(200, { ok: true, avatar, revenuecat });
});

/** Efface `avatars/<id>/avatar.jpg` (absent : rien à faire). Renvoie un état, sans lever. */
async function deleteAvatarFile(
  admin: ReturnType<typeof createClient>,
  userId: string
): Promise<string> {
  try {
    const { error } = await admin.storage.from("avatars").remove([`${userId}/avatar.jpg`]);
    if (!error) return "deleted";
    console.error("delete-account: photo", error.message);
    return "failed";
  } catch (e) {
    console.error("delete-account: photo", e instanceof Error ? e.message : e);
    return "failed";
  }
}

/**
 * Supprime le client RevenueCat (API v2). Clé secrète avec le droit
 * « customer_information:customers:read_write ». Renvoie un état, sans lever.
 * Attention : RevenueCat efface alors l'historique de ce client (y compris dans
 * ses graphiques de revenus).
 */
async function deleteRevenueCatCustomer(userId: string): Promise<string> {
  if ((Deno.env.get("REVENUECAT_DELETE_ON_ACCOUNT_DELETE") || "") !== "true") return "skipped";
  const apiKey = Deno.env.get("REVENUECAT_SECRET_API_KEY") || "";
  const projectId = Deno.env.get("REVENUECAT_PROJECT_ID") || "";
  if (!apiKey || !projectId) return "not_configured";
  try {
    const res = await fetch(
      `https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}` +
        `/customers/${encodeURIComponent(userId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (res.ok || res.status === 404) return "deleted";
    console.error("delete-account: RevenueCat", res.status);
    return "failed";
  } catch (e) {
    console.error("delete-account: RevenueCat", e instanceof Error ? e.message : e);
    return "failed";
  }
}

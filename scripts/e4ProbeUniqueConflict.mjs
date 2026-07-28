/**
 * Staging helper — provoque UNIQUE et imprime la forme d’erreur Supabase/PostgREST.
 *
 * Usage (après e4-01 + e4-02 sur le projet pointé par js/config/supabase.js) :
 *   node scripts/e4ProbeUniqueConflict.mjs
 *
 * Ne pas utiliser en production pour polluer. Nettoie le lobby créé en fin de run.
 *
 * NOTE : nécessite réseau TLS OK vers Supabase. Si UNABLE_TO_VERIFY_LEAF_SIGNATURE,
 * exécuter depuis une machine / CI avec certificats sains, ou SQL Editor + client local.
 */
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../js/config/supabase.js";
import { isLobbyMembersOneLivingPerUserConflict } from "../js/core/lobbyMembershipUniqueConflict.js";

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function printErr(label, error) {
  const shape = {
    code: error?.code ?? null,
    message: error?.message ?? null,
    details: error?.details ?? null,
    hint: error?.hint ?? null,
    constraint: error?.constraint ?? null,
    keys: error && typeof error === "object" ? Object.keys(error) : [],
  };
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(shape, null, 2));
  console.log(
    "isLobbyMembersOneLivingPerUserConflict →",
    isLobbyMembersOneLivingPerUserConflict(error)
  );
}

async function main() {
  const { data: auth, error: authErr } = await sb.auth.signInAnonymously();
  if (authErr) {
    console.error("auth failed", authErr);
    process.exit(1);
  }
  const uid = auth.user.id;
  console.log("uid", uid, "role claim typically authenticated when session present");

  const first = await sb.rpc("create_lobby_atomically", {
    p_display_name: "E4Probe",
    p_emoji: "👤",
    p_color: "#A78BFA",
  });
  console.log("first create", first.data?.status, first.error?.message);

  // Deuxième membership via INSERT direct → forme 23505 PostgREST
  const lobbyB = await sb
    .from("lobbies")
    .insert({
      code: `Z${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      host_id: uid,
      status: "waiting",
    })
    .select("id")
    .single();

  if (lobbyB.error) {
    printErr("unexpected lobby insert error", lobbyB.error);
  } else {
    const mem = await sb.from("lobby_members").insert({
      lobby_id: lobbyB.data.id,
      user_id: uid,
      display_name: "E4Probe2",
      emoji: "👤",
      color: "#60A5FA",
      is_host: false,
      ready: false,
    });
    printErr("second membership INSERT (expect 23505)", mem.error);
    // cleanup orphan lobby B if insert failed
    await sb.from("lobbies").delete().eq("id", lobbyB.data.id);
  }

  // Cleanup first lobby if CREATED
  if (first.data?.lobby_id) {
    await sb.from("lobbies").delete().eq("id", first.data.lobby_id);
  }

  await sb.auth.signOut();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

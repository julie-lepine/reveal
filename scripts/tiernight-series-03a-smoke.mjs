/**
 * FEATURE-TIERNIGHT-SERIES-03A — smoke staging via JWT réel (méthode recommandée).
 *
 * Usage :
 *   set SUPABASE_URL=...
 *   set SUPABASE_ANON_KEY=...
 *   set TNS03A_HOST_EMAIL=...
 *   set TNS03A_HOST_PASSWORD=...
 *   set TNS03A_LOBBY_ID=...          # lobby de TEST isolé (hôte = compte)
 *   set TNS03A_RUN_ID=...            # runId déjà présent dans session série
 *   set TNS03A_ROUND_INDEX=0
 *   set TNS03A_FORCE=false
 *   set TNS03A_DRY_READ=1            # 1 = ACL + lecture session seulement
 *
 * node scripts/tiernight-series-03a-smoke.mjs
 *
 * Ne crée pas de lobby automatiquement (évite pollution). Préparer la session série
 * à la main ou via un seed staging dédié, puis pointer TNS03A_LOBBY_ID.
 */

import { createClient } from "@supabase/supabase-js";

function req(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env ${name}`);
    process.exit(2);
  }
  return v;
}

const url = req("SUPABASE_URL");
const anon = req("SUPABASE_ANON_KEY");
const email = req("TNS03A_HOST_EMAIL");
const password = req("TNS03A_HOST_PASSWORD");
const lobbyId = req("TNS03A_LOBBY_ID");
const dryRead = process.env.TNS03A_DRY_READ === "1";

const supabase = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
  email,
  password,
});
if (authErr) {
  console.error("Auth failed", authErr.message);
  process.exit(1);
}
console.log("auth.uid", authData.user?.id);

const { data: sessionRow, error: sessErr } = await supabase
  .from("game_sessions")
  .select("lobby_id, game_id, screen, state")
  .eq("lobby_id", lobbyId)
  .maybeSingle();
if (sessErr) {
  console.error("session read", sessErr.message);
  process.exit(1);
}
if (!sessionRow) {
  console.error("No game_sessions for lobby — refuse (isolé / mauvais id)");
  process.exit(1);
}

const tn = sessionRow.state?.tierNight;
const series = tn?.series;
console.log("snapshot", {
  game_id: sessionRow.game_id,
  screen: sessionRow.screen,
  runId: tn?.runId,
  phase: series?.phase,
  roundIndex: series?.roundIndex,
  scoredRoundIds: series?.scoredRoundIds,
  tierNightsPlayed: sessionRow.state?.stats?.tierNightsPlayed,
  eveningGamesRecorded: sessionRow.state?.eveningGamesRecorded?.tiernight,
});

if (dryRead) {
  console.log("DRY_READ=1 — stop before RPC");
  process.exit(0);
}

const runId = process.env.TNS03A_RUN_ID || tn?.runId;
const roundIndex = Number(process.env.TNS03A_ROUND_INDEX ?? series?.roundIndex ?? 0);
const roundId = `${runId}:${roundIndex}`;
const force = process.env.TNS03A_FORCE === "true";

console.log("RPC args", { lobbyId, runId, roundId, roundIndex, force });

const { data, error } = await supabase.rpc("finalize_tiernight_series_round", {
  p_lobby_id: lobbyId,
  p_run_id: runId,
  p_round_id: roundId,
  p_round_index: roundIndex,
  p_expected_phase: "ranking",
  p_force: force,
});

if (error) {
  console.error("RPC error", error.message);
  process.exit(1);
}

console.log("RPC result", {
  ok: data?.ok,
  applied: data?.applied,
  code: data?.code,
  phase: data?.phase,
  isLastRound: data?.isLastRound,
});

// Retry idempotent
const { data: data2, error: error2 } = await supabase.rpc("finalize_tiernight_series_round", {
  p_lobby_id: lobbyId,
  p_run_id: runId,
  p_round_id: roundId,
  p_round_index: roundIndex,
  p_expected_phase: "ranking",
  p_force: force,
});
if (error2) {
  console.error("Retry error (unexpected if already applied)", error2.message);
  process.exit(1);
}
console.log("Retry", { ok: data2?.ok, applied: data2?.applied, code: data2?.code });
if (!(data2?.ok === true && data2?.applied === false && data2?.code === "ALREADY_APPLIED")) {
  console.error("Retry did not return ALREADY_APPLIED");
  process.exit(1);
}

console.log("smoke OK");

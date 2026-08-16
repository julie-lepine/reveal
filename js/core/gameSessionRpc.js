/**
 * I-08 / ARCH-03 - appels RPC game_sessions (pas d'UPDATE libre pour invité / acting).
 */
import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

function requireClient() {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error("Supabase non configuré.");
  }
}

/** @param {object|null} data */
function asSessionRow(data) {
  if (!data) return null;
  return data;
}

export async function rpcContributeGameSessionPlayer({ lobbyId, game, kind, value }) {
  requireClient();
  const { data, error } = await supabase.rpc("contribute_game_session_player", {
    p_lobby_id: lobbyId,
    p_game: game,
    p_kind: kind,
    p_value: value,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcContributeChatRouletteReaction({
  lobbyId,
  rouletteId,
  attemptId,
  reaction = null,
}) {
  requireClient();
  const { data, error } = await supabase.rpc("contribute_chat_roulette_reaction", {
    p_lobby_id: lobbyId,
    p_roulette_id: rouletteId,
    p_attempt_id: attemptId,
    p_reaction: reaction,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcUpsertPlayerCustomEntry({ lobbyId, game, entry }) {
  requireClient();
  const { data, error } = await supabase.rpc("upsert_player_custom_entry", {
    p_lobby_id: lobbyId,
    p_game: game,
    p_entry: entry,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcDeletePlayerCustomEntry({ lobbyId, game, entryId }) {
  requireClient();
  const { data, error } = await supabase.rpc("delete_player_custom_entry", {
    p_lobby_id: lobbyId,
    p_game: game,
    p_entry_id: entryId,
  });
  if (error) throw error;
  return asSessionRow(data);
}

/** FEATURE-TIERNIGHT-04C — upsert atomique customLiveTierLists. */
export async function rpcUpsertPlayerCustomLiveTierList({ lobbyId, entry }) {
  requireClient();
  const { data, error } = await supabase.rpc("upsert_player_custom_live_tier_list", {
    p_lobby_id: lobbyId,
    p_entry: entry,
  });
  if (error) throw error;
  return asSessionRow(data);
}

/** FEATURE-TIERNIGHT-04C — delete own customLiveTierLists. */
export async function rpcDeletePlayerCustomLiveTierList({ lobbyId, entryId }) {
  requireClient();
  const { data, error } = await supabase.rpc("delete_player_custom_live_tier_list", {
    p_lobby_id: lobbyId,
    p_entry_id: entryId,
  });
  if (error) throw error;
  return asSessionRow(data);
}

/**
 * FEATURE-TIERNIGHT-04C — clear ALL autoritatif (déclenchement 04F/04G).
 * @param {{ lobbyId: string, expectedSessionId?: string|null, reopen?: boolean }} opts
 */
export async function rpcClearTierNightCustomLiveTierLists({
  lobbyId,
  expectedSessionId = null,
  reopen = false,
}) {
  requireClient();
  const { data, error } = await supabase.rpc("clear_tiernight_custom_live_tier_lists", {
    p_lobby_id: lobbyId,
    p_expected_session_id: expectedSessionId || null,
    p_reopen: Boolean(reopen),
  });
  if (error) throw error;
  return data && typeof data === "object" ? data : null;
}

/**
 * FEATURE-TIERNIGHT-04E — commit atomique série Rank Live (proposition client).
 * @param {{ lobbyId: string, expectedSetupEpoch: number, series: object }} opts
 */
export async function rpcStartTierNightLiveSeries({
  lobbyId,
  expectedSetupEpoch,
  series,
}) {
  requireClient();
  const { data, error } = await supabase.rpc("start_tiernight_live_series", {
    p_lobby_id: lobbyId,
    p_expected_setup_epoch: Number(expectedSetupEpoch),
    p_series: series,
  });
  if (error) throw error;
  return asSessionRow(data);
}

/**
 * FEATURE-TIERNIGHT-03 — hôte réel : vide tous les customRosterTopics (CAS session).
 * @param {{ lobbyId: string, expectedSessionId?: string|null, reopen?: boolean }} opts
 */
export async function rpcClearTierNightCustomRosterTopics({
  lobbyId,
  expectedSessionId = null,
  reopen = false,
}) {
  requireClient();
  const { data, error } = await supabase.rpc("clear_tiernight_custom_roster_topics", {
    p_lobby_id: lobbyId,
    p_expected_session_id: expectedSessionId || null,
    p_reopen: Boolean(reopen),
  });
  if (error) throw error;
  return data && typeof data === "object" ? data : null;
}

export async function rpcSubmitTruthMeterAffirmation({ lobbyId, text, authorEstimate }) {
  requireClient();
  const { data, error } = await supabase.rpc("submit_truth_meter_affirmation", {
    p_lobby_id: lobbyId,
    p_text: text,
    p_author_estimate: authorEstimate,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcApplyActingHostPlay({
  lobbyId,
  action,
  game,
  playPatch = {},
  screen = null,
  gameId = null,
}) {
  requireClient();
  const { data, error } = await supabase.rpc("apply_acting_host_play", {
    p_lobby_id: lobbyId,
    p_action: action,
    p_game: game,
    p_play_patch: playPatch,
    p_screen: screen,
    p_game_id: gameId,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcCompleteGameSessionAsActor({ lobbyId, screen = "results" }) {
  requireClient();
  const { data, error } = await supabase.rpc("complete_game_session_as_actor", {
    p_lobby_id: lobbyId,
    p_screen: screen,
  });
  if (error) throw error;
  return asSessionRow(data);
}

/** BUG-TRIVIA-01B - reveal atomique (hôte réel + acting host). */
export async function rpcRevealTriviaRound({ lobbyId, runId, questionIdx }) {
  requireClient();
  const { data, error } = await supabase.rpc("reveal_trivia_round", {
    p_lobby_id: lobbyId,
    p_run_id: runId,
    p_question_idx: questionIdx,
  });
  if (error) throw error;
  return asSessionRow(data);
}

/** BUG-TRIVIA-01B-bis - réponse atomique + auto-reveal serveur (tous les joueurs MP). */
export async function rpcSubmitTriviaAnswer({
  lobbyId,
  runId,
  questionIdx,
  answerIndex,
  answeredAt,
}) {
  requireClient();
  const { data, error } = await supabase.rpc("submit_trivia_answer", {
    p_lobby_id: lobbyId,
    p_run_id: runId,
    p_question_idx: questionIdx,
    p_answer_index: answerIndex,
    p_answered_at: answeredAt,
  });
  if (error) throw error;
  return asSessionRow(data);
}

/** BUG-TRUTHMETER-01B - reveal/scoring atomique (hôte réel + acting host). */
export async function rpcRevealTruthMeterRound({ lobbyId, runId, roundIdx }) {
  requireClient();
  const { data, error } = await supabase.rpc("reveal_truth_meter_round", {
    p_lobby_id: lobbyId,
    p_run_id: runId,
    p_round_idx: roundIdx,
  });
  if (error) throw error;
  return asSessionRow(data);
}

/** BUG-TRUTHMETER-01B - vote atomique + auto-reveal serveur. */
export async function rpcSubmitTruthMeterVote({ lobbyId, runId, roundIdx, value }) {
  requireClient();
  const { data, error } = await supabase.rpc("submit_truth_meter_vote", {
    p_lobby_id: lobbyId,
    p_run_id: runId,
    p_round_idx: roundIdx,
    p_value: value,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcRevealDrawItRound({ lobbyId }) {
  requireClient();
  const { data, error } = await supabase.rpc("reveal_drawit_round", {
    p_lobby_id: lobbyId,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcAdvanceDrawItRound({ lobbyId }) {
  requireClient();
  const { data, error } = await supabase.rpc("advance_drawit_round", {
    p_lobby_id: lobbyId,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcFinalizeDrawItScores({ lobbyId }) {
  requireClient();
  const { data, error } = await supabase.rpc("finalize_drawit_scores", {
    p_lobby_id: lobbyId,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcSubmitDrawItGuess({ lobbyId, runId, roundIdx, value }) {
  requireClient();
  const { data, error } = await supabase.rpc("submit_drawit_guess", {
    p_lobby_id: lobbyId,
    p_run_id: runId,
    p_round_idx: roundIdx,
    p_value: value,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcAppendDrawItStroke({
  lobbyId,
  runId,
  roundIdx,
  canvasEpoch,
  stroke,
}) {
  requireClient();
  const { data, error } = await supabase.rpc("append_drawit_stroke", {
    p_lobby_id: lobbyId,
    p_run_id: runId,
    p_round_idx: roundIdx,
    p_canvas_epoch: canvasEpoch,
    p_stroke: stroke,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcUndoDrawItStroke({
  lobbyId,
  runId,
  roundIdx,
  canvasEpoch,
  strokeId,
}) {
  requireClient();
  const { data, error } = await supabase.rpc("undo_drawit_stroke", {
    p_lobby_id: lobbyId,
    p_run_id: runId,
    p_round_idx: roundIdx,
    p_canvas_epoch: canvasEpoch,
    p_stroke_id: strokeId,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcClearDrawItCanvas({
  lobbyId,
  runId,
  roundIdx,
  canvasEpoch,
}) {
  requireClient();
  const { data, error } = await supabase.rpc("clear_drawit_canvas", {
    p_lobby_id: lobbyId,
    p_run_id: runId,
    p_round_idx: roundIdx,
    p_canvas_epoch: canvasEpoch,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcEraseDrawItStrokes({
  lobbyId,
  runId,
  roundIdx,
  canvasEpoch,
  strokeIds,
}) {
  requireClient();
  const { data, error } = await supabase.rpc("erase_drawit_strokes", {
    p_lobby_id: lobbyId,
    p_run_id: runId,
    p_round_idx: roundIdx,
    p_canvas_epoch: canvasEpoch,
    p_stroke_ids: strokeIds,
  });
  if (error) throw error;
  return asSessionRow(data);
}

export async function rpcEraseDrawItSegments({
  lobbyId,
  runId,
  roundIdx,
  canvasEpoch,
  operationId,
  replacements,
}) {
  requireClient();
  const { data, error } = await supabase.rpc("erase_drawit_segments", {
    p_lobby_id: lobbyId,
    p_run_id: runId,
    p_round_idx: roundIdx,
    p_canvas_epoch: canvasEpoch,
    p_operation_id: operationId,
    p_replacements: replacements,
  });
  if (error) throw error;
  return asSessionRow(data);
}

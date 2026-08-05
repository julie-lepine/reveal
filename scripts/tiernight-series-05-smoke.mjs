/**
 * FEATURE-TIERNIGHT-SERIES-05B/05C — smoke JWT staging pour advance_tiernight_series_round.
 *
 * Sécurité :
 *   - jamais service_role
 *   - TNS05_CONFIRM_STAGING_FIXTURE=YES obligatoire
 *   - TNS05_EXPECTED_LOBBY_CODE doit matcher lobbies.code et commencer par TNS05
 *   - hôte réel strict = lobbies.host_id === auth.uid()
 *   - snapshot + restore CAS (lobby_id + updated_at) dans finally
 *
 * Usage (PowerShell) : voir docs/FEATURE-TIERNIGHT-SERIES-05C.md
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  validateSmokeEnv,
  runTierNightSeries05Smoke,
  redactSecretsFromText,
} from "./lib/tiernightSeries05SmokeLib.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function safeLog(...args) {
  console.log(...args.map((a) => redactSecretsFromText(String(a))));
}
function safeErr(...args) {
  console.error(...args.map((a) => redactSecretsFromText(String(a))));
}

const gate = validateSmokeEnv(process.env);
if (!gate.ok) {
  safeErr("Refusing to start:", gate.errors.join("; "));
  process.exit(2);
}

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const email = process.env.TNS05_HOST_EMAIL;
const password = process.env.TNS05_HOST_PASSWORD;

const supabase = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
  email,
  password,
});
if (authErr) {
  safeErr("Auth failed:", authErr.message);
  process.exit(1);
}
safeLog("auth.uid", authData.user?.id);

async function writeSnapshotFile(snapshot) {
  const dir = join(ROOT, "tmp", "tns05-smoke");
  await mkdir(dir, { recursive: true });
  const name = `snapshot-${snapshot.lobby_id}-${Date.now()}.json`;
  const path = join(dir, name);
  // Pas de credentials ni tokens ; peut contenir des données applicatives de la fixture.
  await writeFile(path, JSON.stringify(snapshot, null, 2), { encoding: "utf8", mode: 0o600 });
  return path;
}

const result = await runTierNightSeries05Smoke({
  env: process.env,
  supabase,
  log: safeLog,
  error: safeErr,
  io: { writeSnapshotFile },
});

if (result.errors?.length) {
  safeErr("Errors:", result.errors.join(" | "));
}
safeLog(
  JSON.stringify(
    {
      ok: result.ok,
      step: result.step,
      mutated: result.mutated,
      ambiguous: result.ambiguous,
      restoreAttempted: result.restoreAttempted,
      restoreOk: result.restoreOk,
      restoreCode: result.restoreCode,
    },
    null,
    2
  )
);

if (result.ambiguous) {
  safeErr(
    "State may be ambiguous after transport/timeout — re-read session before any retry; do not blind-replay mutations."
  );
}

if (process.env.TNS05_SAVE_SNAPSHOT_FILE === "1" && result.ok && result.restoreOk) {
  safeLog(
    "Cleanup tip: Remove-Item -Recurse -Force .\\tmp\\tns05-smoke  (fixture app data may remain until deleted)"
  );
}

let code = result.code ?? (result.ok ? 0 : 1);
if (
  (result.mutated?.finalize || result.mutated?.advance) &&
  result.restoreAttempted &&
  result.restoreOk === false
) {
  code = Math.max(code, 1);
}
if (
  (result.mutated?.finalize || result.mutated?.advance) &&
  result.restoreAttempted === false &&
  result.restoreCode &&
  result.restoreCode !== "RESTORE_NOT_NEEDED"
) {
  code = Math.max(code, 1);
}
process.exit(code);

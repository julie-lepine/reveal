import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/supabase.js";
import { installRealtimeSocketDiagnostics } from "./realtimeSocketDiagnose.js";

export function isSupabaseConfigured() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  if (SUPABASE_URL.includes("TON_PROJECT")) return false;
  if (SUPABASE_ANON_KEY.includes("REPLACE_ME")) return false;
  return true;
}

export const supabase = isSupabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

if (supabase) {
  try {
    installRealtimeSocketDiagnostics(supabase);
  } catch (e) {
    console.warn("REVEAL realtime socket diagnose:", e?.message || e);
  }
}

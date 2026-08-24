import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

function isMissingAdFreeColumn(error) {
  const msg = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "");
  return (
    code === "42703" ||
    (msg.includes("ad_free") && (msg.includes("column") || msg.includes("schema cache")))
  );
}

async function fetchProfileRow(userId) {
  const withFlag = await supabase
    .from("profiles")
    .select("id, display_name, emoji, ad_free")
    .eq("id", userId)
    .maybeSingle();

  if (!withFlag.error) return withFlag;

  if (!isMissingAdFreeColumn(withFlag.error)) return withFlag;

  const fallback = await supabase
    .from("profiles")
    .select("id, display_name, emoji")
    .eq("id", userId)
    .maybeSingle();
  if (fallback.error) return fallback;
  return {
    data: fallback.data ? { ...fallback.data, ad_free: false } : fallback.data,
    error: null,
  };
}

export async function fetchProfile(userId) {
  console.log("[DEBUG FETCH PROFILE INPUT]", {
    userId,
  });

  const { data: authData } = await supabase.auth.getUser();

  console.log("[DEBUG FETCH PROFILE AUTH]", {
    authUserId: authData?.user?.id,
    isAnonymous: authData?.user?.is_anonymous,
  });

  if (!isSupabaseConfigured() || !userId) return null;

  const { data, error } = await fetchProfileRow(userId);

  console.log("[DEBUG FETCH PROFILE RESULT]", {
    data,
    error,
  });

  if (error) throw error;

  return data;
}

export async function upsertProfile({ userId, displayName, emoji }) {
  if (!isSupabaseConfigured() || !userId) return null;
  const row = {
    id: userId,
    display_name: displayName.trim().slice(0, 24),
    emoji: emoji || "👤",
  };
  const { data, error } = await supabase.from("profiles").upsert(row).select().single();
  if (error) throw error;
  return data;
}

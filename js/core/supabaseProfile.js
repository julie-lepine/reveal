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
  if (!isSupabaseConfigured() || !userId) return null;

  const { data, error } = await fetchProfileRow(userId);

  if (error) throw error;

  return data;
}

export async function upsertProfile({ userId, displayName, emoji }) {
  if (!isSupabaseConfigured() || !userId) return null;

  const name =
    displayName != null && String(displayName).trim()
      ? String(displayName).trim().slice(0, 24)
      : null;

  if (name) {
    const row = {
      id: userId,
      display_name: name,
      emoji: emoji || "👤",
    };
    const { data, error } = await supabase.from("profiles").upsert(row).select().single();
    if (error) throw error;
    return data;
  }

  if (emoji == null) return null;

  const { data, error } = await supabase
    .from("profiles")
    .update({ emoji: emoji || "👤" })
    .eq("id", userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

function isMissingProfileColumn(error) {
  const msg = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "");
  return (
    code === "42703" ||
    ((msg.includes("ad_free") || msg.includes("profile_pack")) &&
      (msg.includes("column") || msg.includes("schema cache")))
  );
}

function withEntitlementDefaults(row) {
  if (!row) return row;
  return {
    ad_free: false,
    profile_pack: false,
    ...row,
  };
}

async function fetchProfileRow(userId) {
  const selects = [
    "id, display_name, emoji, ad_free, profile_pack",
    "id, display_name, emoji, ad_free",
    "id, display_name, emoji",
  ];
  let last = null;
  for (const select of selects) {
    const res = await supabase
      .from("profiles")
      .select(select)
      .eq("id", userId)
      .maybeSingle();
    last = res;
    if (!res.error) {
      return { data: withEntitlementDefaults(res.data), error: null };
    }
    if (!isMissingProfileColumn(res.error)) return res;
  }
  return last;
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

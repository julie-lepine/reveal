import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

function isMissingProfileColumn(error) {
  const msg = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "");
  return (
    code === "42703" ||
    ((msg.includes("ad_free") ||
      msg.includes("profile_pack") ||
      msg.includes("name_color")) &&
      (msg.includes("column") || msg.includes("schema cache")))
  );
}

function withEntitlementDefaults(row) {
  if (!row) return row;
  return {
    ad_free: false,
    profile_pack: false,
    name_color: null,
    ...row,
  };
}

async function fetchProfileRow(userId) {
  const selects = [
    "id, display_name, emoji, ad_free, profile_pack, name_color",
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

export async function upsertProfile({ userId, displayName, emoji, nameColor } = {}) {
  if (!isSupabaseConfigured() || !userId) return null;

  const name =
    displayName != null && String(displayName).trim()
      ? String(displayName).trim().slice(0, 24)
      : null;

  const colorPatch =
    nameColor !== undefined
      ? { name_color: nameColor || null }
      : {};

  if (name) {
    const row = {
      id: userId,
      display_name: name,
      emoji: emoji || "👤",
      ...colorPatch,
    };
    let { data, error } = await supabase.from("profiles").upsert(row).select().single();
    if (error && colorPatch.name_color !== undefined && isMissingProfileColumn(error)) {
      const { name_color: _drop, ...withoutColor } = row;
      ({ data, error } = await supabase.from("profiles").upsert(withoutColor).select().single());
    }
    if (error) throw error;
    return data;
  }

  const patch = {};
  if (emoji != null) patch.emoji = emoji || "👤";
  Object.assign(patch, colorPatch);
  if (!Object.keys(patch).length) return null;

  let { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select()
    .single();
  if (error && colorPatch.name_color !== undefined && isMissingProfileColumn(error)) {
    const { name_color: _drop, ...withoutColor } = patch;
    if (!Object.keys(withoutColor).length) return null;
    ({ data, error } = await supabase
      .from("profiles")
      .update(withoutColor)
      .eq("id", userId)
      .select()
      .single());
  }
  if (error) throw error;
  return data;
}

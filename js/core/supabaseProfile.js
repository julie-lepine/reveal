import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

function isMissingProfileColumn(error) {
  const msg = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "");
  return (
    code === "42703" ||
    ((msg.includes("ad_free") ||
      msg.includes("profile_pack") ||
      msg.includes("host_pack") ||
      msg.includes("name_color") ||
      msg.includes("avatar_path") ||
      msg.includes("avatar_rev")) &&
      (msg.includes("column") || msg.includes("schema cache")))
  );
}

function withEntitlementDefaults(row) {
  if (!row) return row;
  return {
    ad_free: false,
    profile_pack: false,
    host_pack: false,
    name_color: null,
    avatar_path: null,
    avatar_rev: 0,
    ...row,
  };
}

async function fetchProfileRow(userId) {
  const selects = [
    "id, display_name, emoji, ad_free, profile_pack, host_pack, name_color, avatar_path, avatar_rev",
    "id, display_name, emoji, ad_free, profile_pack, host_pack, name_color",
    "id, display_name, emoji, ad_free, profile_pack, host_pack",
    "id, display_name, emoji, ad_free, profile_pack, name_color, avatar_path, avatar_rev",
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

function dropMissingCosmeticColumns(row, error) {
  if (!row || !isMissingProfileColumn(error)) return null;
  const next = { ...row };
  let changed = false;
  const msg = String(error?.message || "").toLowerCase();
  if (msg.includes("avatar_path") || msg.includes("avatar_rev")) {
    delete next.avatar_path;
    delete next.avatar_rev;
    changed = true;
  }
  if (msg.includes("name_color")) {
    delete next.name_color;
    changed = true;
  }
  return changed ? next : null;
}

export async function upsertProfile({
  userId,
  displayName,
  emoji,
  nameColor,
  avatarPath,
  avatarRev,
} = {}) {
  if (!isSupabaseConfigured() || !userId) return null;

  const name =
    displayName != null && String(displayName).trim()
      ? String(displayName).trim().slice(0, 24)
      : null;

  const colorPatch =
    nameColor !== undefined
      ? { name_color: nameColor || null }
      : {};
  const avatarPatch = {};
  if (avatarPath !== undefined) avatarPatch.avatar_path = avatarPath || null;
  if (avatarRev !== undefined) avatarPatch.avatar_rev = Number(avatarRev) || 0;

  if (name) {
    const row = {
      id: userId,
      display_name: name,
      ...colorPatch,
      ...avatarPatch,
    };
    if (emoji !== undefined) row.emoji = emoji || "👤";
    let { data, error } = await supabase.from("profiles").upsert(row).select().single();
    const stripped = dropMissingCosmeticColumns(row, error);
    if (error && stripped) {
      ({ data, error } = await supabase.from("profiles").upsert(stripped).select().single());
    }
    if (error) throw error;
    return data;
  }

  const patch = {};
  if (emoji != null) patch.emoji = emoji || "👤";
  Object.assign(patch, colorPatch, avatarPatch);
  if (!Object.keys(patch).length) return null;

  let { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", userId)
    .select()
    .single();
  const stripped = dropMissingCosmeticColumns(patch, error);
  if (error && stripped) {
    if (!Object.keys(stripped).length) return null;
    ({ data, error } = await supabase
      .from("profiles")
      .update(stripped)
      .eq("id", userId)
      .select()
      .single());
  }
  if (error) throw error;
  return data;
}

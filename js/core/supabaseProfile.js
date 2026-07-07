import { supabase, isSupabaseConfigured } from "./supabaseClient.js";

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

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, emoji")
    .eq("id", userId)
    .maybeSingle();

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

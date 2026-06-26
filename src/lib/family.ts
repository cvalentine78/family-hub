import { createClient } from "@/lib/supabase/server";

export type Family = {
  id: string;
  name: string;
  join_code: string;
  created_by: string;
  created_at: string;
};

// Returns the first family the current user belongs to, or null.
export async function getCurrentFamily(): Promise<Family | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("family_members")
    .select("families(*)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  // data.families is the joined family row
  return (data?.families as unknown as Family) ?? null;
}

export type Member = {
  user_id: string;
  role: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  status: string | null;
};

// Makes sure the current user has a profile row, defaulting the display
// name to the part of their email before the @.
export async function ensureProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (!existing) {
    const fallback = (user.email ?? "Member").split("@")[0];
    await supabase
      .from("profiles")
      .insert({ id: user.id, display_name: fallback, email: user.email });
  } else {
    // Keep the stored email in sync with the auth record.
    await supabase
      .from("profiles")
      .update({ email: user.email })
      .eq("id", user.id);
  }
}

type ProfileRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  status: string | null;
};

// Returns all members of a family with their full profile info.
export async function getFamilyMembers(familyId: string): Promise<Member[]> {
  const supabase = await createClient();

  const { data: members } = await supabase
    .from("family_members")
    .select("user_id, role")
    .eq("family_id", familyId);

  if (!members || members.length === 0) return [];

  const ids = members.map((m) => m.user_id);
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, display_name, email, phone, avatar_url, status")
    .in("id", ids);

  const byId = new Map(
    (profiles ?? []).map((p) => [p.id, p as ProfileRow])
  );

  return members.map((m) => {
    const p = byId.get(m.user_id);
    return {
      user_id: m.user_id,
      role: m.role,
      display_name: p?.display_name ?? "Member",
      email: p?.email ?? null,
      phone: p?.phone ?? null,
      avatar_url: p?.avatar_url ?? null,
      status: p?.status ?? null,
    };
  });
}

// Returns a single family member's profile (only if they share a family
// with the current user — enforced by RLS).
export async function getMemberProfile(
  familyId: string,
  userId: string
): Promise<Member | null> {
  const members = await getFamilyMembers(familyId);
  return members.find((m) => m.user_id === userId) ?? null;
}

// Returns whether the current user has location sharing enabled.
export async function getMyShareLocation(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data } = await supabase
    .from("profiles")
    .select("share_location")
    .eq("id", user.id)
    .maybeSingle();

  return data?.share_location ?? false;
}

// Generates a short, readable join code like "K7P2QX".
export function generateJoinCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

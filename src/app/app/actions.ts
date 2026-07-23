"use server";

import { createClient } from "@/lib/supabase/server";
import { generateJoinCode } from "@/lib/family";
import { isAdult, isPlausibleDateOfBirth } from "@/lib/age";
import {
  krogerConfigured,
  searchKrogerCatalog,
  type KrogerProduct,
} from "@/lib/kroger";
import { revalidatePath } from "next/cache";

// Whether the caller (by their own date_of_birth) is an adult. Never trust a
// submitted value for this — always looked up server-side from auth.uid().
async function callerIsAdult(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("profiles")
    .select("date_of_birth")
    .eq("id", userId)
    .maybeSingle();
  return isAdult(data?.date_of_birth ?? null);
}

// First-time date_of_birth capture: saves it (the write-once trigger accepts
// this first write) and creates the yearly all-day birthday event it implies.
// Year is just an anchor (does not need to match the real birth year).
// date_of_birth can never be set again after this, so a silently swallowed
// failure here would leave someone permanently stuck with no birthdate and
// no birthday event — every write is checked, same as the rest of this file.
async function saveDateOfBirthAndBirthdayEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  familyId: string,
  dateOfBirth: string
): Promise<{ error: string } | { success: true }> {
  const { error: dobError } = await supabase
    .from("profiles")
    .update({ date_of_birth: dateOfBirth })
    .eq("id", userId);
  if (dobError) return { error: dobError.message };

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", userId)
    .maybeSingle();
  const displayName = profile?.display_name ?? "Member";

  const [, month, day] = dateOfBirth.split("-").map(Number);
  const anchorYear = new Date().getFullYear();
  const startsAt = new Date(anchorYear, month - 1, day, 9, 0);
  const endsAt = new Date(anchorYear, month - 1, day, 10, 0);

  const { error: eventError } = await supabase.from("events").insert({
    family_id: familyId,
    title: `${displayName}'s Birthday 🎂`,
    all_day: true,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    recurrence: "yearly",
    recurrence_until: null,
    created_by: userId,
  });
  if (eventError) return { error: eventError.message };

  return { success: true };
}

export async function createFamily(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Please enter a family name." };

  const date_of_birth = String(formData.get("date_of_birth") || "").trim();
  if (!date_of_birth) return { error: "Please enter your date of birth." };
  if (!isPlausibleDateOfBirth(date_of_birth))
    return { error: "Please enter a valid date of birth." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Try a few times in case of a join_code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateJoinCode();
    const { data: familyId, error } = await supabase.rpc("create_family", {
      family_name: name,
      code,
    });

    if (error) {
      if (error.code === "23505") continue; // unique join_code, retry
      return { error: error.message };
    }

    const dobResult = await saveDateOfBirthAndBirthdayEvent(
      supabase,
      user.id,
      familyId as string,
      date_of_birth
    );
    if ("error" in dobResult) return { error: dobResult.error };

    revalidatePath("/app");
    return { success: true };
  }

  return { error: "Could not generate a unique code. Please try again." };
}

export async function createEvent(formData: FormData) {
  const family_id = String(formData.get("family_id") || "");
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const location = String(formData.get("location") || "").trim();
  const all_day = formData.get("all_day") === "on";
  const alarm_reminder = formData.get("alarm_reminder") === "on";
  const starts_at = String(formData.get("starts_at") || "");
  const ends_at = String(formData.get("ends_at") || "");
  const recurrence = String(formData.get("recurrence") || "none");
  const recurrence_until = String(formData.get("recurrence_until") || "");

  if (!title) return { error: "Please enter a title." };
  if (!starts_at) return { error: "Please pick a start time." };

  const validRecurrence = ["none", "daily", "weekly", "monthly", "yearly"];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const isAdultCaller = await callerIsAdult(supabase, user.id);

  const { data: created, error } = await supabase
    .from("events")
    .insert({
      family_id,
      title,
      description: description || null,
      location: location || null,
      all_day,
      alarm_reminder: isAdultCaller ? alarm_reminder : false,
      starts_at: new Date(starts_at).toISOString(),
      ends_at: new Date(ends_at || starts_at).toISOString(),
      recurrence: validRecurrence.includes(recurrence) ? recurrence : "none",
      recurrence_until:
        recurrence !== "none" && recurrence_until ? recurrence_until : null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Reminders (shared across the family). Submitted as repeated "reminders"
  // fields holding minutes-before values; the dispatcher fires them.
  const reminders = [
    ...new Set(
      formData
        .getAll("reminders")
        .map((v) => parseInt(String(v), 10))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 40320) // <= 4 weeks
    ),
  ];
  if (created && reminders.length) {
    await supabase
      .from("event_reminders")
      .insert(reminders.map((m) => ({ event_id: created.id, minutes_before: m })));
  }

  // Attendee tags (informational only — zero rows means "everyone", see
  // updateEvent for the same rule). Submitted as repeated "attendees" fields
  // holding user_id strings.
  const attendees = [...new Set(formData.getAll("attendees").map(String))];
  if (created && attendees.length) {
    await supabase
      .from("event_attendees")
      .insert(attendees.map((user_id) => ({ event_id: created.id, user_id })));
  }

  revalidatePath("/app");
  return { success: true };
}

export async function updateEvent(formData: FormData) {
  const id = String(formData.get("id") || "");
  const title = String(formData.get("title") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const location = String(formData.get("location") || "").trim();
  const all_day = formData.get("all_day") === "on";
  const alarm_reminder = formData.get("alarm_reminder") === "on";
  const starts_at = String(formData.get("starts_at") || "");
  const ends_at = String(formData.get("ends_at") || "");
  const recurrence = String(formData.get("recurrence") || "none");
  const recurrence_until = String(formData.get("recurrence_until") || "");

  if (!id) return { error: "Missing event." };
  if (!title) return { error: "Please enter a title." };
  if (!starts_at) return { error: "Please pick a start time." };

  const validRecurrence = ["none", "daily", "weekly", "monthly", "yearly"];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const isAdultCaller = await callerIsAdult(supabase, user.id);

  const { error } = await supabase
    .from("events")
    .update({
      title,
      description: description || null,
      location: location || null,
      all_day,
      ...(isAdultCaller ? { alarm_reminder } : {}),
      starts_at: new Date(starts_at).toISOString(),
      ends_at: new Date(ends_at || starts_at).toISOString(),
      recurrence: validRecurrence.includes(recurrence) ? recurrence : "none",
      recurrence_until:
        recurrence !== "none" && recurrence_until ? recurrence_until : null,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  // Replace the event's reminders with the submitted set.
  const reminders = [
    ...new Set(
      formData
        .getAll("reminders")
        .map((v) => parseInt(String(v), 10))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 40320) // <= 4 weeks
    ),
  ];
  await supabase.from("event_reminders").delete().eq("event_id", id);
  if (reminders.length) {
    await supabase
      .from("event_reminders")
      .insert(reminders.map((m) => ({ event_id: id, minutes_before: m })));
  }

  // Replace the event's attendee tags with the submitted set. An empty
  // submitted list naturally results in zero rows after this delete with
  // nothing re-inserted — that's what makes selecting "Everyone" work
  // correctly (zero rows = everyone, never insert one row per member).
  const attendees = [...new Set(formData.getAll("attendees").map(String))];
  await supabase.from("event_attendees").delete().eq("event_id", id);
  if (attendees.length) {
    await supabase
      .from("event_attendees")
      .insert(attendees.map((user_id) => ({ event_id: id, user_id })));
  }

  revalidatePath("/app");
  return { success: true };
}

export async function updateDisplayName(formData: FormData) {
  const display_name = String(formData.get("display_name") || "").trim();
  if (!display_name) return { error: "Please enter a name." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, display_name });

  if (error) return { error: error.message };

  revalidatePath("/app/members");
  return { success: true };
}

export async function updateProfile(formData: FormData) {
  const display_name = String(formData.get("display_name") || "").trim();
  const phone = String(formData.get("phone") || "").trim();
  const status = String(formData.get("status") || "").trim();
  const avatar_url = String(formData.get("avatar_url") || "").trim();

  if (!display_name) return { error: "Please enter a name." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name,
      phone: phone || null,
      status: status || null,
      ...(avatar_url ? { avatar_url } : {}),
    })
    .eq("id", user.id);

  if (error) return { error: error.message };

  revalidatePath("/app/members");
  revalidatePath(`/app/members/${user.id}`);
  return { success: true };
}

export async function sendMessage(conversationId: string, body: string) {
  const text = body.trim();
  if (!text) return { error: "Empty message." };
  if (text.length > 2000) return { error: "Message too long." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.from("messages").insert({
    conversation_id: conversationId,
    user_id: user.id,
    body: text,
  });

  if (error) return { error: error.message };
  return { success: true };
}

export async function openGroupConversation(familyId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_or_create_group_conversation", {
    fam: familyId,
  });
  if (error) return { error: error.message };
  return { success: true, conversationId: data as string };
}

export async function openDirectConversation(
  familyId: string,
  otherUserId: string
) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "get_or_create_direct_conversation",
    { fam: familyId, other: otherUserId }
  );
  if (error) return { error: error.message };
  return { success: true, conversationId: data as string };
}

// ----- Grocery list -----

export async function addGroceryItem(
  familyId: string,
  name: string,
  quantity: string,
  unit: string = "",
  price: number | null = null
) {
  const text = name.trim();
  if (!text) return { error: "Enter an item." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.from("grocery_items").insert({
    family_id: familyId,
    name: text,
    quantity: quantity.trim() || null,
    unit: unit.trim() || null,
    price,
    added_by: user.id,
  });
  if (error) return { error: error.message };
  return { success: true };
}

// Live product suggestions from the Kroger catalog for the shopping list's
// add box. Signed-in family members only (protects our daily API quota).
// Returns [] whenever Kroger isn't configured or the lookup fails, so the
// list works fine without it.
export async function searchStoreProducts(
  term: string
): Promise<KrogerProduct[]> {
  const q = term.trim();
  if (q.length < 3) return [];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  if (!krogerConfigured()) return [];
  try {
    return await searchKrogerCatalog(q);
  } catch {
    return [];
  }
}

export async function toggleGroceryItem(id: string, isChecked: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("grocery_items")
    .update({ is_checked: isChecked })
    .eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function deleteGroceryItem(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("grocery_items").delete().eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

// Parse a leading whole number out of a free-text quantity ("2 gallons" -> 2).
function parseQuantity(q: string | null): number {
  if (!q) return 1;
  const m = q.match(/\d+/);
  const n = m ? parseInt(m[0], 10) : 1;
  return n > 0 ? n : 1;
}

// "Bought it": move a grocery item into the inventory, then remove it
// from the shopping list.
export async function checkOffGroceryItem(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: item } = await supabase
    .from("grocery_items")
    .select("family_id, name, quantity")
    .eq("id", id)
    .maybeSingle();
  if (!item) return { error: "Item not found." };

  const amount = parseQuantity(item.quantity);

  // Atomic upsert-with-guard: single INSERT ... ON CONFLICT DO UPDATE against
  // the (family_id, lower(name)) unique index, so two concurrent checkoffs of
  // the same item name can't each miss the other's in-flight row.
  await supabase.rpc("upsert_inventory_on_checkoff", {
    p_family_id: item.family_id,
    p_name: item.name,
    p_amount: amount,
  });

  await supabase.from("grocery_items").delete().eq("id", id);
  return { success: true };
}

export async function clearCheckedGroceryItems(familyId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("grocery_items")
    .delete()
    .eq("family_id", familyId)
    .eq("is_checked", true);
  if (error) return { error: error.message };
  return { success: true };
}

// ----- Inventory -----

export async function addInventoryItem(
  familyId: string,
  name: string,
  quantity: number,
  category: string,
  size: string = ""
) {
  const text = name.trim();
  if (!text) return { error: "Enter an item." };

  const supabase = await createClient();
  const { error } = await supabase.from("inventory_items").insert({
    family_id: familyId,
    name: text,
    quantity: Math.max(0, quantity),
    category: category.trim() || null,
    size: size.trim() || null,
  });
  if (error) return { error: error.message };
  return { success: true };
}

// If an inventory item is at or below its threshold, make sure it's on the
// shopping list (without creating duplicates).
async function autoListIfLow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  itemId: string
) {
  const { data: item } = await supabase
    .from("inventory_items")
    .select("family_id, name, quantity, threshold")
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return;
  if (item.quantity > item.threshold) return;

  // Atomic upsert-with-guard: single INSERT ... ON CONFLICT DO NOTHING against
  // the (family_id, lower(name)) unique index, so two concurrent low-stock
  // triggers for the same item name can't both insert a duplicate.
  await supabase.rpc("insert_grocery_item_if_missing", {
    p_family_id: item.family_id,
    p_name: item.name,
    p_added_by: userId,
  });
}

export async function updateInventoryQuantity(id: string, quantity: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("inventory_items")
    .update({ quantity: Math.max(0, quantity), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  await autoListIfLow(supabase, user.id, id);
  return { success: true };
}

// Scan → create a brand-new inventory item and remember this barcode for it.
export async function createScannedItem(
  familyId: string,
  barcode: string,
  name: string,
  category: string,
  size: string = "",
  quantity: number = 1
) {
  const text = name.trim();
  if (!text) return { error: "Enter a name." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: item, error } = await supabase
    .from("inventory_items")
    .insert({
      family_id: familyId,
      name: text,
      quantity: Math.max(1, quantity),
      category: category.trim() || null,
      size: size.trim() || null,
      barcode: barcode.trim() || null,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };

  const code = barcode.trim();
  if (code) {
    await supabase
      .from("inventory_barcodes")
      .insert({ family_id: familyId, barcode: code, item_id: item.id });
  }
  return { success: true };
}

// Scan → add this barcode to an EXISTING item (e.g. another brand of the same
// thing) and bump that item's quantity.
export async function linkScanToItem(
  familyId: string,
  barcode: string,
  itemId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const code = barcode.trim();
  if (code) {
    await supabase
      .from("inventory_barcodes")
      .insert({ family_id: familyId, barcode: code, item_id: itemId });
  }

  // Atomic single UPDATE ... SET quantity = quantity + 1, so two concurrent
  // scans of the same item can't both read the same stale quantity.
  await supabase.rpc("increment_inventory_quantity", {
    p_item_id: itemId,
    p_delta: 1,
  });
  return { success: true };
}

export async function updateInventoryDetails(
  id: string,
  name: string,
  size: string,
  category: string
) {
  const text = name.trim();
  if (!text) return { error: "Enter a name." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("inventory_items")
    .update({
      name: text,
      size: size.trim() || null,
      category: category.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function updateInventoryThreshold(id: string, threshold: number) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("inventory_items")
    .update({ threshold: Math.max(0, threshold) })
    .eq("id", id);
  if (error) return { error: error.message };

  await autoListIfLow(supabase, user.id, id);
  return { success: true };
}

export async function deleteInventoryItem(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("inventory_items")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

// Add an inventory item's name to the shopping list (e.g. when running low).
export async function addInventoryToGrocery(familyId: string, name: string) {
  return addGroceryItem(familyId, name, "");
}

// ----- Meals (dish library) -----

export async function createDish(
  familyId: string,
  details: {
    name: string;
    cookId?: string | null;
    notes?: string;
    recipeUrl?: string;
    recipeFileUrl?: string;
  }
) {
  const text = details.name.trim();
  if (!text) return { error: "Enter a meal name." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data, error } = await supabase
    .from("dishes")
    .insert({
      family_id: familyId,
      name: text,
      cook_id: details.cookId || null,
      notes: details.notes?.trim() || null,
      recipe_url: details.recipeUrl?.trim() || null,
      recipe_file_url: details.recipeFileUrl?.trim() || null,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { success: true, id: data.id as string };
}

export async function deleteDish(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("dishes").delete().eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function toggleDishFavorite(familyId: string, dishId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: existing } = await supabase
    .from("dish_favorites")
    .select("user_id")
    .eq("dish_id", dishId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("dish_favorites")
      .delete()
      .eq("dish_id", dishId)
      .eq("user_id", user.id);
    return { success: true, favorited: false };
  }

  const { error } = await supabase.from("dish_favorites").insert({
    dish_id: dishId,
    family_id: familyId,
    user_id: user.id,
  });
  if (error) return { error: error.message };
  return { success: true, favorited: true };
}

export async function addDishIngredient(
  familyId: string,
  dishId: string,
  ingredient: string,
  quantity: number
) {
  const text = ingredient.trim();
  if (!text) return { error: "Enter an ingredient." };

  const supabase = await createClient();
  const { error } = await supabase.from("dish_ingredients").insert({
    family_id: familyId,
    dish_id: dishId,
    ingredient: text,
    quantity: Math.max(1, quantity),
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function deleteDishIngredient(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("dish_ingredients")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

// Add a list of ingredient names to the shopping list (the "go to the store"
// action when inventory is short).
export async function addMissingToGroceryList(
  familyId: string,
  items: { name: string; quantity: number }[]
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  for (const item of items) {
    const name = item.name.trim();
    if (!name) continue;
    // Skip if it's already on the list.
    const { data: existing } = await supabase
      .from("grocery_items")
      .select("id")
      .eq("family_id", familyId)
      .ilike("name", name)
      .maybeSingle();
    if (existing) continue;

    await supabase.from("grocery_items").insert({
      family_id: familyId,
      name,
      quantity: item.quantity > 1 ? String(item.quantity) : null,
      added_by: user.id,
    });
  }
  return { success: true };
}

// ----- Dinner suggestions -----

export async function addSuggestion(familyId: string, text: string) {
  const t = text.trim();
  if (!t) return { error: "Enter an idea." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.from("dinner_suggestions").insert({
    family_id: familyId,
    text: t,
    suggested_by: user.id,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function deleteSuggestion(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("dinner_suggestions")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function toggleSuggestionVote(
  familyId: string,
  suggestionId: string
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: existing } = await supabase
    .from("dinner_suggestion_votes")
    .select("user_id")
    .eq("suggestion_id", suggestionId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("dinner_suggestion_votes")
      .delete()
      .eq("suggestion_id", suggestionId)
      .eq("user_id", user.id);
    return { success: true, voted: false };
  }

  const { error } = await supabase.from("dinner_suggestion_votes").insert({
    suggestion_id: suggestionId,
    family_id: familyId,
    user_id: user.id,
  });
  if (error) return { error: error.message };
  return { success: true, voted: true };
}

// ----- Meal log (occurrences / leftovers) -----

export async function logMeal(
  familyId: string,
  dishId: string,
  dishName: string,
  madeOn: string,
  hasLeftovers: boolean
) {
  if (!dishId) return { error: "Pick a meal." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Create an all-day calendar event for the dinner (noon avoids day shifts).
  const startIso = new Date(`${madeOn}T12:00:00`).toISOString();
  const { data: event } = await supabase
    .from("events")
    .insert({
      family_id: familyId,
      title: `🍽️ ${dishName}`,
      all_day: true,
      starts_at: startIso,
      ends_at: startIso,
      created_by: user.id,
    })
    .select("id")
    .single();

  const { error } = await supabase.from("meal_log").insert({
    family_id: familyId,
    dish_id: dishId,
    made_on: madeOn,
    has_leftovers: hasLeftovers,
    event_id: event?.id ?? null,
    created_by: user.id,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function setMealLeftovers(id: string, hasLeftovers: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("meal_log")
    .update({ has_leftovers: hasLeftovers })
    .eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function deleteMealLog(id: string) {
  const supabase = await createClient();
  const { data: entry } = await supabase
    .from("meal_log")
    .select("event_id")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("meal_log").delete().eq("id", id);
  if (error) return { error: error.message };

  if (entry?.event_id) {
    await supabase.from("events").delete().eq("id", entry.event_id);
  }
  return { success: true };
}

export async function setShareLocation(enabled: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase
    .from("profiles")
    .update({ share_location: enabled })
    .eq("id", user.id);

  if (error) return { error: error.message };

  // Turning sharing off removes your last known location from the map.
  if (!enabled) {
    await supabase.from("locations").delete().eq("user_id", user.id);
  }

  revalidatePath("/app");
  revalidatePath("/app/map");
  return { success: true };
}

export async function deleteEvent(formData: FormData) {
  const id = String(formData.get("id") || "");
  const supabase = await createClient();
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/app");
  return { success: true };
}

export async function joinFamily(formData: FormData) {
  const code = String(formData.get("code") || "")
    .trim()
    .toUpperCase();
  if (!code) return { error: "Please enter a join code." };

  const date_of_birth = String(formData.get("date_of_birth") || "").trim();
  if (!date_of_birth) return { error: "Please enter your date of birth." };
  if (!isPlausibleDateOfBirth(date_of_birth))
    return { error: "Please enter a valid date of birth." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { data: familyId, error } = await supabase.rpc("join_family_by_code", {
    code,
  });

  if (error) {
    if (error.message.includes("NO_FAMILY")) {
      return { error: "No family found with that code." };
    }
    return { error: error.message };
  }

  const dobResult = await saveDateOfBirthAndBirthdayEvent(
    supabase,
    user.id,
    familyId as string,
    date_of_birth
  );
  if ("error" in dobResult) return { error: dobResult.error };

  revalidatePath("/app");
  return { success: true };
}

// ----- Projects -----

export async function addProject(
  familyId: string,
  category: string,
  name: string
) {
  const text = name.trim();
  if (!text) return { error: "Enter a project name." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.from("projects").insert({
    family_id: familyId,
    category: category.trim() || "Other",
    name: text,
    created_by: user.id,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function updateProjectStatus(id: string, status: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function updateProjectDetails(
  id: string,
  fields: {
    notes: string;
    materials: string[];
    next_step: string;
    next_step_date: string | null;
  }
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({
      notes: fields.notes.trim() || null,
      materials: fields.materials.map((m) => m.trim()).filter(Boolean),
      next_step: fields.next_step.trim() || null,
      next_step_date: fields.next_step_date || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function deleteProject(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function addProjectTask(
  familyId: string,
  projectId: string,
  text: string
) {
  const trimmed = text.trim();
  if (!trimmed) return { error: "Enter a task." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.from("project_tasks").insert({
    family_id: familyId,
    project_id: projectId,
    text: trimmed,
    created_by: user.id,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function toggleProjectTask(id: string, isChecked: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_tasks")
    .update({ is_checked: isChecked })
    .eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function deleteProjectTask(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("project_tasks")
    .delete()
    .eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

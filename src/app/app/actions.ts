"use server";

import { createClient } from "@/lib/supabase/server";
import { generateJoinCode } from "@/lib/family";
import { revalidatePath } from "next/cache";

export async function createFamily(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Please enter a family name." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  // Try a few times in case of a join_code collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateJoinCode();
    const { error } = await supabase.rpc("create_family", {
      family_name: name,
      code,
    });

    if (error) {
      if (error.code === "23505") continue; // unique join_code, retry
      return { error: error.message };
    }

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

  const { error } = await supabase.from("events").insert({
    family_id,
    title,
    description: description || null,
    location: location || null,
    all_day,
    starts_at: new Date(starts_at).toISOString(),
    ends_at: new Date(ends_at || starts_at).toISOString(),
    recurrence: validRecurrence.includes(recurrence) ? recurrence : "none",
    recurrence_until:
      recurrence !== "none" && recurrence_until ? recurrence_until : null,
    created_by: user.id,
  });

  if (error) return { error: error.message };

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
  unit: string = ""
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
    added_by: user.id,
  });
  if (error) return { error: error.message };
  return { success: true };
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

  // Merge into an existing inventory item of the same name, else create one.
  const { data: existing } = await supabase
    .from("inventory_items")
    .select("id, quantity")
    .eq("family_id", item.family_id)
    .ilike("name", item.name)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("inventory_items")
      .update({
        quantity: existing.quantity + amount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("inventory_items").insert({
      family_id: item.family_id,
      name: item.name,
      quantity: amount,
    });
  }

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

  const { data: existing } = await supabase
    .from("grocery_items")
    .select("id")
    .eq("family_id", item.family_id)
    .ilike("name", item.name)
    .maybeSingle();
  if (existing) return;

  await supabase.from("grocery_items").insert({
    family_id: item.family_id,
    name: item.name,
    added_by: userId,
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
  size: string = ""
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
      quantity: 1,
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

  const { data: item } = await supabase
    .from("inventory_items")
    .select("quantity")
    .eq("id", itemId)
    .maybeSingle();
  if (item) {
    await supabase
      .from("inventory_items")
      .update({
        quantity: item.quantity + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", itemId);
  }
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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in." };

  const { error } = await supabase.rpc("join_family_by_code", { code });

  if (error) {
    if (error.message.includes("NO_FAMILY")) {
      return { error: "No family found with that code." };
    }
    return { error: error.message };
  }

  revalidatePath("/app");
  return { success: true };
}

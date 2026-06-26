import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFamily, getFamilyMembers } from "@/lib/family";
import Nav from "../Nav";
import GroceriesTabs from "./GroceriesTabs";
import type { GroceryItem } from "./ShoppingList";
import type { InventoryItem } from "./InventoryList";
import type {
  Dish,
  DishIngredient,
  DishFavorite,
  MealLogEntry,
  Suggestion,
  SuggestionVote,
} from "./mealTypes";

export default async function GroceriesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const family = await getCurrentFamily();
  if (!family) redirect("/app");

  const { data: grocery } = await supabase
    .from("grocery_items")
    .select("id, name, quantity, unit, is_checked, created_at")
    .eq("family_id", family.id);

  const { data: inventory } = await supabase
    .from("inventory_items")
    .select("id, name, quantity, category, threshold, barcode, created_at")
    .eq("family_id", family.id);

  const { data: dishes } = await supabase
    .from("dishes")
    .select("id, name, cook_id, recipe_url, recipe_file_url, notes, created_at")
    .eq("family_id", family.id);

  const { data: ingredients } = await supabase
    .from("dish_ingredients")
    .select("id, dish_id, ingredient, quantity")
    .eq("family_id", family.id);

  const { data: favorites } = await supabase
    .from("dish_favorites")
    .select("dish_id, user_id")
    .eq("family_id", family.id);

  const { data: mealLog } = await supabase
    .from("meal_log")
    .select("id, dish_id, made_on, has_leftovers, created_at")
    .eq("family_id", family.id);

  const { data: suggestions } = await supabase
    .from("dinner_suggestions")
    .select("id, text, suggested_by, created_at")
    .eq("family_id", family.id);

  const { data: suggestionVotes } = await supabase
    .from("dinner_suggestion_votes")
    .select("suggestion_id, user_id")
    .eq("family_id", family.id);

  const members = await getFamilyMembers(family.id);

  return (
    <div className="max-w-[1320px] mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Groceries</h1>
          <p className="text-sm text-gray-500">{family.name}</p>
        </div>
        <Nav />
      </div>

      <GroceriesTabs
        familyId={family.id}
        currentUserId={user.id}
        members={members}
        groceryItems={(grocery as GroceryItem[]) ?? []}
        inventoryItems={(inventory as InventoryItem[]) ?? []}
        dishes={(dishes as Dish[]) ?? []}
        ingredients={(ingredients as DishIngredient[]) ?? []}
        favorites={(favorites as DishFavorite[]) ?? []}
        mealLog={(mealLog as MealLogEntry[]) ?? []}
        suggestions={(suggestions as Suggestion[]) ?? []}
        suggestionVotes={(suggestionVotes as SuggestionVote[]) ?? []}
      />
    </div>
  );
}

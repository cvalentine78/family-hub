"use client";

import { useState } from "react";
import ShoppingList, { type GroceryItem } from "./ShoppingList";
import InventoryList, {
  type InventoryItem,
  type BarcodeAlias,
} from "./InventoryList";
import MealsList from "./MealsList";
import LeftoversList from "./LeftoversList";
import type { Member } from "@/lib/family";
import type {
  Dish,
  DishIngredient,
  DishFavorite,
  MealLogEntry,
  Suggestion,
  SuggestionVote,
} from "./mealTypes";

export default function GroceriesTabs({
  familyId,
  currentUserId,
  members,
  groceryItems,
  inventoryItems,
  inventoryAliases,
  dishes,
  ingredients,
  favorites,
  mealLog,
  suggestions: dinnerSuggestions,
  suggestionVotes,
}: {
  familyId: string;
  currentUserId: string;
  members: Member[];
  groceryItems: GroceryItem[];
  inventoryItems: InventoryItem[];
  inventoryAliases: BarcodeAlias[];
  dishes: Dish[];
  ingredients: DishIngredient[];
  favorites: DishFavorite[];
  mealLog: MealLogEntry[];
  suggestions: Suggestion[];
  suggestionVotes: SuggestionVote[];
}) {
  type Tab = "list" | "inventory" | "meals" | "leftovers";
  const [tab, setTabState] = useState<Tab>("list");
  // Only mount a tab's component once it's been opened; keep it mounted after
  // so its state and live subscriptions survive later tab switches.
  const [visited, setVisited] = useState<Set<Tab>>(new Set(["list"]));
  function setTab(next: Tab) {
    setTabState(next);
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  }

  // Autocomplete suggestions for the shopping list: inventory + ingredient names.
  const suggestions = Array.from(
    new Set([
      ...inventoryItems.map((i) => i.name),
      ...ingredients.map((i) => i.ingredient),
    ])
  ).sort((a, b) => a.localeCompare(b));

  const tabClass = (active: boolean) =>
    `flex-1 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
      active ? "bg-white shadow text-sky-700" : "text-gray-500"
    }`;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <div className="flex rounded-lg bg-gray-100 p-1 mb-5 w-full max-w-xl">
        <button onClick={() => setTab("list")} className={tabClass(tab === "list")}>
          🛒 Shopping
        </button>
        <button
          onClick={() => setTab("inventory")}
          className={tabClass(tab === "inventory")}
        >
          📦 Inventory
        </button>
        <button onClick={() => setTab("meals")} className={tabClass(tab === "meals")}>
          🍽️ Meals
        </button>
        <button
          onClick={() => setTab("leftovers")}
          className={tabClass(tab === "leftovers")}
        >
          🥡 Leftovers
        </button>
      </div>

      {/* Each tab mounts on first open, then stays mounted (hidden) so its
          state and live updates survive switching. */}
      <div className={tab === "list" ? "" : "hidden"}>
        <ShoppingList
          familyId={familyId}
          initialItems={groceryItems}
          suggestions={suggestions}
        />
      </div>
      {visited.has("inventory") && (
        <div className={tab === "inventory" ? "" : "hidden"}>
          <InventoryList
            familyId={familyId}
            initialItems={inventoryItems}
            initialAliases={inventoryAliases}
          />
        </div>
      )}
      {visited.has("meals") && (
        <div className={tab === "meals" ? "" : "hidden"}>
          <MealsList
            familyId={familyId}
            currentUserId={currentUserId}
            members={members}
            initialDishes={dishes}
            initialIngredients={ingredients}
            initialFavorites={favorites}
            initialLog={mealLog}
            initialInventory={inventoryItems}
            initialSuggestions={dinnerSuggestions}
            initialVotes={suggestionVotes}
          />
        </div>
      )}
      {visited.has("leftovers") && (
        <div className={tab === "leftovers" ? "" : "hidden"}>
          <LeftoversList
            familyId={familyId}
            currentUserId={currentUserId}
            members={members}
            initialDishes={dishes}
            initialLog={mealLog}
          />
        </div>
      )}
    </div>
  );
}

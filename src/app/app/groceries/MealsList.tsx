"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  createDish,
  deleteDish,
  toggleDishFavorite,
  addDishIngredient,
  deleteDishIngredient,
  addMissingToGroceryList,
  addSuggestion,
  deleteSuggestion,
  toggleSuggestionVote,
} from "../actions";
import type { Member } from "@/lib/family";
import type {
  Dish,
  DishIngredient,
  DishFavorite,
  MealLogEntry,
  InventoryLite,
  Suggestion,
  SuggestionVote,
} from "./mealTypes";

function prettyDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export default function MealsList({
  familyId,
  currentUserId,
  members,
  initialDishes,
  initialIngredients,
  initialFavorites,
  initialLog,
  initialInventory,
  initialSuggestions,
  initialVotes,
}: {
  familyId: string;
  currentUserId: string;
  members: Member[];
  initialDishes: Dish[];
  initialIngredients: DishIngredient[];
  initialFavorites: DishFavorite[];
  initialLog: MealLogEntry[];
  initialInventory: InventoryLite[];
  initialSuggestions: Suggestion[];
  initialVotes: SuggestionVote[];
}) {
  const [dishes, setDishes] = useState<Dish[]>(initialDishes);
  const [ingredients, setIngredients] = useState<DishIngredient[]>(
    initialIngredients
  );
  const [favorites, setFavorites] = useState<DishFavorite[]>(initialFavorites);
  const [log] = useState<MealLogEntry[]>(initialLog);
  const [inventory, setInventory] = useState<InventoryLite[]>(initialInventory);
  const [suggestions, setSuggestions] = useState<Suggestion[]>(
    initialSuggestions
  );
  const [votes, setVotes] = useState<SuggestionVote[]>(initialVotes);
  const [suggestInput, setSuggestInput] = useState("");

  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [canMakeOpen, setCanMakeOpen] = useState(false);
  const [cmIndex, setCmIndex] = useState(0);

  // New-dish form.
  const [name, setName] = useState("");
  const [cookId, setCookId] = useState(currentUserId);
  const [notes, setNotes] = useState("");
  const [recipeUrl, setRecipeUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  // Ingredients being added with a new meal.
  const [formIngredients, setFormIngredients] = useState<
    { ingredient: string; quantity: number }[]
  >([]);
  const [formIng, setFormIng] = useState("");
  const [formIngQty, setFormIngQty] = useState(1);

  // Per-dish ingredient input (editing an existing meal).
  const [ingInput, setIngInput] = useState("");
  const [ingQty, setIngQty] = useState(1);

  const memberById = new Map(members.map((m) => [m.user_id, m]));

  function useRealtime(
    table: string,
    setter: React.Dispatch<React.SetStateAction<any[]>>,
    idField: string
  ) {
    useEffect(() => {
      const supabase = createClient();
      const channel = supabase
        .channel(`${table}:${familyId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table,
            filter: `family_id=eq.${familyId}`,
          },
          (payload) => {
            setter((prev) => {
              if (payload.eventType === "DELETE") {
                const oldRow = payload.old as Record<string, unknown>;
                return prev.filter((r) => r[idField] !== oldRow[idField]);
              }
              const row = payload.new as Record<string, unknown>;
              const exists = prev.some((r) => r[idField] === row[idField]);
              if (exists)
                return prev.map((r) => (r[idField] === row[idField] ? row : r));
              return [...prev, row];
            });
          }
        )
        .subscribe();
      return () => {
        supabase.removeChannel(channel);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [familyId]);
  }

  useRealtime("dishes", setDishes as never, "id");
  useRealtime("dish_ingredients", setIngredients as never, "id");
  useRealtime("inventory_items", setInventory as never, "id");
  useRealtime("dinner_suggestions", setSuggestions as never, "id");

  // Suggestion votes keyed by composite (suggestion_id+user) — handle manually.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`sugvote:${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dinner_suggestion_votes",
          filter: `family_id=eq.${familyId}`,
        },
        (payload) => {
          setVotes((prev) => {
            if (payload.eventType === "DELETE") {
              const old = payload.old as SuggestionVote;
              return prev.filter(
                (v) =>
                  !(
                    v.suggestion_id === old.suggestion_id &&
                    v.user_id === old.user_id
                  )
              );
            }
            const row = payload.new as SuggestionVote;
            const exists = prev.some(
              (v) =>
                v.suggestion_id === row.suggestion_id && v.user_id === row.user_id
            );
            return exists ? prev : [...prev, row];
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [familyId]);

  // Favorites keyed by composite (dish_id+user) — handle manually.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`fav:${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dish_favorites",
          filter: `family_id=eq.${familyId}`,
        },
        (payload) => {
          setFavorites((prev) => {
            if (payload.eventType === "DELETE") {
              const old = payload.old as DishFavorite;
              return prev.filter(
                (f) => !(f.dish_id === old.dish_id && f.user_id === old.user_id)
              );
            }
            const row = payload.new as DishFavorite;
            const exists = prev.some(
              (f) => f.dish_id === row.dish_id && f.user_id === row.user_id
            );
            return exists ? prev : [...prev, row];
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [familyId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);

    let recipeFileUrl = "";
    if (file) {
      const supabase = createClient();
      const ext = file.name.split(".").pop() || "dat";
      const path = `${currentUserId}/recipe-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("recipes")
        .upload(path, file, { upsert: true });
      if (!upErr) {
        recipeFileUrl = supabase.storage.from("recipes").getPublicUrl(path)
          .data.publicUrl;
      }
    }

    const res = await createDish(familyId, {
      name,
      cookId,
      notes,
      recipeUrl,
      recipeFileUrl,
    });

    // Save the ingredients that were added with the meal.
    if (res?.id) {
      for (const ing of formIngredients) {
        await addDishIngredient(familyId, res.id, ing.ingredient, ing.quantity);
      }
    }

    setName("");
    setNotes("");
    setRecipeUrl("");
    setFile(null);
    setFormIngredients([]);
    setFormIng("");
    setFormIngQty(1);
    setBusy(false);
  }

  function addFormIngredient() {
    const ing = formIng.trim();
    if (!ing) return;
    setFormIngredients((prev) => [...prev, { ingredient: ing, quantity: formIngQty }]);
    setFormIng("");
    setFormIngQty(1);
  }

  function removeFormIngredient(idx: number) {
    setFormIngredients((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleFavorite(dishId: string) {
    const mine = favorites.some(
      (f) => f.dish_id === dishId && f.user_id === currentUserId
    );
    setFavorites((prev) =>
      mine
        ? prev.filter(
            (f) => !(f.dish_id === dishId && f.user_id === currentUserId)
          )
        : [...prev, { dish_id: dishId, user_id: currentUserId }]
    );
    await toggleDishFavorite(familyId, dishId);
  }

  async function handleAddIngredient(dishId: string) {
    const ing = ingInput.trim();
    if (!ing) return;
    setIngInput("");
    const q = ingQty;
    setIngQty(1);
    await addDishIngredient(familyId, dishId, ing, q);
  }

  async function handleAddSuggestion(e: React.FormEvent) {
    e.preventDefault();
    const t = suggestInput.trim();
    if (!t) return;
    setSuggestInput("");
    await addSuggestion(familyId, t);
  }

  async function handleVote(suggestionId: string) {
    const mine = votes.some(
      (v) => v.suggestion_id === suggestionId && v.user_id === currentUserId
    );
    setVotes((prev) =>
      mine
        ? prev.filter(
            (v) =>
              !(v.suggestion_id === suggestionId && v.user_id === currentUserId)
          )
        : [...prev, { suggestion_id: suggestionId, user_id: currentUserId }]
    );
    await toggleSuggestionVote(familyId, suggestionId);
  }

  // Inventory on-hand by lowercased name.
  const invByName = new Map<string, number>();
  for (const it of inventory) {
    invByName.set(it.name.trim().toLowerCase(), it.quantity);
  }

  function checkDish(dishId: string) {
    const list = ingredients.filter((i) => i.dish_id === dishId);
    const results = list.map((i) => {
      const have = invByName.get(i.ingredient.trim().toLowerCase()) ?? 0;
      return { ...i, have, ok: have >= i.quantity };
    });
    return { results, missing: results.filter((r) => !r.ok) };
  }

  function memberName(id: string | null) {
    if (!id) return null;
    return memberById.get(id)?.display_name ?? "Member";
  }

  // Frequency from the meal log.
  const freq = new Map<string, { count: number; last: string }>();
  for (const e of log) {
    const cur = freq.get(e.dish_id);
    if (cur) {
      cur.count += 1;
      if (e.made_on > cur.last) cur.last = e.made_on;
    } else {
      freq.set(e.dish_id, { count: 1, last: e.made_on });
    }
  }

  const favCount = new Map<string, string[]>();
  for (const f of favorites) {
    const list = favCount.get(f.dish_id) ?? [];
    list.push(f.user_id);
    favCount.set(f.dish_id, list);
  }

  const term = search.trim().toLowerCase();
  const visible = dishes
    .filter((d) => !term || d.name.toLowerCase().includes(term))
    .sort((a, b) => {
      const fa = (favCount.get(a.id) ?? []).length;
      const fb = (favCount.get(b.id) ?? []).length;
      return fb - fa || a.name.localeCompare(b.name);
    });

  // Dishes that have ingredients defined and everything in stock right now.
  const makeable = dishes.filter((d) => {
    const { results, missing } = checkDish(d.id);
    return results.length > 0 && missing.length === 0;
  });
  const cmDish = makeable.length > 0 ? makeable[cmIndex % makeable.length] : null;
  function cycle(dir: 1 | -1) {
    setCmIndex((i) => (i + dir + makeable.length) % makeable.length);
  }

  return (
    <div>
      {/* Add a meal */}
      <form onSubmit={handleCreate} className="bg-gray-50 rounded-xl p-3 mb-5 space-y-3">
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Meal name, e.g. Spaghetti"
            className="flex-1 min-w-[180px] rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
          />
          <select
            value={cookId}
            onChange={(e) => setCookId(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 text-gray-700"
            title="Who makes it"
          >
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {m.display_name}
              </option>
            ))}
          </select>
        </div>
        <input
          value={recipeUrl}
          onChange={(e) => setRecipeUrl(e.target.value)}
          placeholder="Recipe link (optional)"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          rows={2}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
        />
        <label className="block text-sm text-gray-500">
          Recipe file (photo or PDF, optional)
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-1.5 file:text-sky-700 file:font-medium"
          />
        </label>

        {/* Ingredients */}
        <div className="border-t border-gray-200 pt-3">
          <p className="text-sm font-medium text-gray-600 mb-2">Ingredients</p>
          {formIngredients.length > 0 && (
            <ul className="space-y-1 mb-2">
              {formIngredients.map((ing, idx) => (
                <li
                  key={idx}
                  className="flex items-center gap-2 text-sm bg-white rounded-lg px-3 py-1.5 border border-gray-200"
                >
                  <span className="flex-1 text-gray-700">
                    {ing.ingredient}
                    {ing.quantity > 1 && (
                      <span className="text-gray-400"> ×{ing.quantity}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFormIngredient(idx)}
                    className="text-gray-300 hover:text-red-600"
                    aria-label="Remove"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <input
              list="inventory-options"
              value={formIng}
              onChange={(e) => setFormIng(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addFormIngredient();
                }
              }}
              placeholder="Add ingredient (pick or type)…"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
            />
            <input
              type="number"
              min={1}
              value={formIngQty}
              onChange={(e) => setFormIngQty(parseInt(e.target.value) || 1)}
              className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-center outline-none focus:border-sky-500"
            />
            <button
              type="button"
              onClick={addFormIngredient}
              className="text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 rounded-lg"
            >
              Add
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={!name.trim() || busy}
          className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-semibold py-2 rounded-lg"
        >
          {busy ? "Saving…" : "Add meal"}
        </button>
      </form>

      {/* What can we make right now */}
      <div className="mb-5">
        <button
          type="button"
          onClick={() => {
            setCanMakeOpen((o) => !o);
            setCmIndex(0);
          }}
          className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 rounded-xl"
        >
          🍳 What can we make right now?
          {makeable.length > 0 && (
            <span className="bg-white/20 text-xs px-2 py-0.5 rounded-full">
              {makeable.length}
            </span>
          )}
        </button>

        {canMakeOpen && (
          <div className="mt-3 bg-emerald-50 border border-emerald-100 rounded-xl p-5">
            {makeable.length === 0 ? (
              <p className="text-center text-emerald-800/70">
                No meals are fully stocked yet. Add ingredients to your meals
                and keep your inventory up to date.
              </p>
            ) : (
              cmDish && (
                <div className="text-center">
                  <p className="text-xs text-emerald-700 mb-1">
                    {(cmIndex % makeable.length) + 1} of {makeable.length} you
                    can make
                  </p>
                  <h4 className="text-2xl font-bold text-gray-800">
                    {cmDish.name}
                  </h4>
                  {memberName(cmDish.cook_id) && (
                    <p className="text-gray-500 mb-2">
                      {memberName(cmDish.cook_id)}&apos;s
                    </p>
                  )}
                  <p className="text-emerald-600 font-medium mb-3">
                    ✓ You have everything for this!
                  </p>
                  <p className="text-sm text-gray-500 mb-4">
                    {ingredients
                      .filter((i) => i.dish_id === cmDish.id)
                      .map((i) => i.ingredient)
                      .join(" · ")}
                  </p>
                  <div className="flex items-center justify-center gap-3">
                    <button
                      onClick={() => cycle(-1)}
                      disabled={makeable.length < 2}
                      className="w-10 h-10 rounded-full bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                      aria-label="Previous"
                    >
                      ‹
                    </button>
                    <button
                      onClick={() => cycle(1)}
                      className="px-5 py-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                    >
                      {makeable.length < 2 ? "Only option" : "Next idea ›"}
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
          🍽️ Meals · tap to manage ingredients & check inventory
        </h3>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search meals…"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-sky-500 w-44"
        />
      </div>

      {/* Inventory options for the ingredient dropdown */}
      <datalist id="inventory-options">
        {inventory.map((it) => (
          <option key={it.id} value={it.name} />
        ))}
      </datalist>

      {visible.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">
          {dishes.length === 0
            ? "No meals yet. Add one above to start your recipe library."
            : "No meals match your search."}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {visible.map((d) => {
            const expanded = expandedId === d.id;
            const dishIng = ingredients.filter((i) => i.dish_id === d.id);
            const { results, missing } = checkDish(d.id);
            const f = freq.get(d.id);
            const favs = favCount.get(d.id) ?? [];
            const mine = favs.includes(currentUserId);
            return (
              <li key={d.id} className="py-2.5 px-1">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setExpandedId(expanded ? null : d.id)}
                    className="flex-1 min-w-0 text-left flex items-start gap-2"
                  >
                    <span
                      className={`text-gray-400 mt-0.5 transition-transform ${
                        expanded ? "rotate-90" : ""
                      }`}
                    >
                      ▸
                    </span>
                    <span className="min-w-0">
                      <p className="font-medium text-gray-800">
                        {d.name}
                        {memberName(d.cook_id) && (
                          <span className="font-normal text-gray-400">
                            {" "}
                            · {memberName(d.cook_id)}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400">
                        {f ? `${f.count}× · last ${prettyDate(f.last)}` : "not made yet"}
                        {dishIng.length > 0 &&
                          ` · ${dishIng.length} ingredient${
                            dishIng.length === 1 ? "" : "s"
                          }`}
                        {favs.length > 0 && (
                          <span className="text-rose-500">
                            {" · ❤ "}
                            {favs.map((id) => memberName(id)).join(", ")}
                          </span>
                        )}
                      </p>
                    </span>
                  </button>

                  {dishIng.length > 0 &&
                    (missing.length === 0 ? (
                      <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                        ✓ Have it all
                      </span>
                    ) : (
                      <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                        Need {missing.length}
                      </span>
                    ))}

                  <button
                    onClick={() => handleFavorite(d.id)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm transition-colors ${
                      mine ? "text-rose-600 bg-rose-50" : "text-gray-400 hover:bg-gray-100"
                    }`}
                  >
                    <span>{mine ? "❤" : "♡"}</span>
                    {favs.length > 0 && (
                      <span className="text-xs font-medium">{favs.length}</span>
                    )}
                  </button>
                </div>

                {expanded && (
                  <div className="mt-3 ml-1 pl-3 border-l-2 border-gray-100 space-y-3">
                    {(d.recipe_url || d.recipe_file_url || d.notes) && (
                      <div className="text-sm text-gray-500 space-y-0.5">
                        {d.notes && <p className="text-gray-600">{d.notes}</p>}
                        <p className="flex gap-3">
                          {d.recipe_url && (
                            <a href={d.recipe_url} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline">
                              Recipe link ↗
                            </a>
                          )}
                          {d.recipe_file_url && (
                            <a href={d.recipe_file_url} target="_blank" rel="noopener noreferrer" className="text-sky-600 hover:underline">
                              Recipe file ↗
                            </a>
                          )}
                        </p>
                      </div>
                    )}

                    {results.length === 0 ? (
                      <p className="text-sm text-gray-400">
                        No ingredients yet. Add them below.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {results.map((r) => (
                          <li key={r.id} className="flex items-center gap-2 text-sm">
                            <span className={r.ok ? "text-green-600" : "text-amber-600"}>
                              {r.ok ? "✓" : "•"}
                            </span>
                            <span className="flex-1 text-gray-700">
                              {r.ingredient}
                              {r.quantity > 1 && (
                                <span className="text-gray-400"> ×{r.quantity}</span>
                              )}
                            </span>
                            <span className={`text-xs ${r.ok ? "text-gray-400" : "text-amber-600"}`}>
                              have {r.have}/{r.quantity}
                            </span>
                            <button
                              onClick={() => deleteDishIngredient(r.id)}
                              className="text-gray-300 hover:text-red-600"
                              aria-label="Remove ingredient"
                            >
                              ✕
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}

                    {results.length > 0 &&
                      (missing.length === 0 ? (
                        <p className="text-sm text-green-600 font-medium">
                          ✓ You have everything to make this!
                        </p>
                      ) : (
                        <div className="flex items-center justify-between gap-2 bg-amber-50 rounded-lg px-3 py-2">
                          <p className="text-sm text-amber-700">
                            Need to buy: {missing.map((m) => m.ingredient).join(", ")}
                          </p>
                          <button
                            onClick={() =>
                              addMissingToGroceryList(
                                familyId,
                                missing.map((m) => ({
                                  name: m.ingredient,
                                  quantity: Math.max(1, m.quantity - m.have),
                                }))
                              )
                            }
                            className="text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white px-3 py-1.5 rounded-lg whitespace-nowrap"
                          >
                            Add to list
                          </button>
                        </div>
                      ))}

                    {/* Add ingredient with inventory dropdown */}
                    <div className="flex gap-2">
                      <input
                        list="inventory-options"
                        value={expanded ? ingInput : ""}
                        onChange={(e) => setIngInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddIngredient(d.id);
                          }
                        }}
                        placeholder="Add ingredient (pick or type)…"
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
                      />
                      <input
                        type="number"
                        min={1}
                        value={ingQty}
                        onChange={(e) => setIngQty(parseInt(e.target.value) || 1)}
                        className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-center outline-none focus:border-sky-500"
                      />
                      <button
                        onClick={() => handleAddIngredient(d.id)}
                        className="text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 rounded-lg"
                      >
                        Add
                      </button>
                    </div>

                    <button
                      onClick={() => deleteDish(d.id)}
                      className="text-xs text-gray-400 hover:text-red-600"
                    >
                      Delete this meal
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Dinner suggestions */}
      <div className="mt-8 border-t border-gray-100 pt-5">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
          💡 Dinner ideas
        </h3>
        <form onSubmit={handleAddSuggestion} className="flex gap-2 mb-3">
          <input
            value={suggestInput}
            onChange={(e) => setSuggestInput(e.target.value)}
            placeholder="Suggest something for dinner…"
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
          />
          <button
            type="submit"
            disabled={!suggestInput.trim()}
            className="bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white font-semibold px-4 rounded-lg text-sm"
          >
            Suggest
          </button>
        </form>

        {suggestions.length === 0 ? (
          <p className="text-sm text-gray-400">
            No ideas yet. What sounds good for dinner?
          </p>
        ) : (
          <ul className="space-y-1">
            {[...suggestions]
              .map((s) => ({
                ...s,
                voters: votes
                  .filter((v) => v.suggestion_id === s.id)
                  .map((v) => v.user_id),
              }))
              .sort(
                (a, b) =>
                  b.voters.length - a.voters.length ||
                  b.created_at.localeCompare(a.created_at)
              )
              .map((s) => {
                const mine = s.voters.includes(currentUserId);
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-3 py-2 px-1"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800">{s.text}</p>
                      <p className="text-xs text-gray-400">
                        by {memberName(s.suggested_by) ?? "Member"}
                        {s.voters.length > 0 &&
                          ` · 👍 ${s.voters
                            .map((id) => memberName(id))
                            .join(", ")}`}
                      </p>
                    </div>
                    <button
                      onClick={() => handleVote(s.id)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm transition-colors ${
                        mine
                          ? "text-amber-600 bg-amber-50"
                          : "text-gray-400 hover:bg-gray-100"
                      }`}
                      title={mine ? "Remove your vote" : "I'd like this"}
                    >
                      👍
                      {s.voters.length > 0 && (
                        <span className="text-xs font-medium">
                          {s.voters.length}
                        </span>
                      )}
                    </button>
                    {s.suggested_by === currentUserId && (
                      <button
                        onClick={() => deleteSuggestion(s.id)}
                        className="text-gray-300 hover:text-red-600"
                        aria-label="Delete suggestion"
                      >
                        ✕
                      </button>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </div>
    </div>
  );
}

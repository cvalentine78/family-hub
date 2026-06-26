"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addGroceryItem,
  checkOffGroceryItem,
  deleteGroceryItem,
} from "../actions";

export type GroceryItem = {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  is_checked: boolean;
  created_at: string;
};

const UNITS = [
  "",
  "ct",
  "lb",
  "oz",
  "g",
  "kg",
  "gal",
  "qt",
  "pt",
  "fl oz",
  "L",
  "mL",
  "cup",
  "tbsp",
  "tsp",
  "dozen",
  "pack",
  "can",
  "jar",
  "box",
  "bag",
  "bunch",
  "loaf",
];

export default function ShoppingList({
  familyId,
  initialItems,
  suggestions,
}: {
  familyId: string;
  initialItems: GroceryItem[];
  suggestions: string[];
}) {
  const [items, setItems] = useState<GroceryItem[]>(initialItems);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("");
  const [movedMsg, setMovedMsg] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`grocery:${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "grocery_items",
          filter: `family_id=eq.${familyId}`,
        },
        (payload) => {
          setItems((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((i) => i.id !== (payload.old as GroceryItem).id);
            }
            const row = payload.new as GroceryItem;
            const exists = prev.some((i) => i.id === row.id);
            if (exists) return prev.map((i) => (i.id === row.id ? row : i));
            return [...prev, row];
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [familyId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const n = name;
    const q = qty;
    const u = unit;
    setName("");
    setQty("");
    setUnit("");
    await addGroceryItem(familyId, n, q, u);
  }

  // Checking an item = bought it: moves to inventory and off the list.
  async function handleCheck(item: GroceryItem) {
    setItems((prev) => prev.filter((i) => i.id !== item.id)); // optimistic
    setMovedMsg(`Moved “${item.name}” to inventory`);
    setTimeout(() => setMovedMsg(null), 2500);
    await checkOffGroceryItem(item.id);
  }

  async function handleDelete(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id)); // optimistic
    await deleteGroceryItem(id);
  }

  const active = items.sort((a, b) => a.created_at.localeCompare(b.created_at));

  return (
    <div>
      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add an item…"
          list="grocery-suggestions"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
        <datalist id="grocery-suggestions">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder="Qty"
          inputMode="decimal"
          className="w-16 rounded-lg border border-gray-300 px-2 py-2 text-center outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          className="w-24 rounded-lg border border-gray-300 px-2 py-2 outline-none focus:border-sky-500 text-gray-700"
          title="Unit"
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u === "" ? "unit" : u}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!name.trim()}
          className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-semibold px-4 rounded-lg"
        >
          Add
        </button>
      </form>

      {movedMsg && <p className="text-sm text-green-600 mb-3">{movedMsg} ✓</p>}

      {active.length === 0 ? (
        <p className="text-center text-gray-400 py-10">
          Your shopping list is empty. Add something above! 🛒
        </p>
      ) : (
        <ul className="space-y-1">
          {active.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 py-2 px-1"
            >
              <button
                onClick={() => handleCheck(item)}
                className="w-5 h-5 rounded-full border-2 border-gray-300 hover:border-sky-600 hover:bg-sky-50 flex items-center justify-center shrink-0 transition-colors"
                aria-label="Mark as bought"
                title="Bought it — move to inventory"
              >
                <span className="text-xs text-sky-600 opacity-0 hover:opacity-100">
                  ✓
                </span>
              </button>
              <span className="flex-1 text-gray-800">
                {item.name}
                {(item.quantity || item.unit) && (
                  <span className="text-gray-400 text-sm ml-2">
                    {[item.quantity, item.unit].filter(Boolean).join(" ")}
                  </span>
                )}
              </span>
              <button
                onClick={() => handleDelete(item.id)}
                className="text-gray-400 hover:text-red-600 transition-colors"
                aria-label="Delete"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

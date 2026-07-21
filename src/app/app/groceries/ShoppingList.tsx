"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addGroceryItem,
  checkOffGroceryItem,
  deleteGroceryItem,
  searchStoreProducts,
} from "../actions";
import type { KrogerProduct } from "@/lib/kroger";

export type GroceryItem = {
  id: string;
  name: string;
  quantity: string | null;
  unit: string | null;
  price: number | null;
  is_checked: boolean;
  created_at: string;
};

// Parse a leading whole number out of a free-text quantity ("2 gallons" -> 2).
// Mirrors actions.ts's server-side parseQuantity (not imported — that one's
// not exported, and this only needs to run client-side for the total).
function parseQuantity(q: string | null): number {
  if (!q) return 1;
  const m = q.match(/\d+/);
  const n = m ? parseInt(m[0], 10) : 1;
  return n > 0 ? n : 1;
}

// Split a Kroger package size like "16 fl oz" / "340 g" / "12 ct" into the
// form's qty + unit fields, when the unit is one we already offer.
function parseSize(size: string | null): { qty: string; unit: string } | null {
  if (!size) return null;
  const m = size.trim().match(/^(\d+(?:\.\d+)?)\s*(.+)$/);
  if (!m) return null;
  const unit = UNITS.find((u) => u && u.toLowerCase() === m[2].toLowerCase());
  return unit ? { qty: m[1], unit } : null;
}

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
  const [price, setPrice] = useState<number | null>(null);
  const [movedMsg, setMovedMsg] = useState<string | null>(null);

  // Live Kroger catalog results for the add box.
  const [storeResults, setStoreResults] = useState<KrogerProduct[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);
  const skipSearchRef = useRef(false); // picking a suggestion shouldn't re-search
  const latestTermRef = useRef("");

  useEffect(() => {
    const q = name.trim();
    latestTermRef.current = q;
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }
    if (q.length < 3) {
      setStoreResults([]);
      setStoreLoading(false);
      return;
    }
    setStoreLoading(true);
    const timer = setTimeout(async () => {
      const results = await searchStoreProducts(q);
      // Ignore stale responses from a slower earlier search.
      if (latestTermRef.current === q) {
        setStoreResults(results);
        setStoreLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [name]);

  function pickSuggestion(
    text: string,
    size: string | null = null,
    price: number | null = null
  ) {
    skipSearchRef.current = true;
    setName(text);
    const parsed = parseSize(size);
    if (parsed) {
      setQty(parsed.qty);
      setUnit(parsed.unit);
    }
    setPrice(price);
    setStoreResults([]);
    setStoreLoading(false);
  }

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
    const p = price;
    setName("");
    setQty("");
    setUnit("");
    setPrice(null);
    await addGroceryItem(familyId, n, q, u, p);
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

  // Estimated total across items with a known store price (Kroger picks only —
  // manually-typed items have no price and aren't part of this sum).
  const pricedItems = active.filter((item) => item.price != null);
  const estimatedTotal = pricedItems.reduce(
    (sum, item) => sum + item.price! * parseQuantity(item.quantity),
    0
  );

  // Merge instant home suggestions (inventory + ingredients) with live
  // Kroger results in one dropdown. Nothing shows until you type; every
  // typed word must appear somewhere in the item name, in any order.
  const q = name.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const localMatches = q
    ? suggestions
        .filter((s) => {
          const lower = s.toLowerCase();
          return lower !== q && words.every((w) => lower.includes(w));
        })
        .slice(0, 5)
    : [];
  const dropdownOpen =
    nameFocused &&
    q.length > 0 &&
    (localMatches.length > 0 || storeResults.length > 0 || storeLoading);

  return (
    <div>
      <form onSubmit={handleAdd} className="flex flex-wrap gap-2 mb-4">
        <div className="relative w-full sm:w-auto sm:flex-1 min-w-0">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={() => setNameFocused(true)}
            onBlur={() => setNameFocused(false)}
            placeholder="Add an item…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
          />
          {dropdownOpen && (
            <div
              className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto"
              // Keep the input focused so option clicks land before blur.
              onMouseDown={(e) => e.preventDefault()}
            >
              {localMatches.map((s) => (
                <button
                  key={`local-${s}`}
                  type="button"
                  onClick={() => pickSuggestion(s)}
                  className="w-full text-left px-3 py-2 hover:bg-sky-50 text-sm text-gray-800"
                >
                  {s}
                  <span className="text-gray-400 text-xs ml-2">from home</span>
                </button>
              ))}
              {(storeResults.length > 0 || storeLoading) && (
                <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-t border-gray-100 first:border-t-0">
                  {storeLoading ? "Searching Kroger…" : "Kroger"}
                </div>
              )}
              {storeResults.map((p, i) => (
                <button
                  key={`kroger-${i}`}
                  type="button"
                  onClick={() => pickSuggestion(p.name, p.size, p.price)}
                  className="w-full text-left px-3 py-2 hover:bg-sky-50 text-sm"
                >
                  <span className="text-gray-800">{p.name}</span>
                  <span className="text-gray-400 text-xs ml-2">
                    {[
                      p.size,
                      p.price != null ? `$${p.price.toFixed(2)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
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
          className="flex-1 sm:flex-none bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-lg"
        >
          Add
        </button>
      </form>

      {movedMsg && <p className="text-sm text-green-600 mb-3">{movedMsg} ✓</p>}

      {pricedItems.length > 0 && (
        <p className="text-sm text-gray-600 mb-3">
          Est. total: <span className="font-semibold">${estimatedTotal.toFixed(2)}</span>{" "}
          <span className="text-gray-400 text-xs">(priced items only)</span>
        </p>
      )}

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
                {(item.quantity || item.unit || item.price != null) && (
                  <span className="text-gray-400 text-sm ml-2">
                    {[
                      item.quantity,
                      item.unit,
                      item.price != null ? `$${item.price.toFixed(2)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" ")}
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

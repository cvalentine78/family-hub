"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  addInventoryItem,
  updateInventoryQuantity,
  updateInventoryThreshold,
  deleteInventoryItem,
  addInventoryToGrocery,
} from "../actions";

export type InventoryItem = {
  id: string;
  name: string;
  quantity: number;
  category: string | null;
  threshold: number;
  created_at: string;
};

export default function InventoryList({
  familyId,
  initialItems,
}: {
  familyId: string;
  initialItems: InventoryItem[];
}) {
  const [items, setItems] = useState<InventoryItem[]>(initialItems);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [addedMsg, setAddedMsg] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`inventory:${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory_items",
          filter: `family_id=eq.${familyId}`,
        },
        (payload) => {
          setItems((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter(
                (i) => i.id !== (payload.old as InventoryItem).id
              );
            }
            const row = payload.new as InventoryItem;
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
    const c = category;
    setName("");
    setCategory("");
    await addInventoryItem(familyId, n, 1, c);
  }

  async function changeQty(item: InventoryItem, delta: number) {
    const next = Math.max(0, item.quantity + delta);
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, quantity: next } : i))
    );
    await updateInventoryQuantity(item.id, next);
  }

  async function handleDelete(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id)); // optimistic
    await deleteInventoryItem(id);
  }

  async function changeThreshold(item: InventoryItem, value: number) {
    const next = Math.max(0, value);
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, threshold: next } : i))
    );
    await updateInventoryThreshold(item.id, next);
  }

  async function addToList(item: InventoryItem) {
    await addInventoryToGrocery(familyId, item.name);
    setAddedMsg(`Added “${item.name}” to the shopping list`);
    setTimeout(() => setAddedMsg(null), 2500);
  }

  // Group by category.
  const groups = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const key = item.category?.trim() || "Uncategorized";
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const sortedGroups = Array.from(groups.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  return (
    <div>
      <form onSubmit={handleAdd} className="flex gap-2 mb-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add an item…"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category"
          className="w-32 rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-semibold px-4 rounded-lg"
        >
          Add
        </button>
      </form>

      {addedMsg && (
        <p className="text-sm text-green-600 mb-3">{addedMsg} ✓</p>
      )}

      {items.length === 0 ? (
        <p className="text-center text-gray-400 py-10">
          Your inventory is empty. Track what you have at home! 📦
        </p>
      ) : (
        <div className="space-y-5">
          {sortedGroups.map(([cat, list]) => (
            <div key={cat}>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                {cat}
              </h3>
              <ul className="space-y-1">
                {list.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-3 py-2 px-1 group"
                  >
                    <span
                      className={`flex-1 ${
                        item.quantity === 0 ? "text-red-500" : "text-gray-800"
                      }`}
                    >
                      {item.name}
                      {item.quantity === 0 ? (
                        <span className="ml-2 text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded">
                          Out
                        </span>
                      ) : (
                        item.quantity <= item.threshold && (
                          <span className="ml-2 text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded">
                            Low
                          </span>
                        )
                      )}
                    </span>

                    <label className="flex items-center gap-1 text-xs text-gray-400">
                      <span className="hidden sm:inline">low&nbsp;≤</span>
                      <input
                        type="number"
                        min={0}
                        value={item.threshold}
                        onChange={(e) =>
                          changeThreshold(item, parseInt(e.target.value) || 0)
                        }
                        className="w-12 rounded border border-gray-200 px-1.5 py-1 text-center text-gray-700 outline-none focus:border-sky-400"
                        title="Auto-add to shopping list at or below this amount"
                      />
                    </label>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => changeQty(item, -1)}
                        className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600"
                        aria-label="Decrease"
                      >
                        −
                      </button>
                      <span className="w-7 text-center font-medium text-gray-800">
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => changeQty(item, 1)}
                        className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600"
                        aria-label="Increase"
                      >
                        +
                      </button>
                    </div>

                    <button
                      onClick={() => addToList(item)}
                      className="text-xs font-medium text-sky-600 hover:text-sky-700 whitespace-nowrap"
                      title="Add to shopping list"
                    >
                      + List
                    </button>
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

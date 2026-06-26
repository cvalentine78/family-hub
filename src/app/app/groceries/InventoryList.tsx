"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { createClient } from "@/lib/supabase/client";
import {
  addInventoryItem,
  updateInventoryQuantity,
  updateInventoryThreshold,
  updateInventoryDetails,
  deleteInventoryItem,
  addInventoryToGrocery,
  createScannedItem,
  linkScanToItem,
} from "../actions";

export type BarcodeAlias = { barcode: string; item_id: string };

const UNITS = [
  "",
  "oz",
  "fl oz",
  "lb",
  "g",
  "kg",
  "mL",
  "L",
  "ct",
  "pack",
  "gal",
  "qt",
  "pt",
  "cup",
  "can",
  "jar",
  "box",
  "bag",
];

function combineSize(amount: string, unit: string) {
  return [amount.trim(), unit].filter(Boolean).join(" ");
}

// Split a stored size like "14 oz" back into amount + unit for editing.
function splitSize(size: string | null): { amt: string; unit: string } {
  if (!size) return { amt: "", unit: "" };
  const parts = size.trim().split(/\s+/);
  const last = parts[parts.length - 1];
  if (parts.length > 1 && UNITS.includes(last)) {
    return { amt: parts.slice(0, -1).join(" "), unit: last };
  }
  if (UNITS.includes(size.trim())) return { amt: "", unit: size.trim() };
  return { amt: size, unit: "" };
}

const DEFAULT_CATEGORIES = [
  "Pantry",
  "Fridge",
  "Freezer",
  "Produce",
  "Meat & Seafood",
  "Dairy",
  "Bakery",
  "Snacks",
  "Beverages",
  "Condiments",
  "Baking",
  "Canned goods",
  "Cleaning",
  "Paper goods",
  "Toiletries",
  "Health",
  "Baby",
  "Pet",
  "Other",
];

// Camera scanner is only loaded when the user opens it.
const BarcodeScanner = dynamic(() => import("./BarcodeScanner"), { ssr: false });

export type InventoryItem = {
  id: string;
  name: string;
  quantity: number;
  category: string | null;
  threshold: number;
  size: string | null;
  barcode: string | null;
  created_at: string;
};

// Look up a product name from its barcode via Open Food Facts (free, no key).
async function lookupProduct(code: string): Promise<string> {
  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands`
    );
    const data = await res.json();
    if (data.status === 1 && data.product) {
      const p = data.product;
      const name = (p.product_name || "").trim();
      const brand = (p.brands || "").split(",")[0]?.trim();
      if (name) return brand && !name.includes(brand) ? `${brand} ${name}` : name;
    }
  } catch {
    // network/lookup failure — caller falls back to manual naming
  }
  return "";
}

export default function InventoryList({
  familyId,
  initialItems,
  initialAliases,
}: {
  familyId: string;
  initialItems: InventoryItem[];
  initialAliases: BarcodeAlias[];
}) {
  const [items, setItems] = useState<InventoryItem[]>(initialItems);
  const [aliases, setAliases] = useState<BarcodeAlias[]>(initialAliases);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [sizeAmt, setSizeAmt] = useState("");
  const [sizeUnit, setSizeUnit] = useState("");
  const [category, setCategory] = useState("");
  const [addedMsg, setAddedMsg] = useState<string | null>(null);

  // Search + category filter for browsing inventory.
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("");

  // Editing an existing item.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmt, setEditAmt] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editCategory, setEditCategory] = useState("");

  // Barcode scanning state.
  const [scanInput, setScanInput] = useState("");
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const [pendingName, setPendingName] = useState("");
  const [pendingSizeAmt, setPendingSizeAmt] = useState("");
  const [pendingSizeUnit, setPendingSizeUnit] = useState("");
  const [pendingCategory, setPendingCategory] = useState("");
  // "new" = create a new item; otherwise an existing item id to merge into.
  const [pendingTarget, setPendingTarget] = useState<string>("new");

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

  // Keep barcode→item mappings current across devices.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`barcodes:${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "inventory_barcodes",
          filter: `family_id=eq.${familyId}`,
        },
        (payload) => {
          setAliases((prev) => {
            if (payload.eventType === "DELETE") {
              const old = payload.old as BarcodeAlias;
              return prev.filter((a) => a.barcode !== old.barcode);
            }
            const row = payload.new as BarcodeAlias;
            const exists = prev.some((a) => a.barcode === row.barcode);
            return exists ? prev : [...prev, row];
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
    const s = combineSize(sizeAmt, sizeUnit);
    const q = Math.max(1, parseInt(qty) || 1);
    setName("");
    setQty("1");
    setSizeAmt("");
    setSizeUnit("");
    setCategory("");
    await addInventoryItem(familyId, n, q, c, s);
  }

  // Handle a scanned/entered barcode.
  async function handleScan(rawCode: string) {
    const code = rawCode.trim();
    if (!code) return;
    setScanInput("");
    setScanning(true);
    setScanMsg(null);

    // Known barcode (any brand mapped to an item)? Just bump that item.
    const alias = aliases.find((a) => a.barcode === code);
    const existing = alias && items.find((i) => i.id === alias.item_id);
    if (existing) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === existing.id ? { ...i, quantity: i.quantity + 1 } : i
        )
      );
      await updateInventoryQuantity(existing.id, existing.quantity + 1);
      setScanMsg(`+1 ${existing.name}`);
      setScanning(false);
      return;
    }

    // New barcode — look up a suggested name and let the user confirm where it
    // goes (new item, or merge into an existing one like "Green beans").
    const found = await lookupProduct(code);
    setPendingCode(code);
    setPendingName(found);
    setPendingSizeAmt("");
    setPendingSizeUnit("");
    setPendingCategory("");
    setPendingTarget("new");
    setScanning(false);
  }

  async function confirmPending(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingCode) return;
    const code = pendingCode;

    if (pendingTarget === "new") {
      if (!pendingName.trim()) return;
      const nm = pendingName.trim();
      setPendingCode(null);
      await createScannedItem(
        familyId,
        code,
        nm,
        pendingCategory,
        combineSize(pendingSizeAmt, pendingSizeUnit)
      );
      setScanMsg(`Added ${nm}`);
    } else {
      const target = items.find((i) => i.id === pendingTarget);
      setPendingCode(null);
      if (target) {
        setItems((prev) =>
          prev.map((i) =>
            i.id === target.id ? { ...i, quantity: i.quantity + 1 } : i
          )
        );
      }
      await linkScanToItem(familyId, code, pendingTarget);
      setScanMsg(target ? `+1 ${target.name}` : "Added to item");
    }
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

  function startEdit(item: InventoryItem) {
    const { amt, unit } = splitSize(item.size);
    setEditingId(item.id);
    setEditName(item.name);
    setEditAmt(amt);
    setEditUnit(unit);
    setEditCategory(item.category ?? "");
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    const newName = editName.trim();
    const newSize = combineSize(editAmt, editUnit);
    const newCat = editCategory.trim();
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, name: newName, size: newSize || null, category: newCat || null }
          : i
      )
    );
    setEditingId(null);
    await updateInventoryDetails(id, newName, newSize, newCat);
  }

  async function addToList(item: InventoryItem) {
    await addInventoryToGrocery(familyId, item.name);
    setAddedMsg(`Added “${item.name}” to the shopping list`);
    setTimeout(() => setAddedMsg(null), 2500);
  }

  // Category suggestions = defaults + whatever's already used.
  const usedCategories = Array.from(
    new Set(items.map((i) => i.category?.trim()).filter(Boolean) as string[])
  );
  const categoryOptions = Array.from(
    new Set([...DEFAULT_CATEGORIES, ...usedCategories])
  ).sort((a, b) => a.localeCompare(b));

  // Filter by search + selected category, then group by category.
  const term = search.trim().toLowerCase();
  const filtered = items.filter((i) => {
    const cat = i.category?.trim() || "Uncategorized";
    if (filterCategory && cat !== filterCategory) return false;
    if (
      term &&
      !i.name.toLowerCase().includes(term) &&
      !(i.size || "").toLowerCase().includes(term)
    )
      return false;
    return true;
  });

  const groups = new Map<string, InventoryItem[]>();
  for (const item of filtered) {
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
      {/* Barcode scanning */}
      <div className="bg-sky-50 border border-sky-100 rounded-xl p-3 mb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleScan(scanInput);
          }}
          className="flex flex-wrap gap-2"
        >
          <input
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            placeholder="📷 Scan or type a barcode…"
            inputMode="numeric"
            autoComplete="off"
            className="flex-1 min-w-0 basis-full sm:basis-auto rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
          />
          <button
            type="button"
            onClick={() => setShowCamera(true)}
            className="flex-1 sm:flex-none px-3 py-2 rounded-lg bg-white border border-sky-200 text-sky-700 hover:bg-sky-100 text-sm font-medium"
            title="Scan with camera"
          >
            📷 Camera
          </button>
          <button
            type="submit"
            disabled={!scanInput.trim() || scanning}
            className="flex-1 sm:flex-none bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-lg"
          >
            {scanning ? "…" : "Scan"}
          </button>
        </form>

        {scanMsg && <p className="text-sm text-green-600 mt-2">{scanMsg} ✓</p>}

        {pendingCode && (
          <form
            onSubmit={confirmPending}
            className="mt-2 bg-white rounded-lg border border-sky-200 p-3 space-y-2"
          >
            <p className="text-xs text-gray-500">
              Scanned barcode{" "}
              <span className="font-mono">{pendingCode}</span>
            </p>
            <select
              value={pendingTarget}
              onChange={(e) => setPendingTarget(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-sky-500 text-gray-700"
            >
              <option value="new">➕ Add as a new item</option>
              {[...items]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    Add to: {i.name}
                    {i.size ? ` ${i.size}` : ""} (have {i.quantity})
                  </option>
                ))}
            </select>

            {pendingTarget === "new" ? (
              <div className="flex gap-2 flex-wrap">
                <input
                  value={pendingName}
                  onChange={(e) => setPendingName(e.target.value)}
                  placeholder="Item name (e.g. Green beans)"
                  autoFocus
                  className="flex-1 min-w-[140px] rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
                />
                <input
                  value={pendingSizeAmt}
                  onChange={(e) => setPendingSizeAmt(e.target.value)}
                  placeholder="Size"
                  inputMode="decimal"
                  className="w-16 rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-center outline-none focus:border-sky-500"
                />
                <select
                  value={pendingSizeUnit}
                  onChange={(e) => setPendingSizeUnit(e.target.value)}
                  className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-sky-500 text-gray-700"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u === "" ? "unit" : u}
                    </option>
                  ))}
                </select>
                <input
                  value={pendingCategory}
                  onChange={(e) => setPendingCategory(e.target.value)}
                  placeholder="Category"
                  list="category-options"
                  className="w-28 rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:border-sky-500"
                />
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                This brand&apos;s barcode will be remembered, so future scans add
                straight to that item.
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pendingTarget === "new" && !pendingName.trim()}
                className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-medium px-4 py-1.5 rounded-lg text-sm"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setPendingCode(null)}
                className="text-sm text-gray-400 hover:text-gray-700 px-2"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        <p className="text-xs text-gray-400 mt-1">
          Use a handheld scanner (it types the code and presses enter) or the
          camera. Repeat scans add to the quantity.
        </p>
      </div>

      {showCamera && (
        <BarcodeScanner
          onDetected={(code) => {
            setShowCamera(false);
            handleScan(code);
          }}
          onClose={() => setShowCamera(false)}
        />
      )}

      {/* Category options for the dropdowns */}
      <datalist id="category-options">
        {categoryOptions.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <form onSubmit={handleAdd} className="flex flex-wrap gap-2 mb-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add an item…"
          className="flex-1 min-w-0 basis-full sm:basis-auto rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
        <label className="flex items-center gap-1 text-xs text-gray-400">
          Qty
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="numeric"
            className="w-14 rounded-lg border border-gray-300 px-2 py-2 text-center text-gray-900 outline-none focus:border-sky-500"
          />
        </label>
        <input
          value={sizeAmt}
          onChange={(e) => setSizeAmt(e.target.value)}
          placeholder="Size"
          inputMode="decimal"
          className="w-16 rounded-lg border border-gray-300 px-2 py-2 text-center outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
        <select
          value={sizeUnit}
          onChange={(e) => setSizeUnit(e.target.value)}
          className="w-20 rounded-lg border border-gray-300 px-2 py-2 outline-none focus:border-sky-500 text-gray-700"
          title="Unit"
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u === "" ? "unit" : u}
            </option>
          ))}
        </select>
        <input
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category"
          list="category-options"
          className="flex-1 min-w-[110px] rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="flex-1 sm:flex-none bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-lg"
        >
          Add
        </button>
      </form>

      {/* Search + category filter */}
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 Search inventory…"
            className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
          />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sky-500 text-gray-700"
          >
            <option value="">All categories</option>
            {usedCategories
              .sort((a, b) => a.localeCompare(b))
              .map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            {items.some((i) => !i.category?.trim()) && (
              <option value="Uncategorized">Uncategorized</option>
            )}
          </select>
        </div>
      )}

      {addedMsg && (
        <p className="text-sm text-green-600 mb-3">{addedMsg} ✓</p>
      )}

      {items.length === 0 ? (
        <p className="text-center text-gray-400 py-10">
          Your inventory is empty. Track what you have at home! 📦
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-center text-gray-400 py-10">
          Nothing matches your search or filter.
        </p>
      ) : (
        <div className="space-y-5">
          {sortedGroups.map(([cat, list]) => (
            <div key={cat}>
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
                {cat}
              </h3>
              <ul className="space-y-1">
                {list.map((item) =>
                  editingId === item.id ? (
                    <li
                      key={item.id}
                      className="py-2 px-1 bg-sky-50 rounded-lg"
                    >
                      <div className="flex flex-wrap gap-2 items-center">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Name"
                          className="flex-1 min-w-0 basis-full sm:basis-auto rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                        />
                        <input
                          value={editAmt}
                          onChange={(e) => setEditAmt(e.target.value)}
                          placeholder="Size"
                          inputMode="decimal"
                          className="w-16 rounded-lg border border-gray-300 px-2 py-2 text-center text-sm outline-none focus:border-sky-500"
                        />
                        <select
                          value={editUnit}
                          onChange={(e) => setEditUnit(e.target.value)}
                          className="w-20 rounded-lg border border-gray-300 px-2 py-2 text-sm outline-none focus:border-sky-500 text-gray-700"
                        >
                          {UNITS.map((u) => (
                            <option key={u} value={u}>
                              {u === "" ? "unit" : u}
                            </option>
                          ))}
                        </select>
                        <input
                          value={editCategory}
                          onChange={(e) => setEditCategory(e.target.value)}
                          placeholder="Category"
                          list="category-options"
                          className="flex-1 min-w-[110px] rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sky-500"
                        />
                        <button
                          onClick={() => saveEdit(item.id)}
                          disabled={!editName.trim()}
                          className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-medium px-4 py-2 rounded-lg text-sm"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-sm text-gray-400 hover:text-gray-700 px-2"
                        >
                          Cancel
                        </button>
                      </div>
                    </li>
                  ) : (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 py-2 px-1 group"
                    >
                      <button
                        onClick={() => startEdit(item)}
                        className={`flex-1 min-w-0 text-left ${
                          item.quantity === 0 ? "text-red-500" : "text-gray-800"
                        }`}
                        title="Tap to edit"
                      >
                        <span className="truncate">{item.name}</span>
                        {item.size && (
                          <span className="text-gray-400 text-sm font-normal">
                            {" "}
                            · {item.size}
                          </span>
                        )}
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
                      </button>

                      <label className="flex items-center gap-1 text-xs text-gray-400">
                        <span className="hidden sm:inline">low&nbsp;≤</span>
                        <input
                          type="number"
                          min={0}
                          value={item.threshold}
                          onChange={(e) =>
                            changeThreshold(item, parseInt(e.target.value) || 0)
                          }
                          className="w-11 rounded border border-gray-200 px-1.5 py-1 text-center text-gray-700 outline-none focus:border-sky-400"
                          title="Auto-add to shopping list at or below this amount"
                        />
                      </label>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => changeQty(item, -1)}
                          className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600"
                          aria-label="Decrease"
                        >
                          −
                        </button>
                        <span className="w-6 text-center font-medium text-gray-800">
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
                        onClick={() => startEdit(item)}
                        className="text-gray-400 hover:text-sky-600"
                        aria-label="Edit"
                        title="Edit"
                      >
                        ✏️
                      </button>
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
                  )
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

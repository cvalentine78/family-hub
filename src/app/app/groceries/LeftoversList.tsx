"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logMeal, setMealLeftovers, deleteMealLog } from "../actions";
import type { Member } from "@/lib/family";
import type { Dish, MealLogEntry } from "./mealTypes";

function todayStr() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function prettyDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function LeftoversList({
  familyId,
  currentUserId,
  members,
  initialDishes,
  initialLog,
}: {
  familyId: string;
  currentUserId: string;
  members: Member[];
  initialDishes: Dish[];
  initialLog: MealLogEntry[];
}) {
  const [dishes, setDishes] = useState<Dish[]>(initialDishes);
  const [log, setLog] = useState<MealLogEntry[]>(initialLog);
  const [dishId, setDishId] = useState(initialDishes[0]?.id ?? "");
  const [madeOn, setMadeOn] = useState(todayStr());
  const [leftovers, setLeftovers] = useState(true);
  const [busy, setBusy] = useState(false);

  const dishById = new Map(dishes.map((d) => [d.id, d]));
  const memberById = new Map(members.map((m) => [m.user_id, m]));

  // Realtime: meal log.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`meal_log:${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "meal_log",
          filter: `family_id=eq.${familyId}`,
        },
        (payload) => {
          setLog((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((e) => e.id !== (payload.old as MealLogEntry).id);
            }
            const row = payload.new as MealLogEntry;
            const exists = prev.some((e) => e.id === row.id);
            if (exists) return prev.map((e) => (e.id === row.id ? row : e));
            return [...prev, row];
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [familyId]);

  // Realtime: dishes (so newly added meals show in the dropdown).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`dishes-for-log:${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dishes",
          filter: `family_id=eq.${familyId}`,
        },
        (payload) => {
          setDishes((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((d) => d.id !== (payload.old as Dish).id);
            }
            const row = payload.new as Dish;
            const exists = prev.some((d) => d.id === row.id);
            if (exists) return prev.map((d) => (d.id === row.id ? row : d));
            return [...prev, row];
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [familyId]);

  async function handleLog(e: React.FormEvent) {
    e.preventDefault();
    const dish = dishById.get(dishId);
    if (!dish || busy) return;
    setBusy(true);
    await logMeal(familyId, dish.id, dish.name, madeOn, leftovers);
    setLeftovers(true);
    setMadeOn(todayStr());
    setBusy(false);
  }

  async function toggleLeftovers(entry: MealLogEntry) {
    setLog((prev) =>
      prev.map((e) =>
        e.id === entry.id ? { ...e, has_leftovers: !e.has_leftovers } : e
      )
    );
    await setMealLeftovers(entry.id, !entry.has_leftovers);
  }

  async function handleDelete(id: string) {
    setLog((prev) => prev.filter((e) => e.id !== id));
    await deleteMealLog(id);
  }

  function dishName(id: string) {
    return dishById.get(id)?.name ?? "Meal";
  }
  function cookName(id: string) {
    const cookId = dishById.get(id)?.cook_id;
    if (!cookId) return null;
    return memberById.get(cookId)?.display_name ?? "Member";
  }

  const fridge = log
    .filter((e) => e.has_leftovers)
    .sort((a, b) => b.made_on.localeCompare(a.made_on));
  const history = [...log].sort((a, b) => b.made_on.localeCompare(a.made_on));

  return (
    <div>
      {/* Log what we made */}
      <form onSubmit={handleLog} className="bg-gray-50 rounded-xl p-3 mb-5 flex flex-wrap gap-2 items-center">
        {dishes.length === 0 ? (
          <p className="text-sm text-gray-500">
            Add a meal on the 🍽️ Meals tab first, then log when you make it
            here.
          </p>
        ) : (
          <>
            <select
              value={dishId}
              onChange={(e) => setDishId(e.target.value)}
              className="flex-1 min-w-[180px] rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 text-gray-700"
            >
              {dishes.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.cook_id && memberById.get(d.cook_id)
                    ? ` (${memberById.get(d.cook_id)!.display_name})`
                    : ""}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={madeOn}
              onChange={(e) => setMadeOn(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500"
            />
            <label className="flex items-center gap-1.5 text-sm text-gray-600 px-1">
              <input
                type="checkbox"
                checked={leftovers}
                onChange={(e) => setLeftovers(e.target.checked)}
              />
              Leftovers
            </label>
            <button
              type="submit"
              disabled={busy}
              className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white font-semibold px-4 py-2 rounded-lg"
            >
              {busy ? "Logging…" : "Log it"}
            </button>
          </>
        )}
      </form>

      {log.length === 0 ? (
        <p className="text-center text-gray-400 py-10">
          Nothing logged yet. Pick a meal above and log when you made it. 🍽️
        </p>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {/* In the fridge */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              🥡 Leftovers in the fridge · {fridge.length}
            </h3>
            {fridge.length === 0 ? (
              <p className="text-sm text-gray-400">No leftovers right now.</p>
            ) : (
              <ul className="space-y-1">
                {fridge.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center gap-2 py-2 px-3 bg-amber-50 rounded-lg"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-gray-800">
                        {dishName(e.dish_id)}
                      </p>
                      <p className="text-xs text-gray-500">
                        Made {prettyDate(e.made_on)}
                        {cookName(e.dish_id) && ` · by ${cookName(e.dish_id)}`}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleLeftovers(e)}
                      className="text-xs font-medium bg-white border border-amber-200 text-amber-700 px-2 py-1 rounded hover:bg-amber-100"
                    >
                      All eaten
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* History */}
          <div>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
              📖 Meal history
            </h3>
            <ul className="divide-y divide-gray-100">
              {history.map((e) => (
                <li key={e.id} className="flex items-center gap-3 py-2 px-1">
                  <span className="flex-1 text-gray-800">
                    {dishName(e.dish_id)}
                    {e.has_leftovers && (
                      <span className="ml-2 text-xs bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded">
                        Leftovers
                      </span>
                    )}
                  </span>
                  <span className="text-sm text-gray-400">
                    {prettyDate(e.made_on)}
                  </span>
                  <button
                    onClick={() => handleDelete(e.id)}
                    className="text-gray-400 hover:text-red-600 transition-colors"
                    aria-label="Delete"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

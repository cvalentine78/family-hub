"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createFamily, joinFamily } from "./actions";

export default function Onboarding() {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handle(formData: FormData) {
    setLoading(true);
    setError(null);
    const action = mode === "create" ? createFamily : joinFamily;
    const result = await action(formData);
    setLoading(false);
    if (result?.error) {
      setError(result.error);
    } else {
      router.refresh();
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-12 bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
      <div className="flex rounded-lg bg-gray-100 p-1 mb-6">
        <button
          onClick={() => setMode("create")}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            mode === "create" ? "bg-white shadow text-sky-700" : "text-gray-500"
          }`}
        >
          Create a family
        </button>
        <button
          onClick={() => setMode("join")}
          className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
            mode === "join" ? "bg-white shadow text-sky-700" : "text-gray-500"
          }`}
        >
          Join a family
        </button>
      </div>

      <form action={handle} className="space-y-4">
        {mode === "create" ? (
          <label className="block">
            <span className="text-sm font-medium text-gray-700">
              Family name
            </span>
            <input
              name="name"
              required
              placeholder="The Valentines"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 outline-none"
            />
          </label>
        ) : (
          <label className="block">
            <span className="text-sm font-semibold text-gray-800">
              Enter your family&apos;s join code
            </span>
            <input
              name="code"
              required
              placeholder="ABC123"
              autoCapitalize="characters"
              autoFocus
              maxLength={6}
              className="mt-1 w-full rounded-lg border-2 border-sky-400 bg-sky-50/40 px-3 py-3 text-center text-2xl font-bold uppercase tracking-[0.4em] text-gray-800 placeholder:text-gray-300 placeholder:font-normal placeholder:tracking-widest focus:border-sky-600 focus:ring-2 focus:ring-sky-200 outline-none"
            />
            <span className="mt-1 block text-xs text-gray-500">
              Ask whoever set up your family for the 6-character code.
            </span>
          </label>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg transition-colors"
        >
          {loading
            ? "Working…"
            : mode === "create"
            ? "Create family"
            : "Join family"}
        </button>
      </form>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setShareLocation } from "./actions";

export default function ShareLocationToggle({
  initialEnabled,
}: {
  initialEnabled: boolean;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !enabled;
    setEnabled(next); // optimistic
    setError(null);

    // When turning on, ask for permission up front so it starts immediately.
    if (next && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        () => {},
        () => setError("Location permission is needed to share.")
      );
    }

    startTransition(async () => {
      const result = await setShareLocation(next);
      if (result?.error) {
        setEnabled(!next); // revert on failure
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-sm font-medium text-gray-700">
          Share my location
        </p>
        <p className="text-xs text-gray-400">
          {enabled ? "On — visible to family" : "Off"}
        </p>
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        role="switch"
        aria-checked={enabled}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-60 ${
          enabled ? "bg-sky-600" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
            enabled ? "translate-x-5" : "translate-x-1"
          }`}
        />
      </button>
      {error && (
        <p className="text-xs text-red-600 max-w-[160px]">{error}</p>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";

// Dismissible per-page-load only (not persisted) — a real fix on Cari's end
// (re-pasting a working link) reruns saveOutlookIcsUrl, which resets the
// cooldown and clears last_sync_error, so a fixed feed naturally stops
// showing this on the very next load without needing separate "un-dismiss"
// logic here.
export default function OutlookSyncBanner({
  message,
}: {
  message: string | null;
}) {
  const [dismissed, setDismissed] = useState(false);
  if (!message || dismissed) return null;

  return (
    <div className="mb-4 flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-2.5">
      <span>Outlook calendar sync: {message}</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="text-amber-600 hover:text-amber-900 font-medium shrink-0"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

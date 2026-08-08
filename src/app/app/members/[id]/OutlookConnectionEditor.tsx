"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveOutlookIcsUrl, clearOutlookIcsUrl } from "../../actions";

export default function OutlookConnectionEditor({
  initialUrl,
}: {
  initialUrl: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(!initialUrl);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleSave(formData: FormData) {
    setError(null);
    const result = await saveOutlookIcsUrl(formData);
    if (result?.error) {
      setError(result.error);
    } else {
      setEditing(false);
      startTransition(() => router.refresh());
    }
  }

  async function handleClear() {
    if (
      !confirm(
        "Disconnect Outlook? Every event synced from it will be removed."
      )
    )
      return;
    setError(null);
    const result = await clearOutlookIcsUrl();
    if (result?.error) {
      setError(result.error);
    } else {
      setEditing(true);
      startTransition(() => router.refresh());
    }
  }

  return (
    <div>
      <span className="text-sm font-medium text-gray-700">
        Outlook calendar
      </span>
      <p className="text-xs text-gray-400 mb-2">
        Paste your Outlook published calendar (ICS) link to sync your events
        in. New events start private to you — you choose which ones to share
        with the family.
      </p>
      {editing ? (
        <form action={handleSave} className="flex flex-col sm:flex-row gap-2">
          <input
            name="ics_url"
            type="url"
            required
            placeholder="https://outlook.office365.com/owa/calendar/.../calendar.ics"
            defaultValue={initialUrl ?? ""}
            className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="flex-1 sm:flex-none px-4 text-sm font-medium bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white rounded-lg py-2"
            >
              Connect
            </button>
            {initialUrl && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-3 text-sm text-gray-500 hover:text-gray-800"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-gray-600">Connected ✓</span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-sm text-sky-600 hover:underline"
            >
              Update link
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={pending}
              className="text-sm text-red-600 hover:underline disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}

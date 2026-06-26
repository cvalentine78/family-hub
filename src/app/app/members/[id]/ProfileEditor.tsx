"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { updateProfile } from "../../actions";
import dynamic from "next/dynamic";
import Avatar from "../Avatar";
import ShareLocationToggle from "../../ShareLocationToggle";
import type { Member } from "@/lib/family";

// The crop UI (canvas + image processing) is only needed once a photo is
// chosen, so load it on demand instead of in the profile page bundle.
const CropModal = dynamic(() => import("./CropModal"), { ssr: false });

export default function ProfileEditor({
  member,
  shareLocation,
}: {
  member: Member;
  shareLocation: boolean;
}) {
  const router = useRouter();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(member.avatar_url);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState(false);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Open the cropper with the chosen image.
    setCropSrc(URL.createObjectURL(file));
    setError(null);
    // Allow re-selecting the same file later.
    e.target.value = "";
  }

  async function handleCropped(blob: Blob) {
    setCropSrc(null);
    setUploading(true);
    setError(null);
    const supabase = createClient();

    // Path must start with the user's id folder to satisfy storage RLS.
    const path = `${member.user_id}/avatar-${Date.now()}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, blob, { upsert: true, contentType: "image/jpeg" });

    if (uploadError) {
      setUploading(false);
      setError(uploadError.message);
      return;
    }

    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    setAvatarUrl(data.publicUrl);
    setUploading(false);
  }

  async function handleSave(formData: FormData) {
    setSaving(true);
    setError(null);
    setSavedMsg(false);
    if (avatarUrl) formData.set("avatar_url", avatarUrl);
    const result = await updateProfile(formData);
    setSaving(false);
    if (result?.error) {
      setError(result.error);
    } else {
      setSavedMsg(true);
      router.refresh();
    }
  }

  return (
    <>
    {cropSrc && (
      <CropModal
        src={cropSrc}
        onCancel={() => setCropSrc(null)}
        onConfirm={handleCropped}
      />
    )}
    <form
      action={handleSave}
      className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5"
    >
      {/* Avatar + upload */}
      <div className="flex items-center gap-4">
        <Avatar name={member.display_name} url={avatarUrl} size={80} />
        <div>
          <label className="inline-block cursor-pointer text-sm font-medium text-sky-600 hover:text-sky-700">
            {uploading ? "Uploading…" : "Change picture"}
            <input
              type="file"
              accept="image/*"
              onChange={handleFile}
              disabled={uploading}
              className="hidden"
            />
          </label>
          <p className="text-xs text-gray-400 mt-1">JPG or PNG, up to a few MB.</p>
        </div>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Name</span>
        <input
          name="display_name"
          required
          defaultValue={member.display_name}
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">
          Status / quote of the day
        </span>
        <input
          name="status"
          defaultValue={member.status ?? ""}
          placeholder="Living my best life ☀️"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
      </label>

      <label className="block">
        <span className="text-sm font-medium text-gray-700">Phone number</span>
        <input
          name="phone"
          type="tel"
          defaultValue={member.phone ?? ""}
          placeholder="(555) 123-4567"
          className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
      </label>

      <div className="block">
        <span className="text-sm font-medium text-gray-700">Email</span>
        <p className="mt-1 text-gray-500">{member.email ?? "—"}</p>
        <p className="text-xs text-gray-400">
          Your email is set by how you sign in and can&apos;t be edited here.
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-gray-100 pt-5">
        <div>
          <span className="text-sm font-medium text-gray-700">Location</span>
          <p className="text-xs text-gray-400">
            Share your live location with family on the map.
          </p>
        </div>
        <ShareLocationToggle initialEnabled={shareLocation} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {savedMsg && <p className="text-sm text-green-600">Profile saved ✓</p>}

      <button
        type="submit"
        disabled={saving || uploading}
        className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg"
      >
        {saving ? "Saving…" : "Save profile"}
      </button>
    </form>
    </>
  );
}

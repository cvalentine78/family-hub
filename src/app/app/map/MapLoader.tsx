"use client";

import dynamic from "next/dynamic";
import type { Member } from "@/lib/family";

type Loc = {
  user_id: string;
  lat: number;
  lng: number;
  updated_at: string;
};

// Load the map (and the heavy Google Maps library) only on the client, lazily,
// with a lightweight placeholder so it isn't on the route's critical path.
const FamilyMap = dynamic(() => import("./FamilyMap"), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-gray-100 shadow-sm bg-gray-100 animate-pulse h-[70vh] flex items-center justify-center text-gray-400">
      Loading map…
    </div>
  ),
});

export default function MapLoader(props: {
  apiKey: string;
  familyId: string;
  currentUserId: string;
  members: Member[];
  initialLocations: Loc[];
}) {
  return <FamilyMap {...props} />;
}

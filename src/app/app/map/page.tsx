import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentFamily, getFamilyMembers } from "@/lib/family";
import Nav from "../Nav";
import MapLoader from "./MapLoader";

export default async function MapPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const family = await getCurrentFamily();
  if (!family) redirect("/app");

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const members = await getFamilyMembers(family.id);

  const { data: locs } = await supabase
    .from("locations")
    .select("user_id, lat, lng, updated_at")
    .eq("family_id", family.id);

  return (
    <div className="max-w-[1320px] mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">Map</h1>
        <Nav />
      </div>

      {!apiKey ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center">
          <div className="text-5xl mb-3">🗺️</div>
          <h2 className="font-semibold text-gray-700 mb-1">
            Google Maps key needed
          </h2>
          <p className="text-gray-500 text-sm max-w-md mx-auto">
            Add your Google Maps API key to the app&apos;s environment
            (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) and reload to see the live family
            map.
          </p>
        </div>
      ) : (
        <MapLoader
          apiKey={apiKey}
          familyId={family.id}
          currentUserId={user.id}
          members={members}
          initialLocations={locs ?? []}
        />
      )}
    </div>
  );
}

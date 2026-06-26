"use client";

import { useEffect, useState } from "react";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  useMap,
} from "@vis.gl/react-google-maps";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import type { Member } from "@/lib/family";

type Loc = {
  user_id: string;
  lat: number;
  lng: number;
  updated_at: string;
};

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function FamilyMap({
  apiKey,
  familyId,
  currentUserId,
  members,
  initialLocations,
}: {
  apiKey: string;
  familyId: string;
  currentUserId: string;
  members: Member[];
  initialLocations: Loc[];
}) {
  const [locations, setLocations] = useState<Map<string, Loc>>(
    () => new Map(initialLocations.map((l) => [l.user_id, l]))
  );
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "working" | "ok" | "error"
  >("idle");
  const [statusMsg, setStatusMsg] = useState<string>("");

  const memberById = new Map(members.map((m) => [m.user_id, m]));

  // Grab one fresh fix and write it immediately — a reliable manual fallback.
  function updateNow() {
    if (!navigator.geolocation) {
      setUpdateStatus("error");
      setStatusMsg("This device doesn't support location.");
      return;
    }
    setUpdateStatus("working");
    setStatusMsg("Getting your location…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        const supabase = createClient();
        const { error } = await supabase.from("locations").upsert({
          user_id: currentUserId,
          family_id: familyId,
          lat: latitude,
          lng: longitude,
          accuracy,
          updated_at: new Date().toISOString(),
        });
        if (error) {
          setUpdateStatus("error");
          setStatusMsg("Couldn't save location. Try again.");
        } else {
          setUpdateStatus("ok");
          setStatusMsg("Your location is on the map ✓");
        }
      },
      (err) => {
        setUpdateStatus("error");
        setStatusMsg(
          err.code === err.PERMISSION_DENIED
            ? "Location permission is blocked. Allow it in your browser's site settings, then try again."
            : "Couldn't get your location. Make sure location is on and try again."
        );
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  // Live updates: subscribe to location changes for this family.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`locations:${familyId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "locations",
          filter: `family_id=eq.${familyId}`,
        },
        (payload) => {
          const row = payload.new as Loc;
          if (payload.eventType === "DELETE") {
            const old = payload.old as { user_id: string };
            setLocations((prev) => {
              const next = new Map(prev);
              next.delete(old.user_id);
              return next;
            });
          } else {
            setLocations((prev) => {
              const next = new Map(prev);
              next.set(row.user_id, row);
              return next;
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [familyId]);

  const locArray = Array.from(locations.values());

  // Center on the average of known locations, else a default.
  let center = { lat: 39.5, lng: -98.35 };
  let zoom = 4;
  if (locArray.length > 0) {
    center = {
      lat: locArray.reduce((s, l) => s + l.lat, 0) / locArray.length,
      lng: locArray.reduce((s, l) => s + l.lng, 0) / locArray.length,
    };
    zoom = locArray.length === 1 ? 18 : 16;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
        <p className="text-sm text-gray-500">
          {locArray.length} member{locArray.length === 1 ? "" : "s"} sharing
          location
        </p>
        <div className="flex items-center gap-3">
          <button
            onClick={updateNow}
            disabled={updateStatus === "working"}
            className="text-sm font-medium bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg"
          >
            {updateStatus === "working" ? "Locating…" : "📍 Update my location"}
          </button>
          <Link
            href={`/app/members/${currentUserId}`}
            className="text-sm font-medium text-sky-600 hover:text-sky-700"
          >
            Settings
          </Link>
        </div>
      </div>
      {statusMsg && (
        <p
          className={`text-sm mb-3 ${
            updateStatus === "error"
              ? "text-red-600"
              : updateStatus === "ok"
              ? "text-green-600"
              : "text-gray-500"
          }`}
        >
          {statusMsg}
        </p>
      )}

      <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
        <APIProvider apiKey={apiKey}>
          <GoogleMap
            mapId="DEMO_MAP_ID"
            defaultCenter={center}
            defaultZoom={zoom}
            gestureHandling="greedy"
            disableDefaultUI={false}
            style={{ width: "100%", height: "70vh" }}
          >
            <FitBounds locs={locArray} />
            {locArray.map((loc) => {
              const m = memberById.get(loc.user_id);
              const name = m?.display_name ?? "Member";
              return (
                <AdvancedMarker
                  key={loc.user_id}
                  position={{ lat: loc.lat, lng: loc.lng }}
                  title={`${name} · ${timeAgo(loc.updated_at)}`}
                >
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 rounded-full border-2 border-white shadow-md overflow-hidden bg-sky-100">
                      {m?.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.avatar_url}
                          alt={name}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-sky-700 font-semibold text-sm">
                          {name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <span className="mt-0.5 text-[11px] font-medium bg-white/90 px-1.5 rounded shadow-sm whitespace-nowrap">
                      {loc.user_id === currentUserId ? "You" : name}
                    </span>
                  </div>
                </AdvancedMarker>
              );
            })}
          </GoogleMap>
        </APIProvider>
      </div>
    </div>
  );
}

// Auto-fits the map so every shared location is visible. One person → a close
// zoom; multiple people → zoom out to frame them all.
function FitBounds({ locs }: { locs: Loc[] }) {
  const map = useMap();

  useEffect(() => {
    if (!map || locs.length === 0) return;

    if (locs.length === 1) {
      map.setCenter({ lat: locs[0].lat, lng: locs[0].lng });
      map.setZoom(17);
      return;
    }

    const lats = locs.map((l) => l.lat);
    const lngs = locs.map((l) => l.lng);
    map.fitBounds(
      {
        north: Math.max(...lats),
        south: Math.min(...lats),
        east: Math.max(...lngs),
        west: Math.min(...lngs),
      },
      80 // padding in px so pins aren't on the edge
    );
  }, [map, locs]);

  return null;
}

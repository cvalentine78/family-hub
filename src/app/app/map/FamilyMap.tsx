"use client";

import { useEffect, useState } from "react";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
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

  const memberById = new Map(members.map((m) => [m.user_id, m]));

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
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500">
          {locArray.length} member{locArray.length === 1 ? "" : "s"} sharing
          location
        </p>
        <Link
          href={`/app/members/${currentUserId}`}
          className="text-sm font-medium text-sky-600 hover:text-sky-700"
        >
          Location settings
        </Link>
      </div>

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

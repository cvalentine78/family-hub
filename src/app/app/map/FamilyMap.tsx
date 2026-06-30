"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { MAX_ACCURACY_M } from "@/lib/location";
import Link from "next/link";
import type { Member } from "@/lib/family";

type Loc = {
  user_id: string;
  lat: number;
  lng: number;
  updated_at: string;
};

type Crumb = {
  lat: number;
  lng: number;
  recorded_at: string;
};

type Mode = "live" | "history";
type Range = "1h" | "today" | "24h" | "7d";

const RANGE_LABELS: Record<Range, string> = {
  "1h": "Last hour",
  today: "Today",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
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

// Start of the local day, or a fixed number of ms back, as an ISO string.
function cutoffFor(range: Range): string {
  if (range === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const ms = range === "1h" ? 3_600_000 : range === "24h" ? 86_400_000 : 7 * 86_400_000;
  return new Date(Date.now() - ms).toISOString();
}

// Great-circle distance between two points, in meters.
function haversine(a: Crumb, b: Crumb): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function formatDistance(meters: number): string {
  const miles = meters * 0.000621371;
  if (miles < 0.1) return `${Math.round(meters * 3.28084)} ft`;
  return `${miles.toFixed(1)} mi`;
}

function formatSpan(from: string, to: string): string {
  const mins = Math.round(
    (new Date(to).getTime() - new Date(from).getTime()) / 60000
  );
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function shortTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
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
  const [refreshing, setRefreshing] = useState(false);

  // Re-pull the latest saved positions from the DB and redraw. Realtime keeps
  // the map live while connected; this re-syncs after the connection has been
  // asleep (e.g. the app was backgrounded) so it's current the moment you look.
  const refreshMap = useCallback(async () => {
    setRefreshing(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("locations")
      .select("user_id, lat, lng, updated_at")
      .eq("family_id", familyId);
    if (data) {
      setLocations(new Map(data.map((l) => [l.user_id, l as Loc])));
    }
    setRefreshing(false);
  }, [familyId]);

  // Refresh whenever the map comes back into view.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshMap();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshMap]);

  // Broadcast channel used to ask every family device that's open to report a
  // fresh fix (see LocationRefreshResponder).
  const requestChannel = useRef<RealtimeChannel | null>(null);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`locreq:${familyId}`);
    channel.subscribe();
    requestChannel.current = channel;
    return () => {
      supabase.removeChannel(channel);
      requestChannel.current = null;
    };
  }, [familyId]);

  // History view state.
  const [mode, setMode] = useState<Mode>("live");
  const [historyUserId, setHistoryUserId] = useState<string>(currentUserId);
  const [range, setRange] = useState<Range>("today");
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  // The selection the loaded crumbs belong to; while it lags the current
  // selection we're still fetching. Avoids a setState-in-effect loading flag.
  const [loadedKey, setLoadedKey] = useState<string>("");

  const memberById = new Map(members.map((m) => [m.user_id, m]));

  // Update my own location now, and ask every other family device that's open
  // to do the same. Devices that are closed/backgrounded can't respond — they
  // keep updating on their own as the person moves.
  function updateNow() {
    // Ask everyone else's open app to report a fresh fix.
    requestChannel.current?.send({
      type: "broadcast",
      event: "refresh",
      payload: { by: currentUserId },
    });

    if (!navigator.geolocation) {
      setUpdateStatus("error");
      setStatusMsg("This device doesn't support location.");
      return;
    }
    setUpdateStatus("working");
    setStatusMsg("");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (accuracy != null && accuracy > MAX_ACCURACY_M) {
          setUpdateStatus("error");
          setStatusMsg(
            "Couldn't get an accurate fix (you may be indoors). Try again near a window or outside."
          );
          return;
        }
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
          setStatusMsg("");
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

  const historyKey = `${familyId}|${historyUserId}|${range}`;
  const historyLoading = mode === "history" && loadedKey !== historyKey;

  // Fetch the breadcrumb trail whenever the history selection changes.
  useEffect(() => {
    if (mode !== "history") return;
    let cancelled = false;
    const supabase = createClient();
    // Server-side trail: drops imprecise fixes and thins to ~1000 points across
    // the WHOLE window, so a full day isn't capped by PostgREST's 1000-row limit
    // (which had been dropping either the morning or the recent travel).
    supabase
      .rpc("location_trail", {
        p_user: historyUserId,
        p_family: familyId,
        p_since: cutoffFor(range),
        p_max: 1000,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("location_trail failed:", error.message);
        setCrumbs((data as Crumb[]) ?? []);
        setLoadedKey(historyKey);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, historyUserId, range, familyId, historyKey]);

  const locArray = Array.from(locations.values());

  const trailStats = useMemo(() => {
    if (crumbs.length < 2) return null;
    let meters = 0;
    for (let i = 1; i < crumbs.length; i++) {
      meters += haversine(crumbs[i - 1], crumbs[i]);
    }
    return {
      meters,
      from: crumbs[0].recorded_at,
      to: crumbs[crumbs.length - 1].recorded_at,
    };
  }, [crumbs]);

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

  const historyMember = memberById.get(historyUserId);

  // Family members who aren't sharing their location (so they never appear on
  // the map). share_location defaults off until they turn it on.
  const notSharing = members.filter((m) => !m.share_location);

  return (
    <div>
      {/* Mode switch */}
      <div className="inline-flex rounded-lg bg-gray-100 p-0.5 mb-3">
        {(["live", "history"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
              mode === m
                ? "bg-white text-sky-700 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {m === "live" ? "Live" : "History"}
          </button>
        ))}
      </div>

      {mode === "live" ? (
        <>
          <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
            <p className="text-sm text-gray-500">
              {locArray.length} member{locArray.length === 1 ? "" : "s"} sharing
              location
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={refreshMap}
                disabled={refreshing}
                className="text-sm font-medium bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 px-3 py-1.5 rounded-lg"
              >
                {refreshing ? "Refreshing…" : "🔄 Refresh"}
              </button>
              <button
                onClick={updateNow}
                disabled={updateStatus === "working"}
                className="text-sm font-medium bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg"
              >
                {updateStatus === "working" ? "Updating…" : "📍 Update everyone"}
              </button>
              <Link
                href={`/app/members/${currentUserId}`}
                className="text-sm font-medium text-sky-600 hover:text-sky-700"
              >
                Settings
              </Link>
            </div>
          </div>
          {notSharing.length > 0 && (
            <p className="text-sm text-amber-600 mb-1">
              📍 Not sharing:{" "}
              {notSharing
                .map((m) => (m.user_id === currentUserId ? "You" : m.display_name))
                .join(", ")}
            </p>
          )}
        </>
      ) : (
        <div className="mb-2 flex items-end justify-between gap-3 flex-wrap">
          <div className="flex items-end gap-3 flex-wrap">
            <label className="flex flex-col text-xs font-medium text-gray-500">
              Member
              <select
                value={historyUserId}
                onChange={(e) => setHistoryUserId(e.target.value)}
                className="mt-1 text-sm font-medium text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-1.5"
              >
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.user_id === currentUserId ? "You" : m.display_name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs font-medium text-gray-500">
              When
              <select
                value={range}
                onChange={(e) => setRange(e.target.value as Range)}
                className="mt-1 text-sm font-medium text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-1.5"
              >
                {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
                  <option key={r} value={r}>
                    {RANGE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-sm text-gray-500">
            {historyLoading
              ? "Loading trail…"
              : crumbs.length === 0
              ? "No location history for this window."
              : trailStats
              ? `${crumbs.length} points · ${formatSpan(
                  trailStats.from,
                  trailStats.to
                )} · ${formatDistance(trailStats.meters)}`
              : `${crumbs.length} point`}
          </p>
        </div>
      )}

      {mode === "live" && statusMsg && (
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
            {mode === "live" ? (
              <>
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
                        <MemberPin member={m} name={name} />
                        <span className="mt-0.5 text-[11px] font-medium bg-white/90 px-1.5 rounded shadow-sm whitespace-nowrap">
                          {loc.user_id === currentUserId ? "You" : name}
                        </span>
                      </div>
                    </AdvancedMarker>
                  );
                })}
              </>
            ) : (
              <HistoryTrail
                crumbs={crumbs}
                member={historyMember}
                memberName={
                  historyUserId === currentUserId
                    ? "You"
                    : historyMember?.display_name ?? "Member"
                }
              />
            )}
          </GoogleMap>
        </APIProvider>
      </div>
    </div>
  );
}

// A round avatar pin (photo if available, else initials).
function MemberPin({
  member,
  name,
}: {
  member: Member | undefined;
  name: string;
}) {
  return (
    <div className="w-10 h-10 rounded-full border-2 border-white shadow-md overflow-hidden bg-sky-100">
      {member?.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.avatar_url}
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

// Draws a breadcrumb trail: a polyline through every fix, small dots at each
// ping, a green flag at the start and the member's avatar at the latest fix.
// Auto-fits the map to the whole trail.
function HistoryTrail({
  crumbs,
  member,
  memberName,
}: {
  crumbs: Crumb[];
  member: Member | undefined;
  memberName: string;
}) {
  const map = useMap();
  const mapsLib = useMapsLibrary("maps");

  // The polyline is drawn imperatively — this version of the library has no
  // declarative Polyline component.
  useEffect(() => {
    if (!map || !mapsLib || crumbs.length < 2) return;
    const line = new mapsLib.Polyline({
      path: crumbs.map((c) => ({ lat: c.lat, lng: c.lng })),
      geodesic: true,
      strokeColor: "#0284c7",
      strokeOpacity: 0.9,
      strokeWeight: 4,
    });
    line.setMap(map);
    return () => line.setMap(null);
  }, [map, mapsLib, crumbs]);

  // Frame the whole trail (or a single point) when it changes.
  useEffect(() => {
    if (!map || crumbs.length === 0) return;
    if (crumbs.length === 1) {
      map.setCenter({ lat: crumbs[0].lat, lng: crumbs[0].lng });
      map.setZoom(17);
      return;
    }
    const lats = crumbs.map((c) => c.lat);
    const lngs = crumbs.map((c) => c.lng);
    map.fitBounds(
      {
        north: Math.max(...lats),
        south: Math.min(...lats),
        east: Math.max(...lngs),
        west: Math.min(...lngs),
      },
      80
    );
  }, [map, crumbs]);

  if (crumbs.length === 0) return null;

  const start = crumbs[0];
  const end = crumbs[crumbs.length - 1];
  // Skip endpoints; only show intermediate dots, and cap them so a long trail
  // doesn't spawn a thousand markers.
  const dots =
    crumbs.length > 2 && crumbs.length <= 250 ? crumbs.slice(1, -1) : [];

  return (
    <>
      {dots.map((c, i) => (
        <AdvancedMarker
          key={`${c.recorded_at}-${i}`}
          position={{ lat: c.lat, lng: c.lng }}
          title={shortTime(c.recorded_at)}
        >
          <div className="w-2.5 h-2.5 rounded-full bg-sky-500 border border-white shadow-sm" />
        </AdvancedMarker>
      ))}

      {crumbs.length > 1 && (
        <AdvancedMarker
          position={{ lat: start.lat, lng: start.lng }}
          title={`Start · ${shortTime(start.recorded_at)}`}
        >
          <div className="flex flex-col items-center">
            <div className="w-4 h-4 rounded-full bg-emerald-500 border-2 border-white shadow-md" />
            <span className="mt-0.5 text-[11px] font-medium bg-white/90 px-1.5 rounded shadow-sm whitespace-nowrap">
              Start · {shortTime(start.recorded_at)}
            </span>
          </div>
        </AdvancedMarker>
      )}

      <AdvancedMarker
        position={{ lat: end.lat, lng: end.lng }}
        title={`Latest · ${shortTime(end.recorded_at)}`}
      >
        <div className="flex flex-col items-center">
          <MemberPin member={member} name={memberName} />
          <span className="mt-0.5 text-[11px] font-medium bg-white/90 px-1.5 rounded shadow-sm whitespace-nowrap">
            {memberName} · {timeAgo(end.recorded_at)}
          </span>
        </div>
      </AdvancedMarker>
    </>
  );
}

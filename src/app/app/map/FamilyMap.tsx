"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  ControlPosition,
  InfoWindow,
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

type Stop = {
  lat: number;
  lng: number;
  arrived_at: string;
  departed_at: string;
  point_count: number;
  ongoing: boolean;
};

// A stable id for the Map instance, so components outside it (StopsList) can
// still control it via useMap(FAMILY_MAP_ID).
const FAMILY_MAP_ID = "familyMap";

type Mode = "live" | "history";
type Range = "1h" | "today" | "24h" | "7d" | "30d" | "day";

const RANGE_LABELS: Record<Range, string> = {
  "1h": "Last hour",
  today: "Today",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  day: "Pick a day / time…",
};

// History is purged after 30 days (nightly cron), so the day picker and the
// widest range both stop there.
const HISTORY_DAYS = 30;

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// A local calendar date as the YYYY-MM-DD string <input type="date"> uses.
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// The [since, until) window for a range selection, as ISO instants. "day" is
// a from/to time span on one local calendar day (defaults cover the whole
// day); a "to" at or before "from" rolls past midnight into the next morning,
// so "11 PM to 1 AM" works. Everything else ends now.
function windowFor(
  range: Range,
  day: string,
  fromTime: string,
  toTime: string
): { since: string; until: string } {
  if (range === "day") {
    const [y, m, d] = day.split("-").map(Number);
    const [fh, fm] = fromTime.split(":").map(Number);
    const [th, tm] = toTime.split(":").map(Number);
    const since = new Date(y, m - 1, d, fh, fm);
    // +1 minute makes the "to" minute inclusive (and turns the default 23:59
    // into next-midnight, covering the full day).
    const until = new Date(y, m - 1, toTime <= fromTime ? d + 1 : d, th, tm + 1);
    return { since: since.toISOString(), until: until.toISOString() };
  }
  const until = new Date().toISOString();
  if (range === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { since: d.toISOString(), until };
  }
  const ms =
    range === "1h"
      ? 3_600_000
      : range === "24h"
      ? 86_400_000
      : range === "7d"
      ? 7 * 86_400_000
      : HISTORY_DAYS * 86_400_000;
  return { since: new Date(Date.now() - ms).toISOString(), until };
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

// Time with the day attached, for windows that can span several days
// ("Tue, Jul 7, 2:34 PM").
function fullTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
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
  // The specific local day + time span shown when range is "day".
  const [day, setDay] = useState<string>(() => localDateStr(new Date()));
  const [fromTime, setFromTime] = useState<string>("00:00");
  const [toTime, setToTime] = useState<string>("23:59");
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
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

  const historyKey = `${familyId}|${historyUserId}|${range}${
    range === "day" ? `|${day}|${fromTime}|${toTime}` : ""
  }`;
  const historyLoading = mode === "history" && loadedKey !== historyKey;

  // Fetch the breadcrumb trail + stops list whenever the history selection changes.
  useEffect(() => {
    if (mode !== "history") return;
    let cancelled = false;
    const supabase = createClient();
    const { since, until } = windowFor(range, day, fromTime, toTime);

    // Server-side trail: drops imprecise fixes and thins to ~1000 points across
    // the WHOLE window, so a full day isn't capped by PostgREST's 1000-row limit
    // (which had been dropping either the morning or the recent travel).
    const trail = supabase
      .rpc("location_trail", {
        p_user: historyUserId,
        p_family: familyId,
        p_since: since,
        p_until: until,
        p_max: 1000,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("location_trail failed:", error.message);
        setCrumbs((data as Crumb[]) ?? []);
      });

    // Stops: places dwelled for a while, turning the raw trail into a
    // human-readable "where were they, and for how long" timeline.
    const stopsReq = supabase
      .rpc("location_stops", {
        p_user: historyUserId,
        p_family: familyId,
        p_since: since,
        p_until: until,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("location_stops failed:", error.message);
        setStops((data as Stop[]) ?? []);
      });

    Promise.all([trail, stopsReq]).then(() => {
      if (!cancelled) setLoadedKey(historyKey);
    });

    return () => {
      cancelled = true;
    };
  }, [mode, historyUserId, range, day, fromTime, toTime, familyId, historyKey]);

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
            {range === "day" && (
              <>
                <label className="flex flex-col text-xs font-medium text-gray-500">
                  Day
                  <input
                    type="date"
                    value={day}
                    min={localDateStr(
                      new Date(Date.now() - (HISTORY_DAYS - 1) * 86_400_000)
                    )}
                    max={localDateStr(new Date())}
                    onChange={(e) => {
                      if (e.target.value) setDay(e.target.value);
                    }}
                    className="mt-1 text-sm font-medium text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-1"
                  />
                </label>
                <label className="flex flex-col text-xs font-medium text-gray-500">
                  From
                  <input
                    type="time"
                    value={fromTime}
                    onChange={(e) => {
                      if (e.target.value) setFromTime(e.target.value);
                    }}
                    className="mt-1 text-sm font-medium text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-1"
                  />
                </label>
                <label className="flex flex-col text-xs font-medium text-gray-500">
                  To
                  <input
                    type="time"
                    value={toTime}
                    onChange={(e) => {
                      if (e.target.value) setToTime(e.target.value);
                    }}
                    className="mt-1 text-sm font-medium text-gray-800 bg-white border border-gray-200 rounded-lg px-2 py-1"
                  />
                </label>
              </>
            )}
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

      <APIProvider apiKey={apiKey}>
        <div className="rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
          <GoogleMap
            id={FAMILY_MAP_ID}
            mapId="DEMO_MAP_ID"
            defaultCenter={center}
            defaultZoom={zoom}
            gestureHandling="greedy"
            disableDefaultUI={false}
            // Default bottom-right zoom control can end up under the mobile
            // bottom nav bar; top-right is always clear of it.
            zoomControlOptions={{ position: ControlPosition.RIGHT_TOP }}
            fullscreenControlOptions={{ position: ControlPosition.RIGHT_TOP }}
            style={{ width: "100%", height: "70vh" }}
          >
            <MapKick />
            {mode === "live" ? (
              <>
                <FitBounds locs={locArray} />
                <LiveMarkers
                  locs={locArray}
                  memberById={memberById}
                  currentUserId={currentUserId}
                />
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
        </div>

        {mode === "history" && <StopsList stops={stops} />}
      </APIProvider>
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

// The base map tiles can render grey until the map gets a resize event —
// common in the Android WebView, where the map paints before the container is
// settled (toggling Map/Satellite is what forced it to redraw). Nudge it once
// the map is ready, and again on the next frame, so tiles load on first view.
function MapKick() {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    let raf = 0;
    const kick = () => window.google?.maps?.event?.trigger(map, "resize");
    const t = setTimeout(() => {
      kick();
      raf = requestAnimationFrame(kick);
    }, 150);
    return () => {
      clearTimeout(t);
      cancelAnimationFrame(raf);
    };
  }, [map]);
  return null;
}

// Live-mode avatar markers. Tapping one zooms/pans the map to that person.
function LiveMarkers({
  locs,
  memberById,
  currentUserId,
}: {
  locs: Loc[];
  memberById: Map<string, Member>;
  currentUserId: string;
}) {
  const map = useMap();

  return (
    <>
      {locs.map((loc) => {
        const m = memberById.get(loc.user_id);
        const name = m?.display_name ?? "Member";
        return (
          <AdvancedMarker
            key={loc.user_id}
            position={{ lat: loc.lat, lng: loc.lng }}
            title={`${name} · ${timeAgo(loc.updated_at)}`}
            onClick={() => {
              if (!map) return;
              map.panTo({ lat: loc.lat, lng: loc.lng });
              map.setZoom(18);
            }}
          >
            <div className="flex flex-col items-center cursor-pointer">
              <MemberPin member={m} name={name} />
              <span className="mt-0.5 text-[11px] font-medium bg-white/90 px-1.5 rounded shadow-sm whitespace-nowrap">
                {loc.user_id === currentUserId ? "You" : name}
              </span>
            </div>
          </AdvancedMarker>
        );
      })}
    </>
  );
}

// Session-lived cache: rounded "lat,lng" -> short address, so repeat stops at
// the same place (home, work, day after day) don't re-geocode every time.
const geocodeCache = new Map<string, string>();

// Turns a full formatted address into a short "street, city" label.
function shortAddress(formatted: string): string {
  return formatted.split(", ").slice(0, 2).join(", ");
}

// Renders the History "stops" timeline: places dwelled for a while, each
// reverse-geocoded to a short address, tap to zoom the map to that stop.
// Lives inside the same APIProvider as the map but outside <Map>, and reaches
// the map instance via its shared id so tapping a row can still control it.
function StopsList({ stops }: { stops: Stop[] }) {
  const map = useMap(FAMILY_MAP_ID);
  const geocodingLib = useMapsLibrary("geocoding");
  // Bumped to force a re-render once a geocode result lands in the module-level
  // cache below (mutating that Map doesn't itself trigger React to re-render).
  const [, bumpVersion] = useState(0);

  useEffect(() => {
    if (!geocodingLib) return;
    const geocoder = new geocodingLib.Geocoder();
    let cancelled = false;

    stops.forEach((s) => {
      const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
      if (geocodeCache.has(key)) return;
      geocoder.geocode({ location: { lat: s.lat, lng: s.lng } }, (results, status) => {
        if (cancelled) return;
        if (status === "OK" && results && results[0]) {
          geocodeCache.set(key, shortAddress(results[0].formatted_address));
          bumpVersion((n) => n + 1);
        }
      });
    });

    return () => {
      cancelled = true;
    };
  }, [stops, geocodingLib]);

  if (stops.length === 0) return null;

  return (
    <div className="mt-3 bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100 overflow-hidden">
      {stops.map((s, i) => {
        const key = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
        const label = geocodeCache.get(key);
        return (
        <button
          key={`${s.arrived_at}-${i}`}
          onClick={() => {
            if (!map) return;
            map.panTo({ lat: s.lat, lng: s.lng });
            map.setZoom(17);
          }}
          className="w-full flex items-center gap-3 p-3 text-left hover:bg-gray-50 transition-colors"
        >
          <div className="w-9 h-9 rounded-full bg-sky-50 flex items-center justify-center text-lg shrink-0">
            📍
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">
              {label ?? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}`}
            </p>
            <p className="text-xs text-gray-500">
              {shortTime(s.arrived_at)} – {s.ongoing ? "now" : shortTime(s.departed_at)}
              {" · "}
              {formatSpan(s.arrived_at, s.ongoing ? new Date().toISOString() : s.departed_at)}
              {s.ongoing && " (ongoing)"}
            </p>
          </div>
        </button>
        );
      })}
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
  // The dot whose info bubble (address + time) is open, if any.
  const [selected, setSelected] = useState<Crumb | null>(null);

  // Close the bubble whenever the trail itself changes (different member,
  // range, or day) — the old point may not even be on screen anymore.
  useEffect(() => {
    setSelected(null);
  }, [crumbs]);

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
  // Skip endpoints; show intermediate dots, thinned to at most ~250 so a long
  // trail doesn't spawn a thousand markers (every point still lives in the
  // polyline — the dots are just the tappable samples).
  const inner = crumbs.length > 2 ? crumbs.slice(1, -1) : [];
  const step = Math.max(1, Math.ceil(inner.length / 250));
  const dots = inner.filter((_, i) => i % step === 0);

  return (
    <>
      {dots.map((c, i) => (
        <AdvancedMarker
          key={`${c.recorded_at}-${i}`}
          position={{ lat: c.lat, lng: c.lng }}
          title={shortTime(c.recorded_at)}
          onClick={() => setSelected(c)}
        >
          {/* Invisible padding widens the touch target past the tiny dot. */}
          <div className="p-1.5 cursor-pointer">
            <div className="w-2.5 h-2.5 rounded-full bg-sky-500 border border-white shadow-sm" />
          </div>
        </AdvancedMarker>
      ))}

      {crumbs.length > 1 && (
        <AdvancedMarker
          position={{ lat: start.lat, lng: start.lng }}
          title={`Start · ${shortTime(start.recorded_at)}`}
          onClick={() => setSelected(start)}
        >
          <div className="flex flex-col items-center cursor-pointer">
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
        onClick={() => setSelected(end)}
      >
        <div className="flex flex-col items-center cursor-pointer">
          <MemberPin member={member} name={memberName} />
          <span className="mt-0.5 text-[11px] font-medium bg-white/90 px-1.5 rounded shadow-sm whitespace-nowrap">
            {memberName} · {timeAgo(end.recorded_at)}
          </span>
        </div>
      </AdvancedMarker>

      {selected && (
        <InfoWindow
          position={{ lat: selected.lat, lng: selected.lng }}
          pixelOffset={[0, -8]}
          onCloseClick={() => setSelected(null)}
        >
          <CrumbInfo crumb={selected} />
        </InfoWindow>
      )}
    </>
  );
}

// The tap bubble for a breadcrumb dot: when it was recorded plus the
// reverse-geocoded address (shared cache with the stops list, so tapping a dot
// at a known stop is instant).
function CrumbInfo({ crumb }: { crumb: Crumb }) {
  const geocodingLib = useMapsLibrary("geocoding");
  const key = `${crumb.lat.toFixed(4)},${crumb.lng.toFixed(4)}`;
  const [address, setAddress] = useState<string | null>(
    () => geocodeCache.get(key) ?? null
  );

  useEffect(() => {
    const cached = geocodeCache.get(key);
    setAddress(cached ?? null);
    if (cached || !geocodingLib) return;
    let cancelled = false;
    new geocodingLib.Geocoder().geocode(
      { location: { lat: crumb.lat, lng: crumb.lng } },
      (results, status) => {
        if (cancelled) return;
        if (status === "OK" && results && results[0]) {
          const short = shortAddress(results[0].formatted_address);
          geocodeCache.set(key, short);
          setAddress(short);
        } else {
          setAddress(`${crumb.lat.toFixed(4)}, ${crumb.lng.toFixed(4)}`);
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [key, geocodingLib, crumb.lat, crumb.lng]);

  return (
    <div className="text-sm pr-1">
      <p className="font-medium text-gray-800">
        {address ?? "Looking up address…"}
      </p>
      <p className="text-gray-500 mt-0.5">{fullTime(crumb.recorded_at)}</p>
    </div>
  );
}

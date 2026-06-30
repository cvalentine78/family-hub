// "Last seen" presence helpers, shared by every screen that shows who's around.
//
// A member is "active" if their app reported a heartbeat (or a background
// location fix) within ACTIVE_WINDOW_MS. The heartbeat fires every 60s while
// the app is foreground, so a 3-minute window tolerates a missed beat or two.

export const ACTIVE_WINDOW_MS = 3 * 60 * 1000;

export function isActive(lastSeen: string | null | undefined, now: number): boolean {
  if (!lastSeen) return false;
  return now - new Date(lastSeen).getTime() < ACTIVE_WINDOW_MS;
}

// "Active now" / "Active 5m ago" / "Active 2h ago" / "Active 3d ago" / "Offline".
export function lastSeenLabel(
  lastSeen: string | null | undefined,
  now: number
): string {
  if (!lastSeen) return "Offline";
  const secs = Math.floor((now - new Date(lastSeen).getTime()) / 1000);
  if (secs * 1000 < ACTIVE_WINDOW_MS) return "Active now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `Active ${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Active ${hrs}h ago`;
  return `Active ${Math.floor(hrs / 24)}d ago`;
}

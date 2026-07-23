// Adult status from a profile's date_of_birth ("YYYY-MM-DD"). A null
// date_of_birth (not yet collected) is treated as adult — this only gates
// the alarm checkbox on events, not a general permission system, so
// "unknown" must never be more restrictive than "adult".
export function isAdult(dateOfBirth: string | null): boolean {
  if (!dateOfBirth) return true;

  const dob = new Date(dateOfBirth);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const hadBirthdayThisYear =
    now.getMonth() > dob.getMonth() ||
    (now.getMonth() === dob.getMonth() && now.getDate() >= dob.getDate());
  if (!hadBirthdayThisYear) age--;

  return age >= 18;
}

// Rejects a submitted date_of_birth that's obviously wrong (in the future, or
// older than anyone plausibly using this app). This is a sanity check on
// input, not a substitute for isAdult() — an implausible date only ever
// pushes toward the more restrictive "not adult" outcome above, never the
// reverse, so getting this wrong can't weaken the alarm/location gates.
export function isPlausibleDateOfBirth(dateOfBirth: string): boolean {
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return false;

  const now = new Date();
  if (dob > now) return false;

  const MAX_AGE_YEARS = 120;
  const oldest = new Date(now.getFullYear() - MAX_AGE_YEARS, now.getMonth(), now.getDate());
  return dob >= oldest;
}

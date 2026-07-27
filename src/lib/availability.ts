import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { addMinutes, parseISO, format } from "date-fns";
import type { BusinessHours, TimeSlot } from "@/types";

/** Number of alternatives offered when a requested slot is already taken. */
const MAX_ALTERNATIVES = 3;

export function computeAvailableSlots(
  date: string,
  durationMinutes: number,
  timezone: string,
  hours: BusinessHours[],
  existingAppointments: Array<{ starts_at: string; ends_at: string }>,
): TimeSlot[] {
  // Accept YYYY-MM-DD (tolerate a trailing time component from the caller).
  const dateOnly = date.slice(0, 10);
  // Day-of-week of a calendar date is fixed regardless of timezone; deriving it
  // via a UTC round-trip avoids the midnight/DST off-by-one that toZonedTime hit.
  const [year, month, day] = dateOnly.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const dayHours = hours.find((h) => h.day_of_week === dayOfWeek);
  if (!dayHours || dayHours.is_closed || dayHours.hours_ranges.length === 0)
    return [];

  const bookedIntervals = existingAppointments.map((a) => ({
    start: parseISO(a.starts_at),
    end: parseISO(a.ends_at),
  }));

  const slots: TimeSlot[] = [];

  for (const range of dayHours.hours_ranges) {
    // Build the open/close instants directly from the local date + time in the
    // business timezone (fromZonedTime handles the UTC offset / DST correctly).
    const openUtc = fromZonedTime(`${dateOnly}T${range.open}:00`, timezone);
    const closeUtc = fromZonedTime(`${dateOnly}T${range.close}:00`, timezone);

    let cursor = openUtc;
    while (addMinutes(cursor, durationMinutes) <= closeUtc) {
      const slotEnd = addMinutes(cursor, durationMinutes);
      const overlaps = bookedIntervals.some(
        (b) => cursor < b.end && slotEnd > b.start,
      );
      if (!overlaps) {
        slots.push({
          starts_at: cursor.toISOString(),
          ends_at: slotEnd.toISOString(),
        });
      }
      cursor = addMinutes(cursor, 30);
    }
  }

  return slots;
}

/**
 * True when two half-open intervals [start, end) overlap. Back-to-back
 * appointments (one ending exactly when the next starts) do NOT conflict.
 */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/**
 * Does the requested window collide with anything already on the books?
 * `busy` mixes our own appointments with Google Calendar busy blocks, so an
 * event the owner created directly in Google blocks the slot too. Entries whose
 * timestamps fail to parse are skipped rather than treated as busy — refusing a
 * booking on unreadable data would be worse than allowing it.
 */
export function hasConflict(
  startsAt: string,
  endsAt: string,
  busy: TimeSlot[],
): boolean {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))
    return false;

  return busy.some((b) => {
    const bStart = new Date(b.starts_at);
    const bEnd = new Date(b.ends_at);
    if (Number.isNaN(bStart.getTime()) || Number.isNaN(bEnd.getTime()))
      return false;
    return overlaps(start, end, bStart, bEnd);
  });
}

/**
 * Pick the open slots nearest to the time the caller actually asked for, so the
 * agent can counter-offer "a little before or a little after" instead of
 * reciting the whole day. Candidates are ranked by distance from the requested
 * start — which naturally surfaces both sides when both are open — with earlier
 * slots winning ties, and the result is returned in chronological order so it
 * reads naturally when spoken.
 *
 * `notBefore` drops slots that have already passed, which matters when the
 * caller asks for a time earlier today: every open slot before now is real
 * according to business hours but impossible to actually book.
 */
export function suggestAdjacentSlots(
  requestedStartsAt: string,
  openSlots: TimeSlot[],
  notBefore?: Date,
  limit: number = MAX_ALTERNATIVES,
): TimeSlot[] {
  const floor = notBefore?.getTime() ?? -Infinity;
  const bookable = openSlots.filter(
    (slot) => new Date(slot.starts_at).getTime() >= floor,
  );

  const requested = new Date(requestedStartsAt).getTime();
  if (Number.isNaN(requested)) return bookable.slice(0, limit);

  return bookable
    .map((slot) => ({ slot, start: new Date(slot.starts_at).getTime() }))
    .filter(({ start }) => !Number.isNaN(start) && start !== requested)
    .sort((a, b) => {
      const byDistance =
        Math.abs(a.start - requested) - Math.abs(b.start - requested);
      return byDistance !== 0 ? byDistance : a.start - b.start;
    })
    .slice(0, limit)
    .sort((a, b) => a.start - b.start)
    .map(({ slot }) => slot);
}

export function formatSlotForSpeech(slot: TimeSlot, timezone: string): string {
  const local = toZonedTime(parseISO(slot.starts_at), timezone);
  return format(local, "EEEE, MMMM do 'at' h:mm a");
}

/** Join slots into a phrase the agent can read back: "A, B, or C". */
export function formatSlotsForSpeech(
  slots: TimeSlot[],
  timezone: string,
): string {
  const spoken = slots.map((s) => formatSlotForSpeech(s, timezone));
  if (spoken.length <= 1) return spoken.join("");
  return `${spoken.slice(0, -1).join(", ")} or ${spoken[spoken.length - 1]}`;
}

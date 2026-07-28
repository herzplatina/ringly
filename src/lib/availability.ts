import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { addMinutes, isWithinInterval, parseISO, format } from "date-fns";
import type { BusinessHours, TimeSlot } from "@/types";

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
 * True if the window [startsAt, endsAt) overlaps any busy interval. Uses the
 * same strict overlap rule as computeAvailableSlots, so a slot that booking
 * would reject is never offered by check_availability and vice versa.
 */
export function hasConflict(
  busyIntervals: Array<{ starts_at: string; ends_at: string }>,
  startsAt: string,
  endsAt: string,
): boolean {
  const start = parseISO(startsAt);
  const end = parseISO(endsAt);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
  return busyIntervals.some((b) => {
    const busyStart = parseISO(b.starts_at);
    const busyEnd = parseISO(b.ends_at);
    return start < busyEnd && end > busyStart;
  });
}

/** Drop slots that don't start in the future — they can never be booked. */
export function filterFutureSlots(
  slots: TimeSlot[],
  now: Date = new Date(),
): TimeSlot[] {
  return slots.filter((s) => parseISO(s.starts_at) > now);
}

/**
 * The nearest open slots on either side of a requested start time on the same
 * date: up to `perSide` earlier and `perSide` later, in chronological order.
 * Slots already in the past are never offered.
 */
export function findAlternativeSlots(
  date: string,
  durationMinutes: number,
  timezone: string,
  hours: BusinessHours[],
  busyIntervals: Array<{ starts_at: string; ends_at: string }>,
  requestedStart: string,
  perSide = 2,
): TimeSlot[] {
  const requested = parseISO(requestedStart);
  const open = filterFutureSlots(
    computeAvailableSlots(date, durationMinutes, timezone, hours, busyIntervals),
  );
  const earlier = open.filter((s) => parseISO(s.starts_at) < requested);
  const later = open.filter((s) => parseISO(s.starts_at) > requested);
  return [...earlier.slice(-perSide), ...later.slice(0, perSide)];
}

export function formatSlotForSpeech(slot: TimeSlot, timezone: string): string {
  const local = toZonedTime(parseISO(slot.starts_at), timezone);
  return format(local, "EEEE, MMMM do 'at' h:mm a");
}

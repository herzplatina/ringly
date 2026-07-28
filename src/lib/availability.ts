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

export function formatSlotForSpeech(slot: TimeSlot, timezone: string): string {
  const local = toZonedTime(parseISO(slot.starts_at), timezone);
  return format(local, "EEEE, MMMM do 'at' h:mm a");
}


/**
 * Given a specific requested slot, check whether it conflicts with any of the
 * provided booked intervals.  Returns true when the slot is free.
 */
export function isSlotFree(
  startsAt: string,
  endsAt: string,
  bookedIntervals: Array<{ starts_at: string; ends_at: string }>,
): boolean {
  const start = parseISO(startsAt);
  const end = parseISO(endsAt);
  return !bookedIntervals.some((b) => {
    const bStart = parseISO(b.starts_at);
    const bEnd = parseISO(b.ends_at);
    return start < bEnd && end > bStart;
  });
}

/**
 * Return the closest free slots around `requestedStart` (before and after).
 * Slots that are in the past (relative to `now`) are excluded.
 */
export function nearestAlternatives(
  requestedStart: string,
  durationMinutes: number,
  timezone: string,
  hours: BusinessHours[],
  bookedIntervals: Array<{ starts_at: string; ends_at: string }>,
  now: Date = new Date(),
  maxAlternatives: number = 3,
): TimeSlot[] {
  // Compute slots for the requested date
  const dateOnly = requestedStart.slice(0, 10);
  const allSlots = computeAvailableSlots(
    dateOnly,
    durationMinutes,
    timezone,
    hours,
    bookedIntervals,
  );

  // Filter out slots in the past
  const futureSlots = allSlots.filter((s) => parseISO(s.starts_at) > now);

  // Sort by absolute distance from the requested start
  const target = parseISO(requestedStart).getTime();
  futureSlots.sort(
    (a, b) =>
      Math.abs(parseISO(a.starts_at).getTime() - target) -
      Math.abs(parseISO(b.starts_at).getTime() - target),
  );

  return futureSlots.slice(0, maxAlternatives);
}

import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { addMinutes, parseISO, format } from "date-fns";
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
 * Check whether a specific window `[slotStart, slotEnd)` overlaps with any
 * busy interval.  Back-to-back is allowed: one ending exactly when the other
 * begins does NOT count as a conflict.
 */
export function hasConflict(
  slotStart: Date,
  slotEnd: Date,
  busyIntervals: Array<{ starts_at: string; ends_at: string }>,
): boolean {
  return busyIntervals.some((b) => {
    const bStart = new Date(b.starts_at).getTime();
    const bEnd = new Date(b.ends_at).getTime();
    return slotStart.getTime() < bEnd && slotEnd.getTime() > bStart;
  });
}

/**
 * Check whether a slot fits entirely within one of the day's open ranges.
 */
export function isWithinBusinessHours(
  slotStart: Date,
  slotEnd: Date,
  hours: BusinessHours[],
  timezone: string,
  dateOnly: string, // YYYY-MM-DD
): boolean {
  const [year, month, day] = dateOnly.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const dayHours = hours.find((h) => h.day_of_week === dayOfWeek);
  if (!dayHours || dayHours.is_closed || dayHours.hours_ranges.length === 0)
    return false;

  for (const range of dayHours.hours_ranges) {
    const openUtc = fromZonedTime(`${dateOnly}T${range.open}:00`, timezone);
    const closeUtc = fromZonedTime(`${dateOnly}T${range.close}:00`, timezone);
    if (slotStart >= openUtc && slotEnd <= closeUtc) return true;
  }

  return false;
}

/**
 * Find the nearest available alternatives around a requested time.
 *
 * - Filters out slots in the past.
 * - Never returns the exact refused slot.
 * - Sorts by proximity to the requested start so the caller hears the
 *   closest options on either side.
 */
export function findAlternatives(
  requestedStart: Date,
  allSlots: TimeSlot[],
  maxCount: number = 6,
): TimeSlot[] {
  const now = new Date();

  const candidates = allSlots.filter(
    (s) => new Date(s.starts_at).getTime() > now.getTime(),
  );

  // Sort by distance from requested start
  const sorted = [...candidates].sort((a, b) => {
    const distA = Math.abs(
      new Date(a.starts_at).getTime() - requestedStart.getTime(),
    );
    const distB = Math.abs(
      new Date(b.starts_at).getTime() - requestedStart.getTime(),
    );
    return distA - distB;
  });

  return sorted.slice(0, maxCount);
}

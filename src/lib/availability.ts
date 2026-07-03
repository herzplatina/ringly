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

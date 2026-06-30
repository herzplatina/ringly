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
  const localDate = toZonedTime(parseISO(date), timezone);
  const dayOfWeek = localDate.getDay();

  const dayHours = hours.find((h) => h.day_of_week === dayOfWeek);
  if (!dayHours || dayHours.is_closed || dayHours.hours_ranges.length === 0)
    return [];

  const bookedIntervals = existingAppointments.map((a) => ({
    start: parseISO(a.starts_at),
    end: parseISO(a.ends_at),
  }));

  const slots: TimeSlot[] = [];

  for (const range of dayHours.hours_ranges) {
    const [openH, openM] = range.open.split(":").map(Number);
    const [closeH, closeM] = range.close.split(":").map(Number);

    const localOpen = new Date(localDate);
    localOpen.setHours(openH, openM, 0, 0);
    const localClose = new Date(localDate);
    localClose.setHours(closeH, closeM, 0, 0);

    const openUtc = fromZonedTime(localOpen, timezone);
    const closeUtc = fromZonedTime(localClose, timezone);

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

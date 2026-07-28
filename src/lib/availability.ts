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
export type BusyInterval = { starts_at: string; ends_at: string };

/**
 * Strict overlap check: one interval ending exactly when the other begins does
 * NOT count as a conflict, so back-to-back bookings are allowed.
 */
export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function parseInstant(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** True when the [startsAt, endsAt] window collides with any busy interval. */
export function hasBusyConflict(
  startsAt: Date,
  endsAt: Date,
  busy: BusyInterval[],
): boolean {
  return busy.some((b) => {
    const bStart = parseInstant(b.starts_at);
    const bEnd = parseInstant(b.ends_at);
    return (
      bStart !== null &&
      bEnd !== null &&
      intervalsOverlap(startsAt, endsAt, bStart, bEnd)
    );
  });
}

/** True when the whole [startsAt, endsAt] window fits inside one open range. */
export function isWithinBusinessHours(
  startsAt: Date,
  endsAt: Date,
  timezone: string,
  hours: BusinessHours[],
): boolean {
  // Local wall-clock date of the request in the business timezone.
  const dateOnly = format(toZonedTime(startsAt, timezone), "yyyy-MM-dd");
  const [year, month, day] = dateOnly.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const dayHours = hours.find((h) => h.day_of_week === dayOfWeek);
  if (!dayHours || dayHours.is_closed || dayHours.hours_ranges.length === 0)
    return false;

  return dayHours.hours_ranges.some((range) => {
    const openUtc = fromZonedTime(`${dateOnly}T${range.open}:00`, timezone);
    const closeUtc = fromZonedTime(`${dateOnly}T${range.close}:00`, timezone);
    return startsAt >= openUtc && endsAt <= closeUtc;
  });
}

export type SlotBlocker = "past" | "outside_hours" | "conflict";

/**
 * Why a requested window cannot be booked, or null when booking would accept
 * it. `busy` must already combine our own appointments AND the business's
 * Google Calendar so the two sources can never disagree.
 */
export function slotBlocker(
  startsAt: Date,
  endsAt: Date,
  timezone: string,
  hours: BusinessHours[],
  busy: BusyInterval[],
  now: Date = new Date(),
): SlotBlocker | null {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()))
    return "outside_hours";
  if (startsAt.getTime() <= now.getTime()) return "past";
  if (!isWithinBusinessHours(startsAt, endsAt, timezone, hours))
    return "outside_hours";
  if (hasBusyConflict(startsAt, endsAt, busy)) return "conflict";
  return null;
}

/**
 * Real, bookable counter-offers around a refused time: every returned slot is
 * inside opening hours, free of every busy interval (appointments + calendar),
 * in the future, and never the refused slot itself — so a caller who accepts
 * one can actually book it. Empty when the day has nothing left to offer.
 */
export function nearestAvailableSlots(
  requestedStartsAt: Date,
  durationMinutes: number,
  timezone: string,
  hours: BusinessHours[],
  busy: BusyInterval[],
  options: { now?: Date; perSide?: number } = {},
): TimeSlot[] {
  const now = options.now ?? new Date();
  const perSide = options.perSide ?? 2;
  const dateOnly = format(
    toZonedTime(requestedStartsAt, timezone),
    "yyyy-MM-dd",
  );
  const requestedMs = requestedStartsAt.getTime();

  const candidates = computeAvailableSlots(
    dateOnly,
    durationMinutes,
    timezone,
    hours,
    busy,
  ).filter((slot) => {
    const startMs = new Date(slot.starts_at).getTime();
    // Never offer a time that has already passed, nor the slot just refused.
    return startMs > now.getTime() && startMs !== requestedMs;
  });

  // computeAvailableSlots emits ascending order, so the nearest open times on
  // either side are the tail of the earlier group and the head of the later.
  const before = candidates
    .filter((s) => new Date(s.starts_at).getTime() < requestedMs)
    .slice(-perSide);
  const after = candidates
    .filter((s) => new Date(s.starts_at).getTime() > requestedMs)
    .slice(0, perSide);

  return [...before, ...after].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );
}

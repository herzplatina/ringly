import "server-only";
import { google } from "googleapis";
import { decrypt, encrypt } from "./encrypt";
import { addDays } from "date-fns";
import { fromZonedTime } from "date-fns-tz";
import { createServiceClient } from "./supabase/server";
import { env } from "./env";

function oauthClient() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
}

export function getAuthUrl(state: string) {
  const client = oauthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar.events"],
    prompt: "consent",
    state,
  });
}

export async function exchangeCode(code: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

async function calendarClient(businessId: string) {
  const db = createServiceClient();
  const { data: biz } = await db
    .from("businesses")
    .select("google_refresh_token, google_calendar_id")
    .eq("id", businessId)
    .single();

  if (!biz?.google_refresh_token)
    throw new Error("No Google token for business");

  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(biz.google_refresh_token) });
  return {
    calendar: google.calendar({ version: "v3", auth: client }),
    calendarId: biz.google_calendar_id ?? "primary",
  };
}

export async function createCalendarEvent(
  businessId: string,
  appointment: {
    id: string;
    starts_at: string;
    ends_at: string;
    customer_name: string;
    customer_phone: string;
    service_name: string;
  },
) {
  const { calendar, calendarId } = await calendarClient(businessId);
  const event = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `${appointment.service_name} — ${appointment.customer_name}`,
      description: `Phone: ${appointment.customer_phone}\nBooked via Ringly AI receptionist`,
      start: { dateTime: appointment.starts_at },
      end: { dateTime: appointment.ends_at },
    },
  });
  return event.data.id;
}

export async function updateCalendarEvent(
  businessId: string,
  eventId: string,
  appointment: {
    starts_at: string;
    ends_at: string;
    customer_name: string;
    service_name: string;
  },
) {
  const { calendar, calendarId } = await calendarClient(businessId);
  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: {
      summary: `${appointment.service_name} — ${appointment.customer_name}`,
      start: { dateTime: appointment.starts_at },
      end: { dateTime: appointment.ends_at },
    },
  });
}

export async function deleteCalendarEvent(businessId: string, eventId: string) {
  const { calendar, calendarId } = await calendarClient(businessId);
  await calendar.events.delete({ calendarId, eventId });
}

export async function storeGoogleTokens(
  businessId: string,
  tokens: { refresh_token?: string | null; access_token?: string | null },
) {
  if (!tokens.refresh_token) return;
  const db = createServiceClient();
  await db
    .from("businesses")
    .update({ google_refresh_token: encrypt(tokens.refresh_token) })
    .eq("id", businessId);
}

export type CalendarBusyInterval = {
  /** Google Calendar event id, so a reschedule can ignore its own event. */
  event_id: string | null;
  starts_at: string;
  ends_at: string;
};

/**
 * Busy windows on the business's Google Calendar between timeMin and timeMax.
 *
 * - Events the owner marked as free/available (transparency "transparent") do
 *   NOT block a slot, and neither do cancelled events.
 * - An all-day event blocks the business's entire local day (every local day
 *   it spans), not a fixed window.
 * - Intervals are exclusive at the ends, so an event that merely touches the
 *   requested window (one ends exactly when the other begins) does not
 *   conflict — back-to-back bookings are allowed (enforced by the strict
 *   overlap check in availability.ts).
 *
 * Never throws: if the calendar is unreachable, not connected, or errors, the
 * business must still be able to take bookings, so this returns an empty list
 * and leaves conflict protection to our own appointments table.
 */
export async function listCalendarBusyIntervals(
  businessId: string,
  timeMin: string,
  timeMax: string,
  timezone: string,
): Promise<CalendarBusyInterval[]> {
  try {
    const { calendar, calendarId } = await calendarClient(businessId);
    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      showDeleted: false,
      maxResults: 250,
    });

    const items = res?.data?.items ?? [];
    const busy: CalendarBusyInterval[] = [];

    for (const event of items) {
      // A cancelled event does not block the slot.
      if (event.status === "cancelled") continue;
      // An event the owner marked as free/available does not block the slot.
      if (event.transparency === "transparent") continue;

      const { start, end } = event;

      if (start?.date && !start?.dateTime) {
        // All-day event: block the whole local day. Google's end.date is
        // exclusive, so a single all-day event on D returns end.date = D+1.
        const dayStart = fromZonedTime(`${start.date}T00:00:00`, timezone);
        let dayEnd = end?.date
          ? fromZonedTime(`${end.date}T00:00:00`, timezone)
          : addDays(dayStart, 1);
        if (dayEnd <= dayStart) dayEnd = addDays(dayStart, 1);
        busy.push({
          event_id: event.id ?? null,
          starts_at: dayStart.toISOString(),
          ends_at: dayEnd.toISOString(),
        });
        continue;
      }

      if (start?.dateTime && end?.dateTime) {
        const startsAt = new Date(start.dateTime);
        const endsAt = new Date(end.dateTime);
        if (
          Number.isNaN(startsAt.getTime()) ||
          Number.isNaN(endsAt.getTime()) ||
          endsAt <= startsAt
        )
          continue;
        busy.push({
          event_id: event.id ?? null,
          starts_at: startsAt.toISOString(),
          ends_at: endsAt.toISOString(),
        });
      }
    }

    return busy;
  } catch (err) {
    // Keep the line open: an outage must not throw or block booking.
    console.error("Calendar availability lookup failed:", err);
    return [];
  }
}

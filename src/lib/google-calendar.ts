import "server-only";
import { google } from "googleapis";
import { decrypt, encrypt } from "./encrypt";
import { createServiceClient } from "./supabase/server";
import { env } from "./env";
import { fromZonedTime } from "date-fns-tz";

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

/**
 * Fetch busy intervals from the business's Google Calendar.
 *
 * Returns an array of `{ starts_at, ends_at }` objects (ISO strings) that
 * represent occupied time windows.  All-day events are expanded to cover the
 * business's full local day.  Cancelled events and events the owner marked as
 * "free / available" (transparency === "transparent") are skipped.
 *
 * `excludeEventIds` lets the reschedule flow ignore the event for the
 * appointment being moved so it does not conflict with itself.
 *
 * On ANY error (no token, network issue, API error) this returns `[]` so the
 * business can still take bookings protected by the appointments table.
 */
export async function fetchCalendarBusySlots(
  businessId: string,
  timeMin: string,
  timeMax: string,
  timezone: string,
  excludeEventIds?: string[],
): Promise<Array<{ starts_at: string; ends_at: string }>> {
  try {
    const { calendar, calendarId } = await calendarClient(businessId);
    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = res.data.items ?? [];
    const busy: Array<{ starts_at: string; ends_at: string }> = [];

    for (const event of events) {
      // Skip cancelled events
      if (event.status === "cancelled") continue;
      // Skip events the owner marked as free/available
      if (event.transparency === "transparent") continue;
      // Skip excluded event IDs (for reschedule self-conflict avoidance)
      if (excludeEventIds && event.id && excludeEventIds.includes(event.id))
        continue;

      if (event.start?.date && event.end?.date) {
        // All-day event — blocks the business's entire local day(s).
        // start.date is inclusive (YYYY-MM-DD), end.date is exclusive.
        const startUtc = fromZonedTime(
          `${event.start.date}T00:00:00`,
          timezone,
        );
        const endUtc = fromZonedTime(`${event.end.date}T00:00:00`, timezone);
        busy.push({
          starts_at: startUtc.toISOString(),
          ends_at: endUtc.toISOString(),
        });
      } else if (event.start?.dateTime && event.end?.dateTime) {
        busy.push({
          starts_at: new Date(event.start.dateTime).toISOString(),
          ends_at: new Date(event.end.dateTime).toISOString(),
        });
      }
    }

    return busy;
  } catch (err) {
    // Graceful degradation: calendar unreachable/not connected → empty list.
    // The appointments table still protects against double-booking.
    console.error("Failed to fetch calendar events:", err);
    return [];
  }
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

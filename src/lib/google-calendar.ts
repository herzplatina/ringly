import "server-only";
import { google } from "googleapis";
import { decrypt, encrypt } from "./encrypt";
import { createServiceClient } from "./supabase/server";
import { env } from "./env";
import { fromZonedTime } from "date-fns-tz";
import type { TimeSlot } from "@/types";

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
    .select("google_refresh_token, google_calendar_id, timezone")
    .eq("id", businessId)
    .single();

  if (!biz?.google_refresh_token)
    throw new Error("No Google token for business");

  const client = oauthClient();
  client.setCredentials({ refresh_token: decrypt(biz.google_refresh_token) });
  return {
    calendar: google.calendar({ version: "v3", auth: client }),
    calendarId: biz.google_calendar_id ?? "primary",
    timezone: biz.timezone ?? "UTC",
  };
}

/**
 * Time already occupied on the business's Google Calendar between two instants.
 *
 * Uses events.list rather than freebusy because freebusy reports anonymous
 * ranges: without event ids, an appointment being rescheduled would collide
 * with its own calendar event and the move would be refused. `excludeEventId`
 * drops exactly that event. `singleEvents` expands recurring series into their
 * individual occurrences so a weekly block is honoured.
 *
 * Returns `[]` when the business has not connected Google, or when Google is
 * unreachable: an outage must not take the phone line down, and our own
 * appointments table is still checked for conflicts either way. Failures are
 * logged here because the caller gets no signal that the check degraded.
 */
export async function getCalendarBusyIntervals(
  businessId: string,
  timeMin: string,
  timeMax: string,
  excludeEventId?: string,
): Promise<TimeSlot[]> {
  try {
    const { calendar, calendarId, timezone } = await calendarClient(businessId);
    const res = await calendar.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      showDeleted: false,
      maxResults: 2500,
    });

    return (res.data.items ?? []).flatMap((event) => {
      // The appointment's own event must not block its own reschedule.
      if (excludeEventId && event.id === excludeEventId) return [];
      // "transparent" is Google's flag for "show me as available".
      if (event.status === "cancelled" || event.transparency === "transparent")
        return [];

      const start = toInstant(event.start, timezone);
      const end = toInstant(event.end, timezone);
      return start && end ? [{ starts_at: start, ends_at: end }] : [];
    });
  } catch (err) {
    console.error("Calendar busy lookup failed:", err);
    return [];
  }
}

/**
 * Normalize a Google event boundary to a UTC instant. Timed events carry
 * `dateTime` (already offset-qualified); all-day events carry a bare `date`,
 * which means midnight in the business's own timezone — not UTC.
 */
function toInstant(
  boundary: { dateTime?: string | null; date?: string | null } | undefined,
  timezone: string,
): string | null {
  if (boundary?.dateTime) {
    const parsed = new Date(boundary.dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (boundary?.date) {
    const parsed = fromZonedTime(`${boundary.date}T00:00:00`, timezone);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
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

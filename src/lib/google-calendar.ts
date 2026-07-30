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
 * How long the whole calendar lookup — token exchange included — may take
 * before we give up on it. A caller is on the phone waiting for the agent to
 * answer, so a slow Google has to be treated the same as a broken one.
 */
export const CALENDAR_LOOKUP_BUDGET_MS = 1500;

const TIMED_OUT = Symbol("calendar-lookup-timed-out");

/**
 * Time already occupied on the business's Google Calendar between two instants.
 *
 * Uses events.list rather than freebusy because freebusy reports anonymous
 * ranges: without event ids, an appointment being rescheduled would collide
 * with its own calendar event and the move would be refused. `excludeEventId`
 * drops exactly that event. `singleEvents` expands recurring series into their
 * individual occurrences so a weekly block is honoured.
 *
 * Returns `[]` when the business has not connected Google, when Google is
 * unreachable, and when it simply does not answer within
 * CALENDAR_LOOKUP_BUDGET_MS. An outage — including a silent one — must not take
 * the phone line down, and our own appointments table is still checked for
 * conflicts either way. Every degraded path is logged, because the caller gets
 * an empty list back and cannot tell the difference from a genuinely free
 * calendar.
 */
export async function getCalendarBusyIntervals(
  businessId: string,
  timeMin: string,
  timeMax: string,
  excludeEventId?: string,
): Promise<TimeSlot[]> {
  const controller = new AbortController();
  let expiry: ReturnType<typeof setTimeout> | undefined;

  // Resolves rather than rejects, so a slow lookup and a failed one converge on
  // the same fail-open path instead of one of them escaping as a rejection.
  const budget = new Promise<typeof TIMED_OUT>((resolve) => {
    expiry = setTimeout(() => {
      controller.abort();
      resolve(TIMED_OUT);
    }, CALENDAR_LOOKUP_BUDGET_MS);
  });

  const lookup = fetchBusyIntervals(
    businessId,
    timeMin,
    timeMax,
    excludeEventId,
    controller.signal,
  ).catch((err) => {
    console.error("Calendar busy lookup failed:", err);
    return [] as TimeSlot[];
  });

  try {
    const outcome = await Promise.race([lookup, budget]);
    if (outcome === TIMED_OUT) {
      console.error(
        `Calendar busy lookup exceeded ${CALENDAR_LOOKUP_BUDGET_MS}ms; treating the calendar as clear`,
      );
      return [];
    }
    return outcome;
  } finally {
    clearTimeout(expiry);
  }
}

/** The lookup itself. Rejects on failure; the caller decides what that means. */
async function fetchBusyIntervals(
  businessId: string,
  timeMin: string,
  timeMax: string,
  excludeEventId: string | undefined,
  signal: AbortSignal,
): Promise<TimeSlot[]> {
  const { calendar, calendarId, timezone } = await calendarClient(businessId);
  const res = await calendar.events.list(
    {
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      showDeleted: false,
      maxResults: 2500,
    },
    // Abort the in-flight request when the budget expires so an abandoned
    // lookup does not keep the socket (or the function instance) alive.
    { signal },
  );

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

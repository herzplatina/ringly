import "server-only";
import { google } from "googleapis";
import { decrypt, encrypt } from "./encrypt";
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


export async function listCalendarEvents(
  businessId: string,
  timeMin: string,
  timeMax: string,
): Promise<Array<{ starts_at: string; ends_at: string }>> {
  let client;
  try {
    client = await calendarClient(businessId);
  } catch {
    // No Google token configured — nothing to block.
    return [];
  }
  const { calendar, calendarId } = client;
  const res = await calendar.events.list({
    calendarId,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
  });

  return (res.data.items ?? [])
    .filter((e) => e.start?.dateTime && e.end?.dateTime && e.status !== "cancelled")
    .map((e) => ({
      starts_at: e.start!.dateTime!,
      ends_at: e.end!.dateTime!,
    }));
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

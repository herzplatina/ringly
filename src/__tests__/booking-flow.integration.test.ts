/**
 * Integration tests for booking over the phone.
 *
 * These drive the real webhook endpoint the way Retell does — signed HTTP
 * requests carrying a function name and arguments — and assert only on what is
 * observable from outside: the answer the agent is given, and the appointments
 * that exist afterwards.
 *
 * Nothing here reaches into the implementation. Signature verification, the
 * Google Calendar client and the availability maths all run for real; only the
 * two genuine outside boundaries are faked, and both are faked as *worlds*
 * (a database holding rows, a calendar holding events) rather than as
 * expectations about which calls we make. A rewrite of how conflicts are
 * detected should leave every test below passing.
 */

jest.mock("@/lib/env", () => ({
  env: {
    // Inlined rather than referencing RETELL_KEY: jest hoists this factory
    // above the constant's declaration.
    RETELL_API_KEY: "retell-test-key",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    GOOGLE_CLIENT_ID: "google-id",
    GOOGLE_CLIENT_SECRET: "google-secret",
    GOOGLE_REDIRECT_URI: "http://localhost:3000/api/auth/google/callback",
  },
}));

jest.mock("@/lib/encrypt", () => ({
  encrypt: (v: string) => v,
  decrypt: (v: string) => v,
}));

// The business's calendar, served through a fake `googleapis`.
jest.mock("googleapis", () => ({
  get google() {
    return calendarWorld.google;
  },
}));

jest.mock("@/lib/twilio", () => ({
  sendWhatsApp: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => database.client,
}));

import crypto from "crypto";
import { POST } from "@/app/api/webhooks/retell/functions/route";
import { createFakeDb, type FakeDb } from "./__mocks__/fake-supabase";
import {
  createFakeGoogleapis,
  type FakeCalendar,
} from "./__mocks__/fake-googleapis";

const RETELL_KEY = "retell-test-key";
const BUSINESS_NUMBER = "+14155551234";
const CUSTOMER_NUMBER = "+14155550001";
const OTHER_CUSTOMER = "+14155550002";
const BUSINESS_ID = "biz-001";
const HAIRCUT = "svc-1"; // 60 minutes
const MONDAY = "2026-07-06";
const TZ = "America/New_York";

/** An ET wall-clock time on the test Monday, as a UTC ISO instant. */
const at = (hhmm: string) =>
  new Date(`${MONDAY}T${hhmm}:00-04:00`).toISOString();

let database: FakeDb;
let calendarWorld: FakeCalendar;

// ── the phone call ──────────────────────────────────────────────────────────

type AgentReply = {
  status: number;
  result: string;
  conflict?: boolean;
  alternatives?: Array<{ starts_at: string; ends_at: string }>;
  appointment_id?: string;
  slots?: Array<{ starts_at: string; ends_at: string }>;
};

/** Sign a payload the way Retell does: HMAC-SHA256 over body + timestamp. */
function sign(body: string): string {
  const ts = Date.now();
  const digest = crypto
    .createHmac("sha256", RETELL_KEY)
    .update(body + String(ts))
    .digest("hex");
  return `v=${ts},d=${digest}`;
}

/** Invoke a tool on the live endpoint as Retell would mid-call. */
async function agentCalls(
  name: string,
  args: Record<string, unknown>,
  opts: { from?: string; signature?: string } = {},
): Promise<AgentReply> {
  const body = JSON.stringify({
    name,
    args,
    call: {
      call_id: `call-${Math.random().toString(36).slice(2)}`,
      from_number: opts.from ?? CUSTOMER_NUMBER,
      to_number: BUSINESS_NUMBER,
    },
  });

  const res = await POST(
    new Request("http://localhost:3000/api/webhooks/retell/functions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-retell-signature": opts.signature ?? sign(body),
      },
      body,
    }) as never,
  );

  const payload = res.status === 401 ? {} : await res.json();
  return { status: res.status, ...payload } as AgentReply;
}

const booksAppointment = (
  startsAt: string,
  opts: { name?: string; phone?: string } = {},
) =>
  agentCalls(
    "book_appointment",
    {
      customer_name: opts.name ?? "Ada Lovelace",
      phone_number: opts.phone ?? CUSTOMER_NUMBER,
      service_id: HAIRCUT,
      starts_at: startsAt,
    },
    { from: opts.phone ?? CUSTOMER_NUMBER },
  );

// ── the world ───────────────────────────────────────────────────────────────

/** Appointments the business actually has on the books, earliest first. */
const appointmentsOnBooks = () =>
  (database.tables.appointments as Array<Record<string, string>>)
    .filter((a) => !["cancelled", "no_show"].includes(a.status))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

/** An event the owner put on their own Google Calendar. */
const ownerIsBusy = (summary: string, fromHHMM: string, toHHMM: string) => {
  calendarWorld.events.push({
    id: `owner-${calendarWorld.events.length + 1}`,
    status: "confirmed",
    summary,
    start: { dateTime: at(fromHHMM) },
    end: { dateTime: at(toHHMM) },
  });
};

function openForBusiness() {
  database = createFakeDb({
    businesses: [
      {
        id: BUSINESS_ID,
        name: "Glamour Studio",
        timezone: TZ,
        retell_phone_number: BUSINESS_NUMBER,
        whatsapp_number: null,
        whatsapp_sender_status: "not_started",
        google_refresh_token: "refresh-token",
        google_calendar_id: "owner@example.com",
      },
    ],
    services: [
      {
        id: HAIRCUT,
        business_id: BUSINESS_ID,
        name: "Women's Haircut",
        duration_minutes: 60,
      },
    ],
    // Open 9–5, Monday to Friday.
    business_hours: Array.from({ length: 7 }, (_, day) => ({
      id: `h-${day}`,
      business_id: BUSINESS_ID,
      day_of_week: day,
      is_closed: day === 0 || day === 6,
      hours_ranges:
        day === 0 || day === 6 ? [] : [{ open: "09:00", close: "17:00" }],
    })),
    customers: [],
    appointments: [],
    reminders: [],
  });
  calendarWorld = createFakeGoogleapis(TZ);
}

beforeEach(() => {
  // 8am on the test Monday: the whole working day is still ahead.
  jest.useFakeTimers({ now: new Date(at("08:00")) });
  // The outage scenarios log deliberately; keep the report readable.
  jest.spyOn(console, "error").mockImplementation(() => {});
  openForBusiness();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ── scenarios ───────────────────────────────────────────────────────────────

describe("a customer books an open slot", () => {
  test("the appointment is confirmed and ends up on the books", async () => {
    const reply = await booksAppointment(at("10:00"));

    expect(reply.conflict).toBeUndefined();
    expect(reply.result).toMatch(/booked/i);
    expect(appointmentsOnBooks()).toHaveLength(1);
    expect(appointmentsOnBooks()[0]).toMatchObject({
      starts_at: at("10:00"),
      ends_at: at("11:00"),
    });
  });

  test("the confirmation states the time in the customer's own words", async () => {
    const reply = await booksAppointment(at("10:00"));

    // Not a raw UTC timestamp the agent would read out digit by digit.
    expect(reply.result).toContain("10:00 AM");
    expect(reply.result).not.toContain("T14:00");
  });
});

describe("the owner has something else on their calendar", () => {
  test("the slot is refused and nothing is booked", async () => {
    ownerIsBusy("Dentist", "10:00", "11:00");

    const reply = await booksAppointment(at("10:00"));

    expect(reply.conflict).toBe(true);
    expect(reply.result).toMatch(/already taken/i);
    expect(appointmentsOnBooks()).toHaveLength(0);
  });

  test("the customer is offered a time just before and just after", async () => {
    ownerIsBusy("Dentist", "10:00", "11:00");

    const reply = await booksAppointment(at("10:00"));
    const offered = (reply.alternatives ?? []).map((a) => a.starts_at);

    expect(offered).toContain(at("09:00"));
    expect(offered).toContain(at("11:00"));
  });

  test("every time offered can actually be booked", async () => {
    ownerIsBusy("Dentist", "10:00", "11:00");
    const { alternatives = [] } = await booksAppointment(at("10:00"));

    expect(alternatives.length).toBeGreaterThan(0);
    for (const slot of alternatives) {
      // Fresh day per attempt: the offers are alternatives to each other, and
      // adjacent ones would otherwise overlap.
      openForBusiness();
      ownerIsBusy("Dentist", "10:00", "11:00");

      const reply = await booksAppointment(slot.starts_at);

      expect(reply.conflict).toBeUndefined();
      expect(appointmentsOnBooks()).toHaveLength(1);
    }
  });

  test("a time the owner marked as free does not block the slot", async () => {
    calendarWorld.events.push({
      id: "tentative-lunch",
      status: "confirmed",
      transparency: "transparent", // "show me as available"
      start: { dateTime: at("10:00") },
      end: { dateTime: at("11:00") },
    });

    const reply = await booksAppointment(at("10:00"));

    expect(reply.conflict).toBeUndefined();
    expect(appointmentsOnBooks()).toHaveLength(1);
  });

  test("an appointment the owner cancelled does not block the slot", async () => {
    calendarWorld.events.push({
      id: "scrapped",
      status: "cancelled",
      start: { dateTime: at("10:00") },
      end: { dateTime: at("11:00") },
    });

    const reply = await booksAppointment(at("10:00"));

    expect(reply.conflict).toBeUndefined();
    expect(appointmentsOnBooks()).toHaveLength(1);
  });

  test("an all-day block closes the whole day, not part of it", async () => {
    calendarWorld.events.push({
      id: "vacation",
      status: "confirmed",
      summary: "Vacation",
      start: { date: MONDAY },
      end: { date: "2026-07-07" },
    });

    const morning = await booksAppointment(at("09:00"));
    const afternoon = await booksAppointment(at("15:00"));

    expect(morning.conflict).toBe(true);
    expect(afternoon.conflict).toBe(true);
    expect(afternoon.alternatives).toEqual([]);
    expect(afternoon.result).toMatch(/different date/i);
    expect(appointmentsOnBooks()).toHaveLength(0);
  });

  test("a booking that merely butts up against an event is allowed", async () => {
    ownerIsBusy("Team meeting", "09:00", "10:00");

    const reply = await booksAppointment(at("10:00"));

    expect(reply.conflict).toBeUndefined();
    expect(appointmentsOnBooks()).toHaveLength(1);
  });
});

describe("two customers want the same time", () => {
  test("the second is turned away and offered something else", async () => {
    const first = await booksAppointment(at("10:00"), { name: "Ada" });
    const second = await booksAppointment(at("10:00"), {
      name: "Grace",
      phone: OTHER_CUSTOMER,
    });

    expect(first.conflict).toBeUndefined();
    expect(second.conflict).toBe(true);
    expect(second.alternatives?.map((a) => a.starts_at)).not.toContain(
      at("10:00"),
    );
    expect(appointmentsOnBooks()).toHaveLength(1);
  });

  test("the second customer can take one of the offered times", async () => {
    await booksAppointment(at("10:00"), { name: "Ada" });
    const refusal = await booksAppointment(at("10:00"), {
      name: "Grace",
      phone: OTHER_CUSTOMER,
    });

    const reply = await booksAppointment(refusal.alternatives![0].starts_at, {
      name: "Grace",
      phone: OTHER_CUSTOMER,
    });

    expect(reply.conflict).toBeUndefined();
    expect(appointmentsOnBooks()).toHaveLength(2);
  });
});

describe("the whole conversation, end to end", () => {
  test("asked times, hit a clash, took the next best slot", async () => {
    ownerIsBusy("Dentist", "10:00", "11:00");

    // "What have you got on Monday?"
    const offered = await agentCalls("check_availability", {
      date: MONDAY,
      service_id: HAIRCUT,
    });
    const offeredTimes = (offered.slots ?? []).map((s) => s.starts_at);
    expect(offeredTimes).not.toContain(at("10:00"));

    // "Actually, could I have 10?"
    const refusal = await booksAppointment(at("10:00"));
    expect(refusal.conflict).toBe(true);
    expect(appointmentsOnBooks()).toHaveLength(0);

    // "Fine, I'll take the first thing you offered."
    const chosen = refusal.alternatives![0].starts_at;
    const booked = await booksAppointment(chosen);

    expect(booked.conflict).toBeUndefined();
    expect(appointmentsOnBooks()).toHaveLength(1);
    expect(appointmentsOnBooks()[0].starts_at).toBe(chosen);
  });

  test("the times quoted to the caller are times that can be booked", async () => {
    ownerIsBusy("Dentist", "13:00", "14:00");

    const { slots = [] } = await agentCalls("check_availability", {
      date: MONDAY,
      service_id: HAIRCUT,
    });

    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      openForBusiness();
      ownerIsBusy("Dentist", "13:00", "14:00");

      const reply = await booksAppointment(slot.starts_at);

      expect(reply.conflict).toBeUndefined();
    }
  });
});

describe("moving an existing appointment", () => {
  /** Book an appointment and hand back its id. */
  async function existingAppointmentAt(hhmm: string) {
    const reply = await booksAppointment(at(hhmm));
    const id = reply.appointment_id!;
    // Mirror the embedded rows Supabase returns for the reschedule lookup.
    const row = (
      database.tables.appointments as Array<Record<string, unknown>>
    ).find((a) => a.id === id)!;
    row.services = { name: "Women's Haircut", duration_minutes: 60 };
    row.customers = {
      name: "Ada Lovelace",
      phone_number: CUSTOMER_NUMBER,
      whatsapp_consent_status: "not_asked",
    };
    return id;
  }

  const movesTo = (id: string, hhmm: string) =>
    agentCalls("reschedule_appointment", {
      appointment_id: id,
      new_starts_at: at(hhmm),
    });

  test("moving onto a time the owner has blocked is refused", async () => {
    const id = await existingAppointmentAt("14:00");
    ownerIsBusy("School run", "10:00", "11:00");

    const reply = await movesTo(id, "10:00");

    expect(reply.conflict).toBe(true);
    expect(appointmentsOnBooks()[0].starts_at).toBe(at("14:00"));
  });

  test("moving onto another customer's appointment is refused", async () => {
    const mine = await existingAppointmentAt("14:00");
    await booksAppointment(at("10:00"), {
      name: "Grace",
      phone: OTHER_CUSTOMER,
    });

    const reply = await movesTo(mine, "10:00");

    expect(reply.conflict).toBe(true);
    expect(appointmentsOnBooks().map((a) => a.starts_at)).toEqual([
      at("10:00"),
      at("14:00"),
    ]);
  });

  test("nudging an appointment half an hour later works", async () => {
    // The appointment already occupies 14:00–15:00 in our books and on the
    // calendar, and 14:30–15:30 overlaps both — it must not block its own move.
    const id = await existingAppointmentAt("14:00");

    const reply = await movesTo(id, "14:30");

    expect(reply.conflict).toBeUndefined();
    expect(reply.result).toMatch(/rescheduled/i);
    expect(appointmentsOnBooks()[0]).toMatchObject({
      starts_at: at("14:30"),
      ends_at: at("15:30"),
    });
  });

  test("the vacated time becomes available to somebody else", async () => {
    const id = await existingAppointmentAt("14:00");
    await movesTo(id, "11:00");

    const reply = await booksAppointment(at("14:00"), {
      name: "Grace",
      phone: OTHER_CUSTOMER,
    });

    expect(reply.conflict).toBeUndefined();
    expect(appointmentsOnBooks().map((a) => a.starts_at)).toEqual([
      at("11:00"),
      at("14:00"),
    ]);
  });
});

describe("when Google Calendar is unavailable", () => {
  test("the business can still take bookings", async () => {
    calendarWorld.failWith = new Error("503 backend error");

    const reply = await booksAppointment(at("10:00"));

    expect(reply.conflict).toBeUndefined();
    expect(appointmentsOnBooks()).toHaveLength(1);
  });

  test("appointments already on our books are still protected", async () => {
    await booksAppointment(at("10:00"), { name: "Ada" });
    calendarWorld.failWith = new Error("503 backend error");

    const reply = await booksAppointment(at("10:00"), {
      name: "Grace",
      phone: OTHER_CUSTOMER,
    });

    expect(reply.conflict).toBe(true);
    expect(appointmentsOnBooks()).toHaveLength(1);
  });
});

describe("times that make no sense", () => {
  test("a request after closing time is answered with times inside opening hours", async () => {
    ownerIsBusy("Evening event", "20:00", "21:00");

    const reply = await booksAppointment(at("20:00"));
    const offered = reply.alternatives ?? [];

    expect(reply.conflict).toBe(true);
    expect(appointmentsOnBooks()).toHaveLength(0);
    // The shop shuts at 17:00, so every counter-offer must land before then.
    expect(offered.length).toBeGreaterThan(0);
    for (const slot of offered) {
      expect(new Date(slot.ends_at).getTime()).toBeLessThanOrEqual(
        new Date(at("17:00")).getTime(),
      );
    }
  });

  test("a start time the agent garbled is not booked", async () => {
    const reply = await booksAppointment("tomorrow afternoon");

    expect(reply.result).toMatch(/could not be understood/i);
    expect(appointmentsOnBooks()).toHaveLength(0);
  });
});

describe("the endpoint is not open to the world", () => {
  test("an unsigned request is rejected outright", async () => {
    const reply = await agentCalls(
      "book_appointment",
      {
        customer_name: "Attacker",
        phone_number: CUSTOMER_NUMBER,
        service_id: HAIRCUT,
        starts_at: at("10:00"),
      },
      { signature: "" },
    );

    expect(reply.status).toBe(401);
    expect(appointmentsOnBooks()).toHaveLength(0);
  });

  test("a tampered signature is rejected", async () => {
    const reply = await agentCalls(
      "book_appointment",
      {
        customer_name: "Attacker",
        phone_number: CUSTOMER_NUMBER,
        service_id: HAIRCUT,
        starts_at: at("10:00"),
      },
      { signature: `v=${Date.now()},d=${"0".repeat(64)}` },
    );

    expect(reply.status).toBe(401);
    expect(appointmentsOnBooks()).toHaveLength(0);
  });
});

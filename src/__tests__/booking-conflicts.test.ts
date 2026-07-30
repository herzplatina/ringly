/**
 * End-to-end tests for the double-booking guard on the Retell function route:
 * a requested slot is refused when it collides with one of our appointments OR
 * with a busy block on the business's Google Calendar, and the caller is
 * offered the nearest open times instead.
 */

jest.mock("@/lib/env", () => ({
  env: {
    RETELL_API_KEY: "test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  },
}));

jest.mock("@/lib/retell", () => ({
  verifyRetellSignature: jest.fn().mockResolvedValue(true),
  parseRetellCall: () => ({
    callId: "call-1",
    fromNumber: "+15551230000",
    toNumber: BUSINESS_NUMBER,
  }),
}));

jest.mock("@/lib/google-calendar", () => ({
  getCalendarBusyIntervals: jest.fn().mockResolvedValue([]),
  createCalendarEvent: jest.fn().mockResolvedValue("event-1"),
  updateCalendarEvent: jest.fn().mockResolvedValue(undefined),
  deleteCalendarEvent: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/twilio", () => ({
  sendWhatsApp: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => currentDb.client,
}));

import { POST } from "@/app/api/webhooks/retell/functions/route";
import {
  getCalendarBusyIntervals,
  createCalendarEvent,
} from "@/lib/google-calendar";
import { createFakeDb, type FakeDb } from "./__mocks__/fake-supabase";

const BUSINESS_NUMBER = "+15559990000";
const BUSINESS_ID = "biz-1";
const SERVICE_ID = "svc-1";
const MONDAY = "2026-07-06"; // a Monday
const TZ = "America/New_York";

/** An ET wall-clock time on the test Monday, as a UTC ISO instant. */
const et = (hhmm: string) =>
  new Date(`${MONDAY}T${hhmm}:00-04:00`).toISOString();

let currentDb: FakeDb;

function seedDb(overrides: { appointments?: Record<string, unknown>[] } = {}) {
  return createFakeDb({
    businesses: [
      {
        id: BUSINESS_ID,
        name: "Glamour Studio",
        timezone: TZ,
        whatsapp_number: null,
        whatsapp_sender_status: "not_started",
        retell_phone_number: BUSINESS_NUMBER,
      },
    ],
    services: [
      {
        id: SERVICE_ID,
        business_id: BUSINESS_ID,
        name: "Women's Haircut",
        duration_minutes: 60,
      },
    ],
    business_hours: [
      {
        id: "h-1",
        business_id: BUSINESS_ID,
        day_of_week: 1,
        is_closed: false,
        hours_ranges: [{ open: "09:00", close: "17:00" }],
      },
    ],
    customers: [],
    appointments: overrides.appointments ?? [],
    reminders: [],
  });
}

function appointment(
  id: string,
  startHHMM: string,
  endHHMM: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    business_id: BUSINESS_ID,
    customer_id: "cust-existing",
    service_id: SERVICE_ID,
    starts_at: et(startHHMM),
    ends_at: et(endHHMM),
    status: "booked",
    google_calendar_event_id: null,
    ...extra,
  };
}

async function callFunction(name: string, args: Record<string, unknown>) {
  const body = JSON.stringify({ name, args, call: { call_id: "call-1" } });
  const req = new Request("http://localhost/api/webhooks/retell/functions", {
    method: "POST",
    headers: { "x-retell-signature": "sig" },
    body,
  });
  // The route only reads .text() and .headers, both present on a plain Request.
  const res = await POST(req as never);
  return res.json() as Promise<{
    result: string;
    conflict?: boolean;
    alternatives?: Array<{ starts_at: string; ends_at: string }>;
    appointment_id?: string;
    slots?: Array<{ starts_at: string }>;
  }>;
}

const book = (startsAt: string, extra: Record<string, unknown> = {}) =>
  callFunction("book_appointment", {
    customer_name: "Ada Lovelace",
    phone_number: "+15551112222",
    service_id: SERVICE_ID,
    starts_at: startsAt,
    ...extra,
  });

const appointmentsInserted = () =>
  currentDb.inserts.filter((i) => i.table === "appointments");

beforeEach(() => {
  jest.clearAllMocks();
  // Alternatives are never offered in the past, so pin "now" to the morning of
  // the test Monday — otherwise every slot below would be historical.
  jest.useFakeTimers({ now: new Date(et("08:00")) });
  (getCalendarBusyIntervals as jest.Mock).mockResolvedValue([]);
  currentDb = seedDb();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("book_appointment — Google Calendar conflicts", () => {
  test("refuses a slot that is busy on the business's Google Calendar", async () => {
    (getCalendarBusyIntervals as jest.Mock).mockResolvedValue([
      { starts_at: et("10:00"), ends_at: et("11:00") },
    ]);

    const res = await book(et("10:00"));

    expect(res.conflict).toBe(true);
    expect(res.result).toMatch(/already taken/i);
    expect(appointmentsInserted()).toHaveLength(0);
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });

  test("offers the nearest open times either side of the requested slot", async () => {
    (getCalendarBusyIntervals as jest.Mock).mockResolvedValue([
      { starts_at: et("10:00"), ends_at: et("11:00") },
    ]);

    const res = await book(et("10:00"));
    const starts = (res.alternatives ?? []).map((a) => a.starts_at);

    expect(starts).toContain(et("09:00")); // a little before
    expect(starts).toContain(et("11:00")); // a little after
    expect(res.result).toContain("9:00 AM");
    expect(res.result).toContain("11:00 AM");
  });

  test("suggested alternatives are themselves free of calendar conflicts", async () => {
    (getCalendarBusyIntervals as jest.Mock).mockResolvedValue([
      { starts_at: et("10:00"), ends_at: et("11:00") },
      { starts_at: et("11:00"), ends_at: et("12:00") },
    ]);

    const res = await book(et("10:00"));
    const starts = (res.alternatives ?? []).map((a) => a.starts_at);

    expect(starts).not.toContain(et("10:00"));
    expect(starts).not.toContain(et("11:00"));
    expect(starts).toContain(et("09:00"));
    expect(starts).toContain(et("12:00"));
  });

  test("asks the calendar about a window covering the requested slot, just once", async () => {
    await book(et("10:00"));

    // Deliberately not asserting the exact bounds: what matters is that the
    // requested slot is inside whatever window we ask about, and that a clear
    // booking costs a single round trip.
    expect(getCalendarBusyIntervals).toHaveBeenCalledTimes(1);
    const [businessId, from, to, exclude] = (
      getCalendarBusyIntervals as jest.Mock
    ).mock.calls[0];
    expect(businessId).toBe(BUSINESS_ID);
    expect(new Date(from).getTime()).toBeLessThanOrEqual(
      new Date(et("10:00")).getTime(),
    );
    expect(new Date(to).getTime()).toBeGreaterThanOrEqual(
      new Date(et("11:00")).getTime(),
    );
    expect(exclude).toBeUndefined(); // nothing to exclude on a fresh booking
  });

  test("books when the calendar is clear", async () => {
    const res = await book(et("10:00"));

    expect(res.conflict).toBeUndefined();
    expect(res.appointment_id).toBeDefined();
    expect(appointmentsInserted()).toHaveLength(1);
    expect(res.result).toMatch(/Appointment booked for Ada Lovelace/);
  });

  test("a calendar event ending exactly when the slot starts is not a conflict", async () => {
    (getCalendarBusyIntervals as jest.Mock).mockResolvedValue([
      { starts_at: et("09:00"), ends_at: et("10:00") },
    ]);

    const res = await book(et("10:00"));

    expect(res.conflict).toBeUndefined();
    expect(appointmentsInserted()).toHaveLength(1);
  });

  test("a partial overlap with a calendar event is refused", async () => {
    (getCalendarBusyIntervals as jest.Mock).mockResolvedValue([
      { starts_at: et("10:30"), ends_at: et("11:30") },
    ]);

    const res = await book(et("10:00"));

    expect(res.conflict).toBe(true);
    expect(appointmentsInserted()).toHaveLength(0);
  });

  test("still books when Google is unreachable, so an outage cannot close the line", async () => {
    // getCalendarBusyIntervals swallows Google errors and returns [].
    (getCalendarBusyIntervals as jest.Mock).mockResolvedValue([]);

    const res = await book(et("10:00"));

    expect(res.conflict).toBeUndefined();
    expect(appointmentsInserted()).toHaveLength(1);
  });
});

describe("book_appointment — appointments already in our database", () => {
  test("refuses a slot taken by an existing appointment", async () => {
    currentDb = seedDb({
      appointments: [appointment("appt-1", "10:00", "11:00")],
    });

    const res = await book(et("10:00"));

    expect(res.conflict).toBe(true);
    expect(appointmentsInserted()).toHaveLength(0);
  });

  test("ignores cancelled appointments when checking conflicts", async () => {
    currentDb = seedDb({
      appointments: [
        appointment("appt-1", "10:00", "11:00", { status: "cancelled" }),
      ],
    });

    const res = await book(et("10:00"));

    expect(res.conflict).toBeUndefined();
    expect(appointmentsInserted()).toHaveLength(1);
  });

  test("ignores another business's appointments", async () => {
    currentDb = seedDb({
      appointments: [
        appointment("appt-other", "10:00", "11:00", {
          business_id: "biz-other",
        }),
      ],
    });

    const res = await book(et("10:00"));

    expect(res.conflict).toBeUndefined();
    expect(appointmentsInserted()).toHaveLength(1);
  });

  test("reports a full day with no alternatives to offer", async () => {
    // 09:00–17:00 blocked solid on the calendar.
    (getCalendarBusyIntervals as jest.Mock).mockResolvedValue([
      { starts_at: et("09:00"), ends_at: et("17:00") },
    ]);

    const res = await book(et("10:00"));

    expect(res.conflict).toBe(true);
    expect(res.alternatives).toEqual([]);
    expect(res.result).toMatch(/different date/i);
    expect(appointmentsInserted()).toHaveLength(0);
  });

  test("rejects an unparseable start time without writing anything", async () => {
    const res = await book("sometime next week");

    expect(res.result).toMatch(/could not be understood/i);
    expect(appointmentsInserted()).toHaveLength(0);
    expect(createCalendarEvent).not.toHaveBeenCalled();
  });
});

// ── exact-duplicate bookings ────────────────────────────────────────────────
//
// The degenerate case: the requested window is not merely overlapping but
// identical to something already on the books. It gets its own block because it
// is the one a caller hits most often — the agent reads a time out, the customer
// says yes, and meanwhile the slot went to somebody else — and because an
// off-by-one in an overlap test can pass every partial-overlap case while
// failing on exactly equal bounds.
describe("book_appointment — the requested window is already taken exactly", () => {
  const START = "10:00";
  const END = "11:00"; // the 60-minute service occupies precisely this window

  test("an identical existing appointment blocks the booking", async () => {
    currentDb = seedDb({
      appointments: [appointment("appt-1", START, END)],
    });

    const res = await book(et(START));

    expect(res.conflict).toBe(true);
    expect(res.result).toMatch(/already taken/i);
    expect(appointmentsInserted()).toHaveLength(0);
  });

  test("an identical calendar event blocks the booking", async () => {
    (getCalendarBusyIntervals as jest.Mock).mockResolvedValue([
      { starts_at: et(START), ends_at: et(END) },
    ]);

    const res = await book(et(START));

    expect(res.conflict).toBe(true);
    expect(res.result).toMatch(/already taken/i);
    expect(appointmentsInserted()).toHaveLength(0);
  });

  test("either source alone is enough — both together change nothing", async () => {
    currentDb = seedDb({
      appointments: [appointment("appt-1", START, END)],
    });
    (getCalendarBusyIntervals as jest.Mock).mockResolvedValue([
      { starts_at: et(START), ends_at: et(END) },
    ]);

    const res = await book(et(START));

    expect(res.conflict).toBe(true);
    expect(appointmentsInserted()).toHaveLength(0);
  });

  test("the duplicated window is not offered back as an alternative", async () => {
    currentDb = seedDb({
      appointments: [appointment("appt-1", START, END)],
    });

    const res = await book(et(START));
    const offered = (res.alternatives ?? []).map((a) => a.starts_at);

    expect(offered.length).toBeGreaterThan(0);
    expect(offered).not.toContain(et(START));
  });

  test("booking the same slot twice in a row is refused the second time", async () => {
    const first = await book(et(START));
    const second = await book(et(START));

    expect(first.conflict).toBeUndefined();
    expect(first.appointment_id).toBeDefined();
    expect(second.conflict).toBe(true);
    // Exactly one write, from the first request.
    expect(appointmentsInserted()).toHaveLength(1);
  });

  test("an identical window is free again once the appointment is cancelled", async () => {
    currentDb = seedDb({
      appointments: [
        appointment("appt-1", START, END, { status: "cancelled" }),
      ],
    });

    const res = await book(et(START));

    expect(res.conflict).toBeUndefined();
    expect(appointmentsInserted()).toHaveLength(1);
  });

  test("sharing only a boundary is not a duplicate", async () => {
    // The neighbour ends exactly when the request starts. Identical bounds must
    // clash; touching bounds must not.
    currentDb = seedDb({
      appointments: [appointment("appt-1", "09:00", START)],
    });

    const res = await book(et(START));

    expect(res.conflict).toBeUndefined();
    expect(appointmentsInserted()).toHaveLength(1);
  });
});

describe("check_availability", () => {
  test("does not offer slots that are busy on Google Calendar", async () => {
    (getCalendarBusyIntervals as jest.Mock).mockResolvedValue([
      { starts_at: et("10:00"), ends_at: et("11:00") },
    ]);

    const res = await callFunction("check_availability", {
      date: MONDAY,
      service_id: SERVICE_ID,
    });

    const starts = (res.slots ?? []).map((s) => s.starts_at);
    expect(starts).not.toContain(et("10:00"));
    expect(starts).toContain(et("09:00"));
  });
});

describe("reschedule_appointment", () => {
  const CALLER = "+15551230000";

  function seedForReschedule(extra: Record<string, unknown>[] = []) {
    const db = seedDb({
      appointments: [
        {
          ...appointment("appt-mine", "14:00", "15:00"),
          customer_id: "cust-1",
        },
        ...extra,
      ],
    });
    db.tables.customers = [
      {
        id: "cust-1",
        business_id: BUSINESS_ID,
        phone_number: CALLER,
        name: "Ada Lovelace",
        whatsapp_consent_status: "declined",
      },
    ];
    // The route reads the appointment with embedded service/customer rows.
    db.tables.appointments[0].services = {
      name: "Women's Haircut",
      duration_minutes: 60,
    };
    db.tables.appointments[0].customers = {
      name: "Ada Lovelace",
      phone_number: CALLER,
      whatsapp_consent_status: "declined",
    };
    return db;
  }

  const reschedule = (newStartsAt: string) =>
    callFunction("reschedule_appointment", {
      appointment_id: "appt-mine",
      new_starts_at: newStartsAt,
    });

  test("refuses moving an appointment onto a busy calendar block", async () => {
    currentDb = seedForReschedule();
    (getCalendarBusyIntervals as jest.Mock).mockResolvedValue([
      { starts_at: et("10:00"), ends_at: et("11:00") },
    ]);

    const res = await reschedule(et("10:00"));

    expect(res.conflict).toBe(true);
    expect(currentDb.tables.appointments[0].starts_at).toBe(et("14:00"));
  });

  test("refuses moving onto another appointment", async () => {
    currentDb = seedForReschedule([
      appointment("appt-other", "10:00", "11:00"),
    ]);

    const res = await reschedule(et("10:00"));

    expect(res.conflict).toBe(true);
    expect(currentDb.tables.appointments[0].starts_at).toBe(et("14:00"));
  });

  test("an appointment does not conflict with itself when shifted slightly", async () => {
    currentDb = seedForReschedule();

    const res = await reschedule(et("14:30"));

    expect(res.conflict).toBeUndefined();
    expect(res.result).toMatch(/rescheduled/i);
    expect(currentDb.tables.appointments[0].starts_at).toBe(et("14:30"));
    // The appointment being moved is excluded from its own conflict check.
    expect(currentDb.filterLog).toContain('appointments.neq(id,"appt-mine")');
  });

  test("moves the appointment when the new time is clear", async () => {
    currentDb = seedForReschedule();

    const res = await reschedule(et("11:00"));

    expect(res.conflict).toBeUndefined();
    expect(currentDb.tables.appointments[0].starts_at).toBe(et("11:00"));
    expect(currentDb.tables.appointments[0].ends_at).toBe(et("12:00"));
  });

  test("rejects an unparseable new start time without moving anything", async () => {
    currentDb = seedForReschedule();

    const res = await reschedule("next tuesday-ish");

    expect(res.result).toMatch(/could not be understood/i);
    expect(currentDb.tables.appointments[0].starts_at).toBe(et("14:00"));
  });

  test("excludes the appointment's own calendar event from the conflict check", async () => {
    // Regression: the appointment's own Google event overlaps the new time
    // whenever the caller shifts by less than the duration. Left in the busy
    // set, it would block every small move the customer asks for.
    currentDb = seedForReschedule();
    currentDb.tables.appointments[0].google_calendar_event_id = "event-mine";

    await reschedule(et("14:30"));

    const excludedIds = (getCalendarBusyIntervals as jest.Mock).mock.calls.map(
      ([, , , excludeId]) => excludeId,
    );
    expect(excludedIds).toContain("event-mine");
  });

  test("a small shift is allowed even though the old event covers the new time", async () => {
    currentDb = seedForReschedule();
    currentDb.tables.appointments[0].google_calendar_event_id = "event-mine";
    // Google returns everything except the excluded event.
    (getCalendarBusyIntervals as jest.Mock).mockImplementation(
      async (_biz, _min, _max, excludeId) =>
        excludeId === "event-mine"
          ? []
          : [{ starts_at: et("14:00"), ends_at: et("15:00") }],
    );

    const res = await reschedule(et("14:30"));

    expect(res.conflict).toBeUndefined();
    expect(currentDb.tables.appointments[0].starts_at).toBe(et("14:30"));
  });
});

describe("alternatives are bookable", () => {
  test("times earlier today are not offered once they have passed", async () => {
    // It is 12:30; the caller asks for 14:00, which is taken.
    jest.setSystemTime(new Date(et("12:30")));
    (getCalendarBusyIntervals as jest.Mock).mockResolvedValue([
      { starts_at: et("14:00"), ends_at: et("15:00") },
    ]);

    const res = await book(et("14:00"));
    const starts = (res.alternatives ?? []).map((a) => a.starts_at);

    expect(res.conflict).toBe(true);
    expect(starts.length).toBeGreaterThan(0);
    expect(starts).not.toContain(et("09:00"));
    expect(starts).not.toContain(et("11:00"));
    for (const start of starts) {
      expect(new Date(start).getTime()).toBeGreaterThanOrEqual(
        new Date(et("12:30")).getTime(),
      );
    }
  });
});

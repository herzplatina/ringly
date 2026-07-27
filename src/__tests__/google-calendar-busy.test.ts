/**
 * Tests for reading busy time off a business's Google Calendar — the input the
 * booking route uses to refuse an already-taken slot.
 */

jest.mock("@/lib/env", () => ({
  env: {
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    GOOGLE_REDIRECT_URI: "http://localhost/cb",
  },
}));

jest.mock("@/lib/encrypt", () => ({
  decrypt: (v: string) => v,
  encrypt: (v: string) => v,
}));

const eventsList = jest.fn();

jest.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: class {
        setCredentials = jest.fn();
      },
    },
    calendar: () => ({ events: { list: eventsList } }),
  },
}));

let businessRow: Record<string, unknown> | null = null;

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: businessRow }),
        }),
      }),
    }),
  }),
}));

import { getCalendarBusyIntervals } from "@/lib/google-calendar";

const TZ = "America/New_York";
// 10:00–11:00 ET on Monday 2026-07-06.
const WINDOW_START = "2026-07-06T14:00:00.000Z";
const WINDOW_END = "2026-07-06T15:00:00.000Z";

const timedEvent = (overrides: Record<string, unknown> = {}) => ({
  id: "event-1",
  status: "confirmed",
  start: { dateTime: WINDOW_START },
  end: { dateTime: WINDOW_END },
  ...overrides,
});

const listReturns = (items: unknown[]) =>
  eventsList.mockResolvedValue({ data: { items } });

const busy = () => getCalendarBusyIntervals("biz-1", WINDOW_START, WINDOW_END);

beforeEach(() => {
  jest.clearAllMocks();
  businessRow = {
    google_refresh_token: "token",
    google_calendar_id: "owner@example.com",
    timezone: TZ,
  };
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getCalendarBusyIntervals", () => {
  test("returns the busy window of a calendar event", async () => {
    listReturns([timedEvent()]);

    await expect(busy()).resolves.toEqual([
      { starts_at: WINDOW_START, ends_at: WINDOW_END },
    ]);
  });

  test("asks Google for the business's calendar over the requested window", async () => {
    listReturns([]);

    await busy();

    expect(eventsList).toHaveBeenCalledWith(
      expect.objectContaining({
        calendarId: "owner@example.com",
        timeMin: WINDOW_START,
        timeMax: WINDOW_END,
        // Recurring series must be expanded into individual occurrences,
        // otherwise a weekly block would not be seen.
        singleEvents: true,
      }),
    );
  });

  test("falls back to the primary calendar when none is configured", async () => {
    businessRow = { google_refresh_token: "token", timezone: TZ };
    listReturns([]);

    await busy();

    expect(eventsList).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: "primary" }),
    );
  });

  test("excludes a named event so an appointment can be moved off itself", async () => {
    listReturns([timedEvent({ id: "own-event" }), timedEvent({ id: "other" })]);

    const result = await getCalendarBusyIntervals(
      "biz-1",
      WINDOW_START,
      WINDOW_END,
      "own-event",
    );

    expect(result).toHaveLength(1);
  });

  test("ignores events the owner marked as free", async () => {
    listReturns([timedEvent({ transparency: "transparent" })]);

    await expect(busy()).resolves.toEqual([]);
  });

  test("ignores cancelled events", async () => {
    listReturns([timedEvent({ status: "cancelled" })]);

    await expect(busy()).resolves.toEqual([]);
  });

  test("treats an all-day event as blocking the business's local day", async () => {
    listReturns([
      timedEvent({
        start: { date: "2026-07-06" },
        end: { date: "2026-07-07" },
      }),
    ]);

    // Midnight-to-midnight in ET (UTC-4 in July), not in UTC.
    await expect(busy()).resolves.toEqual([
      {
        starts_at: "2026-07-06T04:00:00.000Z",
        ends_at: "2026-07-07T04:00:00.000Z",
      },
    ]);
  });

  test("skips events missing a start or end", async () => {
    listReturns([
      timedEvent({ id: "a", end: {} }),
      timedEvent({ id: "b", start: {} }),
      timedEvent({ id: "c" }),
    ]);

    await expect(busy()).resolves.toEqual([
      { starts_at: WINDOW_START, ends_at: WINDOW_END },
    ]);
  });

  test("returns nothing when the business has not connected Google", async () => {
    businessRow = { google_refresh_token: null, timezone: TZ };

    await expect(busy()).resolves.toEqual([]);
    expect(eventsList).not.toHaveBeenCalled();
  });

  test("returns nothing when Google errors, rather than throwing", async () => {
    eventsList.mockRejectedValue(new Error("503 backend error"));

    await expect(busy()).resolves.toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  test("tolerates a response with no items", async () => {
    eventsList.mockResolvedValue({ data: {} });

    await expect(busy()).resolves.toEqual([]);
  });
});

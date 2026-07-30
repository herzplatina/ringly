/**
 * A stand-in for the `googleapis` module backed by an in-memory calendar.
 *
 * It implements both of the Calendar v3 surfaces that can answer "when is this
 * business busy?" — `events.list` and `freebusy.query` — over the same event
 * data. Tests therefore describe the world ("the owner has a dentist
 * appointment at 10") without encoding which API the implementation chose to
 * ask, so they keep passing if that choice changes.
 */

import { fromZonedTime } from "date-fns-tz";

export type FakeCalendarEvent = {
  id: string;
  status?: string;
  transparency?: string;
  summary?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
};

export type FakeCalendar = {
  /** Events currently on the owner's calendar. Assign freely between tests. */
  events: FakeCalendarEvent[];
  /** Set to make every Calendar API call fail, simulating a Google outage. */
  failWith: Error | null;
  /**
   * Set to make every Calendar API call never answer, simulating Google hanging
   * rather than erroring — the case a try/catch alone does not cover.
   */
  hang: boolean;
  /** Aborts observed on hung requests, so tests can check we let go of them. */
  aborted: number;
  /**
   * How many times the calendar was consulted, across either API. Each one is a
   * network round trip the caller waits on, so this is the number that decides
   * how long the agent takes to answer.
   */
  lookups: number;
  /** Events created through the API, for asserting a booking synced across. */
  created: Array<Record<string, unknown>>;
  updated: Array<Record<string, unknown>>;
  deleted: string[];
  /** IANA zone used to resolve all-day event boundaries. */
  timezone: string;
  google: unknown;
};

/** Millisecond instant of an event boundary, resolving all-day dates in `tz`. */
function boundaryMs(
  boundary: { dateTime?: string; date?: string },
  tz: string,
): number {
  if (boundary.dateTime) return new Date(boundary.dateTime).getTime();
  if (boundary.date) {
    // Reuse date-fns-tz so the fake agrees with Google on what "midnight local"
    // means, including DST.
    return fromZonedTime(`${boundary.date}T00:00:00`, tz).getTime();
  }
  return NaN;
}

export function createFakeGoogleapis(timezone = "UTC"): FakeCalendar {
  const state: FakeCalendar = {
    events: [],
    failWith: null,
    hang: false,
    aborted: 0,
    lookups: 0,
    created: [],
    updated: [],
    deleted: [],
    timezone,
    google: null,
  };

  const guard = () => {
    if (state.failWith) throw state.failWith;
  };

  /**
   * A request that never answers. Records the abort if the caller gives up on
   * it, and stays pending forever either way — so a caller with no time budget
   * of its own would hang here, which is exactly what the tests check for.
   */
  const neverAnswers = <T>(signal?: AbortSignal): Promise<T> =>
    new Promise<T>(() => {
      signal?.addEventListener("abort", () => {
        state.aborted++;
      });
    });

  /** Events that are busy and overlap the window, as Google would report them. */
  const overlapping = (timeMin: string, timeMax: string, busyOnly: boolean) => {
    const windowStart = new Date(timeMin).getTime();
    const windowEnd = new Date(timeMax).getTime();
    return state.events.filter((event) => {
      if (busyOnly && event.status === "cancelled") return false;
      if (busyOnly && event.transparency === "transparent") return false;
      const start = boundaryMs(event.start, state.timezone);
      const end = boundaryMs(event.end, state.timezone);
      if (Number.isNaN(start) || Number.isNaN(end)) return true; // let caller cope
      return start < windowEnd && end > windowStart;
    });
  };

  const calendar = {
    events: {
      list: async (
        {
          timeMin,
          timeMax,
        }: {
          calendarId: string;
          timeMin: string;
          timeMax: string;
        },
        options?: { signal?: AbortSignal },
      ) => {
        state.lookups++;
        if (state.hang) return neverAnswers<never>(options?.signal);
        guard();
        // Google returns events verbatim; filtering out cancelled/transparent
        // ones is the caller's job, so this deliberately does not do it.
        return { data: { items: overlapping(timeMin, timeMax, false) } };
      },
      insert: async ({ requestBody }: { requestBody: unknown }) => {
        guard();
        const id = `gcal-event-${state.created.length + 1}`;
        state.created.push(requestBody as Record<string, unknown>);
        const body = requestBody as {
          start?: { dateTime?: string };
          end?: { dateTime?: string };
        };
        state.events.push({
          id,
          status: "confirmed",
          start: { dateTime: body.start?.dateTime },
          end: { dateTime: body.end?.dateTime },
        });
        return { data: { id } };
      },
      patch: async ({
        eventId,
        requestBody,
      }: {
        eventId: string;
        requestBody: unknown;
      }) => {
        guard();
        state.updated.push({ eventId, ...(requestBody as object) });
        const body = requestBody as {
          start?: { dateTime?: string };
          end?: { dateTime?: string };
        };
        const existing = state.events.find((e) => e.id === eventId);
        if (existing) {
          existing.start = { dateTime: body.start?.dateTime };
          existing.end = { dateTime: body.end?.dateTime };
        }
        return { data: {} };
      },
      delete: async ({ eventId }: { eventId: string }) => {
        guard();
        state.deleted.push(eventId);
        state.events = state.events.filter((e) => e.id !== eventId);
        return { data: {} };
      },
    },

    freebusy: {
      query: async (
        {
          requestBody,
        }: {
          requestBody: {
            timeMin: string;
            timeMax: string;
            items: Array<{ id: string }>;
          };
        },
        options?: { signal?: AbortSignal },
      ) => {
        state.lookups++;
        if (state.hang) return neverAnswers<never>(options?.signal);
        guard();
        const { timeMin, timeMax, items } = requestBody;
        const busy = overlapping(timeMin, timeMax, true).map((event) => ({
          start: new Date(
            boundaryMs(event.start, state.timezone),
          ).toISOString(),
          end: new Date(boundaryMs(event.end, state.timezone)).toISOString(),
        }));
        const id = items[0]?.id ?? "primary";
        return { data: { calendars: { [id]: { busy } } } };
      },
    },
  };

  state.google = {
    auth: {
      OAuth2: class {
        setCredentials() {}
        generateAuthUrl() {
          return "https://accounts.google.com/o/oauth2/auth";
        }
        async getToken() {
          return { tokens: { refresh_token: "rt" } };
        }
      },
    },
    calendar: () => calendar,
  };

  return state;
}

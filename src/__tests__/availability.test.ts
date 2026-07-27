import {
  computeAvailableSlots,
  formatSlotsForSpeech,
  hasConflict,
  suggestAdjacentSlots,
} from "@/lib/availability";

const MONDAY_2026 = "2026-07-06"; // a Monday
const TZ = "America/New_York";

const OPEN_HOURS = [
  {
    day_of_week: 1,
    is_closed: false,
    hours_ranges: [{ open: "09:00", close: "17:00" }],
    id: "1",
    business_id: "b",
    updated_at: "",
  },
];

describe("computeAvailableSlots", () => {
  test("returns slots within open hours", () => {
    const slots = computeAvailableSlots(MONDAY_2026, 60, TZ, OPEN_HOURS, []);
    expect(slots.length).toBeGreaterThan(0);
    // All slots should be within the day
    for (const slot of slots) {
      const start = new Date(slot.starts_at);
      const end = new Date(slot.ends_at);
      expect(end.getTime() - start.getTime()).toBe(60 * 60 * 1000);
    }
  });

  test("returns no slots on closed day", () => {
    const sundayHours = [
      {
        day_of_week: 0,
        is_closed: true,
        hours_ranges: [],
        id: "1",
        business_id: "b",
        updated_at: "",
      },
    ];
    // 2026-07-05 is a Sunday
    const slots = computeAvailableSlots("2026-07-05", 60, TZ, sundayHours, []);
    expect(slots).toHaveLength(0);
  });

  test("excludes booked appointment time", () => {
    // Book 9:00–10:00 ET
    const nineAmEt = new Date("2026-07-06T09:00:00-04:00").toISOString();
    const tenAmEt = new Date("2026-07-06T10:00:00-04:00").toISOString();
    const existing = [{ starts_at: nineAmEt, ends_at: tenAmEt }];

    const slots = computeAvailableSlots(
      MONDAY_2026,
      60,
      TZ,
      OPEN_HOURS,
      existing,
    );
    // 9am slot must not appear
    const slotTimes = slots.map((s) => new Date(s.starts_at).toISOString());
    expect(slotTimes).not.toContain(nineAmEt);
    // 10am slot should still be available
    const tenAmSlot = slots.find(
      (s) => new Date(s.starts_at).toISOString() === tenAmEt,
    );
    expect(tenAmSlot).toBeDefined();
  });

  test("respects duration — 90 min service fills correct window", () => {
    const slots = computeAvailableSlots(MONDAY_2026, 90, TZ, OPEN_HOURS, []);
    for (const slot of slots) {
      const start = new Date(slot.starts_at);
      const end = new Date(slot.ends_at);
      expect(end.getTime() - start.getTime()).toBe(90 * 60 * 1000);
    }
  });

  test("derives day-of-week from the calendar date, not a UTC round-trip (Pacific)", () => {
    // Regression: the old toZonedTime(parseISO(date)) round-trip shifted a
    // Monday date to Sunday in west-coast zones, so no Monday slots came back.
    const slots = computeAvailableSlots(
      MONDAY_2026,
      30,
      "America/Los_Angeles",
      [
        {
          day_of_week: 1, // Monday
          is_closed: false,
          hours_ranges: [{ open: "09:00", close: "17:00" }],
          id: "1",
          business_id: "b",
          updated_at: "",
        },
      ],
      [],
    );
    expect(slots.length).toBeGreaterThan(0);
    // First slot opens at 09:00 Pacific and is the default 30 minutes long.
    const firstHour = new Date(slots[0].starts_at).toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hour12: false,
    });
    expect(Number(firstHour)).toBe(9);
    expect(
      new Date(slots[0].ends_at).getTime() -
        new Date(slots[0].starts_at).getTime(),
    ).toBe(30 * 60 * 1000);
  });

  test("tolerates a trailing time component on the date", () => {
    // A model that passes an ISO datetime instead of YYYY-MM-DD must still work.
    const slots = computeAvailableSlots(
      `${MONDAY_2026}T09:00:00`,
      30,
      TZ,
      OPEN_HOURS,
      [],
    );
    expect(slots.length).toBeGreaterThan(0);
  });

  test("midday closure produces two windows", () => {
    const splitHours = [
      {
        day_of_week: 1,
        is_closed: false,
        hours_ranges: [
          { open: "09:00", close: "12:00" },
          { open: "13:00", close: "17:00" },
        ],
        id: "1",
        business_id: "b",
        updated_at: "",
      },
    ];
    const slots = computeAvailableSlots(MONDAY_2026, 60, TZ, splitHours, []);
    // No slot should straddle noon
    for (const slot of slots) {
      // Convert to ET hour
      const etHour = new Date(slot.starts_at).toLocaleString("en-US", {
        timeZone: TZ,
        hour: "numeric",
        hour12: false,
      });
      // Slot starting at 12 would run 12–13 which crosses the gap
      expect(Number(etHour)).not.toBe(12);
    }
  });
});

// Helper: an ET wall-clock time on Monday 2026-07-06 as a UTC ISO instant.
const et = (hhmm: string) =>
  new Date(`${MONDAY_2026}T${hhmm}:00-04:00`).toISOString();

describe("hasConflict", () => {
  const busy = [{ starts_at: et("10:00"), ends_at: et("11:00") }];

  test("detects an exact overlap", () => {
    expect(hasConflict(et("10:00"), et("11:00"), busy)).toBe(true);
  });

  test("detects a partial overlap on either edge", () => {
    expect(hasConflict(et("09:30"), et("10:30"), busy)).toBe(true);
    expect(hasConflict(et("10:30"), et("11:30"), busy)).toBe(true);
  });

  test("detects a requested window that swallows a busy block", () => {
    expect(hasConflict(et("09:00"), et("12:00"), busy)).toBe(true);
  });

  test("detects a requested window contained inside a busy block", () => {
    expect(hasConflict(et("10:15"), et("10:45"), busy)).toBe(true);
  });

  test("back-to-back appointments do not conflict", () => {
    expect(hasConflict(et("09:00"), et("10:00"), busy)).toBe(false);
    expect(hasConflict(et("11:00"), et("12:00"), busy)).toBe(false);
  });

  test("no conflict against an empty calendar", () => {
    expect(hasConflict(et("10:00"), et("11:00"), [])).toBe(false);
  });

  test("ignores unparseable busy entries rather than blocking the booking", () => {
    expect(
      hasConflict(et("10:00"), et("11:00"), [
        { starts_at: "not-a-date", ends_at: "also-not-a-date" },
      ]),
    ).toBe(false);
  });

  test("an unparseable request window reports no conflict", () => {
    expect(hasConflict("garbage", "garbage", busy)).toBe(false);
  });
});

describe("suggestAdjacentSlots", () => {
  // 60-min slots on an open 9–5 Monday with 10:00–11:00 taken.
  const openSlots = computeAvailableSlots(MONDAY_2026, 60, TZ, OPEN_HOURS, [
    { starts_at: et("10:00"), ends_at: et("11:00") },
  ]);

  test("offers times on both sides of the requested slot", () => {
    const alts = suggestAdjacentSlots(et("10:00"), openSlots);
    const starts = alts.map((s) => s.starts_at);
    expect(starts).toContain(et("09:00")); // the slot just before
    expect(starts).toContain(et("11:00")); // the slot just after
  });

  test("returns at most the requested number of alternatives", () => {
    expect(suggestAdjacentSlots(et("10:00"), openSlots)).toHaveLength(3);
    expect(
      suggestAdjacentSlots(et("10:00"), openSlots, undefined, 2),
    ).toHaveLength(2);
  });

  test("never offers a slot that has already passed", () => {
    // It is 12:30 on the day in question: 9:00 and 11:00 are unbookable.
    const alts = suggestAdjacentSlots(
      et("10:00"),
      openSlots,
      new Date(et("12:30")),
    );
    const starts = alts.map((s) => s.starts_at);

    expect(starts).not.toContain(et("09:00"));
    expect(starts).not.toContain(et("11:00"));
    expect(starts.every((s) => s >= et("12:30"))).toBe(true);
  });

  test("a slot starting exactly now is still offered", () => {
    const alts = suggestAdjacentSlots(
      et("10:00"),
      openSlots,
      new Date(et("13:00")),
    );
    expect(alts.map((s) => s.starts_at)).toContain(et("13:00"));
  });

  test("offers nothing when every open slot is in the past", () => {
    expect(
      suggestAdjacentSlots(et("10:00"), openSlots, new Date(et("23:00"))),
    ).toEqual([]);
  });

  test("prefers the nearest times and returns them chronologically", () => {
    const alts = suggestAdjacentSlots(et("10:00"), openSlots);
    expect(alts.map((s) => s.starts_at)).toEqual([
      et("09:00"),
      et("11:00"),
      et("11:30"),
    ]);
  });

  test("never offers back the exact slot that was requested", () => {
    const alts = suggestAdjacentSlots(et("13:00"), openSlots);
    expect(alts.map((s) => s.starts_at)).not.toContain(et("13:00"));
  });

  test("returns nothing when the day has no open slots", () => {
    expect(suggestAdjacentSlots(et("10:00"), [])).toEqual([]);
  });

  test("falls back to the earliest slots when the request is unparseable", () => {
    const alts = suggestAdjacentSlots("garbage", openSlots);
    expect(alts).toEqual(openSlots.slice(0, 3));
  });
});

describe("formatSlotsForSpeech", () => {
  const slot = (hhmm: string) => ({
    starts_at: et(hhmm),
    ends_at: et(hhmm),
  });

  test("joins three slots with commas and a trailing 'or'", () => {
    const text = formatSlotsForSpeech(
      [slot("09:00"), slot("11:00"), slot("11:30")],
      TZ,
    );
    expect(text).toBe(
      "Monday, July 6th at 9:00 AM, Monday, July 6th at 11:00 AM or Monday, July 6th at 11:30 AM",
    );
  });

  test("renders a single slot with no connector", () => {
    expect(formatSlotsForSpeech([slot("09:00")], TZ)).toBe(
      "Monday, July 6th at 9:00 AM",
    );
  });

  test("renders an empty list as an empty string", () => {
    expect(formatSlotsForSpeech([], TZ)).toBe("");
  });
});

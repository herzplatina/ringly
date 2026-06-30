import { computeAvailableSlots } from "@/lib/availability";

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
      const startLocal = new Date(slot.starts_at);
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

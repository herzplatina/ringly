import { formatHM, mapOpeningHours, normalizePlace } from "@/lib/places";

describe("formatHM", () => {
  test("zero-pads hours and minutes", () => {
    expect(formatHM(9, 0)).toBe("09:00");
    expect(formatHM(17, 30)).toBe("17:30");
  });
  test("clamps out-of-range values", () => {
    expect(formatHM(30, 90)).toBe("23:59");
    expect(formatHM(-1, -5)).toBe("00:00");
  });
});

describe("mapOpeningHours", () => {
  test("returns 7 days, all closed when no periods", () => {
    const rows = mapOpeningHours(undefined);
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.is_closed)).toBe(true);
  });

  test("maps a weekday period to an open range on the right day", () => {
    const rows = mapOpeningHours({
      periods: [
        {
          open: { day: 1, hour: 9, minute: 0 },
          close: { day: 1, hour: 17, minute: 30 },
        },
      ],
    });
    const monday = rows[1];
    expect(monday.is_closed).toBe(false);
    expect(monday.hours_ranges).toEqual([{ open: "09:00", close: "17:30" }]);
    expect(rows[2].is_closed).toBe(true); // Tuesday still closed
  });

  test("clamps an overnight (rollover) period to end-of-day", () => {
    const rows = mapOpeningHours({
      periods: [
        {
          open: { day: 5, hour: 20, minute: 0 },
          close: { day: 6, hour: 2, minute: 0 },
        },
      ],
    });
    expect(rows[5].hours_ranges).toEqual([{ open: "20:00", close: "23:59" }]);
  });
});

describe("normalizePlace", () => {
  test("maps Place Details fields including IANA timezone and phone fallback", () => {
    const { business, hours } = normalizePlace({
      id: "place_1",
      displayName: { text: "Glamour Studio" },
      formattedAddress: "123 Main St, Austin, TX",
      internationalPhoneNumber: "+1 512-555-0100",
      websiteUri: "https://glamour.example",
      location: { latitude: 30.26, longitude: -97.74 },
      timeZone: { id: "America/Chicago" },
      regularOpeningHours: {
        periods: [
          {
            open: { day: 0, hour: 10, minute: 0 },
            close: { day: 0, hour: 15, minute: 0 },
          },
        ],
      },
    });
    expect(business).toMatchObject({
      google_place_id: "place_1",
      name: "Glamour Studio",
      formatted_address: "123 Main St, Austin, TX",
      public_phone: "+1 512-555-0100", // falls back to international when national missing
      website_url: "https://glamour.example",
      timezone: "America/Chicago",
      latitude: 30.26,
      longitude: -97.74,
    });
    expect(hours[0]).toEqual({
      day_of_week: 0,
      is_closed: false,
      hours_ranges: [{ open: "10:00", close: "15:00" }],
    });
  });

  test("defaults timezone when absent", () => {
    const { business } = normalizePlace({
      id: "p",
      displayName: { text: "X" },
    });
    expect(business.timezone).toBe("America/New_York");
  });
});

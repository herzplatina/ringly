import {
  normalizePhone,
  namesMatch,
  phonesMatch,
  isValidTimezone,
  normalizeTimezone,
} from "@/lib/utils";

describe("normalizePhone", () => {
  test("strips non-digits", () => {
    expect(normalizePhone("+1 (415) 555-1234")).toBe("14155551234");
    expect(normalizePhone("")).toBe("");
  });
});

describe("namesMatch", () => {
  // F2.4 identifies an appointment by name plus details instead of by caller
  // ID, so this comparison is an authentication check, not a convenience.
  it("tolerates what speech-to-text does to a name", () => {
    expect(namesMatch("Jane Nguyen", "jane nguyen")).toBe(true);
    expect(namesMatch("Jane  Nguyen", "Jane Nguyen")).toBe(true);
    expect(namesMatch("Renée O'Brien", "Renee OBrien")).toBe(true);
    expect(namesMatch(" Jane Nguyen ", "Jane Nguyen")).toBe(true);
    expect(namesMatch("Blow-dry", "blow dry")).toBe(true);
  });

  it("never matches on a prefix, which would hand over another customer", () => {
    expect(namesMatch("Anna", "Ann")).toBe(false);
    expect(namesMatch("Jane Nguyen", "Jane")).toBe(false);
    expect(namesMatch("Jane Nguyen", "Jane Nguyener")).toBe(false);
  });

  it("treats an empty or punctuation-only name as no match, never a wildcard", () => {
    expect(namesMatch("", "")).toBe(false);
    expect(namesMatch("Jane", "")).toBe(false);
    expect(namesMatch("", "Jane")).toBe(false);
    expect(namesMatch("---", "Jane")).toBe(false);
    expect(namesMatch("---", "***")).toBe(false);
  });

  it("still distinguishes genuinely different people", () => {
    expect(namesMatch("Jane Nguyen", "John Nguyen")).toBe(false);
    expect(namesMatch("Colour", "Cut")).toBe(false);
  });
});

describe("phonesMatch", () => {
  test("matches the same number in different formats", () => {
    expect(phonesMatch("+14155551234", "1-415-555-1234")).toBe(true);
  });

  test("does not substring-match a shorter number", () => {
    // The old .includes() bug would have returned true here.
    expect(phonesMatch("+14155551234", "5551234")).toBe(false);
  });

  test("empty / no-digit inputs never match", () => {
    expect(phonesMatch("", "")).toBe(false);
    expect(phonesMatch("+14155551234", "")).toBe(false);
    expect(phonesMatch("", "+14155551234")).toBe(false);
    expect(phonesMatch("n/a", "unknown")).toBe(false);
  });

  test("different numbers do not match", () => {
    expect(phonesMatch("+14155551234", "+14155559999")).toBe(false);
  });
});

describe("timezone validation", () => {
  test("accepts zones ICU recognizes, rejects malformed strings", () => {
    expect(isValidTimezone("America/Los_Angeles")).toBe(true);
    expect(isValidTimezone("UTC")).toBe(true);
    // Only genuinely malformed strings throw in Intl/date-fns-tz (the 500 risk).
    expect(isValidTimezone("garbage")).toBe(false);
    expect(isValidTimezone("Not/AZone")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });

  test("normalizeTimezone falls back for invalid/empty input", () => {
    expect(normalizeTimezone("America/Chicago")).toBe("America/Chicago");
    expect(normalizeTimezone("garbage")).toBe("America/New_York");
    expect(normalizeTimezone("")).toBe("America/New_York");
    expect(normalizeTimezone(null)).toBe("America/New_York");
    expect(normalizeTimezone("nonsense", "UTC")).toBe("UTC");
  });
});

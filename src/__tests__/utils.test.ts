import { normalizePhone, phonesMatch } from "@/lib/utils";

describe("normalizePhone", () => {
  test("strips non-digits", () => {
    expect(normalizePhone("+1 (415) 555-1234")).toBe("14155551234");
    expect(normalizePhone("")).toBe("");
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

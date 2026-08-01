import {
  NotImplementedError,
  aBusiness,
  billingHistory,
  caller,
  cents,
  day,
  google,
  money,
  operator,
  owner,
  serviceStatus,
  system,
} from "./harness";

/**
 * The harness testing itself.
 *
 * Not a behaviour scenario — §2.21 owns those. This exists so the barrel, the
 * types and the not-implemented mechanism cannot rot silently while every real
 * scenario sits in `test.todo`, which is exactly the window in which a
 * scaffold quietly stops compiling.
 */
describe("harness", () => {
  describe("scalars", () => {
    it("converts dollars to cents without floating-point drift", () => {
      expect(money(0.1).cents).toBe(10);
      expect(money(0.29).cents).toBe(29);
      expect(money(100).cents).toBe(10_000);
      expect(money(470.35).cents).toBe(47_035);
    });

    it("takes cents directly for figures the product states in cents", () => {
      expect(cents(47_035)).toEqual(money(470.35));
    });

    it("names days on the test timeline", () => {
      expect(day(45).index).toBe(45);
    });

    it("names a moment within a day, for the window and DST scenarios", () => {
      expect(day(45, "19:00")).toEqual({ dayIndex: 45, minuteOfDay: 1140 });
      expect(day(1, "00:00").minuteOfDay).toBe(0);
      expect(day(1, "23:59").minuteOfDay).toBe(1439);
    });

    it("rejects a time it cannot parse rather than yielding NaN", () => {
      // Jest holds NaN equal to NaN, so a silently-mistyped time would compare
      // equal to any other mistyped time and the assertion would prove nothing.
      expect(() => day(45, "2pm")).toThrow(/hh:mm/);
      expect(() => day(45, "9:00")).toThrow(/hh:mm/);
      expect(() => day(45, "24:00")).toThrow(/not a time of day/);
      expect(() => day(45, "12:60")).toThrow(/not a time of day/);
    });

    it("distinguishes the two passes through a fall-back hour", () => {
      // Scenario 253. Without the third argument both 01:30s are the same
      // value and the requirement cannot be stated at all.
      expect(day(310, "01:30", "first")).not.toEqual(
        day(310, "01:30", "second"),
      );
      // Absent unless asked for, so ordinary times stay comparable.
      expect(day(310, "01:30")).toEqual({ dayIndex: 310, minuteOfDay: 90 });
    });

    it("keeps both forms plain data, so toEqual compares structurally", () => {
      // A method on these would make two separately built day(60) values
      // unequal under Jest — the trap this shape exists to avoid.
      expect(day(60)).toEqual(day(60));
      expect(day(60, "09:00")).toEqual(day(60, "09:00"));
      expect(Object.values(day(60)).every((v) => typeof v !== "function")).toBe(
        true,
      );
    });
  });

  describe("unimplemented methods", () => {
    it("names the requirement and the phase rather than failing blankly", async () => {
      await expect(billingHistory({ id: "b1" })).rejects.toThrow(
        NotImplementedError,
      );
      await expect(billingHistory({ id: "b1" })).rejects.toThrow(
        /F6\.7.*Phase 4/,
      );
    });

    it("rejects from actors too, not only projections", async () => {
      await expect(operator.pausesDeletionClock({ id: "b1" })).rejects.toThrow(
        /F10\.1b.*Phase 5/,
      );
      await expect(system.runWorker("lifecycle_sweeper")).rejects.toThrow(
        /Phase 1/,
      );
      await expect(system.advanceBy({ seconds: 61 })).rejects.toThrow(/F3\.2/);
      await expect(google.becomesUnreachable()).rejects.toThrow(/F2\.7/);
    });

    it("rejects rather than throwing, so Promise.all does not detonate", async () => {
      const settled = await Promise.allSettled([
        billingHistory({ id: "b1" }),
        serviceStatus({ id: "b1" }),
      ]);
      expect(settled.map((s) => s.status)).toEqual(["rejected", "rejected"]);
    });

    it("throws from a caller session, which is reached through a factory", () => {
      expect(() => caller("+15550000000").calls({ id: "b1" })).toThrow(
        NotImplementedError,
      );
    });
  });

  describe("the builder", () => {
    it("chains configuration without touching anything", () => {
      const builder = aBusiness()
        .named("Shear Genius")
        .inTimezone("America/Los_Angeles")
        .withServices([{ name: "Cut", price: money(45), durationMinutes: 30 }]);
      expect(typeof builder.activated).toBe("function");
    });

    it("throws only when a step would actually create something", async () => {
      await expect(aBusiness().activated()).rejects.toThrow(/F1\.12a.*Phase 4/);
    });
  });

  describe("the barrel", () => {
    it("does not hand specs the not-implemented plumbing", async () => {
      const barrel = await import("./harness");
      expect(barrel).toHaveProperty("NotImplementedError");
      // A spec asserting `pending(...)` would be testing the harness, not the
      // product; only the error type is public.
      expect(barrel).not.toHaveProperty("pending");
      expect(barrel).not.toHaveProperty("notImplemented");
    });
  });

  describe("owner methods", () => {
    it("are all present and all pending", async () => {
      const o = owner({ id: "b1" });
      const methods = Object.keys(o).sort() as (keyof typeof o)[];
      // The exact set, not a lower bound: a method silently dropped during a
      // refactor is precisely what this test is here to catch, and
      // `toBeGreaterThan(10)` would keep passing.
      expect(methods).toEqual([
        "addsPaymentMethod",
        "addsService",
        "confirmsTestCallWorked",
        "deactivatesService",
        "deletesCustomer",
        "optsOutOfStatsDigest",
        "pressesActivate",
        "reconnectsCalendar",
        "repricesService",
        "setsBookingHorizon",
        "setsOpeningHours",
        "setsRecurrenceHorizon",
        "verifiesEmail",
      ]);
      for (const m of methods) {
        await expect((o[m] as () => Promise<unknown>)()).rejects.toThrow(
          NotImplementedError,
        );
      }
    });
  });
});

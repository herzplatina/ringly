import * as harness from "./harness";
import {
  NotImplementedError,
  Refused,
  aBusiness,
  aCustomerNumber,
  aProspect,
  caller,
  cents,
  day,
  money,
  operator,
  owner,
  remember,
  resetWorld,
} from "./harness";

/**
 * The harness testing itself.
 *
 * Not a behaviour scenario — §2.21 owns those. This exists so the barrel, the
 * types and the not-implemented mechanism cannot rot silently while every real
 * scenario sits in `test.todo`, which is exactly the window in which a scaffold
 * quietly stops compiling.
 *
 * **It is written by enumeration, not by sampling.** An earlier version tested
 * two projections out of seventeen; mutation testing showed the other fifteen
 * could be deleted outright with the suite still reporting green. Every
 * assertion below is over the whole exported surface, so anything removed,
 * renamed, or quietly switched to a synchronous throw fails here.
 */

/** Every free function the barrel exports. Adding one means adding it here. */
const EXPECTED_EXPORTS = [
  "NotImplementedError",
  "Refused",
  "aBusiness",
  "aCustomerNumber",
  "aProspect",
  "activationChecklist",
  "allEmailSent",
  "appointments",
  "billingHistory",
  "calendarIncident",
  "callAnalytics",
  "caller",
  "candidates",
  "cents",
  "connectedCalendar",
  "contentDeleteRequestedFor",
  "dataExportIsOffered",
  "day",
  "departureRecord",
  "enrichedDraft",
  "everythingStoredAbout",
  "hasCardOnFile",
  "inbox",
  "isReadableBy",
  "ledger",
  "money",
  "numberAnswers",
  "numberIsReusable",
  "numbersHeld",
  "openingHours",
  "operatorMoneyTable",
  "operatorQueue",
  "opsIsReachableBy",
  "owed",
  "owedAtDeparture",
  "owner",
  "platformTotals",
  "policy",
  "remember",
  "resetWorld",
  "serviceStatus",
  "services",
  "unearningNumbers",
];

/**
 * The exports that are real code rather than adapters, so the pending-check
 * below skips them: value constructors, factories, and the teardown no-op.
 */
const NOT_ADAPTERS = new Set([
  "NotImplementedError",
  "Refused",
  "aBusiness",
  "aCustomerNumber",
  "aProspect",
  "caller",
  "cents",
  "day",
  "money",
  "owner",
  "remember",
  "resetWorld",
]);

/** Every stub object, and the exact members it must have. */
const STUB_OBJECTS: Record<string, readonly string[]> = {
  operator: [
    "clearsCancelled",
    "marksCancelled",
    "pausesDeletionClock",
    "resetsTestCallAllowance",
    "resumesDeletionClock",
    "setsPolicy",
    "viewsAsBusiness",
  ],
  system: ["advanceBy", "advanceTo", "runDueWorkers", "runWorker"],
  calendar: [
    "becomesSlow",
    "becomesUnreachable",
    "ownerCreatesEvent",
    "recovers",
    "revokesConsent",
    "willDeclineCalendarScope",
  ],
  telephony: [
    "willFailNextBind",
    "willFailNextUnbind",
    "willSilentlyIgnoreNextBind",
    "willSilentlyIgnoreNextUnbind",
  ],
  email: ["comesBack", "dropsNextDelivery", "goesDown"],
  payments: [
    "comesBack",
    "declineNextCharge",
    "dropsNextWebhook",
    "filesChargeback",
    "goesDown",
    "payOutstanding",
    "pays",
    "redeliversLastWebhook",
    "sendsUnsignedWebhook",
  ],
  classifier: [
    "deliverPending",
    "holdsNextResult",
    "willClassifyNextAs",
    "willFailNext",
  ],
  enrichment: [
    "comesBack",
    "goesDown",
    "websiteOffers",
    "websiteUnreachable",
    "willReturnCandidates",
  ],
  storage: ["failsNextWrite", "recovers"],
};

const OWNER_METHODS = [
  "addsPaymentMethod",
  "addsService",
  "cancels",
  "changesContactEmail",
  "confirmsTestCallWorked",
  "deactivatesService",
  "deletesCustomer",
  "deletesService",
  "editsService",
  "optsOutOfStatsDigest",
  "pressesActivate",
  "reconnectsCalendar",
  "reordersServices",
  "repricesService",
  "setsBookingHorizon",
  "setsOpeningHours",
  "setsRecurrenceHorizon",
  "verifiesEmail",
];

const SESSION_TURNS = [
  "andAsksAboutServices",
  "andAsksForSomethingElse",
  "andAsksToBook",
  "andAsksToCancel",
  "andAsksToReschedule",
  "andAsksToSetUpRecurring",
  "andChooses",
  "andConfirms",
  "andCorrects",
  "andHangsUp",
  "andSays",
  "transcript",
];

const PROSPECT_STEPS = [
  "commits",
  "declinesCalendarScope",
  "edits",
  "grantsConsent",
  "picksCandidate",
  "submits",
];

const BUILDER_STEPS = [
  "activated",
  "activatedOn",
  "inTimezone",
  "named",
  "openingHours",
  "provisioned",
  "readyToActivate",
  "withContactEmail",
  "withDayOneOn",
  "withServices",
];

const B = { id: "b1" };

/** Calls a stub with throwaway arguments; an unimplemented adapter ignores them. */
const invoke = (fn: unknown): unknown =>
  (fn as (...a: unknown[]) => unknown)(B, B, B);

describe("harness", () => {
  describe("scalars", () => {
    it("converts dollars to cents without floating-point drift", () => {
      expect(money(0.1).cents).toBe(10);
      expect(money(0.29).cents).toBe(29);
      expect(money(100).cents).toBe(10_000);
      expect(money(470.35).cents).toBe(47_035);
    });

    it("normalises negative zero, which toEqual treats as a different value", () => {
      // Without this, an `owed()` arriving at zero from below fails
      // `toEqual(money(0))` and reads as a product bug. Refunds, absorbed
      // excess and negative margin all make it reachable.
      expect(Object.is(money(-0.001).cents, -0)).toBe(false);
      expect(cents(-0)).toEqual(cents(0));
      expect(money(-0)).toEqual(money(0));
    });

    it("takes cents directly for figures the product states in cents", () => {
      expect(cents(47_035)).toEqual(money(470.35));
    });

    it("names days on the test timeline", () => {
      expect(day(45).index).toBe(45);
    });

    it("rejects a day index it cannot mean, rather than yielding NaN", () => {
      // Jest holds NaN equal to NaN, so an unvalidated index would make two
      // mistyped days compare equal and assert nothing.
      expect(() => day(NaN)).toThrow(/whole day index/);
      expect(() => day(0)).toThrow(/whole day index/);
      expect(() => day(-3)).toThrow(/whole day index/);
      expect(() => day(1.5)).toThrow(/whole day index/);
    });

    it("names a moment within a day, for the window and DST scenarios", () => {
      expect(day(45, "19:00")).toEqual({ dayIndex: 45, minuteOfDay: 1140 });
      expect(day(1, "00:00").minuteOfDay).toBe(0);
      expect(day(1, "23:59").minuteOfDay).toBe(1439);
    });

    it("rejects a time it cannot parse rather than yielding NaN", () => {
      expect(() => day(45, "2pm")).toThrow(/hh:mm/);
      expect(() => day(45, "9:00")).toThrow(/hh:mm/);
      expect(() => day(45, "24:00")).toThrow(/not a time of day/);
      expect(() => day(45, "12:60")).toThrow(/not a time of day/);
    });

    it("distinguishes the two passes through a fall-back hour", () => {
      expect(day(310, "01:30", "first")).not.toEqual(
        day(310, "01:30", "second"),
      );
      expect(day(310, "01:30")).toEqual({ dayIndex: 310, minuteOfDay: 90 });
    });

    it("keeps both forms plain data, so toEqual compares structurally", () => {
      expect(day(60)).toEqual(day(60));
      expect(day(60, "09:00")).toEqual(day(60, "09:00"));
      expect(Object.values(day(60)).every((v) => typeof v !== "function")).toBe(
        true,
      );
    });

    it("hands out distinct caller numbers from the reserved range", () => {
      const a = aCustomerNumber();
      const b = aCustomerNumber();
      expect(a).not.toEqual(b);
      // 555 is reserved for fiction, so no fixture can dial a real person.
      expect(a).toMatch(/^\+1555\d{7}$/);
    });

    it("captures a handle that outlives the business it names", () => {
      expect(remember({ id: "gone" })).toEqual({ departedId: "gone" });
    });
  });

  describe("the exported surface", () => {
    it("is exactly this set, so nothing can be dropped unnoticed", () => {
      const actual = Object.entries(harness)
        .filter(([, v]) => typeof v === "function")
        .map(([k]) => k)
        .sort();
      expect(actual).toEqual([...EXPECTED_EXPORTS].sort());
    });

    it("exposes each stub object with exactly its declared members", () => {
      for (const [name, members] of Object.entries(STUB_OBJECTS)) {
        const obj = (harness as unknown as Record<string, object>)[name];
        expect({ [name]: Object.keys(obj).sort() }).toEqual({
          [name]: [...members].sort(),
        });
      }
    });

    it("does not hand specs the not-implemented plumbing", () => {
      expect(harness).toHaveProperty("NotImplementedError");
      expect(harness).not.toHaveProperty("pending");
      expect(harness).not.toHaveProperty("notImplemented");
    });
  });

  describe("every unimplemented member", () => {
    const adapters = EXPECTED_EXPORTS.filter((n) => !NOT_ADAPTERS.has(n));

    it.each(adapters)("%s rejects rather than throwing", async (name) => {
      // `rejects` — not try/catch — because a synchronous throw from a
      // promise-returning function escapes `.catch()` and detonates
      // `Promise.all`. That bug shipped once; this is the guard, and it now
      // covers every member rather than the two it used to.
      const fn = (harness as unknown as Record<string, unknown>)[name];
      await expect(invoke(fn)).rejects.toThrow(NotImplementedError);
    });

    it.each(Object.entries(STUB_OBJECTS))(
      "%s's members all reject",
      async (name, members) => {
        const obj = (
          harness as unknown as Record<string, Record<string, unknown>>
        )[name];
        for (const m of members) {
          await expect(invoke(obj[m])).rejects.toThrow(NotImplementedError);
        }
      },
    );

    it("names the requirement it holds, never a blank failure", async () => {
      const seen: NotImplementedError[] = [];
      const collect = async (fn: unknown) => {
        await (invoke(fn) as Promise<unknown>).catch((e) => seen.push(e));
      };
      for (const name of adapters) {
        await collect((harness as unknown as Record<string, unknown>)[name]);
      }
      // Stub-object members and call turns too, not just the free functions —
      // an earlier version checked only the latter, and a blank `holds` on
      // `operator.setsPolicy` sailed through.
      for (const [name, members] of Object.entries(STUB_OBJECTS)) {
        const obj = (
          harness as unknown as Record<string, Record<string, unknown>>
        )[name];
        for (const m of members) await collect(obj[m]);
      }
      const session = caller("+15550000000").calls(B) as unknown as Record<
        string,
        unknown
      >;
      for (const t of SESSION_TURNS) await collect(session[t]);
      for (const m of OWNER_METHODS) {
        await collect((owner(B) as unknown as Record<string, unknown>)[m]);
      }
      for (const st of PROSPECT_STEPS) {
        await collect((aProspect() as unknown as Record<string, unknown>)[st]);
      }

      const expected =
        adapters.length +
        Object.values(STUB_OBJECTS).reduce((n, m) => n + m.length, 0) +
        SESSION_TURNS.length +
        OWNER_METHODS.length +
        PROSPECT_STEPS.length;
      expect(seen).toHaveLength(expected);
      for (const e of seen) {
        // `holds` is the only thing a stub carries, so it is the only thing
        // worth pinning: a member that rejects without naming a requirement
        // tells an implementer nothing about what it is for. The shape is
        // checked rather than the value, because the requirement set changes
        // with the PRD and this assertion must not need editing when it does.
        expect(e.holds).toMatch(/^[FN]\d|^§\d/);
      }
    });

    it("rejects rather than throwing, so Promise.all does not detonate", async () => {
      const settled = await Promise.allSettled([
        harness.billingHistory(B),
        harness.serviceStatus(B),
      ]);
      expect(settled.map((s) => s.status)).toEqual(["rejected", "rejected"]);
    });
  });

  describe("a product refusal is not the same as an unbuilt path", () => {
    it("does not let `rejects.toThrow()` pass for free", () => {
      // Seventeen scenarios in §2.21 assert the product *refuses* something.
      // Written as a bare `rejects.toThrow()`, every one of them passed against
      // an implementation that did not exist. They must name `Refused`, and
      // `Refused` must be unsatisfiable by `NotImplementedError`.
      const notBuilt = new NotImplementedError("F2.8");
      const refused = new Refused("outside opening hours");
      expect(notBuilt).not.toBeInstanceOf(Refused);
      expect(refused).not.toBeInstanceOf(NotImplementedError);
      expect(refused.reason).toBe("outside opening hours");
    });

    it("still fails a refusal assertion written against today's stubs", async () => {
      // The point of the split, demonstrated: this is how a refusal scenario
      // must be written, and it correctly fails while unimplemented instead of
      // passing on the not-implemented rejection.
      await expect(
        expect(owner(B).setsBookingHorizon(9999)).rejects.toThrow(Refused),
      ).rejects.toThrow();
    });
  });

  describe("factories", () => {
    it("opens a call session without touching anything, so callers can race", () => {
      // `calls()` must not throw synchronously: the concurrency scenarios fan
      // out with Promise.all, which a sync throw would take down before either
      // booking started.
      expect(() => caller("+15550000000").calls(B)).not.toThrow();
      expect(Object.keys(caller("+15550000000").calls(B)).sort()).toEqual(
        [...SESSION_TURNS].sort(),
      );
    });

    it("rejects from every turn of a call", async () => {
      const session = caller("+15550000000").calls(B);
      for (const turn of SESSION_TURNS) {
        await expect(
          invoke((session as unknown as Record<string, unknown>)[turn]),
        ).rejects.toThrow(NotImplementedError);
      }
    });

    it.each([
      ["owner", () => owner(B), OWNER_METHODS],
      ["aProspect", () => aProspect(), PROSPECT_STEPS],
    ] as const)(
      "%s exposes exactly its declared methods, all pending",
      async (_n, make, expected) => {
        const obj = make() as unknown as Record<string, unknown>;
        expect(Object.keys(obj).sort()).toEqual([...expected].sort());
        for (const m of expected) {
          await expect(invoke(obj[m])).rejects.toThrow(NotImplementedError);
        }
      },
    );

    it("chains builder configuration without touching anything", () => {
      const builder = aBusiness()
        .named("Shear Genius")
        .inTimezone("America/Los_Angeles")
        .withServices([{ name: "Cut", price: money(45), durationMinutes: 30 }]);
      expect(Object.keys(builder).sort()).toEqual([...BUILDER_STEPS].sort());
    });

    it("throws only when a builder step would actually create something", async () => {
      await expect(aBusiness().activated()).rejects.toThrow(/F1\.12a/);
      await expect(aBusiness().provisioned()).rejects.toThrow(/F1\.9/);
    });
  });

  describe("teardown", () => {
    it("resolves, so a rejection from it always means a real leak", async () => {
      // Deliberately swallowing nothing: an earlier version caught
      // NotImplementedError here, and mutation testing showed the catch could
      // be widened to hide any teardown failure with no test noticing.
      await expect(resetWorld()).resolves.toBeUndefined();
    });
  });

  describe("the operator surface", () => {
    it("changes policy through the operator, not through a constant", async () => {
      await expect(
        operator.setsPolicy({ testCallAllowance: 5 }),
      ).rejects.toThrow(/F7\.8/);
    });
  });
});

import { notImplemented, pending } from "./pending";
import type {
  BusinessRef,
  Day,
  EmailAddress,
  OpeningHours,
  PhoneNumber,
  ServiceSpec,
} from "./types";

/**
 * Per-test world setup.
 *
 * **One fresh business per test, and tests run in parallel.** The product is
 * multi-tenant by design (N1), so isolation is free and needs no truncation
 * between tests. Two groups must serialise: the cross-tenant isolation
 * scenarios (245–249) and the operator's platform totals (235, 238), both of
 * which read across tenants.
 *
 * Each business also gets **its own Stripe test clock**, because those are
 * per-customer objects — which happens to fit one-tenant-per-test exactly. A
 * Stripe customer must be created *on* a clock, so the clock is created with
 * the business rather than lazily; `system.advanceTo` therefore needs to know
 * whose clock it is moving (`ClockScope`) once more than one exists.
 *
 * The implementation should keep a worker-local `Map<BusinessRef["id"], …>` of
 * resolved handles — sessions, Stripe ids, tenant keys — so that repeated
 * `owner(biz).x()` calls in one test do not re-authenticate. `resetWorld`
 * clears it.
 */

/**
 * Fluent builder. Each step is a *product* action, not a database insert:
 * `.activated()` really presses the button and really charges the card in
 * Stripe test mode. A test may not conjure a state the product cannot reach.
 */
export type BusinessBuilder = {
  /** Defaults to a salon in `America/Los_Angeles` with three services. */
  named(name: string): BusinessBuilder;
  inTimezone(tz: string): BusinessBuilder;
  withContactEmail(address: EmailAddress): BusinessBuilder;
  openingHours(hours: OpeningHours): BusinessBuilder;
  withServices(services: readonly ServiceSpec[]): BusinessBuilder;
  /**
   * Pins day 1 to a real calendar date, e.g. `"2026-10-30"`.
   *
   * The DST scenarios (250–255) are about a specific local hour existing twice
   * or not at all, so they need a timeline that actually crosses a transition;
   * a relative day index cannot reach one. Everything else should leave day 1
   * unpinned and stay relative.
   */
  withDayOneOn(isoDate: string): BusinessBuilder;

  /** Stops after provisioning: `unbilled`, number bound, allowance untouched. */
  provisioned(): Promise<BusinessRef>;
  /** Every checklist item green, but Activate not yet pressed (F1.12). */
  readyToActivate(): Promise<BusinessRef>;
  /** Through activation — $100 charged, period 1 open (F1.12a). */
  activated(): Promise<BusinessRef>;
  /** Activated as of a given day, so period arithmetic is predictable. */
  activatedOn(d: Day): Promise<BusinessRef>;
};

export function aBusiness(): BusinessBuilder {
  const self: BusinessBuilder = {
    named: () => self,
    inTimezone: () => self,
    withContactEmail: () => self,
    openingHours: () => self,
    withServices: () => self,
    withDayOneOn: () => self,
    provisioned: () => pending("F1.1–F1.9", "Phase 3 — Onboarding"),
    readyToActivate: () => pending("F1.12", "Phase 3 — Onboarding"),
    activated: () => pending("F1.12a", "Phase 4 — Billing"),
    activatedOn: () => pending("F1.12a", "Phase 4 — Billing"),
  };
  return self;
}

/** A number the caller can dial. Convenience for the many scenarios that need one. */
export function aCustomerNumber(): PhoneNumber {
  return notImplemented("F2.4", "Phase 1 — Foundations");
}

/**
 * Tear down whatever the test created — Stripe customer and test clock, the
 * tenant's rows, the fakes' captured state.
 *
 * Wired as a global `afterEach` in `tests/behaviour/setup.ts`; a spec should
 * not need to call it.
 */
export function resetWorld(): Promise<void> {
  return pending("§2.20.2", "Phase 1 — Foundations");
}

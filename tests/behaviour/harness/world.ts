import { pending } from "./pending";
import type {
  BusinessRef,
  Day,
  DepartedRef,
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
 * Each business also gets **its own payment-provider test clock**, because
 * those are per-customer objects — which happens to fit one-tenant-per-test
 * exactly. A customer must be created *on* a clock, so the clock is created
 * with the business rather than lazily; `system.advanceTo` therefore needs to
 * know whose clock it is moving (`ClockScope`) once more than one exists.
 *
 * The implementation should keep a worker-local `Map<BusinessRef["id"], …>` of
 * resolved handles — sessions, provider ids, tenant keys — so that repeated
 * `owner(biz).x()` calls in one test do not re-authenticate. `resetWorld`
 * clears it, and also restores every fake to its healthy default.
 */

/**
 * Fluent builder. Each step is a *product* action, not a database insert:
 * `.activated()` really presses the button and really charges the card in the
 * provider's test mode. A test may not conjure a state the product cannot
 * reach.
 *
 * For the scenarios that are *about* onboarding, use `aProspect()` instead —
 * this builder sets what onboarding is supposed to derive, so it cannot hold
 * the enrichment requirements.
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

/**
 * Captures a handle that outlives deletion.
 *
 * Scenarios 190–194 read a departure record, a released number and a content
 * delete *after* the business is gone, when a `BusinessRef` no longer refers to
 * anything. Call this while it still does.
 */
export function remember(_b: BusinessRef): DepartedRef {
  return { departedId: _b.id };
}

/**
 * A number a caller can dial, distinct within the worker.
 *
 * Implemented rather than stubbed: it needs nothing from the product, and
 * stubbing it would block scenarios (26, 49, 50) that only need two callers to
 * be different. Drawn from the reserved 555 range so no fixture can dial a real
 * person.
 */
let customerNumberCounter = 0;
export function aCustomerNumber(): PhoneNumber {
  const worker = Number(process.env.JEST_WORKER_ID ?? 1);
  customerNumberCounter += 1;
  const suffix = String(worker * 10_000 + customerNumberCounter).padStart(
    7,
    "0",
  );
  return `+1555${suffix}`;
}

/**
 * Tear down whatever the test created — the provider customer and test clock,
 * the tenant's rows, every fake's captured *and arranged* state.
 *
 * A no-op until Phase 1, deliberately: there is nothing to reset yet, and a
 * `pending()` here would either redden every test or force the teardown hook to
 * swallow errors — and a hook that swallows is a hook that hides the leak it
 * exists to prevent.
 */
export async function resetWorld(): Promise<void> {
  customerNumberCounter = 0;
}

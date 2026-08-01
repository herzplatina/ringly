import { notImplemented, pending } from "./pending";
import type {
  BusinessRef,
  CallOutcome,
  Day,
  Instant,
  Money,
  OpeningHours,
  PhoneNumber,
  ServiceSpec,
} from "./types";

/**
 * Actors — the write half of the harness.
 *
 * Every method here drives Ringly through a surface the product actually
 * exposes: the Retell webhooks for a caller, the app's own routes for an owner,
 * `/ops` for the operator. Nothing reaches into the database to make something
 * true; if a state is not reachable through the product, a test may not assume
 * it.
 */

// ---------------------------------------------------------------------------
// The caller — simulated Retell payloads (§2.20.1)
// ---------------------------------------------------------------------------

/** What the caller experienced. Assertions read this, never the agent's internals. */
export type CallResult = {
  /** What the agent said, as the caller would have heard it. */
  readonly saidToCaller: string;
  /** Recorded outcome. Injected via the classifier fake — not inferred (§2.8.1). */
  readonly outcome: CallOutcome;
  /** False when the number did not answer at all — allowance spent, or suspended. */
  readonly answered: boolean;
  readonly durationSeconds: number;
};

export type BookingRequest = {
  readonly service: string;
  /** Spoken as the caller would say it: `"Tuesday 2pm"`, `"the 14th at 10"`. */
  readonly at: string;
  readonly name?: string;
};

export type CallSession = {
  andAsksToBook(req: BookingRequest): Promise<CallResult>;
  /** F5.1 — e.g. `{ every: "fourth Tuesday", at: "2pm", service: "Cut" }`. */
  andAsksToSetUpRecurring(
    req: BookingRequest & { every: string },
  ): Promise<CallResult>;
  /** F2.4 — identified by name plus date, time and service, all matching. */
  andAsksToReschedule(
    identify: BookingRequest,
    to: string,
    opts?: { wholeSeries?: boolean },
  ): Promise<CallResult>;
  andAsksToCancel(
    identify: BookingRequest,
    opts?: { wholeSeries?: boolean },
  ): Promise<CallResult>;
  /** An enquiry the agent can answer — prices, hours, services (F6.4). */
  andAsksAboutServices(): Promise<CallResult>;
  /** Something the agent cannot help with (F2.10) — expected to end `dropped`. */
  andAsksForSomethingElse(question: string): Promise<CallResult>;
  andHangsUp(): Promise<CallResult>;
};

export type Caller = {
  /**
   * Synchronous and free of I/O on purpose: the concurrency scenarios fan out
   * with `Promise.all([a.calls(x).andAsksToBook(…), b.calls(x)…])`, which only
   * races the two bookings if opening the session itself costs nothing.
   */
  calls(business: BusinessRef): CallSession;
};

/** `caller('+15551234567').calls(salon).andAsksToBook({ … })` */
export function caller(_from: PhoneNumber): Caller {
  return {
    calls: () => notImplemented("F2.1–F2.11", "Phase 1 — Foundations"),
  };
}

// ---------------------------------------------------------------------------
// The business owner — the app's own routes
// ---------------------------------------------------------------------------

export type Owner = {
  // Onboarding (F1) — Phase 3
  verifiesEmail(): Promise<void>;
  confirmsTestCallWorked(): Promise<void>;
  addsPaymentMethod(): Promise<void>;
  /** F1.12a — the only thing in the system that starts billing (F1.12b). */
  pressesActivate(): Promise<void>;
  /** F1.7b — after a declined or revoked calendar grant. */
  reconnectsCalendar(): Promise<void>;

  // Catalogue and hours (F3) — Phase 6
  addsService(s: ServiceSpec): Promise<void>;
  deactivatesService(name: string): Promise<void>;
  repricesService(name: string, to: Money): Promise<void>;
  setsOpeningHours(hours: OpeningHours): Promise<void>;

  // Horizons (F2.9, F5.2) — Phase 6
  setsBookingHorizon(days: number): Promise<void>;
  setsRecurrenceHorizon(days: number): Promise<void>;

  // Dashboard controls (F6.13) — Phase 8
  /** F10.1a-i — irreversible, and the product warns before confirming. */
  deletesCustomer(phone: PhoneNumber): Promise<void>;
  optsOutOfStatsDigest(): Promise<void>;
};

export function owner(_business: BusinessRef): Owner {
  return {
    verifiesEmail: () => pending("F1.11", "Phase 3 — Onboarding"),
    confirmsTestCallWorked: () => pending("F1.12", "Phase 3 — Onboarding"),
    addsPaymentMethod: () => pending("F7.2", "Phase 3 — Onboarding"),
    pressesActivate: () => pending("F1.12a", "Phase 4 — Billing"),
    reconnectsCalendar: () => pending("F1.7b", "Phase 3 — Onboarding"),
    addsService: () => pending("F3.1", "Phase 6 — Catalogue + hours"),
    deactivatesService: () => pending("F3.3", "Phase 6 — Catalogue + hours"),
    repricesService: () => pending("F3.4", "Phase 6 — Catalogue + hours"),
    setsOpeningHours: () => pending("F3.5", "Phase 6 — Catalogue + hours"),
    setsBookingHorizon: () => pending("F2.9", "Phase 6 — Catalogue + hours"),
    setsRecurrenceHorizon: () => pending("F5.2", "Phase 6 — Catalogue + hours"),
    deletesCustomer: () => pending("F10.1a-i", "Phase 8 — Business dashboard"),
    optsOutOfStatsDigest: () => pending("F8.4", "Phase 8 — Business dashboard"),
  };
}

// ---------------------------------------------------------------------------
// The operator — /ops, the walled garden (F9.1)
// ---------------------------------------------------------------------------

export type Operator = {
  /** F10.1b — silence never pauses anything; this is the explicit act. */
  pausesDeletionClock(business: BusinessRef): Promise<void>;
  resumesDeletionClock(business: BusinessRef): Promise<void>;
  /** F10.1c — resets the allowance *and* rebinds; either alone leaves it stuck. */
  resetsTestCallAllowance(business: BusinessRef): Promise<void>;
  /** F7.10a, F9.10 — the only control that stops future charges. */
  marksCancelled(business: BusinessRef): Promise<void>;
  clearsCancelled(business: BusinessRef): Promise<void>;
};

export const operator: Operator = {
  pausesDeletionClock: () => pending("F10.1b", "Phase 5 — Lifecycle"),
  resumesDeletionClock: () => pending("F10.1b", "Phase 5 — Lifecycle"),
  resetsTestCallAllowance: () => pending("F10.1c", "Phase 5 — Lifecycle"),
  marksCancelled: () => pending("F7.10a", "Phase 4 — Billing"),
  clearsCancelled: () => pending("F7.10a", "Phase 4 — Billing"),
};

// ---------------------------------------------------------------------------
// The system — time, and the workers time makes due
// ---------------------------------------------------------------------------

/** The six background jobs of §2.2, each an idempotent HTTP endpoint (§2.2a). */
export type WorkerName =
  | "recurrence_materialiser"
  | "analytics_rollup"
  | "billing_settlement"
  | "lifecycle_sweeper"
  | "email_dispatcher"
  | "billing_reconciliation";

/**
 * Which work to run after the clock moves.
 *
 * `true` runs everything due — right for the common case. A named list runs
 * only those: at roughly three advances across 269 tests, defaulting to all six
 * endpoints spends about 4,800 worker invocations to want maybe 800.
 */
export type DueWorkers = boolean | readonly WorkerName[];

/**
 * Whose clock is moving.
 *
 * `Instant` is business-local and each business owns its own Stripe test clock,
 * so on the cross-tenant scenarios (245–249, 235, 238) "advance to day 45" has
 * no meaning until it says whose day 45. Single-tenant tests — nearly all of
 * them — omit it and get the only business in the world.
 */
export type ClockScope = { for?: BusinessRef };

export type System = {
  now(opts?: ClockScope): Promise<Instant>;
  /**
   * Moves Ringly's clock and Stripe's test clock together, then runs whatever
   * work has become due — because in production, time passing is what causes
   * that work, and 200 tests each remembering to trigger the sweeper is a bug
   * waiting to happen. Pass `{ runDueWorkers: false }` when the worker itself
   * is the subject.
   *
   * A bare `Day` lands at noon business-local, deliberately not on the 09:00
   * billing anchor — see `day()`.
   */
  advanceTo(
    target: Day | Instant,
    opts?: ClockScope & { runDueWorkers?: DueWorkers },
  ): Promise<void>;
  /**
   * Short hops, for the propagation rules measured in seconds rather than days
   * — F3.2's 60-second budget being the one that matters.
   */
  advanceBy(
    delta: { seconds?: number; minutes?: number; hours?: number },
    opts?: ClockScope & { runDueWorkers?: DueWorkers },
  ): Promise<void>;
  /** Run one worker explicitly — for tests where the worker is the subject. */
  runWorker(name: WorkerName): Promise<void>;
  runDueWorkers(): Promise<void>;
};

export const system: System = {
  now: () => pending("§2.20.1", "Phase 1 — Foundations"),
  advanceTo: () => pending("§2.20.1", "Phase 1 — Foundations"),
  advanceBy: () => pending("F3.2", "Phase 1 — Foundations"),
  runWorker: () => pending("§2.2a", "Phase 1 — Foundations"),
  runDueWorkers: () => pending("§2.2a", "Phase 1 — Foundations"),
};

// ---------------------------------------------------------------------------
// Stripe — real test mode (§2.20.1)
// ---------------------------------------------------------------------------

export type StripeControl = {
  /** Makes the next charge decline for real, in Stripe test mode. */
  declineNextCharge(business: BusinessRef): Promise<void>;
  /** Clears everything owed, the way a successful retry or a new card would. */
  payOutstanding(business: BusinessRef): Promise<void>;
  /** F7.17 — a chargeback, which follows the non-payment path exactly. */
  filesChargeback(business: BusinessRef): Promise<void>;
  /** Simulates the provider being unreachable (N7.1): calls must keep working. */
  goesDown(): Promise<void>;
  comesBack(): Promise<void>;
  /** Drops the webhook for the next event, so the reconciliation backstop is exercised (F7.10b-i). */
  dropsNextWebhook(): Promise<void>;
};

export const stripe: StripeControl = {
  declineNextCharge: () => pending("F7.11", "Phase 4 — Billing"),
  payOutstanding: () => pending("F7.10b", "Phase 4 — Billing"),
  filesChargeback: () => pending("F7.17", "Phase 4 — Billing"),
  goesDown: () => pending("N7.1", "Phase 4 — Billing"),
  comesBack: () => pending("N7.1", "Phase 4 — Billing"),
  dropsNextWebhook: () => pending("F7.10b-i", "Phase 4 — Billing"),
};

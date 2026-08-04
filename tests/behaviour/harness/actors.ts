import { pending } from "./pending";
import type {
  BusinessRef,
  ClassifiedAs,
  Day,
  EmailAddress,
  Instant,
  Money,
  OpeningHours,
  PhoneNumber,
  Policy,
  ServiceSpec,
} from "./types";

/**
 * Actors — the write half of the harness.
 *
 * Every method here drives Ringly through a surface the product actually
 * exposes: the telephony webhooks for a caller, the app's own routes for an
 * owner, `/ops` for the operator. Nothing reaches into the database to make
 * something true; if a state is not reachable through the product, a test may
 * not assume it.
 */

// ---------------------------------------------------------------------------
// The prospect — onboarding, before there is a business (F1.1–F1.8)
// ---------------------------------------------------------------------------

/**
 * Someone going through onboarding.
 *
 * Distinct from `aBusiness()`, which *sets* what onboarding is supposed to
 * *derive*. The whole of scenario group A is about the deriving: a builder that
 * takes a name and a timezone as arguments cannot hold F1.1's "enriches name,
 * address, phone, hours, timezone and website in one request".
 */
export type Prospect = {
  /** F1.1 — the free-form intake box, one request. */
  submits(freeForm: string): Promise<void>;
  /** F1.3 — when enrichment returns several matches. */
  picksCandidate(index: number): Promise<void>;
  /** F1.5 — every enriched field is editable before commit. */
  edits(field: string, value: string): Promise<void>;
  /** F1.7 — the Google consent screen. */
  grantsConsent(): Promise<void>;
  declinesCalendarScope(): Promise<void>;
  /** Commits the draft, producing a provisioned business (F1.9). */
  commits(): Promise<BusinessRef>;
};

export function aProspect(): Prospect {
  return {
    submits: () => pending("F1.1, F1.3, F1.6"),
    picksCandidate: () => pending("F1.3"),
    edits: () => pending("F1.5"),
    grantsConsent: () => pending("F1.7, F1.7c"),
    declinesCalendarScope: () => pending("F1.7a"),
    commits: () => pending("F1.9"),
  };
}

// ---------------------------------------------------------------------------
// The caller — simulated telephony payloads (§2.20.1)
// ---------------------------------------------------------------------------

/** What the caller experienced. Assertions read this, never the agent's internals. */
export type CallResult = {
  /** What the agent said, as the caller would have heard it. */
  readonly saidToCaller: string;
  /** Recorded outcome, or `null` while unclassified (F7.6). */
  readonly outcome: ClassifiedAs;
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

/**
 * A conversation, not a single exchange.
 *
 * Every method returns the result *so far* and leaves the call open, so a test
 * can keep talking. Seven scenarios need more than one turn — 48 (a corrected
 * detail re-runs the search), 51 and 61 (the read-back is the confirmation), 52
 * (this-one-or-the-whole-series), 55, 73 and 256 — and a session whose every
 * method were terminal could express none of them.
 */
export type CallSession = {
  andAsksToBook(req: BookingRequest): Promise<CallResult>;
  /** F5.1 — e.g. `{ every: "fourth Tuesday", at: "2pm", service: "Cut" }`. */
  andAsksToSetUpRecurring(
    req: BookingRequest & { every: string },
  ): Promise<CallResult>;
  /**
   * F2.4 — identified by **name plus date, time and service, all matching**.
   *
   * Caller ID is deliberately not part of it: a customer may ring from a
   * different phone or withhold their number, so the scenarios that matter here
   * are the ones where `caller(...)` is a number the business has never seen.
   * A partial match is refused and says which detail was wrong (scenario 47).
   */
  andAsksToReschedule(
    identify: BookingRequest,
    to: string,
  ): Promise<CallResult>;
  andAsksToCancel(identify: BookingRequest): Promise<CallResult>;
  /** An enquiry the agent can answer — prices, hours, services (F6.4). */
  andAsksAboutServices(): Promise<CallResult>;
  /** Something the agent cannot help with (F2.10) — expected to end `dropped`. */
  andAsksForSomethingElse(question: string): Promise<CallResult>;

  /** Anything else the caller says. The general case behind the named turns. */
  andSays(utterance: string): Promise<CallResult>;
  /** F2.4 — answers the agent's read-back. Scenarios 51 and 61. */
  andConfirms(): Promise<CallResult>;
  /** Scenario 48 — supplies a corrected detail, which must re-run the search. */
  andCorrects(field: string, to: string): Promise<CallResult>;
  /** Scenario 52 — answers the this-one-or-the-whole-series question. */
  andChooses(scope: "this_one" | "whole_series"): Promise<CallResult>;

  andHangsUp(): Promise<CallResult>;

  /** The conversation so far, for the read-back and disclosure scenarios. */
  transcript(): Promise<readonly string[]>;
};

export type CallOptions = {
  /**
   * How long the call runs, end to end.
   *
   * Required by the usage-billing arithmetic: 124 (the whole call is billable,
   * not only the minutes up to the booking), 125 (seconds summed across the
   * period then rounded up once), 133 ($470 of usage → $500 charged), plus
   * every duration and median scenario. Without it `CallResult.durationSeconds`
   * is output-only and none of them can be set up.
   */
  readonly lastingSeconds?: number;
  /** F1.13 — a pre-activation test call, which draws on the allowance. */
  readonly asTestCall?: boolean;
  /**
   * Scenario 264 — an unsigned or wrongly-signed webhook, which must be
   * rejected. The only way to state that without a spec naming the transport.
   */
  readonly withBadSignature?: boolean;
};

export type Caller = {
  /**
   * Synchronous and free of I/O on purpose: the concurrency scenarios fan out
   * with `Promise.all([a.calls(x).andAsksToBook(…), b.calls(x)…])`, which only
   * races the two bookings if opening the session itself costs nothing.
   */
  calls(business: BusinessRef, opts?: CallOptions): CallSession;
};

/** `caller('+15551234567').calls(salon).andAsksToBook({ … })` */
export function caller(_from: PhoneNumber): Caller {
  return {
    // Returns a real session whose *methods* reject. `calls()` itself must not
    // throw: it is declared synchronous precisely so `Promise.all([...])` can
    // race two callers, and a synchronous throw would take the whole expression
    // down before either booking started — the trap `pending()` exists to
    // prevent, one level up in the factory.
    calls: () => ({
      andAsksToBook: () => pending("F2.1–F2.6"),
      andAsksToSetUpRecurring: () => pending("F5.1"),
      andAsksToReschedule: () => pending("F2.4"),
      andAsksToCancel: () => pending("F2.4"),
      andAsksAboutServices: () => pending("F6.4"),
      andAsksForSomethingElse: () => pending("F2.10"),
      andSays: () => pending("F2.1"),
      andConfirms: () => pending("F2.4"),
      andCorrects: () => pending("F2.4"),
      andChooses: () => pending("F5.3"),
      andHangsUp: () => pending("F2.11"),
      transcript: () => pending("F2.2"),
    }),
  };
}

// ---------------------------------------------------------------------------
// The business owner — the app's own routes
// ---------------------------------------------------------------------------

export type Owner = {
  // Onboarding (F1)
  verifiesEmail(): Promise<void>;
  confirmsTestCallWorked(): Promise<void>;
  addsPaymentMethod(): Promise<void>;
  /** F1.12a — the only thing in the system that starts billing (F1.12b). */
  pressesActivate(): Promise<void>;
  /** F1.7b — after a declined or revoked calendar grant. */
  reconnectsCalendar(): Promise<void>;
  changesContactEmail(to: EmailAddress): Promise<void>;

  // Catalogue and hours (F3)
  addsService(s: ServiceSpec): Promise<void>;
  /** F3.1 — name, description, price and duration are all editable. */
  editsService(name: string, to: Partial<ServiceSpec>): Promise<void>;
  deactivatesService(name: string): Promise<void>;
  /** F3.4 — distinct from deactivating: scenario 77 values its appointments. */
  deletesService(name: string): Promise<void>;
  repricesService(name: string, to: Money): Promise<void>;
  /** F3.1 — scenario 71 asserts the order the business chose. */
  reordersServices(namesInOrder: readonly string[]): Promise<void>;
  setsOpeningHours(hours: OpeningHours): Promise<void>;

  // Dashboard controls (F5.15)
  setsBookingHorizon(days: number): Promise<void>;
  setsRecurrenceHorizon(days: number): Promise<void>;
  /** F10.1a-i — irreversible, and the product warns before confirming. */
  deletesCustomer(phone: PhoneNumber): Promise<void>;
  optsOutOfStatsDigest(): Promise<void>;
  /** F7.10 — the business's own cancellation. */
  cancels(): Promise<void>;
};

export function owner(_business: BusinessRef): Owner {
  return {
    verifiesEmail: () => pending("F1.11"),
    confirmsTestCallWorked: () => pending("F1.12"),
    addsPaymentMethod: () => pending("F1.12"),
    pressesActivate: () => pending("F1.12a"),
    reconnectsCalendar: () => pending("F1.7b"),
    changesContactEmail: () => pending("F1.11"),
    addsService: () => pending("F3.1"),
    editsService: () => pending("F3.1"),
    deactivatesService: () => pending("F3.3"),
    deletesService: () => pending("F3.4"),
    repricesService: () => pending("F3.4"),
    reordersServices: () => pending("F3.1"),
    setsOpeningHours: () => pending("F3.5"),
    setsBookingHorizon: () => pending("F6.13"),
    setsRecurrenceHorizon: () => pending("F6.13"),
    deletesCustomer: () => pending("F10.1a-i"),
    optsOutOfStatsDigest: () => pending("F8.4"),
    cancels: () => pending("F7.10"),
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
  /** F9.7 — reads a business's dashboard as it sees it (scenarios 232, 233). */
  viewsAsBusiness(business: BusinessRef): Promise<void>;

  /**
   * F7.8, F1.13, F6.6 — change a policy row.
   *
   * Four scenarios (35, 105, 126, 135) turn on a policy changing "without a
   * deploy", and 105 asks whether the outcome panel renders from data or is
   * hardcoded. None can be distinguished unless a test can move one.
   */
  setsPolicy(change: Partial<Policy>): Promise<void>;
};

export const operator: Operator = {
  pausesDeletionClock: () => pending("F10.1b"),
  resumesDeletionClock: () => pending("F10.1b"),
  resetsTestCallAllowance: () => pending("F10.1c"),
  marksCancelled: () => pending("F9.10"),
  clearsCancelled: () => pending("F9.10"),
  viewsAsBusiness: () => pending("F9.7"),
  setsPolicy: () => pending("F7.8"),
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
 * Whose clock is moving.
 *
 * `Instant` is business-local and each business owns its own payment-provider
 * test clock, so on the cross-tenant scenarios (245–249, 235, 238) "advance to
 * day 45" has no meaning until it says whose day 45. Single-tenant tests —
 * nearly all of them — omit it and get the only business in the world.
 */
export type ClockScope = { for?: BusinessRef };

export type System = {
  /**
   * Moves Ringly's clock and the payment provider's test clock together, then
   * runs whatever work has become due — because in production, time passing is
   * what causes that work, and 200 tests each remembering to trigger the
   * sweeper is a bug waiting to happen. Pass `{ runDueWorkers: false }` when
   * the worker itself is the subject.
   *
   * A bare `Day` lands at noon business-local, deliberately not on the 09:00
   * billing anchor — see `day()`.
   */
  advanceTo(
    target: Day | Instant,
    opts?: ClockScope & { runDueWorkers?: boolean },
  ): Promise<void>;
  /**
   * Short hops, for the propagation rules measured in seconds rather than days
   * — F3.2's 60-second budget being the one that matters.
   */
  advanceBy(
    delta: { seconds?: number; minutes?: number; hours?: number },
    opts?: ClockScope & { runDueWorkers?: boolean },
  ): Promise<void>;
  /** Run one worker explicitly — for tests where the worker is the subject. */
  runWorker(name: WorkerName): Promise<void>;
  runDueWorkers(): Promise<void>;
};

export const system: System = {
  advanceTo: () => pending("§2.20.1"),
  advanceBy: () => pending("§2.20.1"),
  runWorker: () => pending("§2.2a"),
  runDueWorkers: () => pending("§2.2a"),
};

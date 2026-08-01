import { pending } from "./pending";
import type {
  AppointmentView,
  BillingPeriodRow,
  BusinessRef,
  CalendarEvent,
  CallAnalytics,
  CapturedEmail,
  DepartureRecord,
  EmailAddress,
  Money,
  OperatorQueueRow,
  ReportingRange,
  ReportingUnit,
  ServiceStatus,
} from "./types";

/**
 * Projections — the read half of the harness.
 *
 * **A projection reads. It never computes.** The moment one calculates a
 * clamped total, a period boundary, or an outcome, it becomes a second
 * implementation of the product — one that can be wrong in exactly the same way
 * as the first, so the test agrees with the bug and says nothing. Look it up,
 * shape it, stop.
 *
 * **Each one goes through the same path the product does.** The dashboard is a
 * client component fetching `/api/*`, so every figure it shows necessarily has
 * a route, and a projection calls that route. Where a surface does not exist
 * yet, a projection may read the database as a *labelled, temporary* stand-in —
 * never as a design choice, because a projection that queries while the product
 * fetches will pass every test with the API broken.
 *
 * Several of these are not Ringly reads at all — they read the fakes, asserting
 * what Ringly *told the outside world*. That is the strongest evidence available
 * here and needs no Ringly surface whatsoever. They live in this file anyway,
 * because the rule that makes the barrel decidable is "every read is a
 * projection", not "every read of Ringly".
 */

// --- Ringly's own surfaces --------------------------------------------------

/** F6.15 — read from current state, never the rollup. The one never-stale element. */
export function serviceStatus(_b: BusinessRef): Promise<ServiceStatus> {
  return pending("F6.15", "Phase 8 — Business dashboard");
}

/** F6.7, F6.8 — one table, the open period first, marked `in_progress` and live. */
export function billingHistory(
  _b: BusinessRef,
): Promise<readonly BillingPeriodRow[]> {
  return pending("F6.7", "Phase 4 — Billing");
}

/** Everything currently outstanding, exclusive of tax (I3). */
export function owed(_b: BusinessRef): Promise<Money> {
  return pending("F7.10b", "Phase 4 — Billing");
}

/** F6.3 — counts of calls, never of appointments. */
export function callAnalytics(
  _b: BusinessRef,
  _range: { unit: ReportingUnit; range: ReportingRange },
): Promise<CallAnalytics> {
  return pending("F6.3", "Phase 8 — Business dashboard");
}

/** What Ringly believes it has booked — compare against `connectedCalendar` (F6.10). */
export function appointments(
  _b: BusinessRef,
): Promise<readonly AppointmentView[]> {
  return pending("F2.2", "Phase 1 — Foundations");
}

/**
 * F6.5, F9.11 — rendered from `outcome_rulesets`, so the business and the
 * operator read the same row. Keyed by outcome.
 */
export function outcomeDefinitions(): Promise<
  Readonly<Record<string, string>>
> {
  return pending("F6.5", "Phase 8 — Business dashboard");
}

/** F9.12 — a business appears once per condition it is in. */
export function operatorQueue(): Promise<readonly OperatorQueueRow[]> {
  return pending("F9.12", "Phase 10 — Operator dashboard");
}

/**
 * F9.1 — can a signed-in business owner reach the operator surface?
 *
 * Must be false for every business, by every route, with any credential. Phrased
 * as reachability rather than as an HTTP status so the assertion survives the
 * status changing; the requirement's substance is that no business owner gets
 * in, not that the refusal is specifically a 404.
 */
export function opsIsReachableBy(_b: BusinessRef): Promise<boolean> {
  return pending("F9.1", "Phase 10 — Operator dashboard");
}

/**
 * F10.9 — survives deletion. The assertion most tests make against it is a
 * *negative* one: that it carries no consumer data.
 *
 * Takes a raw id, not a `BusinessRef`, because by the time this returns a value
 * the business it refers to no longer exists.
 */
// --- Reads of the vendor fakes ----------------------------------------------

/** F7.2 — does Stripe hold a usable card? Read from Stripe test mode. */
export function hasCardOnFile(_b: BusinessRef): Promise<boolean> {
  return pending("F7.2", "Phase 4 — Billing");
}

/** F10.4b — numbers held in the Retell account, bound or not. */
export function numbersHeld(): Promise<readonly string[]> {
  return pending("F10.4b", "Phase 1 — Foundations");
}

/** F10.5 — did Ringly issue a content delete for this business? (10-day path only.) */
export function contentDeleteRequestedFor(_b: BusinessRef): Promise<boolean> {
  return pending("F10.5", "Phase 5 — Lifecycle");
}

export function departureRecord(
  _businessId: string,
): Promise<DepartureRecord | null> {
  return pending("F10.9", "Phase 5 — Lifecycle");
}

// --- The fakes: what Ringly told the outside world --------------------------

/** Captured by the Resend fake. Content assertions only, never "was this called". */
export function inbox(
  _address: EmailAddress,
): Promise<readonly CapturedEmail[]> {
  return pending("F8", "Phase 2 — Email plumbing");
}

/**
 * Everything sent on this business's behalf, to its owner and to the operator
 * alike.
 *
 * `inbox()` cannot express F8.2 — "if a message is not in the registry it is
 * not sent" is a claim about the whole output, and checking one address at a
 * time can only ever confirm what *was* sent, never that nothing else escaped.
 *
 * Scoped to a business rather than global because specs run in parallel against
 * one worker process: an unscoped version would return every other test's mail
 * too, and the assertion would be about the suite rather than the product.
 */
export function allEmailSent(
  _b: BusinessRef,
): Promise<readonly CapturedEmail[]> {
  return pending("F8.2", "Phase 2 — Email plumbing");
}

/**
 * The business's connected calendar, from the Google fake — including events
 * Ringly did not create, which is how F6.10 and the external-conflict case
 * (F2.3) are tested.
 */
export function connectedCalendar(
  _b: BusinessRef,
): Promise<readonly CalendarEvent[]> {
  return pending("F4.1", "Phase 1 — Foundations");
}

/**
 * Whether the telephony provider currently routes the number to an agent, from
 * the Retell fake.
 *
 * Deliberately separate from `serviceStatus().numberLive`, which is what Ringly
 * *believes*. A failed unbind makes those two disagree — Ringly thinks service
 * stopped while the number keeps answering — and that is a silent revenue leak
 * nothing else would catch (F1.12a-ii).
 */
export function numberAnswers(_b: BusinessRef): Promise<boolean> {
  return pending("F1.12a-ii", "Phase 1 — Foundations");
}

/** F10.4a — is this business's number offered to a new signup? Must never be true while its row exists. */
export function numberIsReusable(_b: BusinessRef): Promise<boolean> {
  return pending("F10.4a", "Phase 1 — Foundations");
}

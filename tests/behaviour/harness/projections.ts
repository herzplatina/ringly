import { pending } from "./pending";
import type {
  ActivationChecklist,
  AppointmentView,
  BillingPeriodRow,
  BusinessRef,
  CalendarEvent,
  CalendarIncident,
  CallAnalytics,
  CapturedEmail,
  DepartedRef,
  DepartureRecord,
  EmailAddress,
  EnrichedDraft,
  LedgerEntry,
  Money,
  OpeningHours,
  OperatorMoneyRow,
  OperatorQueueRow,
  PhoneNumber,
  PlatformTotals,
  Policy,
  ReportingRange,
  ReportingUnit,
  ServiceStatus,
  ServiceView,
  StatedMoney,
  UnearningNumber,
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
 * **Never as a service role.** The temporary database stand-in above must use
 * the tenant's own credentials, never a privileged client. A service-role read
 * would make scenarios 245–249 — the cross-tenant isolation group — pass with
 * RLS disabled entirely, which is a green suite over a broken tenancy boundary.
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

/** F1.12 — three tasks in any order, plus the allowance (scenarios 15, 16). */
export function activationChecklist(
  _b: BusinessRef,
): Promise<ActivationChecklist> {
  return pending("F1.12", "Phase 3 — Onboarding");
}

/** F1.1–F1.6 — what enrichment derived, before the prospect commits it. */
export function enrichedDraft(): Promise<EnrichedDraft> {
  return pending("F1.1–F1.6", "Phase 3 — Onboarding");
}

/** F1.3 — the candidate list shown for an ambiguous name (scenario 2). */
export function candidates(): Promise<readonly string[]> {
  return pending("F1.3", "Phase 3 — Onboarding");
}

/** F6.7 — one row per period, the open one first. */
export function billingHistory(
  _b: BusinessRef,
): Promise<readonly BillingPeriodRow[]> {
  return pending("F6.7", "Phase 8 — Business dashboard");
}

/** F7.16 — every movement, immutably (scenario 134). */
export function ledger(_b: BusinessRef): Promise<readonly LedgerEntry[]> {
  return pending("F7.16", "Phase 4 — Billing");
}

/** What the business owes right now, and whether that figure has settled (F6.14a). */
export function owed(_b: BusinessRef): Promise<StatedMoney> {
  return pending("F7.11", "Phase 4 — Billing");
}

export function callAnalytics(
  _b: BusinessRef,
  _range: { unit: ReportingUnit; range: ReportingRange },
): Promise<CallAnalytics> {
  return pending("F6.1–F6.5", "Phase 8 — Business dashboard");
}

/**
 * F2.5 — the appointments Ringly booked.
 *
 * The window is explicit because several scenarios (74, 79, 91, 204, 206) turn
 * on *past* appointments still being there. A projection defaulting to
 * future-only — the natural dashboard read — would return an empty array and
 * pass them all.
 */
export function appointments(
  _b: BusinessRef,
  _window: "past" | "upcoming" | "all",
): Promise<readonly AppointmentView[]> {
  return pending("F2.5", "Phase 1 — Foundations");
}

/** F3.1 — the catalogue, in the order the business put it in. */
export function services(_b: BusinessRef): Promise<readonly ServiceView[]> {
  return pending("F3.1", "Phase 6 — Catalogue + hours");
}

/** F3.5 — the hours as the product holds them (scenarios 78, 80). */
export function openingHours(_b: BusinessRef): Promise<OpeningHours> {
  return pending("F3.5", "Phase 6 — Catalogue + hours");
}

/** F2.7 — the dashboard's calendar banner (scenarios 65, 66, 68). */
export function calendarIncident(_b: BusinessRef): Promise<CalendarIncident> {
  return pending("F2.7", "Phase 8 — Business dashboard");
}

/** F6.6 — the outcome definitions the dashboard renders, and their version. */
export function policy(): Promise<Policy> {
  return pending("F7.8, F6.6", "Phase 4 — Billing");
}

/** F10.9 — survives deletion. Takes a `DepartedRef` captured before teardown. */
export function departureRecord(
  _d: DepartedRef,
): Promise<DepartureRecord | null> {
  return pending("F10.9", "Phase 5 — Lifecycle");
}

// --- The operator surface (F9) ----------------------------------------------

/** F9.12 — a business appears once per condition it is in. */
export function operatorQueue(): Promise<readonly OperatorQueueRow[]> {
  return pending("F9.12", "Phase 10 — Operator dashboard");
}

/** F9.4 — the money table, one row per business (scenarios 227, 228). */
export function operatorMoneyTable(_range: {
  unit: ReportingUnit;
  range: ReportingRange;
}): Promise<readonly OperatorMoneyRow[]> {
  return pending("F9.4", "Phase 10 — Operator dashboard");
}

/** F9.5 — across every tenant (scenarios 235, 238). */
export function platformTotals(_range: {
  unit: ReportingUnit;
  range: ReportingRange;
}): Promise<PlatformTotals> {
  return pending("F9.5", "Phase 10 — Operator dashboard");
}

/** F9.11 — rented numbers earning nothing (scenario 239). */
export function unearningNumbers(): Promise<readonly UnearningNumber[]> {
  return pending("F9.11", "Phase 10 — Operator dashboard");
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

// --- Cross-tenant isolation (N1, scenarios 245–249) -------------------------

/**
 * Can `actor`, authenticated as itself, read `target`'s data?
 *
 * Must be false for every pair of distinct businesses. This exists because
 * every other projection takes only the business whose data it returns, which
 * makes an *attempted* cross-tenant read unexpressible — and scenarios 94, 246
 * and 247 are precisely about the attempt failing. Without it the isolation
 * group has no vocabulary at all and would be silently skipped.
 */
export function isReadableBy(
  _target: BusinessRef,
  _actor: BusinessRef,
): Promise<boolean> {
  return pending("N1.1", "Phase 1 — Foundations");
}

/** N1.3, scenario 248 — no path offers a bulk export of another tenant's data. */
export function dataExportIsOffered(_b: BusinessRef): Promise<boolean> {
  return pending("N1.3", "Phase 8 — Business dashboard");
}

/**
 * Everything Ringly has stored about this business, unshaped.
 *
 * The **one deliberate escape hatch**, and the only place coupling is
 * warranted. A typed read model cannot hold a negative assertion: scenarios
 * 109, 121, 193, 197, 205, 207, 230, 231 and 263 all say some field is *never*
 * present, and a projection that maps known columns into a fixed shape discards
 * a leaked one by construction — `toEqual` can never see what the shape already
 * dropped. Assert on the key set of this, not on values.
 */
export function everythingStoredAbout(_b: BusinessRef): Promise<unknown> {
  return pending("F10.1a, N1.3", "Phase 5 — Lifecycle");
}

// --- Reads of the vendors ---------------------------------------------------

/** F7.2 — does the payment provider hold a usable card? */
export function hasCardOnFile(_b: BusinessRef): Promise<boolean> {
  return pending("F7.2", "Phase 4 — Billing");
}

/**
 * F10.4b — numbers held in the **telephony fake's** account, bound or not.
 *
 * The fake, never a live provider account: `resetWorld` releases what this
 * returns, and pointed at a real account from a parallel suite that would
 * release real rented numbers.
 */
export function numbersHeld(): Promise<readonly PhoneNumber[]> {
  return pending("F10.4b", "Phase 5 — Lifecycle");
}

/** F10.5 — did Ringly issue a content delete for this business? (10-day path only.) */
export function contentDeleteRequestedFor(_d: DepartedRef): Promise<boolean> {
  return pending("F10.5", "Phase 5 — Lifecycle");
}

/** Captured by the email fake. Content assertions only, never "was this called". */
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

/** F2.5 — what the *calendar* holds, which is the real evidence a booking landed. */
export function connectedCalendar(
  _b: BusinessRef,
): Promise<readonly CalendarEvent[]> {
  return pending("F2.5", "Phase 1 — Foundations");
}

/**
 * Does the number actually answer?
 *
 * Deliberately distinct from `serviceStatus().numberLive`: one is what Ringly
 * *says*, this is what the telephony provider *does*. F1.13a and the suspension
 * scenarios turn on the two agreeing, so a single source would prove nothing.
 */
export function numberAnswers(_b: BusinessRef): Promise<boolean> {
  return pending("F1.13a", "Phase 1 — Foundations");
}

/** F10.4a — released back to the pool and safe to hand to someone else. */
export function numberIsReusable(_d: DepartedRef): Promise<boolean> {
  return pending("F10.4a", "Phase 5 — Lifecycle");
}

/** Scenario 190 — what the operator was told a departing business still owed. */
export function owedAtDeparture(_d: DepartedRef): Promise<Money> {
  return pending("F10.9", "Phase 5 — Lifecycle");
}

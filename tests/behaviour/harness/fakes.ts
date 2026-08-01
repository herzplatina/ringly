import { pending } from "./pending";
import type { BusinessRef, CallOutcome, Instant, Money } from "./types";

/**
 * The vendors — arrangement only.
 *
 * **Named for the capability, not the supplier.** `calendar`, not `google`;
 * `telephony`, not `retell`. The README's one rule forbids a spec body from
 * naming anything the implementation could rename, and the supplier is exactly
 * that: swapping Google Calendar for Microsoft, or Resend for Postmark, must
 * not rewrite a single test. §2.6 already treats the scheduling provider as
 * abstract; this makes the test vocabulary agree.
 *
 * Every member here *changes* something: what the vendor will do next, or what
 * it already holds. Reading one back is a projection and lives in
 * `projections.ts` regardless of what stores the answer — otherwise "does the
 * number answer?" and "which numbers are held?" sit in different files and
 * nobody can say where a new read belongs.
 *
 * **A fake must be able to fail.** One that only ever returns success proves
 * nothing about the fail-closed requirements (F2.7), which are among the most
 * important behaviours in this product, so every fake exposes its failure modes
 * as first-class controls.
 *
 * **Arranged failure is per-business, not global.** The outage controls take a
 * `BusinessRef` for the same reason `allEmailSent` does: specs run in parallel
 * in one worker process, and a process-wide "the calendar is down" switch would
 * fail whichever unrelated booking test happened to be in flight. `resetWorld`
 * restores every fake to its healthy default regardless.
 *
 * What these fakes prove and — more importantly — what they do not is §2.20.3.
 * They demonstrate Ringly's *reaction* to a calendar outage; they say nothing
 * about whether the real provider fails this way. That gap closes only by hand
 * (A1).
 */

// ---------------------------------------------------------------------------
// Calendar — the scheduling provider (§2.6)
// ---------------------------------------------------------------------------

export type CalendarFake = {
  /** An event the owner created directly — respected for conflicts, absent from figures (F6.10). */
  ownerCreatesEvent(
    b: BusinessRef,
    e: { title: string; startsAt: Instant; durationMinutes: number },
  ): Promise<void>;

  /** F2.7 — the provider cannot be reached. Booking must refuse, not proceed. */
  becomesUnreachable(b: BusinessRef): Promise<void>;
  /** N3.1 — slow is failed. Distinct from unreachable, and must behave identically. */
  becomesSlow(b: BusinessRef): Promise<void>;
  /** F2.7a — the grant is gone. Must also refuse, and surface reconnect. */
  revokesConsent(b: BusinessRef): Promise<void>;
  recovers(b: BusinessRef): Promise<void>;

  /** F1.7a — granular consent: sign-in granted, calendar declined. */
  willDeclineCalendarScope(): Promise<void>;
};

export const calendar: CalendarFake = {
  ownerCreatesEvent: () => pending("F6.10", "Phase 1 — Foundations"),
  becomesUnreachable: () => pending("F2.7", "Phase 1 — Foundations"),
  becomesSlow: () => pending("N3.1", "Phase 1 — Foundations"),
  revokesConsent: () => pending("F2.7a", "Phase 1 — Foundations"),
  recovers: () => pending("F2.7", "Phase 1 — Foundations"),
  willDeclineCalendarScope: () => pending("F1.7a", "Phase 3 — Onboarding"),
};

// ---------------------------------------------------------------------------
// Telephony — numbers and the voice agent
// ---------------------------------------------------------------------------

export type TelephonyFake = {
  /** F1.12a-ii — the write reports success but does not apply. The dangerous one. */
  willSilentlyIgnoreNextBind(b: BusinessRef): Promise<void>;
  willSilentlyIgnoreNextUnbind(b: BusinessRef): Promise<void>;
  /** Scenario 23 — a hard failure at bind, a different path from the silent one. */
  willFailNextBind(b: BusinessRef): Promise<void>;
  /** F10.4b, scenario 140 — an unbind that errors and must be retried. */
  willFailNextUnbind(b: BusinessRef): Promise<void>;
};

export const telephony: TelephonyFake = {
  willSilentlyIgnoreNextBind: () =>
    pending("F1.12a-ii", "Phase 3 — Onboarding"),
  willSilentlyIgnoreNextUnbind: () => pending("F10.4b", "Phase 5 — Lifecycle"),
  willFailNextBind: () => pending("F1.12a-ii", "Phase 3 — Onboarding"),
  willFailNextUnbind: () => pending("F10.4b", "Phase 5 — Lifecycle"),
};

// ---------------------------------------------------------------------------
// Email delivery
// ---------------------------------------------------------------------------

export type EmailFake = {
  /** N7.1 — email retries, calls keep working, nothing is lost. */
  goesDown(): Promise<void>;
  comesBack(): Promise<void>;
  /** F8.5 — force a worker retry, so double-sends would show up. */
  dropsNextDelivery(): Promise<void>;
};

export const email: EmailFake = {
  goesDown: () => pending("N7.1", "Phase 2 — Email plumbing"),
  comesBack: () => pending("N7.1", "Phase 2 — Email plumbing"),
  dropsNextDelivery: () => pending("F8.5", "Phase 2 — Email plumbing"),
};

// ---------------------------------------------------------------------------
// Payments — real test mode, not a fake (§2.20.1)
// ---------------------------------------------------------------------------

/**
 * Lives here rather than in `actors.ts` because it arranges a vendor rather
 * than driving Ringly, which is the rule this file states. That it is backed by
 * a real test-mode account instead of an in-process fake is an implementation
 * detail of the adapter, not a difference a spec can see.
 */
export type PaymentsControl = {
  /** Makes the next charge decline for real, in the provider's test mode. */
  declineNextCharge(b: BusinessRef): Promise<void>;
  /** Clears everything owed, the way a successful retry or a new card would. */
  payOutstanding(b: BusinessRef): Promise<void>;
  /** Scenario 151 — a part payment, which must not clear the debt. */
  pays(b: BusinessRef, amount: Money): Promise<void>;
  /** F7.17 — a chargeback, which follows the non-payment path exactly. */
  filesChargeback(b: BusinessRef): Promise<void>;
  /** Simulates the provider being unreachable (N7.1): calls must keep working. */
  goesDown(b: BusinessRef): Promise<void>;
  comesBack(b: BusinessRef): Promise<void>;
  /** F7.10b-i — drops a webhook, exercising the reconciliation backstop. */
  dropsNextWebhook(b: BusinessRef): Promise<void>;
  /** Scenario 162 — the same webhook delivered twice must not restore twice. */
  redeliversLastWebhook(b: BusinessRef): Promise<void>;
  /** Scenario 265 — an unsigned webhook, which must be rejected. */
  sendsUnsignedWebhook(b: BusinessRef): Promise<void>;
};

export const payments: PaymentsControl = {
  declineNextCharge: () => pending("F7.11", "Phase 4 — Billing"),
  payOutstanding: () => pending("F7.10b", "Phase 4 — Billing"),
  pays: () => pending("F7.10b", "Phase 4 — Billing"),
  filesChargeback: () => pending("F7.17", "Phase 4 — Billing"),
  goesDown: () => pending("N7.1", "Phase 4 — Billing"),
  comesBack: () => pending("N7.1", "Phase 4 — Billing"),
  dropsNextWebhook: () => pending("F7.10b-i", "Phase 4 — Billing"),
  redeliversLastWebhook: () => pending("F7.10b-i", "Phase 4 — Billing"),
  sendsUnsignedWebhook: () => pending("N4.2", "Phase 4 — Billing"),
};

// ---------------------------------------------------------------------------
// The outcome classifier
// ---------------------------------------------------------------------------

/**
 * §2.8.1 — classification is a batched LLM call and therefore not
 * deterministic. Tests inject the label so everything downstream of it stays
 * deterministic; whether the model labels a real transcript correctly is a
 * model-evaluation question with its own dataset, not a scenario here (§2.20.3).
 *
 * Scoped per business rather than "the next call" globally: scenario 45 races
 * two callers, and "next" has no meaning when two calls are in flight.
 */
export type ClassifierFake = {
  /** The label the next classified call for this business will receive. */
  willClassifyNextAs(b: BusinessRef, outcome: CallOutcome): Promise<void>;
  /** The batch has not returned yet — the call sits unclassified. */
  holdsNextResult(b: BusinessRef): Promise<void>;
  /** F7.6 — errored or expired. Must leave the call unclassified and unbilled. */
  willFailNext(b: BusinessRef): Promise<void>;
  /** Release everything held, as a returning batch would. */
  deliverPending(b: BusinessRef): Promise<void>;
};

export const classifier: ClassifierFake = {
  willClassifyNextAs: () => pending("§2.8.1", "Phase 1 — Foundations"),
  holdsNextResult: () => pending("§2.8.1", "Phase 1 — Foundations"),
  willFailNext: () => pending("F7.6", "Phase 1 — Foundations"),
  deliverPending: () => pending("§2.8.1", "Phase 1 — Foundations"),
};

// ---------------------------------------------------------------------------
// Enrichment — business lookup and website extraction during onboarding
// ---------------------------------------------------------------------------

export type EnrichmentFake = {
  /** N7.1 — onboarding must degrade to manual entry, not break. */
  goesDown(): Promise<void>;
  comesBack(): Promise<void>;
  /** F1.3 — several hits, so the candidate list is exercised. */
  willReturnCandidates(n: number): Promise<void>;
  /** F1.4 — the business's website, from which services are extracted. */
  websiteOffers(services: readonly string[]): Promise<void>;
  /** Scenario 4 — an unreachable website falls back to manual entry. */
  websiteUnreachable(): Promise<void>;
};

export const enrichment: EnrichmentFake = {
  goesDown: () => pending("N7.1", "Phase 3 — Onboarding"),
  comesBack: () => pending("N7.1", "Phase 3 — Onboarding"),
  willReturnCandidates: () => pending("F1.3", "Phase 3 — Onboarding"),
  websiteOffers: () => pending("F1.4", "Phase 3 — Onboarding"),
  websiteUnreachable: () => pending("F1.4", "Phase 3 — Onboarding"),
};

// ---------------------------------------------------------------------------
// Ringly's own storage — for the durability requirements only
// ---------------------------------------------------------------------------

/**
 * Scenario 22 — "a local write failing after the charge". N10 is about money
 * surviving infrastructure loss, and there is no way to state it unless a test
 * can make Ringly's own persistence fail at a chosen moment.
 */
export type StorageFake = {
  failsNextWrite(b: BusinessRef): Promise<void>;
  recovers(b: BusinessRef): Promise<void>;
};

export const storage: StorageFake = {
  failsNextWrite: () => pending("N10", "Phase 4 — Billing"),
  recovers: () => pending("N10", "Phase 4 — Billing"),
};

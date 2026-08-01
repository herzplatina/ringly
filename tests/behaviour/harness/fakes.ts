import { pending } from "./pending";
import type { BusinessRef, CallOutcome, Instant } from "./types";

/**
 * The faked vendors (§2.20.1) — arrangement only.
 *
 * Every member here *changes* something: what the vendor will do next, or what
 * it already holds. Reading a fake back is a projection and lives in
 * `projections.ts` regardless of what stores the answer — otherwise "does the
 * number answer?" and "which numbers are held?" sit in different files and
 * nobody can say which file a new read belongs in.
 *
 * **A fake must be able to fail.** One that only ever returns success proves
 * nothing about the fail-closed requirements (F2.7), which are among the most
 * important behaviours in this product. Every fake here exposes its failure
 * modes as first-class controls.
 *
 * What these fakes prove and — more importantly — what they do not is §2.20.3.
 * They demonstrate Ringly's *reaction* to a calendar outage; they say nothing
 * about whether Google fails this way. That gap closes only by hand (A1).
 */

// ---------------------------------------------------------------------------
// Google Calendar
// ---------------------------------------------------------------------------

export type GoogleFake = {
  /** An event the owner created directly — respected for conflicts, absent from figures (F6.10). */
  ownerCreatesEvent(
    b: BusinessRef,
    e: { title: string; startsAt: Instant; durationMinutes: number },
  ): Promise<void>;

  /** F2.7 — the provider cannot be reached. Booking must refuse, not proceed. */
  becomesUnreachable(): Promise<void>;
  /** N3.1 — slow is failed. Distinct from unreachable, and must behave identically. */
  becomesSlow(): Promise<void>;
  /** F2.7a — the grant is gone. Must also refuse, and surface reconnect. */
  revokesConsent(b: BusinessRef): Promise<void>;
  recovers(): Promise<void>;

  /** F1.7a — granular consent: sign-in granted, calendar declined. */
  willDeclineCalendarScope(): Promise<void>;
};

export const google: GoogleFake = {
  ownerCreatesEvent: () => pending("F6.10", "Phase 1 — Foundations"),
  becomesUnreachable: () => pending("F2.7", "Phase 1 — Foundations"),
  becomesSlow: () => pending("N3.1", "Phase 1 — Foundations"),
  revokesConsent: () => pending("F2.7a", "Phase 1 — Foundations"),
  recovers: () => pending("F2.7", "Phase 1 — Foundations"),
  willDeclineCalendarScope: () => pending("F1.7a", "Phase 3 — Onboarding"),
};

// ---------------------------------------------------------------------------
// Retell — telephony
// ---------------------------------------------------------------------------

export type RetellFake = {
  /** F1.12a-ii — the write reports success but does not apply. The dangerous one. */
  willSilentlyIgnoreNextBind(): Promise<void>;
  willSilentlyIgnoreNextUnbind(): Promise<void>;
};

export const retell: RetellFake = {
  willSilentlyIgnoreNextBind: () =>
    pending("F1.12a-ii", "Phase 1 — Foundations"),
  willSilentlyIgnoreNextUnbind: () =>
    pending("F1.12a-ii", "Phase 1 — Foundations"),
};

// ---------------------------------------------------------------------------
// Resend — email
// ---------------------------------------------------------------------------

export type ResendFake = {
  /** N7.1 — email retries, calls keep working, nothing is lost. */
  goesDown(): Promise<void>;
  comesBack(): Promise<void>;
  /** F8.5 — force a worker retry, so double-sends would show up. */
  dropsNextDelivery(): Promise<void>;
};

export const resend: ResendFake = {
  goesDown: () => pending("N7.1", "Phase 2 — Email plumbing"),
  comesBack: () => pending("N7.1", "Phase 2 — Email plumbing"),
  dropsNextDelivery: () => pending("F8.5", "Phase 2 — Email plumbing"),
};

// ---------------------------------------------------------------------------
// The outcome classifier
// ---------------------------------------------------------------------------

/**
 * §2.8.1 — classification is a batched LLM call and therefore not
 * deterministic. Tests inject the label so everything downstream of it stays
 * deterministic; whether Haiku labels a real transcript correctly is a
 * model-evaluation question with its own dataset, not a scenario here (§2.20.3).
 */
export type ClassifierFake = {
  /** The label the next classified call will receive. */
  willClassifyNextAs(outcome: CallOutcome): Promise<void>;
  /** The batch has not returned yet — the call sits unclassified. */
  holdsNextResult(): Promise<void>;
  /** F7.6 — errored or expired. Must leave the call unclassified and unbilled. */
  willFailNext(): Promise<void>;
  /** Release everything held, as a returning batch would. */
  deliverPending(): Promise<void>;
};

export const classifier: ClassifierFake = {
  willClassifyNextAs: () => pending("§2.8.1", "Phase 1 — Foundations"),
  holdsNextResult: () => pending("§2.8.1", "Phase 1 — Foundations"),
  willFailNext: () => pending("§2.8.1", "Phase 1 — Foundations"),
  deliverPending: () => pending("§2.8.1", "Phase 1 — Foundations"),
};

// ---------------------------------------------------------------------------
// Google Places — onboarding enrichment
// ---------------------------------------------------------------------------

export type PlacesFake = {
  /** N7.1 — onboarding must degrade to manual entry, not break. */
  goesDown(): Promise<void>;
  comesBack(): Promise<void>;
  /** F1.3 — several hits, so the candidate list is exercised. */
  willReturnCandidates(n: number): Promise<void>;
};

export const places: PlacesFake = {
  goesDown: () => pending("N7.1", "Phase 3 — Onboarding"),
  comesBack: () => pending("N7.1", "Phase 3 — Onboarding"),
  willReturnCandidates: () => pending("F1.3", "Phase 3 — Onboarding"),
};

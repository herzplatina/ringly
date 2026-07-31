/**
 * The single place every Ringly email is declared.
 *
 * Subject lines live here rather than inside each template so the whole set can
 * be read at once — inconsistent subjects are the most common way a
 * transactional suite drifts. Anything sent to a business or to the operator
 * must appear in this table; if it is not here, it is not sent.
 *
 * Every value below is a **default**, chosen to be sensible rather than final.
 * They are meant to be argued with.
 */

export const EMAIL_KINDS = [
  // Business — billing
  "activation_receipt",
  "upcoming_charge",
  "payment_succeeded",
  "payment_failed",
  "payment_reminder",
  "suspension_notice",
  "deletion_warning",
  "cap_reached",
  "cancellation_confirmed",
  // Business — operational
  "calendar_access_failing",
  "recurring_change",
  "test_calls_exhausted",
  // Business — reporting
  "stats_digest",
  // Operator
  "ops_cap_reached",
  "ops_payment_failed",
  "ops_calendar_failing",
  "ops_activation_stuck",
  "ops_business_deleted",
] as const;

export type EmailKind = (typeof EMAIL_KINDS)[number];

export type Audience = "business" | "operator";

/**
 * Separate sending identities per stream. Keeping billing away from reports
 * means a digest nobody opens can never damage the reputation of the address
 * that tells someone their payment failed.
 */
export const SENDERS = {
  billing: "Ringly Billing <billing@ringly.app>",
  service: "Ringly <service@ringly.app>",
  reports: "Ringly Reports <reports@ringly.app>",
  ops: "Ringly Alerts <alerts@ringly.app>",
} as const;

export type EmailSpec = {
  audience: Audience;
  from: (typeof SENDERS)[keyof typeof SENDERS];
  /** Rendered with the template's props. Keep under ~60 characters. */
  subject: (props: Record<string, string | number>) => string;
  /**
   * Transactional mail cannot be unsubscribed from (F8.4). Only the periodic
   * digest is optional.
   */
  transactional: boolean;
  /**
   * How the idempotency key is built (F8.5). A retried worker must never send
   * twice, and the natural key differs per email: some are once per period,
   * some once per incident, some once per event.
   */
  idempotency: "per_period" | "per_incident" | "per_event";
  /** Why this exists, and which requirement it satisfies. */
  requirement: string;
};

export const EMAILS: Record<EmailKind, EmailSpec> = {
  // ── business: billing ─────────────────────────────────────────────────────
  activation_receipt: {
    audience: "business",
    from: SENDERS.billing,
    subject: () => "Your Ringly receptionist is live",
    transactional: true,
    idempotency: "per_period",
    requirement: "F7.1 — first fixed fee charged at activation",
  },
  upcoming_charge: {
    audience: "business",
    from: SENDERS.billing,
    subject: (p) => `Your next Ringly payment: ${p.amount}`,
    transactional: true,
    idempotency: "per_period",
    requirement: "F8.2 — upcoming charge notice",
  },
  payment_succeeded: {
    audience: "business",
    from: SENDERS.billing,
    subject: (p) => `Payment received — ${p.amount}`,
    transactional: true,
    idempotency: "per_period",
    requirement: "F8.2 — invoice issued / payment succeeded",
  },
  payment_failed: {
    audience: "business",
    from: SENDERS.billing,
    subject: () => "Your Ringly payment did not go through",
    transactional: true,
    idempotency: "per_period",
    requirement: "F7.11 — failed charge starts the 7-day grace",
  },
  payment_reminder: {
    audience: "business",
    from: SENDERS.billing,
    subject: (p) => `${p.daysLeft} days before your number stops answering`,
    transactional: true,
    idempotency: "per_event",
    requirement: "F10.3 — reminders through the grace period",
  },
  suspension_notice: {
    audience: "business",
    from: SENDERS.billing,
    subject: () => "Your Ringly number has stopped answering",
    transactional: true,
    idempotency: "per_period",
    requirement: "F10.3 — suspension at day 7",
  },
  deletion_warning: {
    audience: "business",
    from: SENDERS.billing,
    subject: () => "Final notice: your Ringly account is deleted in 48 hours",
    transactional: true,
    idempotency: "per_event",
    requirement: "F10.3a — nothing is deleted without 48 hours' warning",
  },
  cap_reached: {
    audience: "business",
    from: SENDERS.billing,
    subject: () => "You have hit your cap — the rest is on us",
    transactional: true,
    idempotency: "per_period",
    requirement: "F7.9 — cap reached, Ringly absorbs the remainder",
  },
  cancellation_confirmed: {
    audience: "business",
    from: SENDERS.billing,
    subject: () => "Your Ringly account has been cancelled",
    transactional: true,
    idempotency: "per_event",
    requirement: "F7.12 — cancellation, refund and final usage",
  },

  // ── business: operational ─────────────────────────────────────────────────
  calendar_access_failing: {
    audience: "business",
    from: SENDERS.service,
    subject: () => "Ringly cannot reach your calendar",
    transactional: true,
    idempotency: "per_incident",
    requirement: "F2.7 — one email per incident, never per lost call",
  },
  recurring_change: {
    audience: "business",
    from: SENDERS.service,
    subject: (p) =>
      `${p.customerName}'s repeat appointment needs your attention`,
    transactional: true,
    idempotency: "per_event",
    requirement: "F5.2b — occurrence shifted or skipped",
  },
  test_calls_exhausted: {
    audience: "business",
    from: SENDERS.service,
    subject: () => "We could not get your Ringly number working",
    transactional: true,
    idempotency: "per_event",
    requirement: "F1.13 — test calls used without confirmation",
  },

  // ── business: reporting ───────────────────────────────────────────────────
  stats_digest: {
    audience: "business",
    from: SENDERS.reports,
    subject: (p) => `${p.booked} appointments booked this period`,
    transactional: false,
    idempotency: "per_period",
    requirement: "F8.3 — digest aligned to the billing period",
  },

  // ── operator ──────────────────────────────────────────────────────────────
  ops_cap_reached: {
    audience: "operator",
    from: SENDERS.ops,
    subject: (p) => `[Ringly] ${p.businessName} hit the cap`,
    transactional: true,
    idempotency: "per_period",
    requirement: "F7.9, F9.6 — operator alerted when a business caps",
  },
  ops_payment_failed: {
    audience: "operator",
    from: SENDERS.ops,
    subject: (p) => `[Ringly] ${p.businessName} payment failed`,
    transactional: true,
    idempotency: "per_event",
    requirement: "F9.6 — operator alerted on payment failure",
  },
  ops_calendar_failing: {
    audience: "operator",
    from: SENDERS.ops,
    subject: (p) => `[Ringly] ${p.businessName} cannot book — calendar down`,
    transactional: true,
    idempotency: "per_incident",
    requirement: "F2.7, F9.12 — bookings being refused",
  },
  ops_activation_stuck: {
    audience: "operator",
    from: SENDERS.ops,
    subject: (p) => `[Ringly] ${p.businessName} stuck in onboarding`,
    transactional: true,
    idempotency: "per_event",
    requirement: "F1.13, F9.12 — activation needs operator help",
  },
  ops_business_deleted: {
    audience: "operator",
    from: SENDERS.ops,
    subject: (p) => `[Ringly] ${p.businessName} deleted`,
    transactional: true,
    idempotency: "per_event",
    requirement: "F10.3 — record of an irreversible deletion",
  },
};

/**
 * The vocabulary a test body is allowed to use.
 *
 * Everything here is product language. Nothing here names a table, a column, a
 * route, or a vendor identifier — those live behind the actors, projections and
 * fakes, and are the only things that change when the implementation does.
 */

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

/** Money is always cents. Tests never do floating-point arithmetic on dollars. */
export type Money = { readonly cents: number };

export const money = (dollars: number): Money => ({
  cents: Math.round(dollars * 100),
});

export const cents = (n: number): Money => ({ cents: n });

/**
 * A day on the test timeline. `day(1)` is the day the world was created.
 *
 * Business-local rather than UTC because every boundary in the product is
 * computed in the business's timezone (N5.2), and a test that thinks in UTC
 * would silently disagree with the product on the DST scenarios.
 */
export type Day = { readonly index: number };

/** A moment within a day, business-local. */
export type Instant = {
  readonly dayIndex: number;
  readonly minuteOfDay: number;
  /**
   * Which pass through a local time that happens twice (N5.3, scenario 253).
   * Only ever set for the hour a fall-back transition duplicates — everywhere
   * else a local time names exactly one instant and this stays undefined.
   */
  readonly occurrence?: "first" | "second";
};

/**
 * `day(45)` is a date; `day(45, "19:00")` is a moment on it; the third argument
 * disambiguates the hour a DST fall-back duplicates.
 *
 * The second form is not a convenience — roughly fifteen scenarios are
 * unexpressible without it: which four-hour window a call lands in (F6.3b), a
 * booking refused at 3am because the business is shut (F2.8), and both DST
 * cases, where the whole requirement is about a specific local hour existing
 * twice or not at all (N5.3). Pin day 1 to a real date with
 * `aBusiness().withDayOneOn(...)` when a scenario needs a genuine transition.
 *
 * Both forms are plain data with no methods, so `toEqual` compares them
 * structurally. A `Day` carrying an `at()` method would make two separately
 * constructed `day(60)` values unequal under Jest, which is the kind of trap
 * that costs an afternoon.
 *
 * There is deliberately no `startOfBusinessDay` helper. The product anchors
 * billing at 09:00 local (EDD §2.9.3); if a bare `Day` landed on that same
 * instant, every boundary scenario would agree with the product by
 * construction and none could catch the anchor moving. A bare `Day` lands at
 * noon — an hour with no product significance — and the scenarios that care
 * about the anchor say so: `day(31, "08:59")` vs `day(31, "09:01")`.
 */
export function day(index: number): Day;
export function day(
  index: number,
  hhmm: string,
  occurrence?: "first" | "second",
): Instant;
export function day(
  index: number,
  hhmm?: string,
  occurrence?: "first" | "second",
): Day | Instant {
  if (hhmm === undefined) return { index };
  // Validated rather than parsed loosely: `day(45, "2pm")` would otherwise
  // yield minuteOfDay NaN, and Jest's toEqual holds NaN equal to NaN — so a
  // mistyped time would produce two "equal" instants and a green test that
  // asserts nothing.
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) {
    throw new Error(
      `day(): expected a 24-hour "hh:mm", got ${JSON.stringify(hhmm)}`,
    );
  }
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) {
    throw new Error(`day(): ${hhmm} is not a time of day`);
  }
  const at: Instant = { dayIndex: index, minuteOfDay: h * 60 + m };
  return occurrence === undefined ? at : { ...at, occurrence };
}

/** E.164, always. The product treats a phone number as a customer's identity (F2.4). */
export type PhoneNumber = string;

export type EmailAddress = string;

/** Opaque handle to a business under test. Actors and projections take it. */
export type BusinessRef = { readonly id: string };

/**
 * One entry in the catalogue. Priced in `Money`, never in float dollars — the
 * seeding path and the owner's own edits must agree, or a test seeds $45.00 and
 * then asserts on 4499.
 */
export type ServiceSpec = {
  readonly name: string;
  readonly price: Money;
  readonly durationMinutes: number;
};

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

/** F3.5. A day absent from the array is a day the business is shut. */
export type OpeningHours = ReadonlyArray<{
  readonly day: Weekday;
  readonly open: string;
  readonly close: string;
}>;

// ---------------------------------------------------------------------------
// Domain enums — these mirror Part 1 and change only when the product does
// ---------------------------------------------------------------------------

/**
 * F6.3, F6.4. Five outcomes; `enquiry_only` and `dropped` stay distinct (F6.3d).
 *
 * Note `src/types` still declares a same-named union carrying the pre-v3 values
 * (`inquiry_only`, `unresolved`). That one is wrong as of v3 and goes away with
 * the outcome migration; importing it here would be coupling *and* a bug.
 */
export type CallOutcome =
  "booked" | "rescheduled" | "cancelled" | "enquiry_only" | "dropped";

/*
 * Deliberately absent: a `BillingStatus` union.
 *
 * A test that asserts "this business is in `grace`" is asserting on internal
 * state — the one kind of coupling this harness exists to prevent. Every state
 * in EDD §2.9.1 is observable through its consequences instead: does the number
 * answer (`serviceStatus`, `numberAnswers`), is anything owed (`owed`), what did
 * the business receive (`inbox`). Assert those.
 */

/** F6.7. `in_progress` is the open period, always the first row. */
export type PeriodStatus = "in_progress" | "paid" | "failed" | "refunded";

/** F6.14a. Every money figure on either dashboard carries one of these. */
export type MoneyState = "settled" | "accruing" | "outstanding";

/** F6.2. */
export type ReportingUnit = "calendar_month" | "billing_period";
export type ReportingRange = "current" | "past_3" | "past_6" | "past_12";

/** F6.3b. Six four-hour windows from business-local midnight. */
export type TimeWindow =
  "00-04" | "04-08" | "08-12" | "12-16" | "16-20" | "20-24";

/** F8.2 — the registry. If a kind is not here, the product must not send it. */
export type BusinessEmailKind =
  | "email_verification"
  | "welcome_now_live"
  | "upcoming_charge"
  | "payment_failed"
  | "payment_follow_up"
  | "suspension_notice"
  | "service_restored"
  | "deletion_warning"
  | "cap_reached"
  | "cancellation_confirmed"
  | "cancellation_countdown"
  | "closing_statement"
  | "calendar_access_failing"
  | "recurring_change"
  | "test_calls_exhausted"
  | "account_deleted"
  | "stats_digest";

/** F8.13, F9.6. */
export type OperatorEmailKind =
  | "operator_cap_reached"
  | "operator_payment_failed"
  | "operator_calendar_unreachable"
  | "operator_activation_stuck"
  | "operator_unactivated_expiring"
  | "operator_business_deleted";

export type EmailKind = BusinessEmailKind | OperatorEmailKind;

/** F8.11 — four streams on four identities, so a digest cannot poison a dunning address. */
export type SendingIdentity = "billing" | "service" | "reports" | "operator";

/** F9.12 — the named conditions, not a feeling. */
export type OperatorCondition =
  | "bookings_failing"
  | "activation_stuck"
  | "deletion_imminent"
  | "suspended"
  | "cancellation_window_open"
  | "unactivated_expiring"
  | "payment_failed"
  | "at_cap"
  | "negative_margin"
  | "clock_paused"
  | "dispute_open"
  | "debt_on_departure";

/** F10.3 — why a business ended, as recorded on the departure record (F10.9). */
export type EndedBy = "never_activated" | "non_payment" | "cancelled";

// ---------------------------------------------------------------------------
// Read models returned by projections
// ---------------------------------------------------------------------------

/** F6.15 — the first element on the dashboard, never stale. */
export type ServiceStatus = {
  /** Is the agent bound and the number answering? */
  readonly numberLive: boolean;
  readonly number: PhoneNumber;
  /** Present only when `numberLive` is false: why, and what turns it back on. */
  readonly reason?: "allowance_spent" | "suspended" | "dormant";
  /** Pre-activation only (F1.13). */
  readonly testCallsRemaining?: number;
};

/** F6.7 — one row per period, the open one first. */
export type BillingPeriodRow = {
  readonly startsOn: Day;
  readonly endsOn: Day;
  readonly fixedFee: Money;
  readonly billableMinutes: number;
  readonly usageCharge: Money;
  readonly total: Money;
  readonly percentOfCap: number;
  readonly chargedOn?: Day;
  readonly status: PeriodStatus;
  /** F7.11b — true when service was suspended for part of this period. */
  readonly suspended: boolean;
  readonly moneyState: MoneyState;
};

/** F6.3, F6.3a. Counts are of calls, never appointments (F6.3). */
export type CallAnalytics = {
  readonly calls: number;
  readonly averageDurationSeconds: number;
  /** Computed live, labelled live (F6.14). */
  readonly medianDurationSeconds: number;
  readonly callsThatBooked: number;
  readonly revenueBooked: Money;
  readonly revenueIsEstimate: boolean;
  readonly outcomes: Readonly<Record<CallOutcome, number>>;
  /**
   * F6.3c — outcome × window, both directions, because scenario 100 filters
   * each by the other. Storage is five `*_by_window` arrays for exactly this
   * reason; a flat per-window total would force the projection to sum them,
   * which is the one thing a projection may not do.
   */
  readonly byWindow: Readonly<
    Record<CallOutcome, Readonly<Record<TimeWindow, number>>>
  >;
  /** F6.14 — the date the figures are complete to. */
  readonly completeTo: Day;
};

export type AppointmentView = {
  readonly customer: PhoneNumber | null;
  readonly customerName: string | null;
  readonly service: string;
  /** An `Instant`: a ±2h shift (F5.4) is invisible at day resolution. */
  readonly startsAt: Instant;
  readonly durationMinutes: number;
  readonly seriesId: string | null;
};

/** What the *connected calendar* holds — read from the Google fake, not from Ringly. */
export type CalendarEvent = {
  readonly title: string;
  readonly startsAt: Instant;
  readonly durationMinutes: number;
};

/** Captured by the Resend fake. Assertions are on content, never on transport. */
export type CapturedEmail = {
  readonly kind: EmailKind;
  readonly to: EmailAddress;
  readonly from: SendingIdentity;
  readonly subject: string;
  readonly body: string;
  readonly sentOn: Day;
};

export type OperatorQueueRow = {
  readonly business: BusinessRef;
  readonly condition: OperatorCondition;
  readonly sinceDay: Day;
};

/** F10.9 — identity and money only. The absence of consumer data is the assertion. */
export type DepartureRecord = {
  readonly businessId: string;
  readonly name: string;
  readonly joinedOn: Day;
  readonly leftOn: Day;
  readonly endedBy: EndedBy;
  readonly owedAtDeparture: Money;
  readonly lifetimeNetRevenue: Money;
};

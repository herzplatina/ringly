import { Cta, EmailLayout, Facts, P } from "./layout";

/**
 * Operator-facing email — sent to Ringly, not to a business.
 *
 * Different job from the business templates: these are alerts read on a phone,
 * probably at an inconvenient moment. Every one leads with the business name and
 * the money at stake, and says what happens if it is ignored. No reassurance,
 * no marketing voice.
 *
 * Destined for Slack (F9.6); until then the format is the same information in
 * an inbox, so the eventual move is a transport change rather than a rewrite.
 */

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

// ── a business hit its cap ──────────────────────────────────────────────────

export type OpsCapReachedProps = {
  businessName: string;
  businessId: string;
  capCents: number;
  usageCents: number;
  costToDateCents: number;
  periodEnd: string;
  opsUrl: string;
};

export function OpsCapReached({
  businessName,
  businessId,
  capCents,
  usageCents,
  costToDateCents,
  periodEnd,
  opsUrl,
}: OpsCapReachedProps) {
  const bleeding = costToDateCents > capCents;
  return (
    <EmailLayout
      preview={`${businessName} hit the cap — serving at cost until ${periodEnd}`}
      heading={`${businessName} has hit the cap`}
    >
      <P>
        Billing has stopped for this period. Service continues and Ringly
        absorbs everything from here until <strong>{periodEnd}</strong>.
      </P>
      <Facts
        rows={[
          ["Business", `${businessName} (${businessId})`],
          ["Cap", money(capCents)],
          ["Usage accrued", money(usageCents)],
          ["Cost to serve so far", money(costToDateCents)],
          ["Margin", money(capCents - costToDateCents)],
        ]}
      />
      <P>
        {bleeding
          ? "This business is already costing more than it can be charged. Worth looking at before the period ends."
          : "Still profitable at the cap, but worth watching."}
      </P>
      <Cta href={opsUrl} label="Open operator dashboard" />
    </EmailLayout>
  );
}

// ── a business's payment failed ─────────────────────────────────────────────

export type OpsPaymentFailedProps = {
  businessName: string;
  businessId: string;
  amountCents: number;
  reason: string;
  attempt: number;
  suspendsOn: string;
  deletesOn: string;
  opsUrl: string;
};

export function OpsPaymentFailed({
  businessName,
  businessId,
  amountCents,
  reason,
  attempt,
  suspendsOn,
  deletesOn,
  opsUrl,
}: OpsPaymentFailedProps) {
  return (
    <EmailLayout
      preview={`${businessName} payment failed (attempt ${attempt})`}
      heading={`${businessName} — payment failed`}
    >
      <Facts
        rows={[
          ["Business", `${businessName} (${businessId})`],
          ["Amount", money(amountCents)],
          ["Decline reason", reason],
          ["Attempt", String(attempt)],
          ["Suspends on", suspendsOn],
          ["Deletes on", deletesOn],
        ]}
      />
      <P>
        Retries continue automatically. No action needed unless you want to
        reach out — the business has been emailed.
      </P>
      <Cta href={opsUrl} label="Open operator dashboard" />
    </EmailLayout>
  );
}

// ── a business's calendar is unreachable ────────────────────────────────────

export type OpsCalendarFailingProps = {
  businessName: string;
  businessId: string;
  provider: string;
  since: string;
  failedBookings: number;
  error: string;
  opsUrl: string;
};

export function OpsCalendarFailing({
  businessName,
  businessId,
  provider,
  since,
  failedBookings,
  error,
  opsUrl,
}: OpsCalendarFailingProps) {
  return (
    <EmailLayout
      preview={`${businessName} is turning bookings away — calendar unreachable`}
      heading={`${businessName} cannot book anyone`}
    >
      <P>
        Every booking attempt is being refused because the calendar cannot be
        read. This is lost revenue for them and unbillable call time for us.
      </P>
      <Facts
        rows={[
          ["Business", `${businessName} (${businessId})`],
          ["Provider", provider],
          ["Failing since", since],
          ["Bookings turned away", String(failedBookings)],
          ["Error", error],
        ]}
      />
      <P>
        If this is widespread rather than one business, it is more likely our
        credentials or the provider than their calendar.
      </P>
      <Cta href={opsUrl} label="Open operator dashboard" />
    </EmailLayout>
  );
}

// ── a business could not get activated ──────────────────────────────────────

export type OpsActivationStuckProps = {
  businessName: string;
  businessId: string;
  phoneNumber: string;
  attempts: number;
  numberReleasedOn: string;
  opsUrl: string;
};

export function OpsActivationStuck({
  businessName,
  businessId,
  phoneNumber,
  attempts,
  numberReleasedOn,
  opsUrl,
}: OpsActivationStuckProps) {
  return (
    <EmailLayout
      preview={`${businessName} could not activate after ${attempts} test calls`}
      heading={`${businessName} is stuck in onboarding`}
    >
      <P>
        They used all {attempts} test calls without confirming any worked. They
        cannot activate themselves out of this — it needs you.
      </P>
      <Facts
        rows={[
          ["Business", `${businessName} (${businessId})`],
          ["Number", phoneNumber],
          ["Test calls used", String(attempts)],
          ["Number released on", numberReleasedOn],
        ]}
      />
      <P>
        They have been told we are looking into it. Nothing has been charged.
      </P>
      <Cta href={opsUrl} label="Open operator dashboard" />
    </EmailLayout>
  );
}

// ── a business was deleted ──────────────────────────────────────────────────

export type OpsBusinessDeletedProps = {
  businessName: string;
  businessId: string;
  reason: "non_payment" | "cancellation";
  phoneNumber: string;
  lifetimeRevenueCents: number;
  lifetimeCostCents: number;
};

export function OpsBusinessDeleted({
  businessName,
  businessId,
  reason,
  phoneNumber,
  lifetimeRevenueCents,
  lifetimeCostCents,
}: OpsBusinessDeletedProps) {
  return (
    <EmailLayout
      preview={`${businessName} deleted — number released`}
      heading={`${businessName} has been deleted`}
    >
      <P>
        Deletion completed after the 48-hour warning. This is a record, not
        something to act on — it cannot be undone.
      </P>
      <Facts
        rows={[
          ["Business", `${businessName} (${businessId})`],
          [
            "Reason",
            reason === "non_payment" ? "Non-payment" : "Cancelled by request",
          ],
          ["Number released", phoneNumber],
          ["Lifetime revenue", money(lifetimeRevenueCents)],
          ["Lifetime cost", money(lifetimeCostCents)],
          ["Lifetime margin", money(lifetimeRevenueCents - lifetimeCostCents)],
        ]}
      />
    </EmailLayout>
  );
}

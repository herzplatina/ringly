import { money } from "./format";
import { Cta, EmailLayout, Facts, P } from "./layout";

/**
 * Business-facing billing email. Every template here is transactional — a
 * business cannot opt out of being told what it was charged or that its service
 * is about to stop.
 *
 * Defaults set here are starting points, not decisions. Subject lines live in
 * `registry.ts` beside each template so they can be reviewed together.
 */

// ── activation ──────────────────────────────────────────────────────────────

export type ActivationReceiptProps = {
  businessName: string;
  amountCents: number;
  periodStart: string;
  periodEnd: string;
  dashboardUrl: string;
};

export function ActivationReceipt({
  businessName,
  amountCents,
  periodStart,
  periodEnd,
  dashboardUrl,
}: ActivationReceiptProps) {
  return (
    <EmailLayout
      dashboardUrl={dashboardUrl}
      preview={`Your Ringly receptionist is live — ${money(amountCents)} charged`}
      heading="Your receptionist is live"
    >
      <P>
        {businessName} is now answering calls with Ringly. Your first 30-day
        period has started and the fixed fee has been charged.
      </P>
      <Facts
        rows={[
          ["Charged today", money(amountCents)],
          ["Covers", `${periodStart} – ${periodEnd}`],
          ["Usage", "Billed at the end of the period"],
        ]}
      />
      <P>
        You only pay usage on calls that actually did something — a booking, a
        reschedule, or a cancellation. Enquiries and wrong numbers are free.
      </P>
      <Cta href={dashboardUrl} label="See your dashboard" />
    </EmailLayout>
  );
}

// ── upcoming charge ─────────────────────────────────────────────────────────

export type UpcomingChargeProps = {
  amountCents: number;
  chargeDate: string;
  periodStart: string;
  periodEnd: string;
  dashboardUrl: string;
};

export function UpcomingCharge({
  amountCents,
  chargeDate,
  periodStart,
  periodEnd,
  dashboardUrl,
}: UpcomingChargeProps) {
  return (
    <EmailLayout
      dashboardUrl={dashboardUrl}
      preview={`${money(amountCents)} will be charged on ${chargeDate}`}
      heading="Your next payment"
    >
      <P>
        Your next 30-day period starts shortly. Nothing is needed from you —
        this is just so the charge is not a surprise.
      </P>
      <Facts
        rows={[
          ["Amount", money(amountCents)],
          ["Charge date", chargeDate],
          ["Covers", `${periodStart} – ${periodEnd}`],
        ]}
      />
      <Cta href={dashboardUrl} label="View billing" />
    </EmailLayout>
  );
}

// ── payment succeeded ───────────────────────────────────────────────────────

export type PaymentSucceededProps = {
  fixedFeeCents: number;
  usageCents: number;
  totalCents: number;
  periodStart: string;
  periodEnd: string;
  billableMinutes: number;
  invoiceUrl: string;
  dashboardUrl: string;
};

export function PaymentSucceeded({
  fixedFeeCents,
  usageCents,
  totalCents,
  periodStart,
  periodEnd,
  billableMinutes,
  invoiceUrl,
  dashboardUrl,
}: PaymentSucceededProps) {
  return (
    <EmailLayout
      dashboardUrl={dashboardUrl}
      preview={`Payment received — ${money(totalCents)}`}
      heading="Payment received"
    >
      <P>
        Thank you. Here is what you were charged for {periodStart} – {periodEnd}
        .
      </P>
      <Facts
        rows={[
          ["Fixed fee", money(fixedFeeCents)],
          [`Usage (${billableMinutes} min)`, money(usageCents)],
          ["Total", money(totalCents)],
        ]}
      />
      <Cta href={invoiceUrl} label="Download invoice" />
    </EmailLayout>
  );
}

// ── payment failed ──────────────────────────────────────────────────────────

export type PaymentFailedProps = {
  amountCents: number;
  reason: string;
  graceEndsOn: string;
  updateCardUrl: string;
  dashboardUrl: string;
};

export function PaymentFailed({
  amountCents,
  reason,
  graceEndsOn,
  updateCardUrl,
  dashboardUrl,
}: PaymentFailedProps) {
  return (
    <EmailLayout
      dashboardUrl={dashboardUrl}
      preview={`We could not take ${money(amountCents)} — your service is still running`}
      heading="Your payment did not go through"
    >
      <P>
        We tried to charge {money(amountCents)} and it was declined ({reason}).
        <strong> Your receptionist is still answering calls.</strong>
      </P>
      <P>
        We will keep retrying. If payment has not cleared by{" "}
        <strong>{graceEndsOn}</strong>, your number stops answering — but
        nothing is deleted, and paying restores it immediately.
      </P>
      <Cta href={updateCardUrl} label="Update payment method" />
    </EmailLayout>
  );
}

// ── payment retry reminder ──────────────────────────────────────────────────

export type PaymentReminderProps = {
  amountCents: number;
  daysLeft: number;
  graceEndsOn: string;
  updateCardUrl: string;
  dashboardUrl: string;
};

export function PaymentReminder({
  amountCents,
  daysLeft,
  graceEndsOn,
  updateCardUrl,
  dashboardUrl,
}: PaymentReminderProps) {
  return (
    <EmailLayout
      dashboardUrl={dashboardUrl}
      preview={`${daysLeft} days before your number stops answering`}
      heading={`${daysLeft} days left to pay`}
    >
      <P>
        {money(amountCents)} is still outstanding. Your receptionist is
        answering calls as normal until <strong>{graceEndsOn}</strong>.
      </P>
      <P>
        After that the number stops answering. Your appointments, customers and
        history are untouched, and paying brings everything straight back.
      </P>
      <Cta href={updateCardUrl} label="Pay now" />
    </EmailLayout>
  );
}

// ── suspension ──────────────────────────────────────────────────────────────

export type SuspensionNoticeProps = {
  amountCents: number;
  deletionDate: string;
  updateCardUrl: string;
  dashboardUrl: string;
};

export function SuspensionNotice({
  amountCents,
  deletionDate,
  updateCardUrl,
  dashboardUrl,
}: SuspensionNoticeProps) {
  return (
    <EmailLayout
      dashboardUrl={dashboardUrl}
      preview="Your number has stopped answering calls"
      heading="Your number has stopped answering"
    >
      <P>
        Because {money(amountCents)} is still unpaid, {`Ringly`} has stopped
        answering calls to your number. Callers now hear nothing from us.
      </P>
      <P>
        <strong>Nothing has been deleted.</strong> You keep your number, your
        appointments and your history until <strong>{deletionDate}</strong>. We
        are still retrying payment, and the moment one succeeds your
        receptionist is back.
      </P>
      <Cta href={updateCardUrl} label="Restore my service" />
    </EmailLayout>
  );
}

// ── 48-hour deletion warning ────────────────────────────────────────────────

export type DeletionWarningProps = {
  businessName: string;
  phoneNumber: string;
  deletionAt: string;
  appointmentCount: number;
  updateCardUrl: string;
  dashboardUrl: string;
};

export function DeletionWarning({
  businessName,
  phoneNumber,
  deletionAt,
  appointmentCount,
  updateCardUrl,
  dashboardUrl,
}: DeletionWarningProps) {
  return (
    <EmailLayout
      dashboardUrl={dashboardUrl}
      preview={`Final notice — ${businessName} will be deleted on ${deletionAt}`}
      heading="Final notice: your account will be deleted in 48 hours"
    >
      <P>
        This is the last email before we permanently delete {businessName} from
        Ringly on <strong>{deletionAt}</strong>. This cannot be undone.
      </P>
      <P>What will be deleted:</P>
      <Facts
        rows={[
          ["Your phone number", `${phoneNumber} — released, not recoverable`],
          ["Appointments in Ringly", `${appointmentCount} records`],
          ["Customers and call history", "All of it"],
        ]}
      />
      <P>
        Appointments already written to your own calendar stay there — we do not
        touch your calendar. Everything held by Ringly goes.
      </P>
      <Cta href={updateCardUrl} label="Keep my account" />
    </EmailLayout>
  );
}

// ── cap reached ─────────────────────────────────────────────────────────────

export type CapReachedProps = {
  capCents: number;
  periodEnd: string;
  dashboardUrl: string;
};

export function CapReached({
  capCents,
  periodEnd,
  dashboardUrl,
}: CapReachedProps) {
  return (
    <EmailLayout
      dashboardUrl={dashboardUrl}
      preview={`You have reached ${money(capCents)} — the rest of the period is on us`}
      heading="You have hit your cap — the rest is on us"
    >
      <P>
        Your receptionist has done enough useful work this period to reach the{" "}
        {money(capCents)} maximum. That is a lot of booked appointments.
      </P>
      <P>
        <strong>
          Nothing changes and nothing more will be charged until {periodEnd}.
        </strong>{" "}
        Your receptionist keeps answering and booking exactly as it is — Ringly
        covers the cost for the rest of the period.
      </P>
      <Cta href={dashboardUrl} label="See what it booked" />
    </EmailLayout>
  );
}

// ── cancellation ────────────────────────────────────────────────────────────

export type CancellationConfirmedProps = {
  businessName: string;
  refundCents: number;
  finalUsageCents: number;
  deletionDate: string;
  dashboardUrl: string;
};

export function CancellationConfirmed({
  businessName,
  refundCents,
  finalUsageCents,
  deletionDate,
  dashboardUrl,
}: CancellationConfirmedProps) {
  return (
    <EmailLayout
      dashboardUrl={dashboardUrl}
      preview={`${businessName} has been cancelled`}
      heading="Your cancellation is confirmed"
    >
      <P>
        {businessName} has been cancelled and will not be charged again. Your
        receptionist has stopped answering calls.
      </P>
      <Facts
        rows={[
          ["Refund of unused days", money(refundCents)],
          ["Final usage charge", money(finalUsageCents)],
          ["Data deleted on", deletionDate],
        ]}
      />
      <P>
        Until {deletionDate} everything is recoverable — reply to this email and
        we will put it back. After that it is gone. Appointments already in your
        own calendar are unaffected.
      </P>
    </EmailLayout>
  );
}

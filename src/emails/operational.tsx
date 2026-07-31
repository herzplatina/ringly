import { Cta, EmailLayout, Facts, P } from "./layout";

/**
 * Business-facing operational email — things that have gone wrong, or changed,
 * in the running of the receptionist. All transactional.
 */

// ── calendar access failing ─────────────────────────────────────────────────

export type CalendarAccessFailingProps = {
  businessName: string;
  provider: string;
  since: string;
  reconnectUrl: string;
};

export function CalendarAccessFailing({
  businessName,
  provider,
  since,
  reconnectUrl,
}: CalendarAccessFailingProps) {
  return (
    <EmailLayout
      preview="Ringly cannot reach your calendar — bookings are being turned away"
      heading="We cannot reach your calendar"
    >
      <P>
        Since <strong>{since}</strong>, Ringly has not been able to read{" "}
        {businessName}&apos;s {provider} calendar.
      </P>
      <P>
        <strong>
          Your receptionist is still answering, but it is not booking anyone in.
        </strong>{" "}
        We will not book a time we cannot verify is free — putting two customers
        in one slot is worse than asking someone to call back. Callers are being
        apologised to and asked to try again shortly.
      </P>
      <P>Reconnecting your calendar fixes this immediately.</P>
      <Cta href={reconnectUrl} label="Reconnect my calendar" />
    </EmailLayout>
  );
}

// ── recurring occurrence shifted or skipped ─────────────────────────────────

export type RecurringChangeProps = {
  customerName: string;
  customerPhone: string;
  serviceName: string;
  originalTime: string;
  outcome: "shifted" | "skipped";
  newTime?: string;
  dashboardUrl: string;
};

export function RecurringChange({
  customerName,
  customerPhone,
  serviceName,
  originalTime,
  outcome,
  newTime,
  dashboardUrl,
}: RecurringChangeProps) {
  const shifted = outcome === "shifted";
  return (
    <EmailLayout
      preview={
        shifted
          ? `${customerName}'s repeat appointment was moved to ${newTime}`
          : `${customerName}'s repeat appointment could not be booked`
      }
      heading={
        shifted
          ? "A repeat appointment had to be moved"
          : "A repeat appointment could not be booked"
      }
    >
      <P>
        {customerName}&apos;s usual slot was already taken, so Ringly{" "}
        {shifted
          ? "moved this one to the nearest free time on the same day."
          : "could not fit it within two hours of the usual time and has skipped it rather than move them to another day."}
      </P>
      <Facts
        rows={[
          ["Customer", customerName],
          ["Phone", customerPhone],
          ["Service", serviceName],
          ["Usual time", originalTime],
          ["Now", shifted ? (newTime ?? "—") : "Not booked"],
        ]}
      />
      <P>
        <strong>The customer has not been told.</strong> Ringly has no way to
        contact them — if this matters, please call them.
      </P>
      <Cta href={dashboardUrl} label="Open dashboard" />
    </EmailLayout>
  );
}

// ── test calls exhausted ────────────────────────────────────────────────────

export type TestCallsExhaustedProps = {
  businessName: string;
  phoneNumber: string;
  attempts: number;
};

export function TestCallsExhausted({
  businessName,
  phoneNumber,
  attempts,
}: TestCallsExhaustedProps) {
  return (
    <EmailLayout
      preview="Your number is not active yet — we are looking into it"
      heading="We could not get your number working"
    >
      <P>
        You tried {attempts} test calls to {phoneNumber} without confirming any
        of them worked, so {businessName} has <strong>not</strong> been
        activated and you have <strong>not</strong> been charged.
      </P>
      <P>
        We can see this has happened and are looking into it. You do not need to
        do anything — we will come back to you shortly.
      </P>
    </EmailLayout>
  );
}

// ── periodic stats digest (the only unsubscribable email) ───────────────────

export type StatsDigestProps = {
  businessName: string;
  periodStart: string;
  periodEnd: string;
  calls: number;
  uniqueCallers: number;
  avgDurationSeconds: number;
  booked: number;
  rescheduled: number;
  cancelled: number;
  enquiryOnly: number;
  dropped: number;
  revenueBookedCents: number;
  dashboardUrl: string;
};

export function StatsDigest({
  businessName,
  periodStart,
  periodEnd,
  calls,
  uniqueCallers,
  avgDurationSeconds,
  booked,
  rescheduled,
  cancelled,
  enquiryOnly,
  dropped,
  revenueBookedCents,
  dashboardUrl,
}: StatsDigestProps) {
  const mins = Math.floor(avgDurationSeconds / 60);
  const secs = avgDurationSeconds % 60;
  return (
    <EmailLayout
      preview={`${booked} appointments booked from ${calls} calls`}
      heading={`${businessName} — ${periodStart} to ${periodEnd}`}
      unsubscribable
    >
      <P>Here is what your receptionist did over the last 30 days.</P>
      <Facts
        rows={[
          ["Calls answered", String(calls)],
          ["Unique callers", String(uniqueCallers)],
          ["Average call", `${mins}m ${secs}s`],
        ]}
      />
      <P>How those calls ended:</P>
      <Facts
        rows={[
          ["Booked", String(booked)],
          ["Rescheduled", String(rescheduled)],
          ["Cancelled", String(cancelled)],
          ["Enquiry only", String(enquiryOnly)],
          ["Dropped", String(dropped)],
        ]}
      />
      <Facts
        rows={[["Revenue booked", `$${(revenueBookedCents / 100).toFixed(2)}`]]}
      />
      <P>
        Figures for appointments still in the future are estimates — a price can
        change before the appointment happens. Definitions of each outcome are
        on your dashboard.
      </P>
      <Cta href={dashboardUrl} label="See the full picture" />
    </EmailLayout>
  );
}

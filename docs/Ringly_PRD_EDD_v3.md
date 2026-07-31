# Ringly — PRD + EDD (v3.0)

_Supersedes `Ringly_PRD_EDD_v2.md` (2026-07-01). Revised 2026-07-30 for
multi-tenant scale, scheduling-provider independence, recurring appointments,
the business analytics dashboard, Stripe billing, and email notifications._

> **Status.** Part 1 (PRD) is locked. Part 2 (EDD) was rewritten against it on
> 2026-07-30 and supersedes the earlier design. **Almost none of it is built**:
> what ships today is the v2 product plus the calendar conflict check (PR #2) and
> the email templates (PR #4) — and §2.15 lists the places where that shipped code
> contradicts this design. The delivery plan is §2.16.

---

# Part 1 — Product Requirements (PRD)

## 1.1 Vision

Ringly gives a small business a dedicated AI receptionist that answers calls
around the clock, discusses services and pricing, and books, reschedules and
cancels appointments against the business's own calendar.

v2 made a single business live in under three minutes. **v3 turns that into a
business**: thousands of tenants, each with thousands of customers, each in their
own timezone, billed for what they use, and able to see and manage their own
operation without talking to us. Google Calendar is the only scheduling system
served at launch, behind an interface built so others can follow.

## 1.2 What changed from v2

| Area         | v2                                   | v3                                                                |
| ------------ | ------------------------------------ | ----------------------------------------------------------------- |
| Tenancy      | Implicitly single-tenant assumptions | Explicit multi-tenant model, isolation and scale targets          |
| Scheduling   | Google Calendar only, hardwired      | Still Google only, but behind an interface others can plug into   |
| Appointments | One-off only                         | One-off **and** recurring series                                  |
| Reminders    | Deferred (`pg_cron` TODO)            | Still deferred — no near-term plan, see §1.9                      |
| Services     | Set at onboarding                    | Editable any time; changes reach the agent for the next caller    |
| Analytics    | None                                 | Per-business dashboard, plus an operator cost/revenue dashboard   |
| Money        | None                                 | $100/30 days in advance, usage in arrears, $500 cap, card on file |
| Email        | None                                 | Billing and stats emails to the business                          |
| Latency      | Not a stated requirement             | Explicit per-turn budget on the call path                         |
| Cost         | Not a stated requirement             | Explicit per-tenant serving-cost target                           |

## 1.3 Personas

- **Business owner (primary).** Non-technical. Salon, tax office, trades, and
  similar appointment-driven businesses. Wants a receptionist, not a
  configuration project. Checks a dashboard occasionally and
  an email monthly. Cares about missed calls and money.
- **Calling customer (secondary).** Wants an appointment at a time that suits
  them, in one call, without being told to hold. Never sees Ringly's UI.
- **Ringly operator (us).** Needs per-tenant cost visibility, safe degradation,
  and no manual work per new tenant.

## 1.4 Scope

**In scope for v3:** everything in §1.5 and §1.6.

**Explicit non-goals for v3:**

- **Healthcare businesses of any kind, including clinics.** Callers to a clinic
  disclose health information, which makes the call PHI. Retell can carry PHI
  only under a signed Business Associate Agreement, which Ringly does not hold,
  and holding one imposes obligations across the whole stack. Clinics are
  therefore **out of scope until a BAA is in place** — a commercial decision, not
  a technical limitation. **`business_type` must not offer `clinic` or any
  healthcare option**, and the existing enum value must be removed.
- Multi-location businesses (one location per business row).
- Multi-staff / resource-level scheduling (one implicit calendar per business).
- Non-US phone numbers and non-English calls.
- Self-serve plan changes, coupons, and promotional pricing of any kind.
- Customer-facing web booking. The phone is the only booking channel.

---

## 1.5 Functional requirements

### F1 — Onboarding and identity

_(Carried from v2; renumbered. v2 FR1–FR10 map to F1.1–F1.10.)_

- **F1.1** Intake accepts free-form text; no structured fields required.
- **F1.2** Voice output speaks the prompt; input is typed. (Speech-to-text input is deferred.)
- **F1.3** Enrichment resolves name, address, phone, hours, IANA timezone, and
  website from Google Places.
- **F1.4** Services auto-extracted from the website (≤5 items), with upload and
  manual entry as first-class fallbacks.
- **F1.5** All enriched fields are inline-editable before commit.
- **F1.6** Enrichment resolves in a single request.
- **F1.7** A single Google OAuth grants the Ringly session and offline calendar
  access; the account is keyed to the Google identity.
- **F1.7a** **Calendar scope may be declined independently of sign-in.** Google
  offers granular consent, so a user can grant sign-in and refuse calendar in the
  same dialog. Ringly checks the scopes actually granted rather than assuming.
- **F1.7b** **Declining calendar access blocks activation, not the account.**
  Sign-in completes and the enriched draft is kept, so declining costs a click
  rather than the work already done. Onboarding stops at a screen that
  **explains, in plain language, why calendar access is required** — Ringly
  refuses to book a time it cannot verify (F2.7), so without it there is no
  product — and offers a re-consent button.
- **F1.7c** The reason for every scope Ringly requests is stated on the consent
  screen **before** the user is sent to Google, not only after they decline.
- **F1.8** The user is told their Google login is now their Ringly login.
- **F1.9** Number purchase and agent provisioning run in the background.
- **F1.10** No WhatsApp UI in onboarding.
- **F1.11 (new)** Onboarding collects and verifies a **business contact email**,
  defaulted from the Google identity and editable. It is required before
  activation and is the destination for all billing and stats email (F8).
- **F1.12 (new)** Onboarding ends with a **test call** step. The business calls
  its own new number and then **confirms on the dashboard that the call worked**.
  Success is the owner's judgement, not something Ringly infers — only they know
  whether the agent actually sounded right. Confirmation is what fully activates
  the number and starts billing (F7.1).
- **F1.13 (new)** A business may place at most **10 test calls** before
  confirming (F10.1). **If it exhausts them without confirming**, onboarding
  stops and:
  - the business is **emailed** to say the number has not been activated and
    Ringly is investigating and will come back to them;
  - the failure is raised on the **operator dashboard** and **emailed to the
    operator**.

  A business in this state is never charged, and cannot activate itself out of
  it — recovery is operator-led.

### F2 — Call handling and booking

- **F2.1** The agent answers on the business's dedicated number, identifies the
  business, and can describe services, prices, and durations.
- **F2.1a** **Every call opens with a recording disclosure**, immediately after
  the greeting and before the caller says anything of substance:

  > "Hello, this is _[business name]_. Just to let you know, this call is
  > recorded for quality assurance. How can I help you today?"

  Around a dozen US states require all-party consent to record. **The disclosure
  is appended by Ringly and is not part of the business's editable greeting
  script** — a business can change how it introduces itself, but cannot remove or
  alter the disclosure. If a business supplies no greeting of its own, the text
  above is used verbatim.

- **F2.2** The agent books, reschedules, and cancels appointments.
- **F2.3** A requested time is checked against the business's own bookings **and**
  its connected calendar before anything is written; a taken slot is refused and
  the nearest open times either side are offered. _(Shipped in PR #2.)_
- **F2.3a** If the slot is taken **between** offering it and writing it — a race
  with another caller — the agent says so and re-offers:

  > "Unfortunately, that slot has just been taken. Let's find another time for
  > your appointment. Here are some available slots…"

- **F2.4** A caller identifies an existing appointment by **name plus the
  appointment's details** — date, time, and service. Ringly searches for an
  appointment matching all of them.
  - A reschedule or cancellation proceeds **only on a full match**. A partial
    match is refused and the caller is told what did not match.
  - Voice recognition errors are expected, so a caller may correct any detail and
    the search runs again against the corrected values.
  - Caller ID is **not** the identifying factor for _this lookup_: a customer
    may ring from a different phone or withhold their number, and the search runs
    over appointments rather than over customer records.
  - **A customer's identity is nonetheless their phone number**, not their name —
    names are not unique and two customers of one business may share one. A
    customer who books from two different phones therefore becomes two customer
    records, and Ringly cannot tell they are the same person. **Accepted:** it
    inflates unique-caller counts and splits history, and there is no sound way
    to merge on name alone.
  - **A relative day means the next one.** "Tuesday at 2" resolves to the
    **nearest future Tuesday** from the moment of the call. The agent then
    **states the full date back to the caller** and waits for confirmation before
    acting, so an ambiguous phrase is never resolved silently.
  - **For an appointment that belongs to a recurring series, the agent asks
    explicitly whether the caller means this occurrence alone or the whole
    series**, and repeats the choice back before cancelling or moving anything.
    This question is not asked for one-off appointments.
- **F2.5** All times spoken to a caller are in the **business's** local timezone,
  never UTC and never the caller's.
- **F2.6** While the agent is waiting on any backend operation, the caller hears
  natural filler speech rather than silence. No caller-perceptible gap may exceed
  the budget in N3.
- **F2.7** **If the business's calendar cannot be reached for any reason, no
  appointment is booked.** A booking Ringly cannot verify is worse than no
  booking — it double-books the business and the customer arrives to a clash.
  _(This replaces the earlier fail-open position; see R1.)_
  - **To the caller: a quiet apology, not an explanation.** The agent apologises,
    says it cannot confirm a time right now, and asks them to call back shortly.
    No technical detail, no blame.
  - **To everyone else: as loud as possible.** The same failure raises a
    prominent warning on the **business dashboard**, a warning on the **operator
    dashboard**, and an **immediate email to the business** telling them customer
    bookings are failing because their calendar cannot be reached.
  - **Alerting is per incident, not per call.** A calendar outage fails every
    call that arrives during it; the business gets **one** email per incident,
    not one per lost customer. The warning clears automatically on the first
    successful calendar read.
- **F2.7a** This applies however the calendar became unreachable — provider
  outage, timeout, revoked consent, or expired credentials. **There is no case in
  which Ringly books against a calendar it could not read.** A connected calendar
  is mandatory (F4.1), so there is no configuration in which booking proceeds
  unverified.
- **F2.8** The agent answers **24 hours a day**, but appointments may only be
  **booked inside the business's opening hours** (F3, business_hours).
- **F2.9** A one-off appointment may not be booked **more than 70 days ahead**.
  The limit is **configuration, not a constant**: a platform default that the
  **business can change from its own dashboard** (F6.13), bounded to **7–180
  days** so no business can set a value that makes availability computation
  unreasonable.
- **F2.9a** The 70-day limit constrains **what a caller may request**. It does
  not constrain recurrence: a standing series is open-ended by nature, and its
  occurrences are materialised ahead by the system (F5.2), not requested by a
  caller.

### F3 — Service catalogue management

- **F3.1** A business can add, edit, deactivate, and reorder services, each with
  a name, description, price, and duration.
- **F3.2** A change takes effect for the **next** caller. Target propagation ≤ 60s
  from save; the caller mid-conversation keeps the catalogue they started with.
- **F3.3** Deactivating a service never alters appointments already booked
  against it.
- **F3.4** Price and duration are versioned, and resolve at **different moments**:
  - **Price is the price in force at the time of the appointment**, not at
    booking — these businesses charge their customer after the appointment
    happens, so the price they will actually collect is the current one.
  - **Duration is locked** when the appointment is booked (or, for a recurring
    occurrence, when it is materialised) and never changes afterwards. A
    duration that floated would silently overlap appointments booked around it.
  - Deactivating or repricing a service therefore never breaks an existing
    booking's slot, but does change what it is worth.
  - If the service has since been **deleted**, the appointment is valued at the
    **last known price** of that service. An appointment never becomes unpriceable
    because the catalogue moved on.

### F4 — Scheduling integrations

- **F4.1** **A connected calendar is mandatory.** A business cannot activate, and
  cannot take bookings, without one. Ringly refuses to book a time it has not
  verified (F2.7), so a business with no calendar has no product.
- **F4.2** **Google Calendar is the only supported provider at v3 launch**, and
  is the default. Businesses on other systems are not served yet.
- **F4.3** The system is built so a further provider can be added **without
  changes to booking logic** — provider-specific code lives behind one interface
  (EDD §2.4).
- **F4.4** Providers targeted after launch, in priority order: Microsoft 365 /
  Outlook, CalDAV (Apple/Fastmail), then vertical booking systems (Square
  Appointments, Acuity, Calendly).
- **F4.5** **Losing or revoking provider access stops booking.** There is no
  degraded mode that books without verification — the failure is handled by F2.7
  and F2.7a. Calls are still answered and enquiries still work; only booking
  stops, loudly.

### F5 — Recurring appointments

> **Reminders are out of scope for v3.** There is no reminder channel, no
> dispatcher, and no reminder billing. The whole of reminders — including
> notifying a customer when their appointment changes (F5.2c) — is deferred with
> no near-term plan (§1.9). Recurring appointments themselves remain in v3.

- **F5.1** A caller can set up a **recurring** appointment in one call (e.g.
  "every fourth Tuesday at 2"), described by a standard recurrence rule.
- **F5.2** Occurrences are generated ahead of time so each can be individually
  moved, cancelled, or skipped without affecting the rest of the series. The
  horizon is **90 days by default and is configuration, not a constant**: a
  platform default the **business can change from its own dashboard** (F6.13),
  bounded to **30–365 days**.
- **F5.2a** If a generated occurrence lands on a slot that is already taken, it
  is **shifted to the nearest free slot on the same day, within ±2 hours** of its
  usual time. If nothing fits that window the occurrence is **skipped, not
  moved**, so a customer is never silently relocated to another day.
- **F5.2b** Either outcome — shifted or skipped — **emails the business owner**
  with the customer's name and number, the original date and time, what happened,
  and the new time if there is one. The business owner is the only party that can
  be reached in v3.
- **F5.2c** The **customer** is not notified of a shift, because no channel to
  reach them exists. Customer notification ships with the reminder channel in v2.
- **F5.3** Cancelling a series cancels its future occurrences and leaves past
  ones intact.

### F6 — Business dashboard

The dashboard **reports exactly two things** — the aggregate shape of the calls
Ringly handled, and what the business has paid for them. Anything else it might
report is deliberately absent, not merely unbuilt.

It also carries the **controls** a business needs: managing its service catalogue
(F3.1), confirming its test call (F1.12), setting its booking and recurrence
horizons (F2.9, F5.2), reconnecting a calendar (F1.7b), and the warnings raised
when something is wrong (F2.7). Those are actions, not reporting, and the
two-things rule does not constrain them.

**(1) Aggregate analysis of calls to Ringly**

- **F6.1** Each business sees only its own data, always.
- **F6.2** Reported for **both** groupings, side by side:
  - each **calendar month** (June, July, August) — how a business thinks; and
  - each **30-day billing period** — how they are charged.
- **F6.3** The figures are:
  - calls received, and unique callers;
  - call time-of-day distribution;
  - average and median call duration;
  - outcome breakdown as counts and percentages: **booked / rescheduled /
    cancelled / enquiry-only / dropped**;
  - appointments booked, and revenue booked. Revenue for **future**
    appointments is an **estimate**, labelled as such: price resolves at
    occurrence time (F3.4), so it can still change before the appointment
    happens.
- **F6.4** **"Dropped"** covers both a caller who hung up without a resolved
  outcome **and** a call the agent could not help with. If the caller did not get
  what they rang for, it is dropped. A completed enquiry — the caller asked
  something and got a useful answer — is reported separately.
- **F6.5** **Every outcome definition is shown on the dashboard itself**, in
  plain language, next to the figures it governs. A business must never have to
  guess what "dropped" counts.
- **F6.6** **If a definition changes, the dashboard says so prominently** — a
  notice the owner may or may not read, with no acknowledgement required and no
  state to track. It states that figures before and after the change are not
  directly comparable. Historical calls are **not** reclassified — transcripts
  are not retained (F10.6), so outcomes cannot be re-derived. This is a permanent
  property of the design, explained on the dashboard rather than hidden.

**(2) Billing history**

- **F6.7** The business sees what it has paid Ringly, **per billing period**:
  the fixed fee, the usage charged, the total, the date charged, and its status
  (paid, failed, refunded). **"Refunded" is only ever a goodwill gesture made by
  hand** — no rule in this document produces a refund, and none should be
  built.
- **F6.8** The current period shows usage accrued so far, the cap, and the next
  charge date.

**Everything else**

- **F6.9** The dashboard is **aggregate-only for calls**. A business cannot read
  individual transcripts, listen to recordings, or search call content — Ringly
  stores none of it (F10.6). Ringly's own developer inspects individual calls in
  the Retell dashboard.
- **F6.10** Figures cover **only appointments booked through Ringly**. Anything
  the owner enters directly in their own calendar is respected for conflict
  checking (F2.3) but never appears in Ringly's figures.
- **F6.11** All figures are rendered in the business's own timezone, including
  day, week and month boundaries for grouping.
- **F6.12** Dashboard queries return in ≤ 500ms p95 regardless of tenant size,
  and their cost must not grow with total call volume across all tenants.
- **F6.13** From the dashboard a business can: confirm its test call succeeded
  (F1.12), and set its own booking and recurrence horizons (F2.9, F5.2).

> **No-shows are out of scope.** Ringly does not track, record, or report them.
> A no-show is something the business observes in its own calendar and handles
> itself; Ringly has no way to know it happened and no lever to pull. Blacklisting
> repeat no-shows, or reminding them harder, are ideas for later — both depend on
> a customer channel that does not exist.

### F7 — Billing and payments

**Billing period.** A business's period is a **rolling 30 days from activation**,
not a calendar month. Period 1 begins the day the business activates (F1.12);
period _n+1_ begins the day after period _n_ ends.

**The two charges never fall on the same day.** The fixed fee is taken on the
**first** day of a period; that period's usage is settled on its **last** day.
For a business activating on day 1: $100 on day 1, period-1 usage on day 30,
$100 for period 2 on day 31. A card that has gone bad therefore fails one charge
at a time, and there is only ever **one grace clock**, started by whichever
charge failed first (F7.11).

- **F7.1** A **$100 fixed fee** is charged **in advance** at the start of every
  30-day period, irrespective of usage. The first such charge is the activation
  payment — there is no separate one-off activation fee.
- **F7.2** At activation the business's **card is stored for future off-session
  use**, so later charges need no customer presence.
- **F7.3** Ringly never stores, transmits, or logs raw card details. Card data is
  handled entirely by the payment provider; Ringly stores only provider
  identifiers. _(Hard requirement, not a preference.)_
- **F7.4** **Usage** accrues through the period and is charged **in arrears** at
  period end, once the total is known.
- **F7.5** **One billable usage unit in v3: connected minutes on productive
  calls** (F7.6), whole call duration (F7.7). Reminder metering is designed for
  (F7.15) but inert, because reminders do not exist in v3.
- **F7.6** A call is **productive** — and therefore billable — if it resulted in
  any of: a new booking; a reschedule that produced a booked appointment; or a
  cancellation of a real existing appointment. **Not billable:** general enquiry
  calls, wrong numbers, dropped calls, pre-activation test calls, and any call
  that changed nothing for the business. **Who is calling is irrelevant** — the
  owner, a customer, or Ringly's own developer are billed identically. The
  outcome is the only test.
- **F7.7** The **whole call** is billable, not only the minutes up to the
  booking. Once a business is activated, **no caller is exempt** — Ringly does
  not try to decide whether a call came from a genuine customer, the owner, or
  the developer. The only filter is the outcome test in F7.6.
- **F7.7a** Connected seconds are summed across the **whole billing period** and
  **rounded up to a whole minute once**, at period close — not per call. A
  business making many short calls is not charged a full minute for each.
- **F7.8** Rates are **configuration, not constants in code**. The
  per-connected-minute rate is **TBD** and must be settable without a deploy. A
  per-reminder rate (working assumption **$0.05**) is carried in the same policy
  record for when reminders arrive.
- **F7.9** A **$500 cap per period, inclusive of the $100 fixed fee.** Usage
  **keeps accruing past the cap** — it is recorded in full, because Ringly needs
  the real number for cost and margin (F9). The cap is applied **at settlement**,
  not during the period: whatever was accrued, the business is charged at most
  $500 for the period.
- **F7.9a** **Settlement happens at exactly three moments**, and the clamp is
  applied at each:
  1. **Normal period end** — the usual case.
  2. **A cancellation window closing** (F7.12) — 7 days after the request or at
     period end, whichever comes first, which settles the period early.
  3. **Final deletion for non-payment** (F10.3), where the clamped figure is what
     the business is recorded as owing (F10.9) even though it is never collected.
- **F7.9b** On first crossing the cap Ringly **continues to serve the business
  and absorbs the excess**, **alerts the operator** (F9.6), and **emails the
  business** to say it has used enough to reach $500 and that everything for the
  rest of the period is on Ringly. Hitting the cap is good news for the business
  and should read that way.
- **F7.10** Billing repeats every 30 days with no action from the business —
  **unless the business has asked to cancel**. A business marked cancelled is
  **never charged again**, and resumes billing only if it explicitly withdraws
  the cancellation.
- **F7.10a** Because cancellation arrives by email (F10.2), **the operator sets
  and clears a business's cancelled status from the operator dashboard** (F9.10).
  It is the single control that stops future charges.
- **F7.10b** **Reactivating inside the same billing period resumes it.** Nothing
  restarts and no new fixed fee is due for that period. Whatever is
  outstanding — a failed fixed fee, an unsettled usage bill, or both — is charged
  **on the day service is restored**, not deferred to settlement. That period's usage settles as normal on its last day, and includes
  everything served during the 7-day grace before suspension — service given is
  service billed.
- **F7.10c** **Returning after a period has closed starts a new billing period**,
  charged $100 on the day of return. The closed period stays settled on its own
  terms; there is no reaching back into it. Whether they keep their number and
  history depends only on whether their data still exists (F7.12e) — inside the
  dormant window they resume as themselves, after it they are a stranger.
- **F7.11** A failed charge starts a **7-day grace period**. Through it Ringly
  **keeps answering calls and keeps accruing usage**, and emails the business
  about the failure. If payment has not cleared by day 7, the account is
  **suspended** (F10.3).
- **F7.11a** **A business already behind on payment cannot cancel into free
  service.** If a cancellation arrives while a payment failure is unresolved, the
  business is treated as **non-paying**: the suspension clock keeps running
  (F10.3), no free window opens, and no usage is forgiven. Cancelling is not a
  route out of a debt.
- **F7.12** **Cancellation opens a short reconsideration window, then settles.**
  The window runs from the request until **whichever comes first: 7 days later,
  or the end of the current billing period**. During it:
  - **Service continues unchanged.** Calls answered, bookings taken, number
    untouched. A business that changes its mind finds everything as it was.
  - **Usage stops being billed.** Nothing accrued from the request onward is ever
    charged, though the service is still given. Ringly absorbs it.
  - **Reminder emails run through the window**, saying what happens, when, and
    what the business will and will not be charged.
- **F7.12a** **Revoking inside the window erases it, retroactively.** The period
  continues to its original end as though the request never happened — and the
  usage served during the window, which would have been free had they left,
  **becomes billable after all**. The free window is a concession for leaving,
  not a way to take a week of free service and stay.
- **F7.12b** **When the window closes, the period is settled early and service
  stops.** The business is charged the usage it accrued **up to the request**,
  clamped so the period total never exceeds $500 (F7.9a).

  **The $100 fixed fee is not refunded, in whole or in part.** It buys the
  period, and a business that leaves part-way through has still had the service
  it paid for — with free service on top for the length of the window. The
  earlier prorated-refund rule is withdrawn.

- **F7.12c** Settlement sends a **closing statement**: appointments booked in the
  final period, the usage charged, confirmation that the fixed fee is not
  refunded, and the date the account and its data will be deleted if they do not
  return.
- **F7.12f** **If the settlement charge fails, it is recorded and let go.** The
  amount is written to the departure record (F10.9) as owed. Ringly does not
  suspend, retry, or pursue a business whose service has already stopped —
  there is nothing left to withhold.
- **F7.12e** **The account then lies dormant for 60 days, fully recoverable.**
  Service has stopped, but **the phone number and every database record are
  retained**. A business that returns inside those 60 days resumes on **its own
  number with its own history** — customers, appointments and past figures all
  intact — on a **new billing period starting that day, with $100 charged that
  day**. Only after the 60 days is anything deleted, and a business returning
  after that is a wholly new account with a new number. Sixty days costs Ringly
  only the number rental, and far less than losing a business to a number it can
  no longer have.
- **F7.12d** The total charged for a period **never exceeds $500**, cancellation
  or not. Worked example: a business accrues $470 of usage in a period →
  `$100 + $470 = $570` → clamped to **$500**, so $400 of usage is charged and $70
  is absorbed by Ringly.
- **F7.13** The business dashboard shows current-period usage, amount accrued,
  the cap, and the next charge date.
- **F7.14** Every charge, refund, and failure is recorded immutably against the
  business for reconciliation.
- **F7.15** **The commercial terms are expected to change** once real usage is
  observed. The fixed fee, the cap, the per-unit rates, and **the definition of a
  billable call** must all be changeable without a schema migration or a
  redesign. What does **not** change: 30-day billing periods, the rule that data
  lives as long as the relationship and is purged 30 days after it ends (F10.8),
  and the two-phase shape of the lifecycle — a grace period, then suspension,
  then removal after a final warning (F10.3) — though the lengths of those phases
  may be tuned.
- **F7.16** A change to commercial terms **never rewrites history**. Each billing
  period is settled under the terms in force when it ran, so past invoices remain
  reproducible.

> **Architectural consequence.** Pricing is **policy data, not code**: rates, the
> cap, the fixed fee, and the set of outcomes that count as billable all live in
> a versioned `pricing_policy` record with an effective date, and each
> `billing_periods` row records which version it was settled under (EDD §2.9).
> Widening billing to all connected minutes — the expected next model — becomes a
> new policy row, not a deploy.

- **F7.17** A **chargeback is treated exactly as non-payment** (F10.3): the
  7-day grace and suspension, then full revocation at day 60, with reminder
  emails throughout so the business can resolve it and recover. **No special
  handling** — Ringly does not pause the deletion clock while a dispute is open,
  does not build a dispute workflow, and contests or concedes disputes by hand in
  the Stripe dashboard. A dispute running longer than 60 days therefore resolves
  after the business is gone; accepted, because they are rare and the alternative
  is machinery for an event that may never happen.
- **F7.18** **Sales tax is collected through Stripe Tax**, configured per US
  state. Tax is Stripe's calculation, not Ringly's; Ringly stores the resulting
  amounts for reconciliation only.
- **F7.19** **Deleting a business tears down its payment provider state, in
  order**: cancel the subscription → void any open invoices → detach the payment
  method → delete the customer. Only then are Ringly's own rows removed.
  Deleting Ringly's rows first destroys the identifier every one of those steps
  needs, leaving a saved card on file belonging to nobody.
- **F7.20** **The division of responsibility with the payment provider is
  explicit, and nothing is done twice.** Where both could act, exactly one does:

  | Function                                                                   | Owner                                     |
  | -------------------------------------------------------------------------- | ----------------------------------------- |
  | Tax calculation                                                            | **Stripe** — Ringly stores the amounts    |
  | Invoices, receipts, payment-succeeded email                                | **Stripe**, carrying Ringly branding      |
  | Retrying failed payments                                                   | **Stripe** — Ringly builds no retry loop  |
  | Every failure-path email (failed, reminders, suspension, deletion warning) | **Ringly**                                |
  | Proration and the $500 cap                                                 | **Ringly** computes, Stripe executes      |
  | Refunds                                                                    | **Ringly** computes, Stripe executes      |
  | End-of-dunning behaviour and teardown                                      | **Ringly** (F7.19)                        |
  | Billing thresholds                                                         | **Neither** — deliberately not configured |
  | Self-service cancellation portal                                           | **Disabled** (§1.9)                       |

- **F7.21** **The failure path is Ringly's because only Ringly knows the
  consequence.** Stripe's dunning email can say a card was declined; it cannot
  say service continues for seven days, that nothing has been deleted yet, or
  what exactly is destroyed in 48 hours — those are Ringly's timelines and
  Ringly's data. Stripe's own dunning and receipt-on-failure emails are therefore
  **switched off**, or a business receives two differently-worded messages from
  what appears to be one company.

### F7a — The billing model, end to end

_Normative summary. Where this and F7/F10 differ, the numbered requirements win._

**Activation.** A business signs up, gets a number, places up to 10 test calls,
and confirms on its dashboard that one worked. That confirmation activates the
number and starts period 1. A business that never confirms is removed entirely at
day 10.

**A period.** Thirty days from activation. **$100 on the first day.** Usage
accrues across the period on **productive calls only** — a booking, a reschedule
that booked, or a cancellation of a real appointment. Enquiries, wrong numbers
and dropped calls cost the business nothing, and who is calling never matters.
**Usage is settled on the last day**, seconds summed across the whole period and
rounded up to a minute once. The next period begins the following day with its
own $100 — so the two charges never share a date, and a failing card fails one at
a time.

**The cap.** $500 per period including the fixed fee. Usage past it is still
recorded, because Ringly needs its true cost, but the charge is clamped at
settlement. The business is told it has hit the cap and that the rest of the
period is on Ringly.

**Settlement happens at exactly three moments:** a period ending normally, a
cancellation window closing, or final removal for non-payment — where the
clamped figure becomes the debt on the departure record, uncollected.

**If payment fails.** One clock, started by whichever charge failed first.

| Day  |                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------- |
| 0–7  | Service continues and **this usage is billable**. Reminder emails.                                |
| 7    | Suspended. Calls stop. **Number and all data retained.**                                          |
| 7–60 | **Recoverable at any point** — Stripe retries, and paying what is owed restores service that day. |
| ~58  | 48-hour final warning.                                                                            |
| 60   | Number released, data deleted, debt recorded permanently. A later return is a new account.        |

**If the business cancels.** The window is **7 days or the end of the period,
whichever comes first**. Through it service continues untouched and usage stops
being billed.

- **Revoke inside the window** and the period runs to its original end — and the
  usage served during the window **becomes billable after all**. The concession
  was for leaving.
- **Let it close** and the period settles early: usage up to the request is
  charged, **the $100 is not refunded**, service stops, and a closing statement
  goes out. There is **no refund on this path at all** — the fee is never
  returned and usage is only ever charged in arrears.
- **Then 60 days dormant.** Number and every record retained. Come back inside it
  and you resume on your own number with your own history, on a new period
  charged $100 that day. After it, everything is deleted and a return is a
  stranger.

**A business already behind on payment cannot cancel into free service** — it is
treated as non-paying, and the suspension clock keeps running. **If a departing
business's settlement charge fails**, it is recorded as owed and let go; there is
nothing left to withhold.

**Chargebacks** follow the non-payment path exactly.

**Who does what.**

| Stripe                                      | Ringly                                         |
| ------------------------------------------- | ---------------------------------------------- |
| Tax calculation                             | The whole failure path, every email in it      |
| Invoices, receipts, payment-succeeded email | The cap, and clamping at settlement            |
| Retrying failed payments                    | Deciding when service stops and when data goes |
| Executing charges                           | Teardown at deletion                           |

Billing thresholds: neither. Customer portal: disabled. **Teardown order:** capture
lifetime revenue → cancel subscription → void open invoices → detach card →
delete the Stripe customer → delete Ringly's rows → write the departure record.

### F8 — Email

- **F8.1** Business email goes to the contact address collected at onboarding
  (F1.11). Operator email goes to Ringly's own alert address.
- **F8.2** **Every email Ringly can send is declared in one place** —
  `src/emails/registry.ts`. If a message is not in that table it is not sent.
  The table fixes, per email: audience, sending identity, subject line,
  transactional status, and how its idempotency key is built.
- **F8.3** **Templates are React Email components versioned in this repository**
  (`src/emails/`). They are reviewed in pull requests like any other code, so a
  change to what a customer reads goes through the same scrutiny as a change to
  what the code does. No hosted template editor, no copy living in a vendor UI.
- **F8.3a** **Ringly does not send the success path.** Receipts, invoices and
  payment-succeeded notices are **Stripe's**, carrying Ringly branding (F7.20).
  Ringly sends no email that Stripe already sends well — the split is by who
  knows the consequence, not by who could technically send it (F7.21).
- **F8.4** **Transactional email cannot be unsubscribed from.** A business
  cannot opt out of being told its payment failed or its data is about to be
  deleted. **Only the periodic stats digest is optional.**
- **F8.5** Sending is **idempotent**: the key is written before the send, so a
  retried worker can never send twice. Three key shapes, chosen per email:
  - **per period** — at most once per business per billing period (receipts,
    digests, cap notice);
  - **per incident** — at most once per continuous failure, however many calls
    it affects (calendar outage). An outage must never produce one email per
    lost customer;
  - **per event** — once per discrete occurrence (a shifted appointment, a
    deletion warning).

**Format defaults — every email**

- **F8.6** Plain and utilitarian. No images, no web fonts, no columns, no
  marketing voice. These are messages about money and service interruptions;
  they should read like a utility bill and survive Gmail clipping and Outlook.
- **F8.7** Structure is fixed: wordmark, one heading stating the situation, body
  copy in plain language, a facts table for any figures, **at most one call to
  action**, then the footer.
- **F8.8** Every email states **what has happened, what it means for the reader,
  and what happens next if they do nothing**. An email that leaves the reader
  unsure whether they must act has failed.
- **F8.9** Amounts always carry currency; dates are always absolute ("14 August"),
  never relative ("in 3 days"), because delivery may be delayed.
- **F8.10** Subject lines are under ~60 characters, state the situation rather
  than tease it, and never use urgency the body does not justify.
- **F8.11** **Separate sending identities per stream** — billing, service,
  reports, operator alerts — so a digest nobody opens can never harm the
  reputation of the address that tells someone their payment failed.

**Business-facing email — the full set**

| Email                   | When                                  | Tone default                                                     |
| ----------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| Activation receipt      | First fixed fee charged (F7.1)        | Welcoming; confirms what was charged and what is free            |
| Upcoming charge         | Before each period's fixed fee        | Neutral; no action needed                                        |
| Payment succeeded       | Invoice settled                       | Neutral; itemised                                                |
| Payment failed          | First decline (F7.11)                 | Calm, **leads with "your service is still running"**             |
| Payment reminder        | Through the grace period              | Firmer, counts down to the date service stops                    |
| Suspension notice       | Day 7 (F10.3)                         | Direct, **leads with "nothing has been deleted"**                |
| Deletion warning        | 48 hours before deletion (F10.3a)     | Unambiguous; itemises exactly what is destroyed                  |
| Cap reached             | $500 reached (F7.9b)                  | **Good news** — they earned it, the rest is on Ringly            |
| Cancellation confirmed  | Operator marks cancelled (F7.10a)     | Matter-of-fact; states refund, final charge, deletion date       |
| Calendar access failing | Bookings being refused (F2.7)         | Urgent, explains _why_ refusing beats double-booking             |
| Recurring change        | Occurrence shifted or skipped (F5.2b) | Informational; **states plainly that the customer was not told** |
| Test calls exhausted    | Activation stuck (F1.13)              | Reassuring; not their fault, not charged, Ringly is on it        |
| Stats digest            | Each billing period (F8.3)            | Light; the only unsubscribable email                             |

**Operator-facing email**

- **F8.12** Operator alerts are a different product from business email: read on
  a phone, at an inconvenient moment. Each **leads with the business name and
  the money at stake**, and says what happens if it is ignored. No reassurance,
  no marketing voice.
- **F8.13** The set: business hit its cap (with cost-to-serve and margin, so an
  unprofitable tenant is visible immediately), payment failed, calendar
  unreachable, activation stuck, business deleted.
- **F8.14** These move to Slack later (F9.6). The format carries the same
  information either way, so the move is a transport change rather than a
  rewrite.

### F9 — Operator dashboard (Ringly-internal)

- **F9.1** Visible **only to the operator**. No business owner may reach it by
  any route, with any credential. This is the single screen that reads across all
  tenants and is therefore treated as a walled garden (EDD §2.11, N1.1).
- **F9.2** Per business, per period: **net revenue** (charges received, less
  payment-processor fees), **cost incurred**, and the margin between them.
- **F9.3** Payment reliability per business — paid on time, late, failed,
  currently past due — so irregular payers are visible at a glance.
- **F9.4** Platform totals: revenue, cost, and margin across all businesses.
- **F9.5** **Cost model (v1): Retell only.** Retell is the sole recurring cost
  attributed per business, covering the telephony number rental and all per-call
  charges including LLM. Deliberately excluded: Supabase and Vercel (fixed
  platform overhead, immaterial per tenant) and Google Places (one-off at
  onboarding, considered covered by the first $100). **WhatsApp messaging cost is
  added to this model when WhatsApp ships.**
- **F9.6** **Operator alerts**: a business reaching its cap (F7.9b), and payment
  failures. Delivered by **email** initially. _TBD: move operator alerting to
  Slack; pending implementation._
- **F9.7** Refreshed **daily**, and available at all times. The current period is
  computed live; history is served from pre-aggregated data.
- **F9.8** Figures are reported **by calendar month** (June, July, August), not by
  each business's 30-day period. No two businesses share a period, so per-period
  reporting cannot be summed into anything meaningful for accounting. Only
  **money actually received into Stripe** counts as revenue, and only **real
  incurred cost** counts as cost — neither is accrued or projected.
- **F9.13** The operator can **pause the 10-day unactivated clock** on an
  individual business (F10.1b), and see which businesses are paused and since
  when. A pause is an explicit act with a visible owner, never a side-effect.
- **F9.10** The operator **sets and clears a business's cancelled status** here
  (F7.10a), since cancellation arrives by email. It is the control that stops
  future charges, and the only place it exists.
- **F9.11** Shows the same **outcome definitions** the business sees (F6.5), so
  both sides of a conversation about the numbers are reading the same
  definitions.
- **F9.12** Surfaces businesses needing attention: calendar access failing
  (F2.7), test calls exhausted without confirmation (F1.13), payment failing, at
  cap, and approaching final deletion.
- **F9.9** Shows **rented phone numbers that are not earning**: numbers held for
  businesses that never activated, are suspended, or are otherwise not paying the
  $100 minimum. Every such number is a standing cost with no revenue against it.

### F10 — Account lifecycle, suspension and data retention

- **F10.1** A business that **never activates** is removed entirely after **10
  days** — its rented number is released and all information about it is deleted.
  It may place at most **10 test calls** before activating. Both limits exist
  because an unactivated business is pure cost: a rented number and live call
  minutes against no revenue, with no relationship to protect.
- **F10.1b** **The operator can pause the 10-day clock on any individual
  business**, from the operator dashboard (F9.13). A business whose test calls
  all failed (F1.13) is waiting on Ringly, not the other way round, and would
  otherwise be deleted while the problem is being investigated. **Silence is not
  a pause:** absent an explicit operator action the default stands and an
  unactivated business is removed at day 10.
- **F10.1a** **A consumer has no direct route to Ringly.** A caller wanting
  their data removed asks the business, which asks Ringly (F10.2). Ringly has no
  relationship with the caller and offers them no interface. Not a priority, and
  no mechanism exists in v3 for a business to delete a single customer.
- **F10.2** **Cancellation is not self-serve in v3.** All business-initiated
  account actions — cancellation, deletion, reactivation — go through Ringly's
  **official contact email address**, which is the single supported channel.
  _(Self-serve cancellation is deferred to soon after v3 — §1.9.)_
- **F10.3** The two paths differ sharply. **Non-payment withdraws service after
  a week. Cancellation never withdraws it at all** — it runs out the period the
  business already paid for.

  **On payment failure** — the clock starts the day the _first_ charge fails,
  whether that was a fixed fee or a usage settlement:

  | Day  | What happens                                                                                                                                    |
  | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
  | 0    | Charge fails. Service continues, usage keeps accruing, business emailed.                                                                        |
  | 0–7  | **Grace period.** Calls answered as normal. Reminder emails sent. This usage **is billable** — service given is service billed.                 |
  | 7    | **Suspended.** Calls stop being answered; **the number and all data are retained.**                                                             |
  | 7–60 | Suspended but **fully recoverable at any point**: Stripe keeps retrying, and paying the outstanding charges restores service that day (F7.10b). |
  | ~58  | **48-hour final warning by email**, itemising exactly what will be deleted.                                                                     |
  | 60   | **Full stop.** Number released, Ringly-held data deleted, amount owed recorded permanently (F10.9).                                             |

  Days 7–60 cost Ringly almost nothing — service has already stopped, and only
  the number rental continues — so the window is long, because the business's
  number is worth far more to them than the rental is to Ringly.

  **On a cancellation request** — a short window, then dormancy:

  | Point               | What happens                                                                                                                                   |
  | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
  | Request             | Operator marks it cancelled (F7.10a). **Service continues. Usage stops being billed. Nothing settled** (F7.12).                                |
  | Until window closes | Reconsideration window — **7 days, or period end, whichever is sooner**. Service runs free. Reminder emails explain what is coming.            |
  | Any time inside it  | Revoking erases the request; the period continues to its original end and billing resumes (F7.12a).                                            |
  | **Window closes**   | Period settled early. Usage to the request date charged; **no refund of the fixed fee**. Service stops. **Closing statement sent** (F7.12b–c). |
  | + 0 to 60 days      | **Dormant.** Number and all data retained. Returning resumes the same number and history on a new period (F7.12e).                             |
  | + 58 days           | **48-hour final warning** before deletion.                                                                                                     |
  | + 60 days           | Number released, Ringly-held data deleted (F10.8). A later return is a wholly new account.                                                     |

- **F10.3a** **Nothing is ever deleted without a 48-hour warning email first.**
  This applies to both paths and is not conditional on the business having read
  earlier emails.
- **F10.3b** A business that has asked to cancel is **not** retried for payment
  (F7.10); the retry loop applies only to the non-payment path.
- **F10.4** A business's telephone number is its public identity, printed on
  signage and listings, and losing it is not recoverable. **How long it is held
  after service ends depends on why service ended:**
  - **Never activated** — removed at **day 10** (F10.1). No relationship to
    protect.
  - **Non-payment or chargeback** — held to **day 60** (F10.3), recoverable
    throughout by paying what is owed. Holding it costs Ringly only the rental;
    releasing it early costs the business its identity.
  - **The business's own cancellation** — held a further **60 days** after
    service stops (F7.12e), fully recoverable, because a business that left in
    good standing may come back and should find itself intact.
- **F10.5** **Ringly issues no deletion call to the telephony provider.**
  Transcripts and recordings expire on their own **30-day TTL** (F10.6), which is
  never longer than the window before a business is deleted, so provider-held
  content is gone long before then without Ringly doing anything. Deletion covers
  Ringly's own database only.
- **F10.6** **Ringly stores neither transcripts nor recordings.** Both remain
  with the telephony provider and are fetched on demand when needed. Retention is
  configured **on every provisioned agent**, never inherited from a default:
  - **Recordings: 30 days.** Deliberately generous for now so early calls can be
    reviewed while the product is being proven; to be reduced once recordings are
    shown to behave.
  - **Transcripts: at least 30 days**, and never shorter than recordings.
- **F10.7** Because transcript and recording retention live with the provider,
  **call content older than 30 days is not retrievable** — by the business or by
  Ringly. Any requirement that depends on older call content must be read against
  this limit.
- **F10.8** **Retention of Ringly's own data: everything lives as long as the
  business does.** Ringly does not age out any table while a business is active.
  Call records, customers, appointments, usage, costs and money records are all
  needed by the business dashboard, the operator dashboard, and invoice
  reconciliation — all of which look back over months, not days.
  - The **only** thing on a 30-day clock is what Ringly does **not** store:
    transcripts and recordings, held by the telephony provider (F10.6).
  - Everything Ringly holds is destroyed when the relationship is over, on the
    clock the ending sets (F10.3, F10.4): **day 60** for non-payment, **60 days
    after service stops** for a business that cancelled, **day 10** for one that
    never activated.
  - There is no partial or rolling deletion, and no field-level expiry.
- **F10.9** **A departed business leaves a permanent financial record.** When a
  business is deleted, Ringly retains, indefinitely and outside the purge:
  - the business's **id and name**;
  - the **date it joined and the date it left**, and how it ended;
  - the **amount it still owed** at departure;
  - the **lifetime net revenue** Ringly earned from it, **after payment-processor
    fees**.

  This record contains **business identity and money only — never consumer data**.
  No caller names, no phone numbers, no appointments. It exists so Ringly can
  answer "what did this customer earn us, and what did they leave owing" years
  later, and must not become a way for customer records to survive deletion.

- **F10.10** **The financial record is captured before teardown begins.** Net
  revenue is derived from payment-processor records that the teardown deletes, so
  the order is fixed: **capture the totals → tear down the payment provider
  (F7.19) → delete Ringly's rows → write the record.** Reversing any of these
  loses the number permanently.

---

## 1.6 Non-functional requirements

### N1 — Multi-tenancy and isolation

- **N1.1** Every row of business data belongs to exactly one business, and no
  query path can return another business's rows. Isolation is enforced by the
  database, not only by application code.
- **N1.2** Server-side code paths that bypass row-level security (webhook
  handlers using a service role) must scope every query by business explicitly,
  and that scoping must be covered by tests.
- **N1.3** A tenant's data is **deleted** completely when the relationship ends
  (F10.8). **Ringly offers no export**, deliberately: every appointment already
  lives in the business's own calendar, which they keep; transcripts and
  recordings were never Ringly's to give; and everything else is Ringly's
  operational record of a relationship that has ended. There is nothing a
  business would receive that it does not already hold.

### N2 — Scale

- **N2.1** Target: **10,000 businesses**, each with up to **10,000 customers** and
  a comparable number of historical appointments and calls — order 10⁸ rows in
  the largest tables.
- **N2.2** No feature may degrade as a function of _total_ platform size; only of
  the requesting tenant's own size.
- **N2.3** Scheduled background work — recurrence materialisation, analytics
  rollups, billing settlement — must sustain the resulting steady-state volume
  with bounded lag.

### N3 — Latency on the call path

Caller-perceived silence is the metric that matters. Budget per agent turn that
involves a backend call:

| Segment                                    | Target p95 |
| ------------------------------------------ | ---------- |
| Ringly webhook handler, end to end         | ≤ 400 ms   |
| — of which our own datastore               | ≤ 80 ms    |
| — of which external scheduling provider    | ≤ 250 ms   |
| Hard ceiling before we abandon and degrade | 1500 ms    |
| Caller-perceived silence (filler covers)   | ≈ 0        |

- **N3.1** Any backend operation on the call path has a hard timeout and a
  defined outcome on expiry. **Slow is treated as failed** — and for the
  scheduling provider, failed means the booking is refused (F2.7), not that it
  proceeds unverified. The earlier "abandon and degrade" wording is superseded:
  there is nothing to degrade to when the answer would be a booking we cannot
  stand behind.
- **N3.2** Work not needed to answer the caller is done after responding, never
  before.

### N4 — Serving cost

- **N4.1** Per-business fixed monthly infrastructure cost (excluding telephony
  and LLM minutes, which are usage-driven) is the metric to minimise; it must not
  grow faster than linearly with tenants.
- **N4.2** Repeated reads of slow-changing configuration on the call path must
  not hit paid third-party APIs or the primary database every time.
- **N4.3** Dashboard analytics must be served from pre-aggregated data, not from
  scanning raw call history per request.
- **N4.4** Paid third-party calls (Places, LLM, telephony) are attributable per
  business so unit economics are measurable.

### N5 — Timezone correctness

- **N5.1** Every instant is stored in UTC and rendered in the business's IANA
  timezone.
- **N5.2** All day, week, and month boundaries — for availability, analytics
  grouping, and billing periods — are computed in the business's timezone, not
  the server's and not UTC.
- **N5.3** Behaviour is correct across DST transitions, including the duplicated
  and skipped local hours.

### N6 — Security and compliance

- **N6.1** Provider refresh tokens are encrypted at rest.
- **N6.2** Card data never touches Ringly infrastructure (F7.3), keeping us out
  of PCI-DSS scope beyond SAQ-A.
- **N6.3** All inbound webhooks verify provider signatures before acting.
- **N6.4** Customer PII (name, phone) is per-tenant and deletable (N1.3).

### N7 — Third-party dependencies and degradation

Ringly is assembled from services it does not control. Pretending otherwise
produced the wrong behaviour once already (R1), so the dependencies and their
failure modes are stated explicitly.

| Dependency                                         | Used for                    | If it is down                                                                                   |
| -------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| **Retell**                                         | Telephony, STT, LLM, TTS    | **Total outage.** No call is answered. Nothing Ringly can do; not survivable by design.         |
| **Supabase**                                       | All tenant data             | **Total outage.** The agent cannot resolve the business or its catalogue. Not survivable.       |
| **Vercel**                                         | The application itself      | **Total outage.**                                                                               |
| **Google Calendar** (or other scheduling provider) | Verifying a slot is free    | **Booking fails audibly** (F2.7). The caller is told; nothing is written. Enquiries still work. |
| **Stripe**                                         | Charging, refunds, tax      | Calls continue. Charges queue and settle later; usage accrues locally regardless (§2.9).        |
| **Resend**                                         | Business and operator email | Calls continue. Email retries; nothing is lost, delivery is delayed.                            |
| **Google Places**                                  | Onboarding enrichment       | New onboarding degrades to manual entry. Existing businesses unaffected.                        |

- **N7.1** A failure in a **non-critical** dependency (Stripe, Resend, Places)
  must never prevent an existing business from answering calls. Retell, Supabase
  and Vercel are **critical** — their loss is a Ringly outage, and no design
  mitigates it.
- **N7.2** **Scheduling-provider failure is fail-closed, not fail-open.** Ringly
  will not book a time it could not verify. The caller hears an error and no row
  is written.
- **N7.3** Every degraded path is logged, surfaced to the business, and alerted
  to the operator. **Silent degradation is a defect** — see R1, which is exactly
  this bug in the shipped code.

## 1.7 Success metrics

| Metric                                | Target                 |
| ------------------------------------- | ---------------------- |
| Time-to-live (land → Go Live)         | p50 < 3 min            |
| Activation rate (live → paid)         | > 60%                  |
| Caller-perceived silence per turn     | p95 ≈ 0, no gap > 1.5s |
| Booking conflicts reaching a customer | 0                      |
| Recurrence materialisation lag        | p99 ≤ 1 h              |
| Dashboard load                        | p95 ≤ 500 ms           |
| Monthly infra cost per business       | tracked, trending down |

## 1.8 Decisions and open questions

**Settled 2026-07-30:** pricing shape (F7), cap behaviour (F7.9a/F7.12d), minute rounding (F7.7a), grace and suspension timeline (F10.3), email
provider Resend, 90-day recurrence horizon, occurrence-clash handling (F5.2a),
price at occurrence time and duration locked (F3.4), Ringly storing neither
transcripts nor recordings (F10.6), retention for the life of the relationship
(F10.8), the departure record (F10.9), the Stripe division of responsibility
(F7.20–F7.21), operator cost model and calendar-month reporting (F9.5, F9.8),
dropped-call definition (F6.3), calendar-provider switching out of scope (R9).

**Still open:**

- **Q1 — The per-connected-minute rate (Phase 5).** TBD; held as configuration
  (F7.8), so Phase 5 can be built and tested with a placeholder but cannot be
  switched on for real customers until set. The per-reminder rate is assumed
  $0.05.
- **Q2 — Resolved.** Any caller, but only productive outcomes. F7.6 and F7.7
  now state this directly: who is calling is irrelevant, the outcome is the only
  test.
- **Q3 — Ringly's cancellation email address** (F10.2). Needed for the dashboard
  and the transactional emails.
- **Q4 — Resolved.** Reminders leave v3 entirely (§1.9).
- **Q5 — Resolved.** Every email is declared and templated (F8.2, F8.3), and the
  division with Stripe settles which of them Ringly sends at all (F7.20, F8.3a).

---

## 1.9 Deferred

Two buckets, distinguished by intent rather than by a version number. "v1", "v2"
and "v3" refer only to **documents**; product scope is either _in v3_ or in one of
the buckets below.

### Soon after v3

- **Self-serve cancellation.** Replaces the email-based flow in F10.2. Recorded
  now because it raises questions that should be answered before it is built:
  - Does cancelling take effect immediately, or at period end?
  - Is the refund automatic, or does it require review?
  - What stops a business cycling — cancel, re-activate, and reset the $500 cap
    (F7.9) — which is only safe today because a human sees every cancellation?
  - Does the business get an export of their data before day-30 deletion?
  - Can a suspended business self-serve reactivate, or does that stay manual?
- **Operator alerting via Slack**, replacing email (F9.6).
- **Stripe's own customer portal as the cancellation route.** It would give
  businesses self-service cancellation and payment-method updates without Ringly
  building either. Deliberately **disabled in v3** because it would bypass the
  email-only flow (F10.2) and let a business cancel without the operator seeing
  it — which is currently the only thing preventing cap-cycling (F7.9).

### Later — no near-term plan

- **Reminders, and the channels that deliver them.** Not scheduled. **All
  existing reminder code, tables and policies are to be deleted**, not left
  dormant — dead scaffolding rots and misleads. When reminders return they return
  as a fresh design. Deferred with them:
  - customer notification when a recurring occurrence is shifted or skipped
    (F5.2c);
  - reminder metering, whose unit is already carried in the pricing policy (F7.8)
    so its return needs no migration;
  - the delivery guarantees the earlier draft specified (at-most-once,
    restart-safe, cancelled when an appointment moves).

# Part 2 — Engineering Design (EDD)

_Rewritten 2026-07-30 against the locked Part 1. Supersedes the earlier design,
which predated fail-closed booking, the removal of reminders, versioned pricing
policy, and the division of responsibility with Stripe._

## 2.1 The four properties that shape everything

Most of this design falls out of four requirements. Where a decision looks
over-engineered, one of these is usually why.

1. **A booking Ringly cannot verify is never written** (F2.7, N7.2). This is the
   opposite of the usual "degrade gracefully" instinct and it propagates: the
   provider interface cannot return a bare list, the call path cannot answer
   before the check completes, and "no busy intervals" must be a different value
   from "I could not find out".
2. **One tenant's data must never reach another** (N1.1), while the code paths
   that matter most — the Retell webhooks — run under a service role that
   bypasses row-level security entirely. Isolation therefore cannot rest on RLS
   alone.
3. **The caller is on the phone** (N3). Every decision on the call path is
   bounded by a hard timeout, and anything not needed to answer them happens
   after the response.
4. **The commercial terms will change** (F7.15) without rewriting history
   (F7.16). Pricing is data with versions, not constants in code, and every
   settled period remembers which version settled it.

## 2.2 Architecture

```mermaid
flowchart TB
    Caller([Caller]) -->|PSTN| Retell[Retell agent]
    Retell -->|signed webhook| Fn[/api/webhooks/retell/functions/]
    Retell -->|signed webhook| Post[/api/webhooks/retell/post-call/]

    subgraph Hot["Call path — hard latency budget, fail-closed"]
        Fn --> Cache[(Tenant config cache)]
        Fn --> DB[(Postgres · RLS per tenant)]
        Fn --> Sched{{SchedulingProvider}}
    end

    Sched --> GCal[Google Calendar]
    Sched -.later.-> MS[Microsoft 365 · CalDAV]

    Post --> DB
    Post --> Cost[cost_records]
    Post --> Usage[usage_records]

    subgraph Cold["Workers — may be slow, must be idempotent"]
        W1[Recurrence materialiser]
        W2[Analytics rollup]
        W3[Billing settlement]
        W4[Lifecycle sweeper]
        W5[Email dispatcher]
    end
    DB --> Cold

    W3 --> Stripe[Stripe]
    Stripe -->|signed webhook| Hook[/api/webhooks/stripe/]
    Hook --> DB
    W5 --> Resend[Resend]

    Owner([Business owner]) --> Dash[/dashboard/]
    Op([Operator]) --> Ops[/ops/ — walled garden]
    Dash --> Roll[(daily_business_stats)]
    Ops --> Econ[(daily_business_economics)]
```

**The split that matters:** the call path touches a cache, one database, and one
external calendar, each under a hard timeout. Everything else — settlement,
rollups, recurrence, lifecycle, email — runs on scheduled workers where slowness
is survivable and idempotency is mandatory.

## 2.3 Multi-tenancy

**Shared schema, shared database, row-level isolation.** Rejected:
database-per-tenant (10,000 databases makes fixed cost scale with tenants,
violating N4.1) and schema-per-tenant (migration cost scales with tenants).

### 2.3.1 Two isolation mechanisms, because one is not enough

**RLS** covers everything reached with the user's own credentials — the
dashboard, the settings pages. Policies stay as today: `owner_user_id =
auth.uid()` on `businesses`, and membership via a `security definer stable`
helper elsewhere so the planner evaluates it once per statement rather than once
per row.

**RLS does not cover the webhooks**, which is where nearly all writes happen.
Retell posts to us; we resolve the tenant from the dialled number and then use a
service-role client that bypasses RLS by design. That is the real exposure
(N1.2), and the mitigation is structural:

```ts
// The only way webhook code is allowed to reach the database.
function tenantScoped(db: ServiceClient, businessId: string): TenantDb;
```

`TenantDb` exposes the same query surface with `business_id` already bound. A
webhook handler cannot express a cross-tenant query because it never holds the
unscoped client. Lint forbids importing `createServiceClient` outside
`lib/db/tenant.ts` and `lib/ops/`.

**Tests are part of the mechanism, not a check on it** (N1.2): every webhook
function is exercised with two seeded businesses, asserting that a call arriving
for one can neither read nor write the other's rows.

### 2.3.2 Physical layout

`business_id` leads every composite index, so a tenant's working set is
contiguous and query cost tracks the tenant rather than the platform (N2.2).
`calls` and `appointments` are the tables that grow without bound — at the N2.1
target, order 24M `calls` rows a year — and their primary keys are chosen now so
monthly range partitioning stays available without a rewrite. Partitioning is
deferred until measured.

## 2.4 Data model

Migrations are forward-only and immutable. Numbering continues from `004`.

### 005 — foundations

Everything Phase 1 needs; nothing that depends on a later decision.

- **`btree_gist`**, then replace the `(business_id, starts_at)` unique index with
  a range exclusion constraint, so overlapping active appointments are impossible
  at the database rather than merely unlikely:

  ```sql
  alter table appointments add constraint appointments_no_overlap
    exclude using gist (
      business_id with =,
      tstzrange(starts_at, ends_at, '[)') with &&
    ) where (status in ('booked','rescheduled'));
  ```

  This closes the check-then-write race that the application check alone cannot
  (two callers, same slot, same instant). **It also means the materialiser and
  the booking path must handle a rejected insert as a real outcome** (F2.3a,
  F5.2a), not an unexpected error.

- **Drop what v3 removed:** the `reminders` table and its policy;
  `customers.whatsapp_consent_status`, `whatsapp_consent_at`,
  `whatsapp_consent_call_id`; `businesses.whatsapp_number`,
  `whatsapp_sender_status`, `onboarding_step`; `no_show` from the appointment
  status check; `clinic` from the `business_type` check.
- **`calls` gains** `started_at`, `ended_at`, `duration_seconds`, `end_reason`,
  `outcome` widened to include `dropped`, and `is_billable boolean not null
default false`. No `transcript` and no `recording_url` — Ringly stores neither
  (F10.6), and a stored recording URL would rot because Retell's are signed.
- **Composite indexes** leading with `business_id` on `appointments`, `calls`,
  `customers`.
- **`tenant_id_of(uuid)`** — the `security definer stable` RLS helper.

### 006 — service versioning (F3.4)

```
service_versions(id, service_id, business_id, name, price_cents,
                 duration_minutes, effective_from, effective_to)
appointments.duration_minutes          -- locked at booking/materialisation
```

Price is **not** stored on the appointment: F3.4 resolves it at occurrence time,
so it is looked up from `service_versions` for the date in question, falling back
to the last known version if the service was deleted. Duration **is** stored,
because a duration that moved would silently overlap neighbouring bookings.

### 007 — scheduling credentials (F4)

```
businesses.scheduling_provider text not null default 'google'
businesses.external_calendar_id text
appointments.external_event_id text
scheduling_credentials(business_id pk, provider, encrypted_payload,
                       status, last_ok_at, last_error_at, last_error)
```

Generalises `google_calendar_id`, `google_calendar_event_id` and
`google_refresh_token`. There is **no `none` provider** — a calendar is mandatory
(F4.1).

### 008 — recurrence (F5)

```
appointment_series(id, business_id, customer_id, service_id, rrule, timezone,
                   dtstart, until, status)
appointments.series_id, appointments.occurrence_date
unique (series_id, occurrence_date)
```

The unique key is what makes materialisation idempotent. Occurrences are ordinary
appointment rows, so conflict checking, calendar sync and analytics work on them
unchanged.

### 009 — analytics (F6)

```
daily_business_stats(business_id, local_date, calls, unique_caller_hashes,
                     duration_seconds_total, duration_seconds_p50,
                     booked, rescheduled, cancelled, enquiry_only, dropped,
                     appointments_booked, revenue_booked_cents,
                     primary key (business_id, local_date))
```

`local_date` is computed in the **business's** timezone (N5.2, F6.11).
`unique_caller_hashes` stores the distinct set as hashes rather than a count, so
a _monthly_ unique-caller figure can be computed correctly from daily rows
instead of double-counting anyone who rang on two days.

### 010 — billing (F7)

```
pricing_policy(id, version unique, effective_from,
               fixed_fee_cents, cap_cents, per_minute_cents,
               per_reminder_cents, billable_outcomes text[])

billing_periods(id, business_id, seq, starts_at, ends_at, timezone,
                pricing_policy_id, status, fixed_fee_charged_at,
                usage_settled_at, cancellation_requested_at,
                free_from, unique (business_id, seq))

usage_records(id, business_id, billing_period_id, call_id, occurred_at,
              kind, quantity_seconds, unit_cents, amount_cents)

billing_events(id, business_id, stripe_event_id unique, kind,
               amount_cents, fee_cents, occurred_at, payload)

cost_records(id, business_id, call_id, occurred_at, source, kind, amount_cents)

businesses.contact_email, stripe_customer_id, stripe_subscription_id,
          billing_status, activated_at, booking_horizon_days,
          materialisation_horizon_days
```

Three deliberate choices:

- **`billing_periods` rows are authoritative**, not arithmetic over
  `activated_at`. Cancellation, suspension and reactivation all break
  `activated_at + n × 30 days`, and a settled period must be immutable for
  reconciliation (F7.16).
- **`pricing_policy_id` is pinned per period**, so changing the fee or the cap
  cannot retroactively alter a closed invoice (F7.16). `billable_outcomes` holds
  the F7.6 predicate as data, so widening billing to every connected minute is a
  new policy row rather than a deploy (F7.15).
- **`usage_records.quantity_seconds`** — seconds, not minutes. The round-up to
  whole minutes happens once at settlement (F7.7a), never per row.

### 011 — lifecycle and operator (F9, F10)

```
lifecycle_deadlines(business_id pk, kind, due_at, paused_at, paused_by, reason)
departed_businesses(business_id pk, name, joined_at, left_at, ended_by,
                    owed_at_departure_cents, lifetime_net_revenue_cents)
calendar_incidents(id, business_id, opened_at, closed_at, last_error,
                   notified_at)
email_log(id, business_id, kind, idempotency_key unique, sent_at, status)
daily_business_economics(business_id, local_date, revenue_net_cents,
                         cost_cents, calls, billable_calls,
                         primary key (business_id, local_date))
```

**`lifecycle_deadlines` exists because the operator can pause a clock** (F10.1b).
A deadline computed on the fly from `created_at + 10 days` cannot be paused; a
stored `due_at` with a nullable `paused_at` can. Every lifecycle transition in
§2.10 reads from this table.

`departed_businesses` and `daily_business_economics` carry **no consumer data**
and no RLS policy — they are reachable only through the ops module (§2.11).

## 2.5 The call path

### 2.5.1 Budget

| Segment                              | p95     |
| ------------------------------------ | ------- |
| Webhook handler, end to end          | ≤ 400ms |
| — tenant config (cache hit)          | ≤ 5ms   |
| — own appointments (Postgres)        | ≤ 80ms  |
| — scheduling provider                | ≤ 250ms |
| Hard ceiling, after which we give up | 1500ms  |

Retell's own budget is ~600ms, so a 400ms handler keeps a turn near one second.
`speak_during_execution` covers the gap audibly (F2.6), with per-tool filler
phrasing — "let me check the diary for you" — rather than one generic line.

### 2.5.2 Booking, in order

```
1  verify signature (Retell SDK)                      — reject unsigned
2  resolve tenant config from cache by dialled number — 1 read, not 3 queries
3  validate: parseable time · inside opening hours (F2.8)
           · within booking_horizon_days (F2.9)
4  ┌ own appointments overlapping the window  ┐ in parallel, both under budget
   └ provider busy intervals (§2.6)           ┘
5  if provider check did NOT succeed → refuse, apologise, open incident  (F2.7)
6  if conflicting → refuse, offer nearest open slots either side         (F2.3)
7  INSERT — exclusion constraint may still reject (race)                 (F2.3a)
8  respond to the caller
── after the response ──────────────────────────────────────────────────
9  create the calendar event, store external_event_id
10 (post-call webhook) outcome, duration, is_billable, usage, cost
```

Steps 1–8 are the budget. Steps 9–10 are not (N3.2). The **conflict read cannot
move after the response** — that is the whole point of fail-closed — but the
calendar _write_ can and does.

### 2.5.3 Fail-closed, concretely

The shipped code returns `[]` for both "nothing is busy" and "I could not find
out", which is exactly the R1 defect. The interface returns a result:

```ts
type BusyLookup =
  | { ok: true; intervals: BusyInterval[] }
  | { ok: false; reason: "unreachable" | "timed_out" | "unauthorised" };
```

The booking path refuses on `ok: false` — no row written, quiet apology to the
caller (F2.7). An `unauthorised` result additionally marks
`scheduling_credentials.status`, which is what surfaces "reconnect your calendar"
on the dashboard.

### 2.5.4 Incidents, so an outage sends one email

A calendar outage fails every call while it lasts. Emailing per failure would
send a business dozens of identical messages during the worst hour of its week.
`calendar_incidents` is opened on the first failure and closed on the first
success; the email is sent once, when the incident opens (F2.7). The dashboard
banner is a function of "is an incident open", so it clears itself.

### 2.5.5 Tenant config cache

A read-through cache keyed by **dialled number**, holding the slow-changing
tenant configuration: business, timezone, opening hours, active services with
current prices and durations, provider, horizons, billing status.

- **TTL 60s**, and **explicitly invalidated on write** by the settings, hours and
  services endpoints — so an edit reaches the next caller immediately in the
  normal case and within 60s if invalidation is missed (F3.2).
- **Configuration only.** Never appointments, never busy intervals. A stale
  conflict check books someone over a real appointment; a stale price is a
  rounding error.
- One mechanism serving three requirements: propagation (F3.2), latency (N3),
  and not re-reading the same rows on every call (N4.2).

### 2.5.6 Identifying an existing appointment (F2.4)

Reschedule and cancel search **appointments**, not customers: name plus date plus
time plus service, all matching. Caller ID is not used — customers ring from
other phones. A relative day resolves to the **next** such day, and the agent
reads the full date back before acting. For an occurrence of a series the agent
asks explicitly whether the caller means this one or all of them.

This is weaker than caller-ID matching and knowingly so (R12): the tuple is
narrow enough that collisions are rare, since two appointments cannot share a
slot.

## 2.6 Scheduling providers

```ts
type ProviderCapabilities = {
  excludeEventById: boolean; // can we ask it to ignore one event?
  expandsRecurrence: boolean; // does it return occurrences or rules?
};

interface SchedulingProvider {
  readonly id: "google" | "microsoft" | "caldav";
  readonly capabilities: ProviderCapabilities;
  getBusy(
    ctx: TenantContext,
    window: Window,
    opts: { excludeExternalEventId?: string; signal: AbortSignal },
  ): Promise<BusyLookup>;
  createEvent(
    ctx: TenantContext,
    appt: AppointmentView,
  ): Promise<string | null>;
  updateEvent(
    ctx: TenantContext,
    eventId: string,
    appt: AppointmentView,
  ): Promise<void>;
  deleteEvent(ctx: TenantContext, eventId: string): Promise<void>;
}
```

- **Google is the only implementation at launch** (F4.2) and already exists in
  all but name: PR #2's `getCalendarBusyIntervals` has this shape, including the
  exclusion parameter and the `AbortSignal`. Extracting it is a refactor; the
  return type is the only real change.
- **Capabilities are declared, not discovered.** `excludeEventById` matters
  because a provider that cannot exclude an event makes an appointment collide
  with its own calendar entry when rescheduled — the bug PR #2 fixed for Google
  by moving from `freebusy` to `events.list`.
- **Every implementation must honour the signal and the budget.** A provider that
  cannot answer in time returns `{ ok: false, reason: "timed_out" }`. Slow is
  failed (N3.1).
- **Retention is set explicitly at provisioning** — 30 days for recordings, at
  least 30 for transcripts (F10.6) — never inherited from a default.

## 2.7 Recurrence

**Materialiser**, hourly. For each active series, ensure occurrences exist to the
business's `materialisation_horizon_days` (90 by default, 30–365, F5.2).
Idempotent via `(series_id, occurrence_date)`.

**Clash handling** (F5.2a) is the interesting part, because the 005 exclusion
constraint makes a clash a _rejected insert_ rather than something to check for:

```
try insert at the usual time
  └ rejected → search same day, ±2h, nearest first
        ├ found → insert there,      record "shifted"
        └ none  → skip the occurrence, record "skipped"
```

**Owner notification is batched per run, not per occurrence** (F5.2b). A business
that closes a weekday permanently would otherwise receive one email per skipped
occurrence for the next 90 days.

The horizon (90) exceeds the caller booking limit (70) deliberately: the limit
constrains what a _caller may request_, the horizon keeps a standing series
populated ahead of it (F2.9a).

## 2.8 Analytics

Raw `calls` are never scanned per dashboard request (F6.12, N4.3). A nightly
per-tenant rollup writes `daily_business_stats` keyed by the business's local
date; the dashboard reads a bounded number of pre-aggregated rows and computes
today live from that tenant's own rows only — bounded by tenant size, not
platform size (N2.2).

**Both groupings come from the same daily rows** (F6.2): calendar months by
summing on `local_date`, billing periods by summing between
`billing_periods.starts_at` and `ends_at`. Storing daily and aggregating upward
is what makes two different calendars possible from one table.

**Outcome derivation happens once, at the post-call webhook**, from the
transcript in the payload — which is the only moment Ringly ever sees it (F10.6).
`outcome`, `end_reason` and `is_billable` are persisted then. **Outcomes can
never be re-derived** (F6.6): if the classifier improves, history keeps its old
labels, and the dashboard says so rather than hiding it.

`dropped` covers both a caller who hung up unresolved and a call the agent could
not help with (F6.4).

## 2.9 Billing

The most stateful part of the system, and the one where a wrong transition costs
real money. Modelled explicitly rather than inferred from timestamps.

### 2.9.1 Business billing states

```
        ┌──────────── activate (F1.12) ─────────────┐
        │                                            ▼
  unbilled                                        active ──── cancel request ───▶ cancelling
        ▲                                       │     ▲                              │
        │                          charge fails │     │ pays                         │ window closes
        │                                       ▼     │                              ▼
        └──── (never activated: deleted d10) ── grace ─┴──── suspended ──────▶ dormant
                                                  │ d7            │ d60            │ d60
                                                  └───────────────┴────────────────┴──▶ deleted
```

| State        | Calls answered? | Usage billed? | Exit                                                       |
| ------------ | --------------- | ------------- | ---------------------------------------------------------- |
| `unbilled`   | test only       | no            | activate → `active`; else deleted at day 10                |
| `active`     | yes             | yes           | charge fails → `grace`; cancel → `cancelling`              |
| `grace`      | yes             | **yes**       | pays → `active`; day 7 → `suspended`                       |
| `suspended`  | **no**          | no            | pays → `active` (fee charged that day); day 60 → `deleted` |
| `cancelling` | yes             | **no**        | revokes → `active`; window closes → `dormant`              |
| `dormant`    | no              | no            | returns → `active` (new period); day 60 → `deleted`        |

Two transitions carry the rules most easily got wrong:

- **`grace` → `active`** charges the outstanding amount **on the restore day**,
  not at settlement (F7.10b), and the grace usage stays billable — service given
  is service billed.
- **`cancelling` → `active`** makes the window's usage **billable retroactively**
  (F7.12a). The free window is a concession for leaving; without this, cancel-
  then-revoke is a way to take a free week and stay.

**A cancellation request while not `active` does not open a window** (F7.11a): a
business in `grace` or `suspended` is treated as non-paying, and the suspension
clock keeps running.

### 2.9.2 Settlement

Exactly three triggers (F7.9a): a period ending normally, a cancellation window
closing, and final deletion. All three run the same function, which is
**idempotent on `billing_periods.usage_settled_at`** — a re-run settles nothing
twice.

```
sum(usage_records.quantity_seconds for the period)   -- seconds, not minutes
  → ceil to whole minutes                            -- once, here (F7.7a)
  → × pricing_policy.per_minute_cents                -- the pinned version
  → total = fixed_fee + usage
  → clamp total to pricing_policy.cap_cents          -- $500 incl. fee (F7.9)
  → charge the difference, or record it owed if the charge fails (F7.12f)
```

Usage past the cap is **recorded in full and charged short**: Ringly needs the
true number for margin (F9), the business is never charged more than $500.

### 2.9.3 Stripe

Everything below exists to stop both systems acting on the same event (F7.20).

| Setting                     | Value                    | Without it                                           |
| --------------------------- | ------------------------ | ---------------------------------------------------- |
| Subscription interval       | `day` × 30               | `month` drifts to calendar months                    |
| Billing anchor              | 09:00 local, day 1       | midnight ± DST moves the charge to the previous date |
| Dunning emails              | **off**                  | two payment-failure emails from one company          |
| Receipts, payment-succeeded | **on**, Ringly-branded   | Ringly duplicates what Stripe does better            |
| `proration_behavior`        | `none`                   | Stripe prorates by the second and ignores the cap    |
| Billing thresholds          | **not configured**       | invoices early, alongside our cap logic              |
| Customer portal             | **disabled**             | businesses self-cancel, bypassing F10.2              |
| Smart Retries               | schedule spans 60 days   | gives up before the deletion boundary                |
| End of dunning              | leave subscription alone | Stripe ends the relationship on its schedule         |
| Statement descriptor        | `RINGLY`                 | unrecognised charges become disputes                 |

**Ringly's own `billing_periods` are authoritative**; Stripe executes payments.
Where the two disagree about when a period started, ours wins.

Webhooks are verified with `stripe.webhooks.constructEvent` — the vendor's own
verifier, never hand-rolled — and every event is recorded in `billing_events`
keyed on `stripe_event_id`, which is both the audit trail (F7.14) and the
idempotency key for redelivery.

**Usage is written locally first** and pushed to Stripe's meter asynchronously,
so a Stripe outage never blocks a call (N7.1).

### 2.9.4 Teardown, in order (F7.19, F10.10)

```
1  capture lifetime net revenue and outstanding balance   ← from Stripe
2  cancel subscription
3  void open invoices
4  detach payment method
5  delete Stripe customer
6  delete Ringly's rows
7  write departed_businesses
```

Steps 1 and 7 bracket the rest for a reason: net revenue comes from Stripe
balance transactions that step 5 destroys, and `business_id` is needed for step 7
after step 6 has removed the row that holds it. Doing 6 before 2–5 leaves a saved
card in Stripe belonging to nobody.

## 2.10 Lifecycle and retention

**Every deadline is a stored row, not a computed offset.** `lifecycle_deadlines`
holds `due_at` with a nullable `paused_at`, because the operator can pause a
clock (F10.1b) and an expression like `created_at + interval '10 days'` cannot be
paused. The sweeper acts only on rows that are due and not paused; **silence
never pauses anything**.

**Lifecycle sweeper**, hourly:

| Deadline kind         | Set when                | Action at `due_at`                             |
| --------------------- | ----------------------- | ---------------------------------------------- |
| `unactivated_expiry`  | number provisioned      | release number, delete everything (F10.1)      |
| `grace_expiry`        | first charge fails      | `grace` → `suspended` (F7.11)                  |
| `suspended_expiry`    | suspension begins       | delete (F10.3)                                 |
| `cancellation_window` | cancellation requested  | settle, stop service, `cancelling` → `dormant` |
| `dormancy_expiry`     | service stops           | delete (F7.12e)                                |
| `final_warning`       | 48h before any deletion | send the warning (F10.3a)                      |

`final_warning` is a **separate deadline**, not a branch inside the deletion job,
so that "nothing is deleted without 48 hours' notice" (F10.3a) is enforced by the
schedule rather than by remembering to check.

**Retention** (F10.8) is one rule: nothing is aged out while a business is
active; everything goes when the relationship ends, on the clock the ending sets
— day 10 unactivated, day 60 suspended, 60 days after service stops for a
cancellation. There is no field-level expiry and no rolling deletion.

**Transcripts and recordings are never stored** (F10.6). They stay with Retell on
a 30-day TTL set per agent at provisioning, are fetched on demand by signed URL,
and **Ringly issues no deletion call** (F10.5) — the TTL expires long before the
earliest Ringly deletion.

## 2.11 The operator surface

`/ops` is a **separate application surface**, not a privileged view of the
business dashboard, because it is the one place a cross-tenant query is
legitimate (F9.1) and therefore the one place it must be contained.

- **Route namespace `/ops/*`**, excluded from every tenant-facing layout.
- **Its own data module** (`lib/ops/`). Tenant code never imports it; it never
  imports `tenantScoped`. Lint enforces both directions.
- **Authorisation by env-configured operator allowlist**, checked in the proxy
  _and_ in every handler. Not a role column on a tenant table — nothing a
  compromised business account could grant itself.
- **Tests assert** that an authenticated business owner receives 404 from every
  `/ops` route, and that no tenant-facing module transitively imports `lib/ops`.

**Economics** (F9.2–F9.5): `cost_records` are written at the post-call webhook,
preferring a cost field on Retell's call object where present and otherwise
`duration × configured_rate`; number rental is a monthly per-business line.
Revenue is **net of Stripe fees**, taken from balance transactions.
`daily_business_economics` is refreshed daily and **reported by calendar month**
(F9.8) — no two businesses share a billing period, so per-period figures cannot
be summed into anything an accountant recognises.

**Controls** (F9.9–F9.13): set and clear cancelled status (the only place that
exists), pause an unactivated clock, and see idle numbers — Retell numbers
reconciled against businesses with an active paid period, each a standing cost
with no revenue against it.

## 2.12 Email

**Resend**, with templates as React Email components in this repository (F8.3) —
already built in PR #4 — so a change to what a customer reads is reviewed like a
change to what the code does.

```ts
sendEmail(kind: EmailKind, businessId: string, payload): Promise<void>
```

Writes `email_log` **before** sending, keyed by an idempotency key whose shape
depends on the email (F8.5): **per period** for receipts and digests, **per
incident** for calendar failures, **per event** for a shifted occurrence or a
deletion warning. The per-incident shape is what stops an outage generating one
email per lost customer.

**Ringly sends only what Stripe does not** (F8.3a). Stripe owns receipts and
payment-succeeded; Ringly owns the entire failure path, because only Ringly knows
that service continues seven days, that nothing has been deleted yet, and what
exactly is destroyed in forty-eight hours (F7.21).

Every declared kind is **type-linked to a template**, so adding one without
writing it fails the build rather than failing at send time.

## 2.13 Cost model

| Lever                       | Mechanism                                              |
| --------------------------- | ------------------------------------------------------ |
| Fixed cost per tenant       | Shared schema, shared database, no per-tenant infra    |
| Call-path third-party spend | Config cache (§2.5.5); one provider call per turn      |
| Dashboard cost              | Pre-aggregated rollups (§2.8)                          |
| Background work             | Batched workers, `SKIP LOCKED`, no external queue      |
| Enrichment spend            | Cache Places by `place_id`; one call on submit         |
| Attribution                 | `cost_records` and `usage_records` per business (N4.4) |

Deliberately **not** done: caching Google access tokens. Every lookup pays a
token exchange; accepted by owner decision.

## 2.14 Security

Unchanged foundations: signature verification on every inbound webhook (Retell
and now Stripe, each with the vendor's own verifier), encrypted provider
credentials (N6.1), RLS on tenant tables.

Added by this design: `tenantScoped` as the single service-role query path
(§2.3.1), the `/ops` allowlist (§2.11), and the fact that **card data never
touches Ringly** (F7.3) — Stripe Elements collects it, we store only identifiers,
which keeps us at SAQ-A (N6.2).

**PHI is out of scope** by product decision: healthcare businesses are excluded
because Retell requires a signed BAA that Ringly does not hold (§1.4).

## 2.15 What has to change in code that already exists

The parts of the shipped system this design contradicts, so none of it is
discovered late:

| Today                                                                                                         | Must become                                                             |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `getCalendarBusyIntervals` returns `[]` on failure                                                            | Returns `BusyLookup`; booking refuses on failure (R1, F2.7)             |
| Booking proceeds when the calendar is unreadable                                                              | Refuses, apologises, opens an incident                                  |
| Webhooks use `createServiceClient` directly                                                                   | Only through `tenantScoped` (N1.2)                                      |
| `reminders` table, WhatsApp consent columns, `record_whatsapp_consent` tool, consent step in the agent prompt | **Deleted** — and removing the consent step shortens every booking call |
| Agent greeting has no recording disclosure                                                                    | Disclosure appended by Ringly, not editable (F2.1a)                     |
| `business_type` includes `clinic`                                                                             | Removed (§1.4)                                                          |
| `calls` has no duration, end reason, or billability                                                           | Captured at post-call (F6, F7.6)                                        |
| `(business_id, starts_at)` unique index                                                                       | Range exclusion constraint (§2.4/005)                                   |
| Agent answers with no booking-horizon or opening-hours check                                                  | Enforces both (F2.8, F2.9)                                              |

## 2.16 Delivery plan

Each phase is independently shippable. **Phase 1 is a prerequisite for
everything**; the rest are independent of each other after it.

| Phase                        | Scope                                                                                                                                        | Needs   | Flag |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---- |
| **1 — Foundations**          | 005; `tenantScoped` + isolation tests; fail-closed booking and incidents (R1); delete reminders/WhatsApp; recording disclosure; call capture | —       | no   |
| **2 — Catalogue + cache**    | 006; tenant config cache; F3 end to end                                                                                                      | 1       | no   |
| **3 — Provider abstraction** | 007; extract `SchedulingProvider`; port Google behind it                                                                                     | 1       | no   |
| **4 — Business dashboard**   | 009; rollup worker; F6                                                                                                                       | 1       | no   |
| **5 — Billing**              | 010; state machine; settlement; Stripe config; F7                                                                                            | 1, 4    | yes  |
| **6 — Lifecycle**            | 011 (deadlines); sweeper; teardown; departure record; F10                                                                                    | 1, 5    | yes  |
| **7 — Recurrence**           | 008; materialiser; clash shift/skip; F5                                                                                                      | 1, 3    | yes  |
| **8 — Operator dashboard**   | 011 (economics); `/ops` walled garden; F9                                                                                                    | 1, 4, 5 | yes  |

**Phases split by layer** — migration+types → backend → UI → enablement — because
each merges green independently and a schema can land inert before anything uses
it. Phase 5 additionally splits by concern (subscription, then usage and cap,
then settlement), because "billing" as one PR is unreviewable.

Phases 1–4 need no flags: each is invisible to users or a strict improvement, and
complete when merged. Phases 5–8 are flagged so incomplete work lives on `main`
rather than on a long-lived branch.

## 2.17 Risks

- **R1 — The shipped code fails open; the product requires fail-closed.** A
  specification change, not only a bug fix. Phase 1.
- **R2 — LAUNCH BLOCKER: Google OAuth verification not submitted.** Refresh
  tokens are revoked after 7 days while the app is in _Testing_; with a mandatory
  calendar and fail-closed booking, every business stops taking bookings a week
  after signup. Weeks of review, independent of every engineering phase.
- **R3 — Cross-tenant leakage via the service role.** Mitigated by §2.3.1; must
  stay test-enforced.
- **R4 — 005 cannot apply over existing overlapping appointments.** Needs a data
  audit before the migration runs.
- **R5 — Provider capability mismatch.** Declared, not assumed (§2.6).
- **R6 — Live busy-checks cost real money per turn.** Accepted: a stale conflict
  check is worse.
- **R8 — Unbooked calls are pure cost.** At Retell's $0.13–0.31/min, $100 covers
  roughly 320–770 minutes of unbillable calling. F9 exists partly to measure it.
- **R9 — Switching calendar provider is out of scope.** Not designed, not built.
- **R10 — Retention depends on a provider setting.** Retell's is per-agent, 1 day
  to 2 years; must be set explicitly at provisioning, never inherited.
- **R11 — PHI.** Resolved by excluding healthcare (§1.4).
- **R12 — Caller authentication is weaker than caller ID** (§2.5.6). Deliberate;
  revisit if abused.
- **R13 — Appointments edited directly in the owner's calendar drift.** Conflict
  checks stay correct (busy is read live); Ringly's stored time may not be.
  Sync-back is not built.
- **R14 — A business changing hours or timezone.** Rare, not handled.
- **R15 — Long-running disputes outlive the business.** A chargeback resolving
  after day 60 lands on a deleted account. Accepted, no special handling (F7.17).

## 2.18 Verified vendor capabilities (2026-07-30)

- **Stripe** — `SetupIntent` stores a card off-session; usage-based billing via
  **Meters**; **billing thresholds** exist and are deliberately unused; dunning,
  receipts, proration and the customer portal are each independently
  configurable, which is what makes §2.9.3 possible. Disputes: **$15 fee,
  non-refundable in the US**, 7–21 days to submit evidence, 2–3 months to
  resolve.
  [Setup Intents](https://docs.stripe.com/payments/setup-intents) ·
  [Usage-based pricing](https://docs.stripe.com/billing/subscriptions/usage-based/pricing-plans) ·
  [Thresholds](https://docs.stripe.com/billing/subscriptions/usage-based/thresholds) ·
  [Disputes](https://stripe.com/payments/dispute-management)
- **Retell** — ~600ms end-to-end budget; `speak_during_execution` and
  configurable backchannelling cover tool latency; retention is **per-agent, 1
  day to 2 years**; recording URLs are **signed and expire**, so they must be
  fetched at view time; SOC 2, GDPR and HIPAA-capable but **PHI requires a BAA**.
  Cost is $0.13–0.31/min all-in.
  [Data storage](https://docs.retellai.com/accounts/privacy-disable) ·
  [Compliance](https://docs.retellai.com/general/compliance) ·
  [Latency](https://www.retellai.com/blog/how-real-time-voice-ai-works-stt-llm-tts)
- **Google Calendar** — `calendar.events` is a **sensitive** scope requiring
  verification; refresh tokens revoked after 7 days in _Testing_ (R2); granular
  consent means calendar can be declined independently of sign-in (F1.7a);
  `events.list` exposes event ids where `freebusy` does not, which is why the
  former is used.
  [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) ·
  [App audience](https://support.google.com/cloud/answer/15549945?hl=en)

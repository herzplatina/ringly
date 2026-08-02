# Ringly — Product Requirements (v3.0)

_Supersedes Part 1 of `Ringly_PRD_EDD_v2.md` (2026-07-01). Locked 2026-07-30,
revised 2026-08-01._

> **The design that serves these requirements is
> [`Ringly_EDD_v3.md`](./Ringly_EDD_v3.md).** The two were one document until
> 2026-08-01 and were split so each carries its own history: requirements change
> when the product does, the design changes when the engineering does, and one
> commit log could not carry both reasons without every entry needing to say
> which half it was about.

> **Status.** Locked. **Almost none of it is built** — what runs on `main` is the
> v2 product. The delivery plan that replaces it is EDD §2.16.

> **Where to start.** **§1.4** draws the scope boundaries the rest of this
> document assumes — most consequentially that there is no channel to the calling
> customer, no healthcare business, one owner account per business, and no
> recurring appointments. **§1.8** carries the questions still open (Q1, Q3, Q6)
> and the action items that are not phases.

> **Revision history is in `git log docs/Ringly_PRD_v3.md`** — one commit per
> decision, each carrying the reasoning for that decision alone. Every decision is
> stated in the section that owns it, and this cover deliberately does not
> summarise them: a summary drifts from the sections it describes, and a reader
> who trusts it then acts on something the document no longer says.

---

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

| Area       | v2                                   | v3                                                                |
| ---------- | ------------------------------------ | ----------------------------------------------------------------- |
| Tenancy    | Implicitly single-tenant assumptions | Explicit multi-tenant model, isolation and scale targets          |
| Scheduling | Google Calendar only, hardwired      | Still Google only, but behind an interface others can plug into   |
| Services   | Set at onboarding                    | Editable any time; changes reach the agent for the next caller    |
| Hours      | Set at onboarding                    | Editable; timezone stays an operator action (F3.5–F3.6)           |
| Customers  | A messaging channel was planned      | **None, ever.** The call is the only contact (§1.4)               |
| Analytics  | None                                 | Per-business dashboard, plus an operator cost/revenue dashboard   |
| Money      | None                                 | $100/30 days in advance, usage in arrears, $500 cap, card on file |
| Email      | None                                 | Billing and stats emails **to the business**                      |
| Verticals  | Salons, clinics, tax offices         | **No healthcare** — no BAA, so clinics are out (§1.4)             |
| Hosting    | Assumed Vercel                       | **Undecided** — Vercel or Cloud Run; design stays portable (N8)   |
| Latency    | Not a stated requirement             | Explicit per-turn budget on the call path                         |
| Cost       | Not a stated requirement             | Explicit per-tenant serving-cost target                           |

## 1.3 Personas

- **Business owner (primary).** Non-technical. Salon, tax office, trades, and
  similar appointment-driven businesses — **explicitly not healthcare of any
  kind** (§1.4). Wants a receptionist, not a configuration project. Checks a
  dashboard occasionally and an email monthly. Cares about missed calls and
  money.
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
- **Any outbound channel to the calling customer.** Ringly has no way to reach a
  caller after the call ends — no SMS, no messaging app, no email, no
  appointment confirmations or reminders of any kind. The **call itself is the
  only contact with a customer**, and the confirmation the caller receives is the
  agent reading the booking back to them before hanging up. Every requirement in
  this document is written on that basis: where a customer would otherwise need
  telling something after the call has ended, the **business owner** is told
  instead and it is the owner's decision what to do. This is a product boundary,
  not a deferral with a date.
- Multi-location businesses (one location per business row).
- **Recurring appointments.** Ringly does not schedule a repeating series and
  never materialises future occurrences. A caller who asks for one gets **the
  first instance booked and nothing else**, read back to them so they know
  exactly what they have (F2.2a). There is no series record anywhere in the
  system, so every appointment is a standalone one.
- Multi-staff / resource-level scheduling (one implicit calendar per business).
- Multiple logins per business. **One business has exactly one owner account**,
  the Google identity that signed it up (F1.7). There are no staff logins, no
  invitations, and no roles.
- Non-US phone numbers and non-English calls.
- Self-serve plan changes, coupons, and promotional pricing of any kind.
- Customer-facing web booking. The phone is the only booking channel.
- **Transferring a call to a human, and taking a message.** The agent handles the
  call or it does not; there is no fallback to the owner's mobile and no voicemail
  (F2.10).

---

## 1.5 Functional requirements

### F1 — Onboarding and identity

_(Carried from v2; renumbered. v2 FR1–FR10 map to F1.1–F1.10.)_

- **F1.1** Intake accepts free-form text; no structured fields required.
- **F1.2** Voice output speaks the prompt; input is typed. (Speech-to-text input is deferred.)
- **F1.3** Enrichment resolves name, address, phone, hours, IANA timezone, and
  website from Google Places.
- **F1.4** Services auto-extracted from the website (≤15 items), with upload and
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
- **F1.10 — Retired.** The number is left unused so references in earlier
  documents and commits still resolve.
- **F1.11** Onboarding collects and verifies a **business contact email**,
  defaulted from the Google identity and editable. It is the destination for all
  billing email, including the 48-hour warning before deletion (F9.3a), so an
  unverified address is a silent single point of failure.
- **F1.12** **Getting ready is a checklist of three tasks, presented
  together and completed in any order the business likes:**
  1. **verify the contact email** (F1.11);
  2. **make a test call and confirm it worked** — the owner's judgement, not
     something Ringly infers, because only they know whether the agent sounded
     right;
  3. **add a payment method.**

  Nothing is sequenced. A business that wants to hear its receptionist before
  giving anyone a card can; one that wants everything done in a minute can. The
  screen shows all three with their state, and what remains.

  **The screen also shows test calls remaining** (F1.13), because the allowance
  is small and running out of it stops the phone answering. A counter a business
  discovers only by hitting zero is a trap.

- **F1.12a** **Activation is one deliberate act by the business owner: pressing
  a button.** When all three checklist items are green an **Activate** button
  becomes available. Pressing it — and nothing else, ever — charges the $100,
  starts period 1, and flips the account from `unbilled` to `active`. The
  business is then told plainly that it is **now taking customer calls** and
  that billing has begun. There is no separate activation fee (F7.1); this charge
  is period 1's.
- **F1.12a-i** **Activation touches three systems, and the business is told the
  truth at each of them.** Taking money and connecting a phone are separate acts
  that can fail separately (EDD §2.5.2), and the one thing a business must never
  be left with is a charge and no explanation.

  **The owner presses Activate exactly once.** Everything after that press is
  Ringly's problem to finish. **No failure is ever handed back as "press it
  again"** — the one moment a business must not be asked to press a payment
  button a second time is the moment it cannot tell whether the first press took.

  | If it fails at               | The business sees                                                                                                                                              | Charged?  |
  | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
  | **The card**                 | Inline, immediately: the card was declined, try another. Nothing else changed                                                                                  | **No**    |
  | **Recording the activation** | Nothing. **Ringly completes it itself** — the charge is the commitment, and finishing the record is a retry against Ringly's own database                      | Yes, once |
  | **Connecting the number**    | "You're activated and your first period has started. Your number is being connected — we will email you the moment it is live." **Plus that email when it is** | Yes       |
  - **Row two must never reach the screen.** A charge that succeeded and a record
    that did not is Ringly's inconsistency to resolve, not a task to hand to the
    person who just paid. The button shows progress until it resolves.
  - **Row three is the one that will be seen**, because connecting a number
    depends on a third party. The business has paid and its phone is not yet
    ringing, and silence there is indistinguishable from having been charged for
    nothing — so it is said plainly and raised to the operator (F8.6).
  - **No message ever leaves the business guessing whether it was charged.**

- **F1.12a-ii** **Every bind and every unbind is verified by reading the
  telephony provider's own record back.** A write that returns success and does
  not take effect is otherwise invisible until it matters, and it matters in both
  directions:
  - **A failed bind** — at provisioning (F1.9), at activation, or at any rebind
    (F1.13b, F6.10b) — leaves a business paying for a number that rings nowhere.
    It is discovered by a customer.
  - **A failed unbind** — at the test-call limit (F1.13a), at suspension, or at
    dormancy — leaves the number **answering calls Ringly has decided to stop
    serving and stopped metering**. It is a revenue leak and a correctness
    failure at once, and **nothing else in the system would ever notice it**,
    because every other component believes service has stopped.

  **A verification that fails is treated as a failed operation**: retried, and
  raised to the operator — a failed bind as an activation-stuck alert, a failed
  unbind under its own alert (F7.13a), because an unbind failure has no other
  symptom. The read-back is cheap, deterministic, and tests the thing that
  actually goes wrong.

  **It is a check against provider state, never a placed call.** Ringly does not
  dial its own number: a synthetic call costs telephony minutes on every bind and
  unbind, lands in `calls` where it corrupts the test-call count (F1.13) and the
  analytics (F5.3), and still proves only that something answered. Whether the
  agent _sounds_ right is a human judgement, and checklist item 2 already exists
  for exactly that (F1.12).

- **F1.12b** **Nothing activates a business except that button.** Stated
  negatively because it is the thing most likely to be assumed otherwise:
  - **Call volume never activates anything.** Not the first call, not the fifth,
    not the one that gets refused after it. The number of calls placed has no
    bearing on billing status whatsoever.
  - **Confirming the test call does not activate.** It ticks one of three boxes
    (F1.12) and nothing more. A business can confirm its test call and sit there
    for a week without being charged a penny.
  - **Adding a card does not activate**, and the card is not charged when it is
    added — only stored (F6.2).
  - **Time never activates.** An unactivated business is deleted at day 10
    (F9.1); it is never promoted into a paying one.
  - **Ringly never activates a business on its behalf.** Not the operator, not a
    background job, not a support action.

  **Before that press: no charge is possible, ever.** After it: usage is billed
  by outcome alone (F6.6). There is no third state and no gradual transition.

- **F1.13** **An unactivated business gets five free test calls, and then the
  number stops answering.** Every pre-activation call costs Ringly real telephony
  and LLM minutes against no revenue (R8), and a business that will not activate
  is a business Ringly is subsidising indefinitely. Five is enough to hear the
  agent, try a booking, and try a reschedule; it is not enough to run a free
  receptionist.
  - **The allowance is five, and it is configuration, not a constant** — a
    platform default, changeable without a deploy, on the same principle as every
    other number in this document (F6.15).
  - **Reaching five does not activate the business, charge it, or promote it in
    any way.** It stops it, which is the opposite (F1.12b).
- **F1.13a** **At the fifth call the agent is unbound from the number, and the
  sixth call is not answered at all.** This is the same mechanism used for
  suspension and dormancy (EDD §2.10.1), applied for a different reason.
  - **Not answering is the point.** A polite refusal recorded by the agent would
    still be a connected call and would still cost Ringly minutes, which is the
    cost the limit exists to bound. The call must not reach the agent.
  - **The number stays rented and stays reserved to that business** (F9.4a). It
    is unbound, not released; nothing else can be given it while the business row
    exists.
  - **The business is emailed**, when the five test call limit is reached. Business is
    told that its number has stopped
    answering, why, and what turns it back on.
  - **The operator is alerted only if the business _cannot_ activate** — that is,
    if it never confirmed a working test call (F8.12, "activation stuck"). A
    business with all three boxes green that simply has not pressed the button is
    **not stuck**; it is deciding, and raising it to a human every time would
    make the queue meaningless.
  - **The business is never charged.** Not for the five, not for the refused
    calls, not for being stuck.
- **F1.13b** **There are two ways out, and which one applies depends on whether
  the business ever heard a call that worked.**
  1. **It can activate itself, and that rebinds the number immediately.** If all
     three checklist items are green — including a confirmed test call — the
     Activate button still works. Pressing it charges the $100, binds the agent
     back, and the business is live (F1.12a). **Running out of test calls is not
     a bar to activating**; a business that has decided to pay should never be
     held back by an allowance that exists to limit free usage.
  2. **Otherwise it is genuinely stuck and recovery is operator-led.** A business
     that never got a call it was happy with cannot tick box 2 and therefore
     cannot activate. The operator investigates, **pauses the deletion clock**
     (F9.1b), and **resets the allowance and rebinds the agent** (F9.1c) once
     the fault is fixed.

  In both cases the **10-day clock keeps running unless the operator pauses it**
  (F9.1). An unactivated business is still deleted at day 10.

- **F1.13c** **A call is a test call if the business had not yet pressed Activate
  when it arrived. That is the whole rule; there is no detection.** Ringly bought
  the number minutes earlier and it is on no listing, no website, no sign and in
  nobody's contacts. The only person who knows it exists is the owner Ringly just
  gave it to, so before activation there is no other kind of call it could be.
  - **Who is calling is not examined**, deliberately: caller ID would add a way
    to be wrong about something the account state already settles. If a stranger
    somehow dials the number it still counts against the five and the business is
    still charged nothing, which is the right answer either way.
  - **The classification is written at the time of the call, not derived later**
    (EDD 005, `is_test_call`). Billing status changes; a call's history must not.
    Deriving it from today's status would reclassify every one of a business's
    test calls the instant it activated.
  - **After activation there are no test calls.** The owner ringing their own
    number is billed on the same terms as anyone else, by outcome alone (F6.6,
    F6.7).

- **F1.13d** **The lifecycle in full, so the boundary is unambiguous.** Three
  businesses, same five calls; the only difference is the button:

  |                            | A — activates                               | B — could, doesn't                                     | C — never got a good call                                 |
  | -------------------------- | ------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------- |
  | Signs up, gets a number    | `unbilled`                                  | `unbilled`                                             | `unbilled`                                                |
  | Places 5 test calls        | 5 test calls, **$0**                        | 5 test calls, **$0**                                   | 5 test calls, **$0**                                      |
  | Confirms one worked        | box 2 ticked                                | box 2 ticked                                           | **cannot** — none sounded right                           |
  | Email verified, card added | all 3 green                                 | all 3 green                                            | 2 of 3                                                    |
  | 5th call ends              | agent unbound; emailed                      | agent unbound; emailed                                 | agent unbound; emailed **and operator alerted** (F1.13a)  |
  | **Presses Activate**       | → `active`, **$100**, period 1, **rebound** | can still do this at any time → rebinds, live (F1.13b) | **button unavailable** — box 2 is not green               |
  | Next call arrives          | answered, **production, billable**          | **not answered**                                       | **not answered**                                          |
  | Where it ends up           | Paying customer                             | Its own choice; deleted at day 10 if it never presses  | Operator-led (F9.1b, F9.1c); deleted day 10 unless paused |
  | Total charged              | $100 + usage                                | **$0**                                                 | **$0**                                                    |

  **B and C are never charged anything, whatever happens**, because neither
  pressed the button. There is no call count at which billing begins — only a
  call count at which the phone stops being answered.

### F2 — Call handling and booking

- **F2.1** The agent answers on the business's dedicated number, identifies the
  business, and can describe services, prices, and durations.
- **F2.1a** **Every call opens with a recording disclosure**, immediately after
  the greeting and before the caller says anything of substance.
  Around a dozen US states require all-party consent to record. **The disclosure
  is appended by Ringly and is not part of the business's editable greeting
  script** — a business can change how it introduces itself, but cannot remove or
  alter the disclosure. If a business supplies no greeting of its own, the text
  below is used verbatim.

  > "Hello, this is _[business name]_. Just to let you know, this call is
  > recorded for quality assurance. How can I help you today?"

- **F2.2** The agent books, reschedules, and cancels appointments.
- **F2.2a** **A request for a repeating appointment books the first occurrence
  and nothing else.** Ringly has no concept of a series and never materialises
  future occurrences (§1.4), so there is nothing to book beyond the first.
  - When a caller asks for something repeating — "every Tuesday at two", "put me
    down for the same slot next month as well" — the agent **books the first
    instance only**.
  - It then **reads that one appointment back** — date, time, service and
    business (F2.11) — and **says plainly that this is the only appointment
    booked** and that they should ring again for the next one. The caller must
    never leave the call believing anything further is held for them.
  - **Nothing distinguishes the resulting appointment from any other.** A later
    call reschedules or cancels it exactly as it would a one-off (F2.4), and no
    requirement anywhere may ask whether an appointment belongs to a series.
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
  - A reschedule or cancellation proceeds **only on a match against appointment details and name.**
    Note that none of the indiviual attributes may match "exactly" since the customer may
    use short-hand language to convey what they mean (such as only first name, short name, day instead of date, time without AM or PM etc)
    If any one of the attributes of an appointment did not even partially match, then the caller is refused and told
    which attribute (out of name, date, time and service) did not match.
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
- **F2.9** An appointment may not be booked **more than 70 days ahead**.
  The limit is **configuration, not a constant**: a platform default that the
  **business can change from its own dashboard** (F5.15), bounded to **7–180
  days** so no business can set a value that makes availability computation
  unreasonable.
- **F2.10** **There is no escape hatch out of the agent.** Ringly does not
  transfer to a human, does not take a message, and has no voicemail. A caller
  the agent cannot help is told plainly that it cannot help with that and is
  given the business's own contact details — which the business already
  published. The call is recorded as `dropped` (F5.4), which is how the business
  finds out this is happening. Adding a transfer target would mean holding an
  owner's personal number, ringing it out of hours, and building a hand-off the
  agent cannot verify anyone answered.
- **F2.11** **The caller's booking confirmation is the agent reading it back**
  during the call — date, time, service, and business — and nothing else. Ringly
  cannot reach the caller after the call (§1.4), so the read-back is the whole
  confirmation and the agent must not promise a message that will never arrive.
- **F2.12** **No appointment is booked without the caller's phone number. There
  are no anonymous bookings.** A customer's identity is their number (F2.4), so
  an appointment with no number attached belongs to nobody: the business cannot
  tell who is coming, and a later call cannot reschedule or cancel it against a
  customer record that was never created.
  - **Caller ID supplies it in the ordinary case**, and the agent never has to
    ask. If the number is withheld or unavailable, **the agent asks for one and
    will not complete the booking until it has one.**
  - **A caller who will not give a number is refused, plainly**, and told why.
    That is a worse outcome than booking them, and it is still better than a
    diary entry the business cannot act on.
  - **This does not change how an existing appointment is found** (F2.4). A
    caller may still ring from a different phone or withhold their number when
    rescheduling, because that lookup runs over appointments rather than over
    customer records. The number is required to **create** an appointment, not to
    find one.

### F3 — Service catalogue and opening hours

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
  - **Duration is locked** when the appointment is booked and never changes
    afterwards. A duration that floated would silently overlap appointments
    booked around it.
  - Deactivating or repricing a service therefore never breaks an existing
    booking's slot, but does change what it is worth.
  - If the service has since been **deleted**, the appointment is valued at the
    **last known price** of that service. An appointment never becomes unpriceable
    because the catalogue moved on.
- **F3.5** **Opening hours are editable by the business on its own dashboard**,
  on the same terms as the catalogue — same screen, same ≤60s propagation
  (F3.2). A business that cannot change its own Saturday has to ring Ringly to
  do it, which is not a product.
  - **The change is written to the database on save** and is authoritative from
    that moment. There is no draft, no review, and no operator step.
  - **Every subsequent booking decision uses the new hours** — the agent's
    availability check (F2.8) and the slots it offers either side of a taken one
    (F2.3). The only
    bound is the ≤60s the agent may take to see the change (F3.2), and a caller
    already mid-conversation keeps the hours they started with.
  - **Appointments already booked are never moved or cancelled.** One that now
    falls outside opening hours stays exactly where it is: a time was agreed with
    a customer Ringly has no way to contact (§1.4), so breaking it silently is
    worse than honouring it. The business can see it in its own calendar and
    handle it.
  - **Narrowing hours does not retroactively invalidate anything**, and widening
    them makes new slots bookable immediately.
- **F3.6** **Changing timezone is an operator action, not a self-serve one.**
  A timezone is resolved once at onboarding from the business's address (F1.3)
  and is almost never genuinely wrong; changing it silently re-interprets every
  stored instant a business can see (N5.1) and every billing-period boundary
  (N5.2). Rare enough to handle by hand, and consequential enough that it should
  be.

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

### F5 — Business dashboard

The dashboard has the following :
a) the aggregate shape of the calls Ringly handled
b) what the business has paid for them.
c) **the state of the service itself** (F5.18) and the **controls** a business
needs — the full list is F5.15.

**(a) Aggregate analysis of calls to Ringly**

- **F5.1** Each business sees only its own data, always.
- **F5.2** **Two filters, in order, governing everything on the page:**
  1. **Unit** — `calendar month` (how a business thinks) or `billing period`
     (how it is charged). One or the other, never both at once.
  2. **Range** — `current` · `past 3` · `past 6` · `past 12` of that unit. These
     four and no others; an arbitrary date picker invites ranges that cross a
     unit boundary and answer nothing.
- **F5.3** **Five top-level metric tiles, aggregate only.** There is no per-customer reporting:
  a customer cannot be reliably identified — names are not unique and one person
  rings from different numbers — so any per-customer figure would be a guess
  presented as a fact.
  - **total calls**
  - **average call duration**
  - **median call duration**
  - **total appointments booked** — the headline number, promoted to a tile
    because it is what an owner looks for first. **A call books at most one
    appointment**, because a repeating request books only its first instance
    (F2.2a) and there are no series anywhere in the system, so this is also the
    count of calls whose outcome was a booking and is the same figure as the
    `booked` grouping in F5.4.
  - **revenue booked** — an **estimate** wherever the range includes
    future appointments, labelled as such, because price resolves at occurrence
    time (F3.4).
- **F5.4** **One chart, and its only measure is the number of calls.** It has two
  dimensions and no others:
  - **time of day** — when the call arrived, in the windows of F5.4a;
  - **outcome** — booked / rescheduled / cancelled / enquiry-only / dropped.

  How the two are combined is the business's choice, not a second chart (F5.4b).

  **"Dropped"** covers both a caller who hung up without a resolved
  outcome **and** a call the agent could not help with. If the caller did not get
  what they rang for, it is dropped. A completed enquiry — the caller asked
  something and got a useful answer — is recorded as `enquiry_only`.

- **F5.4a** **Time of day is reported in six four-hour windows**, starting at
  local midnight: 00–04, 04–08, 08–12, 12–16, 16–20, 20–24. Hourly resolution is
  noise at these volumes; four-hour windows are the grain at which a business can
  act — "we are missing calls in the evening".
- **F5.4b** **The two dimensions swap roles inside that one chart. One groups,
  the other filters, and the business chooses which way round.** There is no
  second chart and no separate report:
  - **grouped by outcome, filtered by time of day** — how do evening calls end?
  - **grouped by time of day, filtered by outcome** — when do reschedules happen?

  Both configurations are reached from the same chart, and **neither renders both
  dimensions as grouping at the same time**. A single plot carrying every outcome
  across every window is unreadable at these volumes and answers neither
  question; swapping which dimension groups answers both.

- **F5.5** **Three separate trends across periods** — calls, appointments
  booked, and revenue booked — each one chart, one column per period. Kept apart
  rather than behind a measure toggle, so a period where calls rose and revenue
  did not is visible at a glance instead of requiring two clicks to notice.
- **F5.6** **What the business pays Ringly is not among the call metrics.** It
  lives in the billing history (F5.9). The call analysis is about the work done;
  the billing history is about the money.
- **F5.7** **Every outcome definition is shown on the dashboard itself**, in
  plain language, next to the figures it governs. A business must never have to
  guess what "dropped" counts.
- **F5.8** **If a definition changes, the dashboard says so prominently** — a
  notice the owner may or may not read, with no acknowledgement required and no
  state to track. It states that figures before and after the change are not
  directly comparable. Historical calls are **not** reclassified — transcripts
  are not retained (F9.6), so outcomes cannot be re-derived. This is a permanent
  property of the design, explained on the dashboard rather than hidden.

**(b) Billing history**

- **F5.9** Billing history is **one table, not a chart** — one row per billing
  period: **dates · fixed fee · billable minutes · usage charge · total · % of the
  $500 cap · date charged · status**.
  - **The current period is the first row of that same table**, not a separate
    panel beside it (F5.10). It is the row a business looks at most, and lifting
    it out would mean the one number they check daily lives somewhere different
    from the eleven they check yearly, in a different shape, having to say the
    same things twice.
  - **Billable minutes** are connected minutes on productive calls (F6.6);
    enquiry-only and dropped calls consume none.
  - **Status** is what makes the current row legible next to the closed ones:
    **in progress** · paid · failed · refunded. **"Refunded" is only ever a
    goodwill gesture made by hand** — no rule in this document produces a refund,
    and none should be built.
  - **A period during which service was suspended says so in its row** (F6.11b).
    Its dates are still exactly 30 days, so nothing looks wrong; what the label
    adds is that the business was not served for some of them and was **not
    charged for those days**. Without it, a period with low usage and a full $100
    looks like a mistake.
  - Minutes and money are different units, so nothing here is charted: a single
    plot carrying both would need two axes, which is the one construction that
    reliably misleads.
- **F5.10** **The current period's row is live** and carries what a business
  actually asks: usage accrued so far, the cap and how close they are to it, and
  **the date of the next charge**. Every other row is settled and final.

**Everything else**

- **F5.11** The dashboard is **aggregate-only**. A business cannot read individual
  transcripts, listen to recordings, search what was said, or see figures broken
  down by customer — Ringly stores no call content (F9.6) and cannot reliably
  identify a customer. Ringly's own developer inspects individual calls in
  the Retell dashboard.
- **F5.12** Figures cover **only appointments booked through Ringly**. Anything
  the owner enters directly in their own calendar is respected for conflict
  checking (F2.3) but never appears in Ringly's figures.
- **F5.13** All figures are rendered in the business's own timezone, including
  day, week and month boundaries for grouping.
- **F5.14** Dashboard queries return in ≤ 500ms p95 regardless of tenant size,
  and their cost must not grow with total call volume across all tenants.
- **F5.15** From the dashboard a business can: manage its service catalogue and
  opening hours (F3.1, F3.5), confirm its test call succeeded (F1.12), set its
  own booking horizons (F2.9), reconnect a calendar after a
  failure (F1.7b), and opt out of the stats digest (F7.4). **It cannot change its timezone** (F3.6) or cancel
  its account (F9.2); both go through Ringly.
- **F5.16** **The dashboard states how fresh it is, on the page, always.**
  - **A nightly rollup is the right grain for every call metric** (F5.3).
    These are questions about shape and trend — how many calls, when they
    arrive, how they end — and none of them is meaningfully different for having
    happened four hours ago. Serving them from a rollup is also what keeps F5.14
    achievable at 10,000 tenants.
  - **The consequence is that today's calls are not shown**, and the dashboard
    must **say so in plain words** next to the figures: complete to a stated
    date, today appears tomorrow. A business that has just taken a call, cannot
    find it, and is given no explanation concludes the product is broken — and it
    will do that on day one, when it is testing exactly this.
  - **Median call duration is computed live** when the dashboard loads (F5.3),
    because a median cannot be recovered from daily aggregates. It is the single
    live query against raw calls and is bounded by the selected range.
  - **Billing figures are live** (F5.10). A business asking what it owes is
    asking about now, and the numbers are small enough to compute on demand.
  - Anything live is **labelled live**, so the two kinds of figure are never read
    as one.
- **F5.17** **Every money figure states whether it is settled.** A charge that
  has cleared, a charge that is still accruing, and a charge that failed are
  three different kinds of number, and rendering them identically invites a
  business to plan around one that has not happened.
  - **Settled** — money that moved. Closed periods, completed charges.
  - **Accruing** — the current period's usage and running total, correct as of
    now and certain to change (F5.10).
  - **Outstanding** — invoiced and not paid, whether the business is in grace or
    suspended (F6.11b-i).

  **The same rule governs the operator dashboard** (F8.8), where it matters more:
  revenue there counts only money actually received, and a figure that quietly
  mixed in what is merely invoiced would misstate the business Ringly is in.

- **F5.18** **The dashboard states the current state of the service, at the top,
  always.** A business must be able to answer "is my phone being answered right
  now?" without ringing it. Three facts, in plain language:
  - **whether the number is live** — bound to an agent and taking calls, or not
    (F1.13a, F9.3) — and, when it is not, **why, and exactly what turns it back
    on**: activate (F1.13b), or settle what is owed (F6.10b);
  - **the number itself**, since it is the business's public identity;
  - **test calls remaining**, before activation only (F1.13).

  **This is the one thing on the dashboard that is never stale**: it is read from
  current state, not from the rollup, and it is the first thing on the page. A
  business whose number stopped answering and whose dashboard looked normal would
  have no way of finding out except from a customer who could not get through.

> **No-shows are out of scope.** Ringly does not track, record, or report them.
> A no-show is something the business observes in its own calendar and handles
> itself; Ringly has no way to know it happened and no lever to pull. Blacklisting
> repeat no-shows, or reminding them harder, are ideas for later — both depend on
> a customer channel that does not exist.

### F6 — Billing and payments

**Billing period.** A business's period is a **rolling 30 days from activation**,
not a calendar month. Period 1 begins the day the business activates (F1.12);
period _n+1_ begins the day after period _n_ ends.

**The two charges never fall on the same day.** The fixed fee is taken on the
**first** day of a period; that period's usage is settled on its **last** day.
For a business activating on day 1: $100 on day 1, period-1 usage on day 30,
$100 for period 2 on day 31. A card that has gone bad therefore fails one charge
at a time, and there is only ever **one grace clock**, started by whichever
charge failed first (F6.11).

- **F6.1** A **$100 fixed fee** is charged **in advance** at the start of every
  30-day period, irrespective of usage. The first such charge is the activation
  payment — there is no separate one-off activation fee.
- **F6.2** At activation the business's **card is stored for future off-session
  use**, so later charges need no customer presence.
- **F6.3** Ringly never stores, transmits, or logs raw card details. Card data is
  handled entirely by the payment provider; Ringly stores only provider
  identifiers. _(Hard requirement, not a preference.)_
- **F6.4** **Usage** accrues through the period and is charged **in arrears** at
  period end, once the total is known.
- **F6.5** **There is exactly one billable usage unit: connected minutes on
  productive calls** (F6.6), whole call duration (F6.7). No other unit is
  metered, and the pricing policy carries no dormant ones — a rate nothing
  produces is scaffolding that misleads whoever reads it next.
- **F6.6** A call is **productive** — and therefore billable — if it resulted in
  any of: a new booking; a reschedule that produced a booked appointment; or a
  cancellation of a real existing appointment. **Not billable:** general enquiry
  calls, wrong numbers, dropped calls, pre-activation test calls, and any call
  that changed nothing for the business. **Who is calling is irrelevant** — the
  owner, a customer, or Ringly's own developer are billed identically. The
  outcome is the only test.
- **F6.7** The **whole call** is billable, not only the minutes up to the
  booking. Once a business is activated, **no caller is exempt** — Ringly does
  not try to decide whether a call came from a genuine customer, the owner, or
  the developer. The only filter is the outcome test in F6.6.
- **F6.7a** Connected seconds are summed across the **whole billing period** and
  **rounded up to a whole minute once**, at period close — not per call. A
  business making many short calls is not charged a full minute for each.
- **F6.8** Rates are **configuration, not constants in code**. The
  per-connected-minute rate is **TBD** (Q1) and must be settable without a
  deploy. Adding a future unit of usage means adding a column to the pricing
  policy at that time, not carrying an unused one now.
- **F6.9** A **$500 cap per period, inclusive of the $100 fixed fee.** Usage
  **keeps accruing past the cap** — it is recorded in full, because Ringly needs
  the real number for cost and margin (F8). The cap is applied **at settlement**,
  not during the period: whatever was accrued, the business is charged at most
  $500 for the period.
- **F6.9a** **Settlement happens at exactly three moments**, and the clamp is
  applied at each:
  1. **Normal period end** — the usual case.
  2. **A cancellation window closing** (F6.12) — 7 days after the request or at
     period end, whichever comes first, which settles the period early.
  3. **Final deletion for non-payment** (F9.3), where the clamped figure is what
     the business is recorded as owing (F9.9) even though it is never collected.
- **F6.9b** On first crossing the cap Ringly **continues to serve the business
  and absorbs the excess**, **alerts the operator** (F8.6), and **emails the
  business** to say it has used enough to reach $500 and that everything for the
  rest of the period is on Ringly. Hitting the cap is good news for the business
  and should read that way.
- **F6.10** Billing repeats every 30 days with no action from the business —
  **unless the business has asked to cancel**. A business marked cancelled is
  **never charged again**, and resumes billing only if it explicitly withdraws
  the cancellation.
- **F6.10a** Because cancellation arrives by email (F9.2), **the operator sets,
  clears, and marks revoked a business's cancelled status from the operator
  dashboard** (F8.10). It is the single control that stops future charges.
  **Marking a cancellation revoked is its own act, distinct from clearing it**
  (F6.12a): clearing is for a cancellation that should never have been recorded,
  while revoking is a business changing its mind inside the window — and revoking
  has a consequence clearing does not, since the usage served during the window
  becomes billable again. One control doing both would make a billing outcome
  depend on which of the two the operator had in mind.
- **F6.10b** **Payment clearing is the trigger; restoration is the consequence.**
  Ringly does not charge a suspended business to bring it back — it is already
  being charged, continuously, by the retries that never stopped (F6.11b-i).
  **The moment nothing is outstanding, service resumes that same day**: the
  number is rebound and the business is emailed to say its phone is answering
  again.
  - **"Nothing outstanding" is the test, not "a payment arrived".** A business can
    owe a failed fixed fee and an unsettled usage bill at once; clearing one of
    two leaves it suspended, and the email says what remains.
  - **It does not matter how the payment cleared** — an automatic retry, a new
    card, or the business paying the invoice by hand. All three reach Ringly the
    same way (EDD §2.10.6).
  - **Which period they land in follows F6.11b-iii**: the original one if it is
    still running, otherwise a new one opened that day. **The original is never
    extended** — the days lost to suspension are lost (F6.11b).
  - Usage served during the 7-day grace before suspension **is billable and
    settles with its period** — service given is service billed.
- **F6.10b-i** **A business that has paid and is still not being answered is the
  worst state in the system**, so recovery must not depend on a single message
  arriving. If the notification of payment is lost, a **daily reconciliation**
  finds any suspended business that owes nothing and restores it (EDD §2.10.6).
  A lost notification may cost such a business hours; it must never cost it days,
  and it must never cost it the account.
- **F6.10c** **A new billing period opens, charged $100 that day, whenever
  service resumes and no period is running.** Two routes reach it:
  - **Returning from dormancy after cancellation** (F6.12e) — that path settled
    its period on the way out (F6.12b), so there is never one to resume.
  - **Returning from suspension after the original period already ended**
    (F6.11b-iii).

  Whether they keep their number and history depends only on whether their data
  still exists — inside the recoverable window they resume as themselves, after
  it they are a stranger.

- **F6.11** A failed charge starts a **7-day grace period**. Through it Ringly
  **keeps answering calls and keeps accruing usage**, and emails the business
  about the failure. If payment has not cleared by day 7, the account is
  **suspended** (F9.3).
- **F6.11a** **A business already behind on payment cannot cancel into free
  service.** If a cancellation arrives while a payment failure is unresolved, the
  business is treated as **non-paying**: the suspension clock keeps running
  (F9.3), no free window opens, and no usage is forgiven. Cancelling is not a
  route out of a debt.
- **F6.11b** **A billing period is 30 calendar days and is never extended.
  Suspension does not extend it, and a suspended business is charged nothing
  new.** (The one thing that can make a period _shorter_ is cancellation, which
  settles the final one early — F6.12b. Nothing ever makes one longer.) Two rules
  that sound like they conflict and do not:
  - **The period clock never stops.** `starts_at` and `ends_at` are set when the
    period opens and **never move**. A period that begins on the 3rd ends on the
    2nd of the following month whether the business was served for thirty of
    those days or seven.
  - **No new charge of any kind arises during suspension** — no fixed fee, no
    usage, no new period. Calls are not being answered (F9.3), so there is
    nothing to bill for.

  **A suspended business therefore loses service days it has already paid for,
  and that is the intended outcome.** The days were lost by not paying on time.
  Extending the period to give them back would mean a business that pays late
  ends up no worse off than one that pays on time, which is not a rule Ringly
  should be operating.

  - **Usage does not accrue during suspension**, because no calls are served.
  - **The $100 already invoiced for that period stands, whole and unprorated**
    (F6.11e). It was charged in advance for a period Ringly held open and stood
    ready to serve.
  - **A period _can_ end while suspended**, and this is the case the rule has to
    answer (F6.11d): it **settles on its original last day** for whatever usage
    accrued before suspension, clamped — and **no successor opens** while the
    business is still suspended.

- **F6.11b-i** **What pauses is the meter, not the collection of what is already
  owed.** These are two different things and conflating them breaks the recovery
  path, because the unpaid charge is the entire reason the business is suspended
  and paying it is the only way out.

  | During suspension                              | Continues? | Whose job  |
  | ---------------------------------------------- | ---------- | ---------- |
  | The **outstanding invoice** stays open and due | **Yes**    | Stripe     |
  | **Automatic retries** against the card on file | **Yes**    | Stripe     |
  | **Payment follow-up emails** to the business   | **Yes**    | **Ringly** |
  | The 48-hour deletion warning at ~day 58        | **Yes**    | **Ringly** |
  | New fixed fees                                 | **No**     | —          |
  | New usage charges                              | **No**     | —          |
  | New billing periods                            | **No**     | —          |

  A suspended business must be **chased as hard as any other debtor** — it is
  being asked to settle what it already owes, which is not a charge for the
  suspension. What it must never receive is a **new** charge for a service it is
  not getting.

- **F6.11b-ii** **Ringly writes and sends every one of those emails; Stripe
  retries the card in silence** (Q7, F6.20, F6.21). Suspension is a Ringly
  concept and Stripe knows nothing about it — not that the agent has been
  unbound, not that no new period will open, not that the number goes in 48
  hours.
  An email from Stripe during suspension could only say a card was declined,
  which is the least useful true thing available and would arrive alongside
  Ringly's saying something different. **Stripe's dunning stays off throughout**,
  including here.

  **The failure this guards against is the opposite of the one F6.11b guards
  against.** F6.11b stops Ringly billing for a phone nobody answers; F6.11b-i
  stops Ringly going quiet on a debt and letting a recoverable business drift to
  day 60 in silence. The implementation detail that makes the pair work is at
  EDD §2.10.8 — a subscription whose collection is fully paused would stop the
  retries, which is not what is wanted.

- **F6.11b-iii** **On restore, where the business lands depends on one question:
  is the period it was suspended in still running?**
  - **Still running** → service simply resumes inside it. **Nothing new is
    charged**, and it ends on its original date with however many days are left.
  - **Already ended** → **a new period opens on the day service is restored**,
    with $100 charged that day (F6.10c). The ended period stays settled on its
    own terms; there is no reaching back into it.

  **At most one period boundary can ever be crossed while suspended**, because no
  successor opens during suspension and the whole suspension is bounded at 60
  days (F9.3). There is no case of a business returning to find three periods
  stacked up behind it.

  **The debt clears first; the new period's fee is charged after.** These are two
  separate movements on the same day and the order is not cosmetic: restoration
  is triggered by owing nothing (F6.10b), so the new period cannot exist until
  the old debt is settled. A business paying its way out of suspension on a day
  when a new period opens is therefore charged **twice that day** — what it owed,
  then $100 — and both appear separately in its billing history (F5.9).

- **F6.11b-iv** **If the new period's $100 fails, that is a fresh failure with a
  fresh clock.** The old grace clock ended the moment the debt cleared; a decline
  on the new period starts a new 7-day grace from that day (F6.11), not a
  continuation of the one just closed. A business is never carried straight from
  suspension back into suspension without the full grace it is owed — and the
  60-day deletion clock restarts with it, because the previous one expired when
  the account was restored.

- **F6.11c** **No new billing period ever opens while the business owes
  anything.** Not during grace, not during suspension. This is the single rule
  that keeps a failing account from accumulating fees, and it holds from the
  moment the first charge declines until the moment the debt clears.
  - **A business in trouble is therefore only ever dealing with one period** —
    the one that was open when the trouble started, if any — and one debt.
  - **The period that was already open runs to its own end and settles there**
    (F6.11b), because it was opened and paid for, or invoiced, before any of this
    began. Its successor simply never arrives.
  - **A second decline does not start a second clock.** There is one, started by
    whichever charge failed first (F6.11), and outstanding amounts add up.

  **Without this rule a business is billed $100 for periods it never asked for
  and mostly did not receive**, discovering the total at the exact moment it is
  deciding whether to come back. With it, the debt a business must clear is
  bounded by what it actually used before Ringly stopped serving it.

- **F6.11c-i** **Grace service is a one-time concession per failure, not a
  recurring benefit.** The seven days are given once, when a payment first
  declines. They are not re-granted at what would have been the next period
  boundary, because there is no next period while the debt stands (F6.11c) — a
  business cannot collect a fresh week of free service every thirty days by
  continuing not to pay.

- **F6.11c-ii** **Grace usage is billed only if there is an open period to bill
  it to.**
  - **Usually there is**, and it settles with that period as ordinary usage —
    service given is service billed.
  - **In one case there is not**: when the failed charge _was_ the settlement of
    a period, that period closes on the same day (F6.16), and the grace that
    follows runs with no period open. **That usage is not billed.** There is
    nothing to bill it to, no successor opens (F6.11c), and inventing a period to
    hold it would be manufacturing exactly the $100 charge this design refuses.
  - **The cost is still recorded.** `cost_records` do not belong to a period, so
    Ringly keeps its true cost of serving those days (F8.5, R8) even though it
    charges nothing for them. **What Ringly absorbs, Ringly measures.**
  - It is bounded at seven days, once (F6.11c-i).

  **This makes grace mean two slightly different things, and that is accepted.**
  Where the fee declined, grace is _service continues and you still owe for it_;
  where the settlement declined, grace is _service continues and it is free_. The
  difference is not a policy choice about which failure deserves more sympathy —
  it falls out of whether a period happened to be open. **Recorded rather than
  smoothed over**, because the two ways to remove it are both worse: opening a
  period to bill against would manufacture a $100 charge on an already-failing
  account, and withholding service during the second kind of grace would punish
  the business that failed the _smaller_ of the two charges.

- **F6.11d** **Which period suspension lands in depends on which charge failed,
  and the two cases are not symmetric.** There are only two ways to fail a payment
  (F6.11) and they sit at opposite ends of a period, so both are worked through
  here in full. In each, day numbers are days of period _N_, grace runs 7 days
  from the failure, and **no period is ever extended** (F6.11b).

  **Case (a) — the $100 fixed fee fails.** Charged on **day 1** of period _N_, so
  the failure is at the very start of a period nobody has paid for.

  |                                                   |                                                                                                                                                                            |
  | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Day 1                                             | $100 invoiced, declined. Grace starts                                                                                                                                      |
  | Days 1–8                                          | Served. Period _N_ runs normally, usage accrues to it and is billable (F6.11c-ii)                                                                                          |
  | Day 8                                             | **Suspended.** Period _N_ keeps running; the business is simply not being served                                                                                           |
  | **Pay on day 20** — owes **$100**                 | That is the only invoice raised so far; _N_'s usage is not settled until day 30. Service resumes **inside _N_**, which still ends day 30. **Nothing else is charged then** |
  | └ then day 30                                     | _N_ settles as normal, for **days 1–8 _and_ 20–30** of usage — everything served, whenever it was served                                                                   |
  | **Day 30 while still suspended**                  | _N_ **settles on time** for its 7 days of usage (days 1–8), clamped, and that invoice joins the debt. **No _N+1_ opens** (F6.11b)                                          |
  | **Pay on day 45** — owes **$100 + 7 days' usage** | Both invoices must clear. _N_ is over, so **a new period opens day 45** and **its own $100 is charged then**, after the debt clears (F6.10c)                               |
  | Never pay                                         | Deleted at day 60 from the failure. Debt = the $100 **plus** the 7 days of usage, clamped (F6.9a)                                                                          |

  **Case (b) — the usage settlement fails.** Charged on the **last day** of period
  _N_, so _N_ closes that same day and **no successor ever opens** (F6.11c). The
  whole episode belongs to _N_.

  |                                          |                                                                                                                                                           |
  | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | Day 30 of _N_                            | Usage settled and invoiced; declined. Grace starts. **_N_ is closed** — `usage_settled_at` is set and it never reopens (F6.16)                            |
  | Days 30–37                               | **Served, under grace — and not billed.** There is no open period to bill it to and none opens (F6.11c-ii). Ringly absorbs it; the cost is still recorded |
  | Day 31                                   | **Nothing happens.** No period opens, no $100 is invoiced. The debt does not grow                                                                         |
  | Day 37                                   | **Suspended.** Service stops                                                                                                                              |
  | Outstanding, throughout                  | **One invoice: _N_'s usage settlement.** It never grows, however long the suspension lasts                                                                |
  | **Pay on day 45** — owes **_N_'s usage** | Nothing outstanding → restored that day. **No period is open, so a new one opens on day 45** with its own $100, charged then (F6.10c). It runs to day 74  |
  | **Pay on day 70** — owes **_N_'s usage** | **Identical.** A new period opens day 70, $100 charged then, running to day 99                                                                            |
  | Never pay                                | Deleted at day 90 (60 days from the day-30 failure). Debt = **_N_'s usage settlement and nothing else**, clamped                                          |

  **Case (b) has no second period in it at all**, and that is the whole point of
  F6.11c. Paying on day 45 and paying on day 70 are the same transaction: clear
  one invoice, start fresh at full price. The only thing later costs the business
  is the days its phone was not answered.

  **The seven grace days in case (b) are free**, and deliberately so
  (F6.11c-ii) — the period they would have belonged to closed the day the charge
  failed, and Ringly will not open a period to have something to bill them
  against. **They are given once** (F6.11c-i): a business that stays unpaid does
  not receive another week at what would have been the next boundary, because no
  boundary arrives.

  **The shape both cases share.** At most one period is ever open during a failure
  episode, and at most one debt accumulates. Paying while that period is still
  running resumes it with no new charge and no days given back; paying after it
  has ended — or when there was never one open — starts a fresh period at full
  price. **Late payment costs service days. That is the whole penalty, and it is
  enough of one.**

  **The debt never grows while a business is unpaid.** It is fixed by what was
  served before Ringly stopped serving, and a business deciding on day 55 whether
  to come back owes exactly what it owed on day 8. That is the property F6.11c
  exists to guarantee, and it is what makes the recovery path something a
  struggling business can actually take.

- **F6.11e** **The $100 is never prorated — not on suspension, not on
  cancellation, not on deletion.** A period that delivered 7 days of service still
  owes its whole fee.
  - **The fee buys the period, not the days consumed.** The same principle
    already governs cancellation, where it is not refunded for a period cut short
    (F6.12b). A business that was suspended could have had the rest of its days by
    paying; it chose the timing.
  - **Nothing is collected either way on the deletion path** (F6.12f) — this only
    fixes the figure on the departure record (F9.9). Prorating it would be
    arithmetic in service of a number nobody will ever be paid.
- **F6.11f** **A business has at most one open period at any moment, and periods
  never overlap or stack.** A settled period is finished; a suspended business
  opens none (F6.11b); a restored business either lands in the one still running
  or gets exactly one new one (F6.11b-iii). **There is no state in which two
  periods are live**, which is what keeps the billing history a simple ordered
  list a business can read down (F5.9).

- **F6.12** **Cancellation opens a short reconsideration window, then settles.**
  The window runs from the request until **whichever comes first: 7 days later,
  or the end of the current billing period**. During it:
  - **Service continues unchanged.** Calls answered, bookings taken, number
    untouched. A business that changes its mind finds everything as it was.
  - **Usage stops being billed.** Nothing accrued from the request onward is ever
    charged, though the service is still given. Ringly absorbs it.
  - **Countdown emails run through the window**, saying what happens, when, and
    what the business will and will not be charged.
- **F6.12a** **Revoking inside the window erases it, retroactively.** The
  business asks by emailing the same address it cancelled through (F9.2) and the
  operator marks the cancellation revoked (F6.10a). The period
  continues to its original end as though the request never happened — and the
  usage served during the window, which would have been free had they left,
  **becomes billable after all**. The free window is a concession for leaving,
  not a way to take a week of free service and stay.
- **F6.12b** **When the window closes, the period is settled early and service
  stops.** The business is charged the usage it accrued **up to the request**,
  clamped so the period total never exceeds $500 (F6.9a).

  **The $100 fixed fee is not refunded, in whole or in part.** It buys the
  period, and a business that leaves part-way through has still had the service
  it paid for — with free service on top for the length of the window. The
  earlier prorated-refund rule is withdrawn.

- **F6.12c** Settlement sends a **closing statement**: appointments booked in the
  final period, the usage charged, confirmation that the fixed fee is not
  refunded, and the date the account and its data will be deleted if they do not
  return.
- **F6.12d** The total charged for a period **never exceeds $500**, cancellation
  or not. Worked example: a business accrues $470 of usage in a period →
  `$100 + $470 = $570` → clamped to **$500**, so $400 of usage is charged and $70
  is absorbed by Ringly.
- **F6.12e** **The account then lies dormant for 60 days, fully recoverable.**
  Service has stopped, but **the phone number and every database record are
  retained**. A business that returns inside those 60 days resumes on **its own
  number with its own history** — customers, appointments and past figures all
  intact — on a **new billing period starting that day, with $100 charged that
  day**. Only after the 60 days is anything deleted, and a business returning
  after that is a wholly new account with a new number. Sixty days costs Ringly
  only the number rental, and far less than losing a business to a number it can
  no longer have.
- **F6.12f** **If the settlement charge fails, it is recorded and let go.** The
  amount is written to the departure record (F9.9) as owed. Ringly does not
  suspend, retry, or pursue a business whose service has already stopped —
  there is nothing left to withhold.
- **F6.13** The business dashboard shows current-period usage, amount accrued,
  the cap, and the next charge date.
- **F6.14** Every charge, refund, and failure is recorded immutably against the
  business for reconciliation.
- **F6.15** **The commercial terms are expected to change** once real usage is
  observed. The fixed fee, the cap, the per-unit rates, and **the definition of a
  billable call** must all be changeable without a schema migration or a
  redesign. What does **not** change: 30-day billing periods, the rule that data
  lives as long as the relationship and is purged **60 days** after it ends
  (F9.3, F9.8), and the two-phase shape of the lifecycle — a grace period, then
  suspension, then removal after a final warning (F9.3) — though the lengths of
  those phases may be tuned.
- **F6.16** A change to commercial terms **never rewrites history**. Each billing
  period is settled under the terms in force when it ran, so past invoices remain
  reproducible.

> **Architectural consequence.** Pricing is **policy data, not code**: rates, the
> cap, the fixed fee, and the set of outcomes that count as billable all live in
> a versioned `pricing_policy` record with an effective date, and each
> `billing_periods` row records which version it was settled under (EDD §2.4/007).
> Widening billing to all connected minutes — the expected next model — becomes a
> new policy row, not a deploy.

- **F6.17** A **chargeback is treated exactly as non-payment** (F9.3): the
  7-day grace and suspension, then full revocation at day 60, with follow-up
  emails throughout so the business can resolve it and recover. **No special
  handling** — Ringly does not pause the deletion clock while a dispute is open,
  does not build a dispute workflow, and contests or concedes disputes by hand in
  the Stripe dashboard. A dispute running longer than 60 days therefore resolves
  after the business is gone; accepted, because they are rare and the alternative
  is machinery for an event that may never happen.
- **F6.18** **Sales tax is collected through Stripe Tax**, configured per US
  state. Tax is Stripe's calculation, not Ringly's; Ringly stores the resulting
  amounts for reconciliation only.
- **F6.19** **Deleting a business tears down its external state before its own,
  in order**: capture the lifetime totals (F9.10) → cancel the subscription →
  void any open invoices → detach the payment method → delete the payment-provider
  customer → **email the business and the operator** (F9.3c) → **release the phone
  number to the telephony provider** (F9.4b) → **delete Ringly's rows and write the
  departure record, together in a single transaction** (F9.10). Deleting Ringly's
  rows first
  destroys the identifier every one of those steps needs, leaving a saved card on
  file belonging to nobody and a rented number belonging to nobody. The email goes
  before the number because releasing the number cannot be undone (F9.3d). The full
  reasoning for each position in that order is at EDD §2.13.4.
- **F6.20** **The division of responsibility with the payment provider is
  explicit, and nothing is done twice.** Where both could act, exactly one does:

  | Function                                                                     | Owner                                                                |
  | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
  | Tax calculation                                                              | **Stripe** — Ringly stores the amounts                               |
  | Invoices, receipts, payment-succeeded email                                  | **Stripe**, carrying Ringly branding                                 |
  | Retrying failed payments                                                     | **Stripe** — Ringly builds no retry loop                             |
  | Every failure-path email (failure, follow-ups, suspension, deletion warning) | **Ringly**                                                           |
  | The $500 cap and the clamp at settlement                                     | **Ringly** computes, Stripe executes                                 |
  | Refunds                                                                      | **Neither, automatically** — goodwill only, by hand in Stripe (F5.9) |
  | End-of-dunning behaviour and teardown                                        | **Ringly** (F6.19)                                                   |
  | Billing thresholds                                                           | **Neither** — deliberately not configured                            |
  | Self-service cancellation portal                                             | **Disabled** (§1.9)                                                  |

- **F6.21** **The failure path is Ringly's because only Ringly knows the
  consequence.** Stripe's dunning email can say a card was declined; it cannot
  say service continues for seven days, that nothing has been deleted yet, or
  what exactly is destroyed in 48 hours — those are Ringly's timelines and
  Ringly's data. Stripe's own dunning and receipt-on-failure emails are therefore
  **switched off**, or a business receives two differently-worded messages from
  what appears to be one company.

### F6a — The billing model, end to end

**Activation.** A business signs up, gets a number, and places up to **five** test
calls. To go live it must do three things — verify its email, confirm on its
dashboard that a test call worked, and add a card — and then **press Activate**.
That press charges the $100 and starts period 1; **nothing else does** (F1.12b).
At five test calls without activating, **the number stops answering** (F1.13a).
A business that never activates is removed entirely at day 10.

**A period.** Thirty calendar days from activation, **never extended for any
reason** (F6.11b). **$100 on the first day.** Usage
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

| Day  |                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0–7  | Service continues and **this usage is billable**. The period runs normally. Payment follow-up emails.                                                                                            |
| 7    | Suspended. Calls stop. **Number and all data retained.** The period keeps running — it is simply not being served                                                                                |
| 7–60 | **Nothing new is charged and nothing accrues.** Recoverable at any point; paying restores service that day, inside the same period if it is still running, otherwise on a fresh one (F6.11b-iii) |
| ~58  | 48-hour final warning.                                                                                                                                                                           |
| 60   | Number released, data deleted, the paused period settled for what was served and the debt recorded permanently.                                                                                  |

**Nothing new is billed for a suspended day, and no period is ever extended**
(F6.11b). A business suspended for ten days of its period simply gets twenty days
of service for its $100. **The lost days are the penalty for paying late**, and
they are the only penalty — Ringly adds no fee, no interest, and no charge for
the time it was not answering the phone.

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

### F6b — One business, end to end

_Illustrative, not normative. Where this and F6 differ, F6 wins._ A single
worked life, because the rules above are individually simple and only get hard
where they meet.

**Signing up — no money moves.** A salon lands on the site, types its name and
address, and Ringly enriches it from Places and builds a service menu from its
website. It signs in with Google, grants calendar access, and a number is bought
and an agent bound behind the value screen. **The account is `unbilled`. It has
been charged nothing and could walk away costing Ringly one number rental.**

**Getting ready — still no money.** The checklist shows three tasks. The owner
rings the number, hears the agent, books a test appointment, and ticks "it
worked". They verify the email that arrived. They add a card, **which is stored,
not charged** (F6.2). Three test calls used, two remaining (F1.13).

**Activation — the only thing that starts billing.** They press **Activate**.
$100 is charged, `billing_status` becomes `active`, and **period 1 opens: day 1
to day 30** (F1.12a). The agent is already bound, so the number is live. From the
next call onward, usage accrues on productive calls (F6.6).

**Period 1 runs.** 40 productive calls, 96 connected minutes. On **day 30**,
usage settles: the seconds are summed across the period, rounded up once to 96
minutes, priced at the rate pinned to this period, and charged. **Day 31: period
2 opens and its $100 is charged.** Two charges, one day apart, never the same day
(F6).

**Period 2, and the card expires.** On **day 31** — day 1 of period 2 — the $100
declines.

| Day   |                                                                                                                                                    |                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 31    | Charge fails. **Grace starts.** Email: _your service is still running_                                                                             | Owes **$100**          |
| 31–38 | **Served normally.** Usage accrues to period 2 and is billable. Follow-up emails count down                                                        | Owes $100              |
| 38    | **Suspended.** Agent unbound, verified (F1.12a-ii). The number stops answering. **Period 2 keeps running to day 60** — it is not extended (F6.11b) | Owes $100              |
| 38–60 | Nothing accrues, nothing new is charged. Stripe keeps retrying; Ringly keeps emailing (F6.11b-i, -ii)                                              | Owes $100              |
| 60    | **Period 2 ends on time and settles** for the 8 days of usage it did serve, clamped. That invoice joins the debt. **No period 3 opens** (F6.11c)   | Owes **$100 + 8 days** |
| 60–91 | Suspended, debt **frozen**. It does not grow by a cent however long this lasts                                                                     | Owes $100 + 8 days     |
| ~89   | 48-hour deletion warning                                                                                                                           |                        |

**Two endings.**

**They pay on day 75.** The retry succeeds; the webhook arrives; nothing is
outstanding (EDD §2.10.6). Ringly rebinds the agent and verifies it, and **the number
answers again that day**. No period is open, so **period 3 opens on day 75 and
its $100 is charged then** (F6.10c) — two movements on the same day, both in the
billing history. Period 3 runs to day 104. If _that_ $100 had declined, it would
be a **fresh** failure with a fresh 7-day grace (F6.11b-iv), not a continuation.

**They never pay.** At **day 91** — 60 days from the day-31 decline — the salon
is emailed, the number is released to Retell, and every Ringly row is deleted in
the same transaction that writes a departure record showing **$100 + 8 days of
usage** owed and never collected (F9.9). The customer records, appointments and
call history go with it (F9.1a-ii).

**What the salon paid across the whole story:** $100 for period 1, plus period
1's usage, plus — on the paying ending — the $100 and 8 days it owed for period
2, plus $100 for period 3. **It was never charged for a single day the phone was
not being answered, and the debt it had to clear on day 75 was exactly the debt
it had on day 60.**

**Who does what** is one table, in F7 — every scenario, who invoices and who
writes the words. **The teardown order** is F6.19, with the reasoning for each
position at EDD §2.13.4.

### F6c — Invariants

_Normative. Every one of these should hold for every business in every state; a
change that breaks one is a change to the commercial model, not a detail._

| #      | Invariant                                                                                                                                                                                                                                                          | Exceptions                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **I1** | **A billing period is 30 calendar days and is never extended** — not by suspension, not by grace, not by anything (F6.11b)                                                                                                                                         | **One:** cancellation settles the final period **early** (F6.12b). Periods can be cut short; none is ever lengthened                       |
| **I2** | **At most one period is open at a time, and none opens while the business owes anything** (F6.11c, F6.11f)                                                                                                                                                         | None                                                                                                                                       |
| **I3** | **A period's total is clamped to $500 inclusive of the fee (F6.9), and what is owed is that total less anything already collected.** Because only one period can ever be outstanding (I2), **$500 is the ceiling on what any business can owe** — exclusive of tax | None                                                                                                                                       |
| **I4** | **Nothing is deleted without a 48-hour warning email** (F9.3a)                                                                                                                                                                                                     | None                                                                                                                                       |
| **I5** | **No _new_ charge ever arises while a business is suspended** — no fee, no usage, no period (F6.11b, F6.11c). Its debt is frozen at what it owed when service stopped                                                                                              | **Not the same as "pays only for days served":** the fee already taken for the current period covers days it will not now receive (F6.11b) |
| **I6** | **The $100 is never prorated or refunded** (F6.11e, F6.12b)                                                                                                                                                                                                        | Goodwill refunds, by hand, which no rule produces (F5.9)                                                                                   |

**The two failure cases reach different ceilings**, because they differ on
whether the fixed fee was ever collected:

|                                        | Owed if they never pay                                                                                                              | Ceiling  |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Case (a)** — the fee declined        | `min($100 + usage, $500)`. The fee was invoiced and never collected, so the whole clamped total is owed                             | **$500** |
| **Case (b)** — the settlement declined | `min($100 + usage, $500) − $100` = `min(usage, $400)`. The fee was collected at period start, so only the usage half is outstanding | **$400** |

**$500 is therefore the ceiling across every scenario**, and only case (a)
reaches it. **Tax sits outside it** (F6.18): the cap clamps Ringly's own charges,
and Stripe Tax is added on top at invoice time.

**The departure record holds the figure exclusive of tax** (F9.9). Tax was never
Ringly's money and, on a debt that is never collected, was never remitted either;
including it would overstate what the business owes Ringly by an amount Ringly
would never have kept.

**Three things that are _not_ invariants**, listed because they read like they
should be:

- **"Everything is deleted at 60 days."** There are **three** deletion clocks and
  they start from different events: **10 days** for a business that never
  activated (F9.1, and the operator can pause it — F9.1b); **60 days from the
  first failed charge** for non-payment and chargebacks (F9.3); **60 days after
  service stops** for a business that cancelled, which is itself up to 7 days
  after the request (F6.12e) — so up to 67 days from that request.
- **"Free service never exceeds 7 days."** It is bounded at 7 in the two places
  that look like concessions — the grace period (F6.11) and the cancellation
  window (F6.12) — but **the $500 cap is deliberately unbounded within a period**
  (F6.9b). A business that reaches the cap on day 6 is served free for the
  remaining 24 days, and Ringly absorbs it on purpose. That is the single largest
  giveaway in the model and the one worth watching (R8).
- **"Grace always costs the business nothing."** Grace usage **is billed** when a
  period is open to bill it to, which is the ordinary case; it is free only when
  the failed charge was itself a settlement, because that period closed the same
  day (F6.11c-ii). **The asymmetry is known and accepted** — see F6.11c-ii for
  why the two ways of removing it are both worse than living with it.

### F7 — Email

- **F7.1** Business email goes to the contact address collected at onboarding
  (F1.11). Operator email goes to Ringly's own alert address.
- **F7.2** **Every email Ringly can send is declared in one place** —
  `src/emails/registry.ts`. If a message is not in that table it is not sent.
  The table fixes, per email: audience, sending identity, subject line,
  transactional status, and how its idempotency key is built.
- **F7.3** **Templates are React Email components versioned in this repository**
  (`src/emails/`). They are reviewed in pull requests like any other code, so a
  change to what a customer reads goes through the same scrutiny as a change to
  what the code does. No hosted template editor, no copy living in a vendor UI.
- **F7.3a** **Ringly does not send the success path.** Receipts, invoices and
  payment-succeeded notices are **Stripe's**, carrying Ringly branding (F6.20).
  Ringly sends no email that Stripe already sends well — the split is by who
  knows the consequence, not by who could technically send it (F6.21).
- **F7.4** **Transactional email cannot be unsubscribed from.** A business
  cannot opt out of being told its payment failed or its data is about to be
  deleted. **Only the periodic stats digest is optional.**
- **F7.5** **Sending is at-least-once, and a duplicate is the acceptable
  failure.** A worker that dies between handing a message to the provider and
  recording that it did will send it again. That is chosen, not tolerated: the
  only way to guarantee no duplicate is to risk losing the message, and **these
  are the messages a business cannot afford to miss** — a payment failure, a
  suspension, and the 48-hour warning that I4 makes unconditional. Reading
  something twice is an annoyance. Never being told your data is about to be
  deleted is a broken promise, and it is one nobody would discover until the data
  was gone.
  - **Every email carries one line telling the reader to ignore it if they have
    already had it** (F7.7). It costs a sentence and turns a duplicate from a
    defect into a non-event.
  - **The provider's own idempotency key is sent with every message** where the
    provider supports one, so most duplicates are collapsed before delivery
    rather than apologised for after it.
  - **A separate key still governs how many times there is a _reason_ to send.**
    That is a different question from how many times a send is attempted, and
    both are needed — without it an outage emails a business once per lost
    customer. Three shapes:
    - **per period** — at most one reason per business per billing period (the
      digest, the upcoming-charge notice, the cap notice);
    - **per incident** — at most one reason per continuous failure, however many
      calls it affects (calendar outage);
    - **per event** — one reason per discrete occurrence (a deletion warning).
  - **Nothing outside the registry is ever sent** (F7.2), whatever a retry
    does.

**Format defaults — every email**

- **F7.6** Plain and utilitarian. No images, no web fonts, no columns, no
  marketing voice. These are messages about money and service interruptions;
  they should read like a utility bill and survive Gmail clipping and Outlook.
- **F7.7** Structure is fixed: wordmark, one heading stating the situation, body
  copy in plain language, a facts table for any figures, **at most one call to
  action**, then the footer. **The footer carries the line telling the reader to
  ignore the message if they have already received it** (F7.5) — on every email,
  without exception, because the email that gets duplicated is the one whose
  worker died and there is no way to know in advance which that is.
- **F7.8** Every email states **what has happened, what it means for the reader,
  and what happens next if they do nothing**. An email that leaves the reader
  unsure whether they must act has failed. Email should include call to action, if needed.
- **F7.9** Amounts always carry currency; dates are always absolute ("14 August"),
  never relative ("in 3 days"), because delivery may be delayed.
- **F7.10** Subject lines are under ~60 characters, state the situation rather
  than tease it, and never use urgency the body does not justify.
- **F7.11** **Separate sending identities per stream** — billing, service,
  reports, operator alerts — so a digest nobody opens can never harm the
  reputation of the address that tells someone their payment failed.

**Business-facing email — the full set**

**Every row below is an email Ringly sends.** Receipts, invoices and
payment-succeeded notices are **absent by design** — they are Stripe's (F7.3a),
and duplicating them is how a business ends up with two differently-worded
messages from what looks like one company (F6.21).

| Email                   | When                                          | Tone default                                                                                                                                                                                                   |
| ----------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email verification      | Contact email entered (F1.11)                 | Functional; one link, nothing else                                                                                                                                                                             |
| Welcome / now live      | Activation completes (F1.12a)                 | Welcoming; **states the number is now taking customer calls**                                                                                                                                                  |
| Upcoming charge         | Before each period's fixed fee                | Neutral; no action needed                                                                                                                                                                                      |
| Payment failed          | First decline (F6.11)                         | Calm, **leads with "your service is still running"**                                                                                                                                                           |
| Payment follow-up       | Through the grace period                      | Firmer, counts down to the date service stops                                                                                                                                                                  |
| Suspension notice       | Day 7 (F9.3)                                  | Direct, **leads with "nothing has been deleted"**                                                                                                                                                              |
| **Service restored**    | Nothing outstanding after suspension (F6.10b) | **Leads with "your number is answering again"**; states the new period end date, since the period was paused (F6.11b)                                                                                          |
| Deletion warning        | 48 hours before deletion (F9.3a)              | Unambiguous; itemises exactly what is destroyed                                                                                                                                                                |
| Cap reached             | $500 reached (F6.9b)                          | **Good news** — they earned it, the rest is on Ringly                                                                                                                                                          |
| Cancellation confirmed  | Operator marks cancelled (F6.10a)             | Matter-of-fact; **states the fixed fee is not refunded** (F6.12b)                                                                                                                                              |
| Cancellation countdown  | Through the reconsideration window (F6.12)    | Neutral; the date service stops, and how to revoke                                                                                                                                                             |
| Closing statement       | Cancellation window closes (F6.12c)           | Final; usage charged, fee not refunded, deletion date                                                                                                                                                          |
| Calendar access failing | Bookings being refused (F2.7)                 | Urgent, explains _why_ refusing beats double-booking                                                                                                                                                           |
| **Account deleted**     | Teardown completes, on every path (F9.3c)     | Final and factual: what was deleted, that the number is gone for good, and any amount recorded as owed. **Sent before anything irreversible — the number release and the row deletion both follow it** (F9.3d) |
| Test calls exhausted    | 5th test call, not activated (F1.13a)         | States plainly that the number has stopped answering, that they are not charged, and that activating turns it back on (F1.13b)                                                                                 |
| Stats digest            | Each billing period (F7.4)                    | Light; the only unsubscribable email                                                                                                                                                                           |

**Who raises the money and who writes the words — every scenario**

One rule underneath the table: **Stripe invoices, charges and retries; Ringly
decides the amounts and writes every message except the three Stripe already
sends well.** Stripe's dunning is off throughout (F6.21), including during
suspension (F6.11b-ii).

| Scenario                    | Invoice + charge                                   | Email to the business                                     |
| --------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| Activation, period 1's $100 | **Stripe** (Ringly triggers)                       | Receipt: **Stripe** · "You're live": **Ringly**           |
| Each period's $100          | **Stripe**                                         | Upcoming charge: **Ringly** · Receipt: **Stripe**         |
| Usage settlement            | **Stripe** — Ringly computes and clamps (F6.9)     | Receipt: **Stripe**                                       |
| $500 cap reached            | — nothing charged                                  | **Ringly**                                                |
| Payment declines            | Stripe retries, 60-day schedule                    | **Ringly**                                                |
| Through grace               | Stripe still retrying                              | **Ringly** — follow-ups                                   |
| Suspension                  | Stripe **still retrying**; no new invoice (F6.11c) | **Ringly** — suspension notice, then follow-ups           |
| Service restored            | New period's $100, if one opens: **Stripe**        | **Ringly**                                                |
| 48h before deletion         | —                                                  | **Ringly**                                                |
| Deletion                    | Teardown voids open invoices (EDD §2.13.4)         | **Ringly** — to the business **and** the operator (F9.3c) |
| Cancellation requested      | — nothing charged in the window                    | **Ringly** — confirmation, then countdown                 |
| Cancellation settles        | Final usage: **Stripe**                            | **Ringly** — closing statement                            |
| Refund (goodwill only)      | **Stripe**, by hand (F5.9)                         | none automated                                            |
| Test calls exhausted        | — never charged                                    | **Ringly**                                                |
| Calendar unreachable        | —                                                  | **Ringly**                                                |
| Stats digest                | —                                                  | **Ringly**                                                |

**Stripe sends exactly three things to a business: invoices, receipts, and
payment-succeeded** (F7.3a). Everything else in the table is Ringly's, because
every other message depends on something Stripe does not know — that service
continues seven days, that the agent has been unbound, that no new period will
open, or what is destroyed in forty-eight hours.

**Operator-facing email**

- **F7.12** Operator alerts are a different product from business email: read on
  a phone, at an inconvenient moment. Each **leads with the business name and
  the money at stake**, and says what happens if it is ignored. No reassurance,
  no marketing voice.
- **F7.13** The set: business hit its cap (with cost-to-serve and margin, so an
  unprofitable tenant is visible immediately), payment failed, calendar
  unreachable, activation stuck, **unactivated and about to expire** (F8.6a),
  **a number that would not release** (F7.13a), and **business deleted** — the
  last carrying lifetime net revenue and the amount left owing, since deletion
  is the only moment those totals are final (F9.3c).
- **F7.13a** **A failed unbind is raised to the operator**, naming the business,
  the number still answering, and the reason Ringly tried to release it. F1.12a-ii
  establishes that a failed unbind leaves a number **answering calls Ringly has
  decided to stop serving and stopped metering** — a revenue leak and a
  correctness failure at once — and that _nothing else in the system would ever
  notice it_, because every other component believes service has stopped. An
  alert is therefore the only thing standing between that state and a number
  that answers, unmetered, until someone happens to look. It carries the same
  urgency as a cap breach: it is money leaving.
- **F7.14** These move to Slack later (F8.6). The format carries the same
  information either way, so the move is a transport change rather than a
  rewrite.

**When a message cannot be delivered**

- **F7.15** **Mail that cannot be delivered is surfaced, never swallowed.** A
  message is only useful if it arrives, and the whole of F7 is built on the
  assumption that telling a business something counts as having told them. When
  that assumption fails it must fail **loudly to Ringly**, because it has already
  failed silently to the business.
  - **There are two ways a message fails permanently, and the second is worse.**
    Either **the send never succeeded** — the delivery provider was unreachable
    and the retries ran out — or **the provider accepted it and the recipient's
    mail server rejected it**. The second is the dangerous one: it looks like
    success at every point except the inbox, and a wrong or dead contact address
    produces it every single time.
  - **Both appear as a named condition on the operator's "needs attention" queue**
    (F8.12). The business cannot be told by email that its email is not working,
    so a human has to reach them another way.
  - **It does not become a new operator alert email** (F7.13 is a closed set).
    An address that bounces is a queue entry to work through, not a page in the
    night.
  - **An undeliverable deletion warning is the case that matters most**, because
    I4 says nothing is deleted without one. Whether "warned" means _sent_ or
    _delivered_ is deliberately settled at F9.3c — best effort to the address on
    file, because an unactivated business may never have confirmed an address —
    but the operator sees it, and that is the point of the queue.

### F8 — Operator dashboard (Ringly-internal)

- **F8.1** Visible **only to the operator**. No business owner may reach it by
  any route, with any credential. This is the single screen that reads across all
  tenants and is therefore treated as a walled garden (EDD §2.11, N1.1).
- **F8.2** **Two filters, governing everything on the page:** a **range**
  (`current calendar month` · `past 3` · `past 6` · `past 12`) and a **business
  selector** listing every business active in that range, from which the operator
  picks one, several, or all.
- **F8.2a** **The main view is money, and it is a table** — one row per business:
  **net revenue · cost · margin**, sortable on any column. With thousands of
  businesses no chart distinguishes them; a table sorted by margin puts the ones
  losing money at the top, which is the question the operator actually has.
- **F8.2b** **Two charts.**
  - **Margin over time**, one column per calendar month across the selected
    range, aggregating whichever businesses are selected. Margin can go
    **negative** (R8), so this chart has a **zero baseline** and distinguishes
    positive from negative — a losing month must not render as merely a shorter
    bar.
  - **Outcomes × time of day**, grouping by one and filtering the other, exactly
    as F5.4b does for the business.
- **F8.2c** **No per-business call volume, duration, or outcome columns in the
  table.** Those questions are about one business and are answered by opening
  that business's own dashboard (F8.2e), one click away and in the form the
  business itself sees. The main table is money, and stays money (F8.2a).

  **This does not exclude the aggregate outcomes × time-of-day chart** in F8.2b,
  which answers a different question — how calls behave across the platform, or
  across whichever businesses are selected — and cannot be got by opening one
  dashboard at a time.

- **F8.2d** **No unique-caller or per-customer figures anywhere.** Same reason as
  F5.3: a customer cannot be reliably identified, so the number would be a guess.
- **F8.2e** **The operator can open any business's own dashboard**, exactly as
  that business sees it, by picking the business from a **drop-down of business
  names**. This is how a support conversation gets resolved — looking at the same
  screen the person on the phone is describing.
  - **Read-only. Every control in F5.15 is absent**, not disabled — editing
    services and hours, setting horizons, confirming a test call, and the digest
    opt-out. **There is no customer-deletion control to hide**, here or on the
    business's own dashboard (F9.1a).
  - **Visibly a borrowed view**, banner-marked with the business's name.
  - **Not impersonation.** No business session is created and no business
    credential is used; the page renders inside `/ops` from the operator's own
    session (EDD §2.11).
- **F8.3** Payment reliability per business — paid on time, late, failed,
  currently past due — so irregular payers are visible at a glance.
- **F8.4** Platform totals: revenue, cost, margin, and **the number of active
  businesses**, across all businesses in the selected range.
- **F8.5** **Cost model (v1): two lines, both billed per business per call.**
  - **Telephony and the voice agent** — the number rental plus all per-call
    charges including the agent's own LLM.
  - **Outcome classification** — the model call that labels each call's outcome
    (EDD §2.9.1). It is a separate vendor and a separate charge from the agent's
    LLM, and it is metered per call, so it belongs here rather than in platform
    overhead. It is small next to telephony and **is not therefore allowed to be
    invisible**: a cost that nobody attributes is a cost nobody notices growing.

  Deliberately excluded: the database and the application host (fixed platform
  overhead, immaterial per tenant, and **not yet chosen** — N8) and Google Places
  (one-off at onboarding, considered covered by the first $100). A cost line is
  added to this model only when something new is billed per business; nothing is
  carried here in advance of that.

- **F8.6** **Operator alerts** are the set in F7.13 and no other: a business
  reaching its cap (F6.9b, with cost-to-serve and margin), a payment failure,
  a calendar unreachable (F2.7), an activation stuck (F1.13a), **an unactivated
  business approaching deletion** (F8.6a), **a number that would not release**
  (F7.13a, F1.12a-ii), and a business deleted (F9.3c).
  Delivered by **email** initially. _Moving operator alerting to Slack is
  deferred (§1.9)._
- **F8.6a** **An unactivated business is raised to the operator before its 10-day
  clock runs out**, whether or not it is stuck (F1.13a). The two conditions are
  different and both need a human:
  - **Stuck** means it _cannot_ activate — no test call ever worked — and Ringly
    is the blocker.
  - **Expiring** means it _has not_ activated, for any reason, and is about to be
    deleted with its number released. It may be a business that got busy, hit a
    problem Ringly never saw, or is one prompt away from paying.
  - **This is the last moment anything can be done.** After deletion the number
    is gone to the carrier and the account is a stranger (F9.4b) — an outcome
    worth one email to avoid, given a signup already cost Ringly enrichment,
    a number, and up to five calls.
  - **Timed to leave room to act**, not fired at the deadline. The operator can
    then reach out, pause the clock (F9.1b), or let it lapse deliberately.
- **F8.7** **The operator dashboard follows the same freshness rule as the
  business one** (F5.16): served from the nightly rollup, complete to a stated
  date, with **median duration the one live figure and labelled as such**. One
  rule, one pipeline, one explanation — and the operator and the business looking
  at the same numbers on a support call is worth more than the operator seeing
  four hours further ahead.
  - **Money is the exception, and it is a different exception.** Revenue, cost
    and margin are only counted once they are real (F8.8), so they are as fresh
    as the payment provider's own records and no fresher. They are not "live" in
    the sense the median is; they are **settled**, which is a stronger property.
  - **The operational panels are live** — needs attention, idle numbers, payment
    reliability (F8.12, F8.9, F8.3). They exist to prompt action today, and a
    business whose calendar broke this morning must not first appear tomorrow.
- **F8.8** Figures are reported **by calendar month** (June, July, August), not by
  each business's 30-day period. No two businesses share a period, so per-period
  reporting cannot be summed into anything meaningful for accounting. Only
  **money actually received into Stripe** counts as revenue, and only **real
  incurred cost** counts as cost — neither is accrued or projected.
- **F8.9** Shows **rented phone numbers that are not earning**: numbers held for
  businesses that never activated, are suspended, or are otherwise not paying the
  $100 minimum. Every such number is a standing cost with no revenue against it.
- **F8.10** The operator **sets, clears, and marks revoked a business's cancelled
  status** here (F6.10a), since both cancelling and revoking arrive by email
  (F9.2). It is the control that stops future charges, and the only place it
  exists. **Revoked is a distinct outcome from cleared**, because revoking inside
  the window makes the usage served during it billable again (F6.12a).
- **F8.11** Shows the same **outcome definitions** the business sees (F5.7), so
  both sides of a conversation about the numbers are reading the same
  definitions.
- **F8.12** **"Needs attention" is a table of named conditions, not a feeling.**
  Every row is a business, the condition it is in, how long it has been in it, and
  what the operator can do. Ordered by how little time is left to act.

  **Broken now — a customer is being turned away as you read this**

  | Condition            | Trigger                                                                               | Operator action                                                                                                |
  | -------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
  | **Bookings failing** | An open calendar incident (F2.7)                                                      | Get them to reconnect the calendar; every caller meanwhile is refused                                          |
  | **Activation stuck** | 5 test calls used, never confirmed (F1.13a) — **their number is no longer answering** | Investigate; then reset the allowance and rebind (F9.1c). They are waiting on Ringly and are not being charged |

  **About to lose the business**

  | Condition                    | Trigger                            | Operator action                                             |
  | ---------------------------- | ---------------------------------- | ----------------------------------------------------------- |
  | **Deletion imminent**        | Inside the 48-hour warning (F9.3a) | Last chance; number and data go permanently at the deadline |
  | **Suspended**                | Day 7+ of non-payment (F9.3)       | Their phone is not being answered; recoverable until day 60 |
  | **Cancellation window open** | Requested, not yet settled (F6.12) | They can still revoke; the window is short                  |
  | **Unactivated, expiring**    | Approaching day 10 (F9.1)          | Pause the clock (F9.1b) or let it lapse                     |
  | **Payment failed**           | Inside the 7-day grace (F6.11)     | Service still running; Stripe is retrying                   |

  **Costing Ringly money**

  | Condition               | Trigger                                            | Operator action                                                                                         |
  | ----------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
  | **At cap**              | Reached $500 for the period (F6.9b)                | Everything further is absorbed; check the pricing fits them                                             |
  | **Negative margin**     | Cost exceeded revenue for the range (R8)           | The unbooked-call economics are not working for this business                                           |
  | **Number not released** | An unbind failed its read-back (F1.12a-ii, F7.13a) | Release it by hand. It is still answering calls nobody is metering, and no other signal will surface it |

  **Needs a human, or nothing will happen**

  | Condition               | Trigger                                                                        | Operator action                                                                                            |
  | ----------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
  | **Clock paused**        | An operator paused a lifecycle deadline (F9.1b)                                | Resolve and unpause — a paused clock never resumes itself                                                  |
  | **Dispute open**        | A chargeback was filed (F6.17)                                                 | Contest or concede by hand in Stripe; may outlast the account                                              |
  | **Debt on departure**   | A settlement charge failed (F6.12f)                                            | Informational — recorded as owed, not pursued                                                              |
  | **Email undeliverable** | A message exhausted its retries, or the recipient's server rejected it (F7.15) | Reach the business another way and correct the address. **Assume they know none of what the message said** |

  A business can appear under several conditions at once and is listed once per
  condition, because they need different actions.

- **F8.13** The operator can **pause the 10-day unactivated clock** on an
  individual business (F9.1b), and see which businesses are paused and since
  when. A pause is an explicit act with a visible owner, never a side-effect.

### F9 — Account lifecycle, suspension and data retention

- **F9.1** **An unactivated business is bounded twice, because it is pure
  cost** — a rented number and live call minutes against no revenue, with no
  relationship to protect:
  - **five test calls**, after which the number stops answering (F1.13, F1.13a);
  - **ten days**, after which the business is removed entirely — number released,
    everything deleted.

  **The two limits are independent and bite in either order.** A business can
  exhaust its calls on day one and sit unbound for nine more, or never call at
  all and be deleted on day ten with its allowance untouched. Only the operator
  changes either (F9.1b, F9.1c).

- **F9.1a** **A consumer has no direct route to Ringly**, and does not need
  one. A caller wanting their data removed asks the **business**, which is who
  they have a relationship with; Ringly is the business's service provider
  (N6.5) and offers the caller no interface.

  **Customer PII is destroyed on exactly one occasion: when the business itself
  is deleted.** There is no second occasion and no partial one. Nobody at Ringly
  can do it, the business cannot do it from its dashboard, and no support action
  reaches it.

  **There is deliberately no way to delete a single customer.** An earlier
  version of this document gave the business a self-serve control for it; that
  requirement is **withdrawn**, and its absence is the design:
  - **A per-customer delete is a per-customer lookup**, and Ringly does not have
    one. Every figure in this product is aggregate precisely because a customer
    cannot be reliably identified (F5.3, F5.11) — the same person rings from two
    phones and becomes two records (F2.4). A control that resolves a phone number
    to a customer in order to erase them is the per-customer view the dashboard
    exists to exclude, arriving through a side door.
  - **Deleting one customer rewrites settled figures or lies about them.** Their
    past appointments carry revenue the rollups already counted (F5.3) and
    invoices already settled against them (F6.16). Either those figures move,
    which breaks F6.16, or the appointment is kept with the name stripped, which
    means the deletion was partial and the product said it was not.
  - **A deletion path nobody can reach cannot be got wrong**, and this one would
    be reached rarely and tested least.

  **The consequence is stated rather than hidden** (R23): a business that
  receives a consumer erasure request cannot action it through Ringly except by
  ending its own account. Ringly is the processor and the business is the
  controller (N6.5), so the obligation is the business's — but Ringly's ability
  to assist with it is, deliberately, all-or-nothing.

- **F9.1a-i — Retired.** The number is left unused so references in earlier
  documents and commits still resolve. It held the withdrawn per-customer
  deletion path.

- **F9.1a-ii** **Every customer goes when the business does, automatically, and
  only then.** When a lifecycle deadline expires — day 10 unactivated, day 60
  suspended, or 60 days dormant after cancellation — the sweeper deletes the
  tenant, and **customers, appointments and calls are ordinary tenant rows caught
  by that** (F9.3, F9.8). **Nobody requests it and nobody performs it.**

  **They are deleted in the same transaction that writes the departure record**
  (F9.10). Not before it and not after it: the business ceasing to exist and its
  customer data ceasing to exist are one event, and there is no window in which
  either has happened without the other.

  **Exactly one thing survives, and it contains no consumer data by
  construction**: `departed_businesses` (F9.9) — the business's id and name, when
  it joined and left, how it ended, what it owed, and what Ringly earned from it.
  **No caller name, no caller number, no appointment.** That is a property to
  preserve, not a coincidence: the departure record must never become a way for
  customer data to outlive the deletion that was supposed to remove it.

- **F9.1b** **The operator can pause the 10-day clock on any individual
  business**, from the operator dashboard (F8.13). A business whose test calls
  all failed (F1.13) is waiting on Ringly, not the other way round, and would
  otherwise be deleted while the problem is being investigated. **Silence is not
  a pause:** absent an explicit operator action the default stands and an
  unactivated business is removed at day 10.
- **F9.1c** **Resetting the allowance and rebinding the agent are one operator
  action**, taken once the fault is fixed. A business whose five calls all failed
  has an unbound number (F1.13a) **and** an exhausted allowance, so restoring one
  without the other leaves it exactly as stuck as before — a phone that rings
  nowhere, or an answering phone with no calls left to prove itself with. The
  operator normally does this alongside pausing the clock (F9.1b).
- **F9.2** **Cancellation is not self-serve in v3.** All business-initiated
  account actions — cancellation, **revoking a cancellation**, deletion and
  reactivation — go through Ringly's **official contact email address**, which is
  the single supported channel.
  - **It is the same address in both directions.** A business that emailed to
    cancel emails that same address to undo it, and the address is stated in
    every cancellation-countdown email so it is in front of them at the moment
    they might change their mind. Asking someone to find a different route to
    reverse a decision than the one they used to make it is how a reconsideration
    window goes unused.
  - **A revocation is judged by when the business sent it, not by when Ringly
    read it.** The window is short (F6.12) and the channel is asynchronous, so a
    request sent inside it stands even if it is actioned after it has closed.
    Otherwise a business that changed its mind in good time loses its account to
    Ringly's own inbox latency.
    _(Self-serve cancellation and self-serve revocation are both deferred to soon
    after v3 — §1.9.)_
- **F9.3** The two paths differ sharply. **Non-payment withdraws service after
  a week. Cancellation never withdraws it at all** — it runs out the period the
  business already paid for.

  **On payment failure** — the clock starts the day the _first_ charge fails,
  whether that was a fixed fee or a usage settlement:

  | Day  | What happens                                                                                                                                                                      |
  | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 0    | Charge fails. Service continues, usage keeps accruing, business emailed.                                                                                                          |
  | 0–7  | **Grace period.** Calls answered as normal. Payment follow-up emails sent. This usage **is billable** — service given is service billed.                                          |
  | 7    | **Suspended.** Calls stop being answered; **the number and all data are retained**. Any open period keeps running and is not extended (F6.11b); **none opens** (F6.11c).          |
  | 7–60 | Suspended and **charged nothing whatsoever** — no fee, no usage, no new period. Fully recoverable: paying what is owed restores service and resumes the period that day (F6.10b). |
  | ~58  | **48-hour final warning by email**, itemising exactly what will be deleted.                                                                                                       |
  | 60   | **Full stop.** Number released, Ringly-held data deleted, the paused period settled for what was served, amount owed recorded permanently (F9.9).                                 |

  Days 7–60 cost Ringly almost nothing — service has already stopped, and only
  the number rental continues — so the window is long, because the business's
  number is worth far more to them than the rental is to Ringly. **It costs the
  business nothing at all**, which is the point: Ringly does not charge for a
  phone it is not answering.

  **On a cancellation request** — a short window, then dormancy:

  | Point               | What happens                                                                                                                                   |
  | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
  | Request             | Operator marks it cancelled (F6.10a). **Service continues. Usage stops being billed. Nothing settled** (F6.12).                                |
  | Until window closes | Reconsideration window — **7 days, or period end, whichever is sooner**. Service runs free. Countdown emails explain what is coming.           |
  | Any time inside it  | Revoking erases the request; the period continues to its original end and billing resumes (F6.12a).                                            |
  | **Window closes**   | Period settled early. Usage to the request date charged; **no refund of the fixed fee**. Service stops. **Closing statement sent** (F6.12b–c). |
  | + 0 to 60 days      | **Dormant.** Number and all data retained. Returning resumes the same number and history on a new period (F6.12e).                             |
  | + 58 days           | **48-hour final warning** before deletion.                                                                                                     |
  | + 60 days           | Number released, Ringly-held data deleted (F9.8). A later return is a wholly new account.                                                      |

- **F9.3a** **Nothing is ever deleted without a 48-hour warning email first.**
  This applies to both paths and is not conditional on the business having read
  earlier emails.
- **F9.3b** A business that has asked to cancel is **not** retried for payment
  (F6.10); the retry loop applies only to the non-payment path.
- **F9.3c** **Deletion is confirmed by email to the business and to the
  operator, on every path** — day 10 unactivated, day 60 non-payment, 60 days
  after service stops for a cancellation.
  - **To the business:** what has been deleted, that **the number is gone
    permanently and cannot be recovered** (F9.4b), and any amount recorded as
    owed (F9.9). The 48-hour warning said this was coming (F9.3a); this says it
    has happened. A business that ignored the warning and rings its own number a
    week later deserves a better answer than a dead line.
  - **To the operator:** the same event, with the money — lifetime net revenue
    and the amount left owing — because deletion is the moment a customer
    relationship ends and the only moment those totals are final (F7.13).
  - **It is sent even when the address was never verified** (F1.11). An
    unactivated business may never have confirmed its email; best effort to the
    address on file is better than deleting in silence.
- **F9.3d** **The deletion email is sent before anything irreversible happens to
  the business.** Two constraints fix its position and both are load-bearing:
  - **Before the tenant rows are deleted**, because `departed_businesses`
    deliberately keeps no contact details (F9.9) and once teardown removes the
    tenant row there is no address left to write to.
  - **Before the number is released** (F9.4b), because that step cannot be
    undone: the number goes back to the carrier and neither Ringly nor the
    business can have it again. Sending first means a send that fails outright
    halts teardown while the business is still whole and still recoverable,
    rather than after it is neither.

  **The send is enqueued, not waited on.** The idempotency key is written before
  the send (F7.5), so the message is durable the moment it is queued and teardown
  never blocks on the email provider retrying (N7). A rented number must not stay
  open, billing Ringly, because Resend is slow.

  This fixes the position of the send inside the teardown order (F6.19, EDD
  §2.13.4) — it is not a step that can be moved to the end for tidiness.

- **F9.4** A business's telephone number is its public identity, printed on
  signage and listings, and losing it is not recoverable. **How long it is held
  after service ends depends on why service ended:**
  - **Never activated** — removed at **day 10** (F9.1). No relationship to
    protect.
  - **Non-payment or chargeback** — held to **day 60** (F9.3), recoverable
    throughout by paying what is owed. Holding it costs Ringly only the rental;
    releasing it early costs the business its identity.
  - **The business's own cancellation** — held a further **60 days** after
    service stops (F6.12e), fully recoverable, because a business that left in
    good standing may come back and should find itself intact.
- **F9.4a** **A number is never reassigned while any business still holds it.**
  Suspension and dormancy stop the number being answered, which makes it look
  unused; it is not. A number leaves a business **only at deletion** — day 10
  unactivated, day 60 otherwise — and never during a suspension or dormancy
  period, however idle it appears.
- **F9.4b** **At deletion the number is handed back to the telephony provider,
  not retained in a Ringly pool for the next business.** Recorded with its
  reasoning so the question is settled:
  - **There is no purchase price to save.** Retell numbers are a **$2/month
    rental with no one-time purchase fee**, so holding one costs $2/month for as
    long as it sits idle and buying a fresh one when needed costs the same $2/month
    starting only when needed. Pooling is strictly more expensive, and it
    manufactures exactly the cost F8.9 exists to surface.
  - **A departed business's customers keep calling its number** — from saved
    contacts, printed material, a vehicle, a stale listing. Reassigning it means
    those callers reach **a different business's receptionist**, which answers as
    that business and may book them an appointment at the wrong one.
  - **Carriers quarantine numbers for a reason.** US rules require **at least 45
    days** after disconnection before reassignment, and carriers commonly hold
    30–90. Handing the number back makes that quarantine the provider's
    responsibility and the provider's cost.
  - **The residual risk is customer confusion, not regulatory.** Ringly is
    inbound-only, so reassigned-number liability that attaches to outbound
    callers does not reach it. That lowers the stakes; it does not change the
    decision, because the cost argument alone already favours handing it back.
- **F9.5** **Deleting a business deletes Ringly's own database only**, plus the
  external teardown in F6.19. Transcripts and recordings expire on their own
  **30-day TTL** with the telephony provider (F9.6), and Ringly does not chase
  them — with one exception, which exists because the general rule does not hold
  everywhere:
  - **On the 60-day paths** (non-payment, cancellation) the TTL has long since
    expired by the time deletion runs. Nothing to do.
  - **On the 10-day unactivated path (F9.1) it has not.** A test call placed on
    day 1 is held by the provider until day 31, three weeks after the business
    and every record of it are gone. **Ringly therefore issues an explicit
    provider-side deletion for that path**, or the business's calls outlive the
    business — the one case where "the TTL is always shorter" is simply false.
    _(The earlier blanket claim that provider content always expires first is
    withdrawn.)_
- **F9.6** **Ringly stores neither transcripts nor recordings.** Both remain
  with the telephony provider and are fetched on demand when needed. Retention is
  configured **on every provisioned agent**, never inherited from a default:
  - **Recordings: 30 days.** Deliberately generous for now so early calls can be
    reviewed while the product is being proven; to be reduced once recordings are
    shown to behave.
  - **Transcripts: at least 30 days**, and never shorter than recordings.
- **F9.7** Because transcript and recording retention live with the provider,
  **call content older than 30 days is not retrievable** — by the business or by
  Ringly. Any requirement that depends on older call content must be read against
  this limit.
- **F9.8** **Retention of Ringly's own data: everything lives as long as the
  business does.** Ringly does not age out any table while a business is active.
  Call records, customers, appointments, usage, costs and money records are all
  needed by the business dashboard, the operator dashboard, and invoice
  reconciliation — all of which look back over months, not days.
  - The **only** thing on a 30-day clock is what Ringly does **not** store:
    transcripts and recordings, held by the telephony provider (F9.6).
  - Everything Ringly holds is destroyed when the relationship is over, on the
    clock the ending sets (F9.3, F9.4): **day 60** for non-payment, **60 days
    after service stops** for a business that cancelled, **day 10** for one that
    never activated.
  - **It all goes at once, in the transaction that writes the departure record**
    (F9.1a-ii, F9.10) — customers, appointments, calls, usage and costs together.
  - There is no partial or rolling deletion, no field-level expiry, and **no way
    to delete any part of it early** (F9.1a).
- **F9.9** **A departed business leaves a permanent financial record.** When a
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

- **F9.10** **The financial record is captured before teardown begins, and
  written by the same transaction that removes the business.** Net revenue is
  derived from payment-processor records that the teardown deletes, so the order
  is fixed: **capture the totals → tear down the payment provider (F6.19) → send
  the deletion emails (F9.3d) → release the number → delete Ringly's rows and
  write the departure record, together, in one transaction.** Each step destroys
  something the one before it needed: the totals come from Stripe, and the emails
  need an address on the tenant row.
  - **The last two are one transaction because they are the only two that can
    be.** Every other step is a call to an external provider and cannot join a
    database transaction; these two are both local to Ringly's own database.
  - **Ordering them against each other was the mistake.** Writing the record
    first leaves a window in which a business is both present and departed —
    still counted among active businesses (F8.4) if the process then dies.
    Deleting first leaves a window in which a crash loses a money record
    permanently, which is worse (N10.1, N10.6). **Committing them together
    removes both windows**, and there is no third state to reason about: either
    the business is gone and its record exists, or neither happened and teardown
    can be run again.

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
  (F9.8). **Ringly offers no export**, deliberately: every appointment already
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
- **N2.3** Scheduled background work — analytics
  rollups, billing settlement — must sustain the resulting steady-state volume
  with bounded lag.

### N3 — Latency on the call path

Caller-perceived silence is the metric that matters. Budget per agent turn that
involves a backend call:

| Segment                                  | Target p95 | Hard ceiling |
| ---------------------------------------- | ---------- | ------------ |
| Ringly webhook handler, end to end       | ≤ 400 ms   | **6000 ms**  |
| — of which our own datastore             | ≤ 80 ms    | 1000 ms      |
| — of which external scheduling provider  | ≤ 250 ms   | **5000 ms**  |
| Caller-perceived silence (filler covers) | ≈ 0        | —            |

**The p95 target and the hard ceiling answer different questions, and the gap
between them is deliberate.** The target is what the system should normally do.
The ceiling is the point at which waiting longer is worse than giving up — and
for the scheduling provider on a live call, that point is much further out than
it looks.

**Giving up costs a customer.** A refused booking is a caller told to ring back,
and most of them do not (F2.7). Six seconds of the agent saying "let me just
check that for you" costs a slightly awkward pause; abandoning at 1.5 seconds
costs the business the booking. The agent covers the wait with filler speech
(F2.6), so the caller hears someone working rather than silence.

**The ceiling is not a licence to be slow.** A provider routinely taking seconds
is a provider failing its p95, and that is an operational problem to raise
(N7.3) rather than absorb quietly.

- **N3.1** Any backend operation on the call path has a hard timeout and a
  defined outcome on expiry. **Slow is treated as failed** — and for the
  scheduling provider, failed means the booking is refused (F2.7), not that it
  proceeds unverified. There is no "degrade" to fall back to: the only thing to
  degrade _to_ would be a booking Ringly cannot stand behind.
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
- **N6.2** Card data never touches Ringly infrastructure (F6.3), keeping us out
  of PCI-DSS scope beyond SAQ-A.
- **N6.3** All inbound webhooks verify provider signatures before acting.
- **N6.4** Customer PII (name, phone) is per-tenant and is destroyed **wholesale
  and automatically when the tenant leaves** (N1.3, F9.1a-ii), in the transaction
  that writes the departure record. **That is the only deletion path, and it
  needs no human in the loop** — it neither waits on anyone at Ringly nor offers
  anyone a control to press. **There is deliberately no per-customer deletion**
  (F9.1a).
- **N6.5** **Ringly is a service provider to the business, not a controller of
  the caller's data.** The business owns its customer relationship and its own
  privacy obligations; Ringly processes on its behalf and offers the caller no
  interface (F9.1a). Every consumer request therefore arrives through the
  business, and Ringly's duty is to be able to action it (N6.4), not to
  adjudicate it.

### N7 — Third-party dependencies and degradation

Ringly is assembled from services it does not control. Pretending otherwise
produced the wrong behaviour once already (R1), so the dependencies and their
failure modes are stated explicitly.

| Dependency                                         | Used for                    | If it is down                                                                                                                 |
| -------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Retell**                                         | Telephony, STT, LLM, TTS    | **Total outage.** No call is answered. Nothing Ringly can do; not survivable by design.                                       |
| **Supabase**                                       | All tenant data             | **Total outage.** The agent cannot resolve the business or its catalogue. Not survivable.                                     |
| **Application host** (N8, undecided)               | The application itself      | **Total outage.**                                                                                                             |
| **Google Calendar** (or other scheduling provider) | Verifying a slot is free    | **Booking fails audibly** (F2.7). The caller is told; nothing is written. Enquiries still work.                               |
| **Stripe**                                         | Charging, refunds, tax      | Calls continue. Charges queue and settle later; usage accrues locally regardless (EDD §2.10).                                 |
| **Resend**                                         | Business and operator email | Calls continue. Email retries; delivery is delayed. A message that still cannot be delivered surfaces to the operator (F7.15) |
| **Google Places**                                  | Onboarding enrichment       | New onboarding degrades to manual entry. Existing businesses unaffected.                                                      |

- **N7.1** A failure in a **non-critical** dependency (Stripe, Resend, Places)
  must never prevent an existing business from answering calls. Retell, Supabase
  and the application host are **critical** — their loss is a Ringly outage, and
  no design mitigates it.
- **N7.2** **Scheduling-provider failure is fail-closed, not fail-open.** Ringly
  will not book a time it could not verify. The caller hears an error and no row
  is written.
- **N7.3** Every degraded path is logged, surfaced to the business, and alerted
  to the operator. **Silent degradation is a defect** — see R1, which is exactly
  this bug in the shipped code.

### N8 — Hosting: undecided, and the application must stay portable

**Where Ringly runs is an open decision (Q6).** The two candidates are **Vercel**
and **Google Cloud Run**, and nothing in this document assumes either.

- **N8.1** No requirement in this document depends on the choice. Everything the
  application needs from its host is ordinary: serve HTTP, hold environment
  secrets, and run scheduled work on a timer.
- **N8.2** **The application must not become unportable while the decision is
  open.** Host-specific primitives — a proprietary cron, a proprietary
  key-value or queue product, a runtime only one platform offers — are not to be
  adopted without recording the decision to be locked in. This is cheap to hold
  now and expensive to undo later.
- **N8.3** **Scheduled work is the only place the two hosts differ materially**,
  and it is where every background worker in this design lives (EDD §2.2). The
  design therefore specifies workers as **idempotent HTTP endpoints invoked by
  an external timer**, which both platforms can drive and neither owns.
- **N8.4** Whichever is chosen must run in a **US region**, alongside the
  database, so the call path does not cross a continent inside a 400ms budget
  (N3).

### N9 — Cost control on the unauthenticated surface

**Sized for the traffic actually expected, which is low.** Onboarding is not a
consumer signup funnel — a realistic day is a handful of businesses, not
thousands — so this is a **cost guardrail, not an anti-abuse system**. Build the
cheap version; revisit only if the cost figures say otherwise.

- **N9.1** **Onboarding enrichment is a paid endpoint reachable without a login**
  (EDD §2.5.1 step 2: Google Places, a website crawl, and a model call). It carries
  a **simple per-IP limit and a daily spend ceiling**, above which it degrades to
  manual entry (F1.4) rather than continuing to spend. Both are configuration.
- **N9.2** The spend is **attributable** even before a business exists (N4.4), so
  a runaway is visible in the operator's cost figures rather than appearing as
  unexplained margin loss. **Visibility is doing most of the work here** — at
  this volume, noticing is worth more than preventing.
- **N9.3** Nothing chargeable to Ringly beyond enrichment — buying a number,
  creating an agent — may happen before a Google sign-in (EDD §2.5.1 step 7). This is
  the real bound: a bot that gets through the limiter costs one enrichment call,
  never a phone number.

### N10 — Durability of money records

**This is the strictest requirement in the document.** Everything else can be
rebuilt from a provider or asked for again; the record of what a business was
charged, under which terms, and what it still owes exists nowhere else in full.
Stripe holds the payments but not the periods, the policy versions, the clamped
totals, or the usage they were derived from.

- **N10.1** **The money tables are `billing_events`, `usage_records`,
  `billing_periods`, `pricing_policy` and `departed_businesses`.** They are named
  here so the protections below apply to a definite list rather than a feeling
  about which data is important.
- **N10.2** **Two copies in v3:**
  1. **Point-in-time recovery** on the primary database — covers a bad
     migration, an errant delete, corruption.
  2. **Automated backups replicated to a second region**, retained ≥ 90 days —
     covers losing a region.
- **N10.3** **RPO ≤ 1 hour for the money tables, RTO ≤ 4 hours.** An hour is
  below any billing interval in this design, so at most one hour of usage
  records — not one period's, and never a settled charge — can be at risk.
- **N10.4** **Nothing in the money tables is ever hard-deleted or updated in
  place once settled** (F6.16). Corrections are new rows. A durable copy of a
  table that gets rewritten protects nothing, and this costs nothing to hold to
  from the first migration.
- **N10.5** **Restores are exercised on a schedule and the result recorded.** A
  backup never restored is a belief.
- **N10.6** **Deleting a business is not an exception.** The departure record is
  written by the transaction that removes the tenant, and deliberately outlives
  it (F9.9, F9.10); it is a money record and is covered by the above. **It is
  never left unwritten and never written alone**: a business cannot be deleted
  without its record, and no record can exist for a business still present.
- **N10.7** **Stripe is a second copy of the payments, though not of the
  reasoning.** Every charge, refund and dispute also exists in Stripe's own
  records, which fail independently of Ringly's infrastructure. What Stripe does
  **not** hold is which period a payment settled, under which policy version,
  against how many seconds of usage, and clamped by how much — so Stripe is a
  meaningful partial backstop for v3, and not a substitute for N10.2.

> **Deferred, deliberately (§1.9): a third copy outside the provider account.**
> Both copies above live in the same provider account and share its fate — a
> credential compromise or an account closure takes them together. The fix is an
> append-only export to storage under separate credentials, and it is **not built
> in v3**: it is real work for a failure mode that is rare, and Stripe (N10.7)
> covers the payments half of it in the meantime. Recorded so the gap is a
> decision rather than an oversight, and revisited once there is revenue worth
> the effort.

## 1.7 Success metrics

**v3 splits the v2 "time to live" metric in two**, because activation is no
longer the end of a single uninterrupted sitting: it now requires an inbox
round-trip and a card (F1.12), so a p50 measured end to end would be measuring
how fast someone checks their email.

| Metric                                      | Target                 | Measured from → to                         |
| ------------------------------------------- | ---------------------- | ------------------------------------------ |
| **Time to provisioned** — land → own number | p50 < 3 min            | First keystroke → checklist screen (F1.12) |
| **Time to activated** — land → paying       | p50 < 24 h             | First keystroke → $100 charged (F1.12a)    |
| **Activation rate** — provisioned → paying  | > 60%                  | Of businesses reaching the checklist       |
| Caller-perceived silence per turn           | p95 ≈ 0, no gap > 1.5s |                                            |
| Booking conflicts reaching a customer       | 0                      |                                            |
| Dashboard load                              | p95 ≤ 500 ms           |                                            |
| Monthly infra cost per business             | tracked, trending down |                                            |

**Activation is the same event as the first payment** (F1.12a), so there is no
intermediate "live but unpaid" state to measure between them — the v2 metric
that assumed one is retired.

## 1.8 Decisions and open questions

**Still open:**

- **Q1 — The per-connected-minute rate (Phase 4).** TBD; held as configuration
  (F6.8), so billing can be built and tested with a placeholder but **cannot be
  switched on for real customers until it is set**.
- **Q3 — Ringly's contact email address** (F9.2). It is the single channel for
  cancellation, deletion and reactivation, so it is needed by the dashboard, the
  transactional emails, and the footer of every message Ringly sends. **Blocks
  Phase 5.**
- **Q6 — Where the application is hosted (N8).** **Vercel** or **Google Cloud
  Run**; undecided. It does not block any phase — N8.2 keeps the application
  portable while it is open — but it must be settled before the first paying
  customer, because moving a live phone system is not a thing to do casually.
  The decision turns on how scheduled work is run (N8.3) and on whether the
  Next.js-native deployment is worth more than the container control.

**Action items — work that is not a question and not a phase:**

- **A1 — Manual QA against the real Google, Retell and Resend, before launch.**
  The automated suite fakes all three (EDD §2.15.4), so it proves Ringly reacts
  correctly to a simulated calendar failure, not that Google fails that way. What
  only a human can confirm is listed at **EDD §2.15.6**: that the agent actually says
  the disclosure and sounds right, that a real granular-consent decline and a real
  token revocation behave as designed, and that mail from all four identities
  lands in an inbox rather than a spam folder. **Owner: the operator.** This is
  the untested half of the system, and no amount of green tests substitutes for
  it.
- **A2 — A load exercise against the N2.1 targets** (10,000 businesses × 10,000
  customers), which an end-to-end suite cannot express (EDD §2.15.6).
- **A3 — A restore drill** proving N10.5, including from the cross-region copy.

---

## 1.9 Deferred

"v1", "v2" and "v3" refer only to **documents**; product scope is either _in v3_
or listed below. **Nothing here is scaffolded in advance** — no dormant table, no
unused column, no dead code path held open against a future that may not arrive
(EDD §2.4/005, F6.5).

### Soon after v3

- **Self-serve cancellation, and self-serve revocation with it.** Replaces the
  email-based flow in F9.2 in both directions — a business that can cancel from
  its own dashboard must be able to undo it there too, or the reconsideration
  window is harder to use than the decision it exists to soften. Recorded now
  because it raises questions that should be answered before it is built:
  - Does cancelling take effect immediately, or at period end?
  - What stops a business cycling — cancel, re-activate, and reset the $500 cap
    (F6.9) — which is only safe today because a human sees every cancellation?
  - Can a suspended business self-serve reactivate, or does that stay manual.

- **Operator alerting via Slack**, replacing email (F8.6).
- **A third copy of the money records, outside the primary provider account**
  (N10). v3 ships point-in-time recovery plus cross-region backups, which both
  live in one account and share its fate. The eventual fix is an append-only
  daily export under separate credentials with object lock (EDD §2.14.5 records the
  shape). **Deferred because it is real work against a rare failure**, and
  because Stripe independently holds the payments half in the meantime (N10.7).
  Worth doing once there is enough revenue to miss.
- **Stripe's own customer portal as the cancellation route.** It would give
  businesses self-service cancellation and payment-method updates without Ringly
  building either. Deliberately **disabled in v3** because it would bypass the
  email-only flow (F9.2) and let a business cancel without the operator seeing
  it — which is currently the only thing preventing cap-cycling (F6.9).

### Not planned

These are **out of scope with no date**, listed so nobody re-proposes them as
oversights. Each is a boundary stated in §1.4, repeated here because that is
where people look.

- **Any channel to the calling customer**, and therefore every feature built on
  one: appointment confirmations after the call, appointment reminders, no-show
  follow-up.
- **Recurring appointments** (§1.4). A repeating request books its first
  instance and stops there (F2.2a); series scheduling is not deferred, it is
  not planned.
- **Call transfer to a human, and voicemail** (F2.10).
- **Staff logins and roles** (§1.4).
- **Healthcare businesses**, until a BAA exists (§1.4, R11).

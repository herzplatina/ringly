# Ringly — Product Requirements (v3.0)

> **The design that serves these requirements is
> [`Ringly_EDD_v3.md`](./Ringly_EDD_v3.md).** Requirements change when the product
> does; the design changes when the engineering does. Each carries its own history
> so a commit log entry never has to say which half it was about.

> **Where to start.** **[§1.4](#14-scope)** draws the scope boundaries the rest of this
> document assumes — most consequentially that there is no channel to the calling
> customer, no healthcare business, one owner account per business, and no
> recurring appointments. **[§1.8](#18-decisions-and-open-questions)** carries the questions still open and the action
> items that are not phases.

> **Edge cases are marked inline**, in the requirement they belong to, as
> **⚠ Edge case** — a case the requirement does not settle, a recommendation, and
> what else was considered. They are open questions with a proposed answer, not
> decisions.

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

| Area       | v2                                   | v3                                                                                                                               |
| ---------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Tenancy    | Implicitly single-tenant assumptions | Explicit multi-tenant model, isolation and scale targets                                                                         |
| Scheduling | Google Calendar only, hardwired      | Still Google only, but behind an interface others can plug into                                                                  |
| Services   | Set at onboarding                    | Editable any time; changes reach the agent for the next caller                                                                   |
| Hours      | Set at onboarding                    | Editable; timezone stays an operator action ([F3.5](#f3-5)–[F3.6](#f3-6))                                                        |
| Customers  | A messaging channel was planned      | **None, ever.** The call is the only contact ([§1.4](#14-scope))                                                                 |
| Analytics  | None                                 | Per-business dashboard, plus an operator cost/revenue dashboard                                                                  |
| Money      | None                                 | Free trial, then $100/month in advance with usage in arrears on one invoice, $500 cap, card on file                              |
| Email      | None                                 | Billing and stats emails **to the business**                                                                                     |
| Verticals  | Salons, clinics, tax offices         | **No healthcare** — no BAA, so clinics are out ([§1.4](#14-scope))                                                               |
| Hosting    | Assumed Vercel                       | **Undecided** — Vercel or Cloud Run; design stays portable ([N8](#n8--hosting-undecided-and-the-application-must-stay-portable)) |
| Latency    | Not a stated requirement             | Explicit per-turn budget on the call path                                                                                        |
| Cost       | Not a stated requirement             | Explicit per-tenant serving-cost target                                                                                          |

## 1.3 Personas

- **Business owner (primary).** Non-technical. Salon, tax office, trades, and
  similar appointment-driven businesses — **explicitly not healthcare of any
  kind** ([§1.4](#14-scope)). Wants a receptionist, not a configuration project. Checks a
  dashboard occasionally and an email monthly. Cares about missed calls and
  money.
- **Calling customer (secondary).** Wants an appointment at a time that suits
  them, in one call, without being told to hold. Never sees Ringly's UI.
- **Ringly operator (us).** Needs per-tenant cost visibility, safe degradation,
  and no manual work per new tenant.

## 1.4 Scope

**In scope for v3:** everything in [§1.5](#15-functional-requirements) and [§1.6](#16-non-functional-requirements).

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
  exactly what they have ([F2.2a](#f2-2a)). There is no series record anywhere in the
  system, so every appointment is a standalone one.
- Multi-staff / resource-level scheduling (one implicit calendar per business).
- Multiple logins per business. **One business has exactly one owner account**,
  the Google identity that signed it up ([F1.7](#f1-7)). There are no staff logins, no
  invitations, and no roles.
- Non-US phone numbers and non-English calls.
- Self-serve plan changes, coupons, and promotional pricing of any kind.
- Customer-facing web booking. The phone is the only booking channel.
- **Transferring a call to a human, and taking a message.** The agent handles the
  call or it does not; there is no fallback to the owner's mobile and no voicemail
  ([F2.10](#f2-10)).

---

## 1.5 Functional requirements

### F1 — Onboarding and identity

_(Carried from v2; renumbered. v2 FR1–FR10 map to [F1.1](#f1-1)–F1.10.)_

- <a id="f1-1"></a>**F1.1** Intake accepts free-form text; no structured fields required.
- <a id="f1-2"></a>**F1.2** Voice output speaks the prompt; input is typed. (Speech-to-text input is deferred.)
- <a id="f1-3"></a>**F1.3** Enrichment resolves name, address, phone, hours, IANA timezone, and
  website from Google Places.
- <a id="f1-4"></a>**F1.4** Services auto-extracted from the website (≤15 items), with upload and
  manual entry as first-class fallbacks.
- <a id="f1-5"></a>**F1.5** All enriched fields are inline-editable before commit.
- <a id="f1-6"></a>**F1.6** Enrichment resolves in a single request.
- <a id="f1-7"></a>**F1.7** A single Google OAuth grants the Ringly session and offline calendar
  access; the account is keyed to the Google identity.
  > **⚠ Edge case — one person, two businesses.** [§1.4](#14-scope) settles that one business
  > has exactly one owner account. It does not settle the reverse: whether one
  > Google identity can own **two businesses**, which is an ordinary situation —
  > a salon and a barbershop, or a trade with two brands. Keying the account to
  > the identity ([F1.7](#f1-7)) implies it cannot, but no requirement says so and the
  > sign-in flow would silently return them to the first business.
  >
  > **Recommendation:** **one Google identity owns exactly one business in v3, and
  > the second signup is refused with an explanation** rather than being silently
  > resolved to the first. It is a real constraint and the product should say it
  > out loud; a second business means a second Google account today.
  >
  > **Alternatives considered.** _(a) Allow several and add a switcher_ — every
  > screen, query and email in this document assumes one business per session, and
  > it is the multi-tenancy of [N1](#n1--multi-tenancy-and-isolation) arriving inside a single account. _(b) Silently
  > return them to the first_ — the current behaviour, and the worst: the person
  > believes they created a second business and cannot find it. _(c) Key on the
  > business rather than the identity_ — reopens which identity may sign in, which
  > is the staff-logins question [§1.4](#14-scope) rules out.
- <a id="f1-7a"></a>**F1.7a** **Calendar scope may be declined independently of sign-in.** Google
  offers granular consent, so a user can grant sign-in and refuse calendar in the
  same dialog. Ringly checks the scopes actually granted rather than assuming.
- <a id="f1-7b"></a>**F1.7b** **Declining calendar access blocks provisioning, not the account.**
  Sign-in completes and the enriched draft is kept, so declining costs a click
  rather than the work already done. Onboarding stops at a screen that
  **explains, in plain language, why calendar access is required** — Ringly
  refuses to book a time it cannot verify ([F2.7](#f2-7)), so without it there is no
  product — and offers a re-consent button.
- <a id="f1-7c"></a>**F1.7c** The reason for every scope Ringly requests is stated on the consent
  screen **before** the user is sent to Google, not only after they decline.
- <a id="f1-8"></a>**F1.8** The user is told their Google login is now their Ringly login.
- <a id="f1-9"></a>**F1.9** Number purchase and agent provisioning run in the background, and
  **only once the whole checklist is green** ([F1.11](#f1-11)) — a verified email, calendar
  access, and a payment method that has been checked and works. Before that
  Ringly has bought nothing and owes nobody rent.
- <a id="f1-10"></a>**F1.10** Onboarding collects and verifies a **business contact email**,
  defaulted from the Google identity and editable. It is the destination for all
  billing email, including the 48-hour warning before deletion ([F9.3a](#f9-3a)), so an
  unverified address is a silent single point of failure.
  **It is also the address on the payment-provider customer**, so invoices,
  receipts and decline notices ([F7.3a](#f7-3a)) reach the same inbox as everything
  Ringly sends. Two addresses would mean a business could be up to date on its
  service and unaware of its bill, or the reverse.
- <a id="f1-11"></a>**F1.11** **Getting ready is a checklist of three tasks, presented
  together and completed in any order the business likes:**

  1. **verify the contact email** ([F1.10](#f1-10));
  2. **grant calendar access** ([F1.7a](#f1-7a));
  3. **add a payment method, which Ringly checks actually works** ([F6.2](#f6-2)).

  Nothing is sequenced. A business that wants its calendar connected before
  giving anyone a card can; one that wants everything done in a minute can. The
  screen shows all three with their state, and what remains.

  **Completing all three is what buys the number and starts the trial**
  ([F1.11a](#f1-11a)), and nothing is provisioned before then. A number costs rent from
  the day it is bought and a calendar Ringly cannot read is a product that cannot
  book, so both gates exist to stop Ringly spending money on a business that has
  not yet shown it can be served. **The card is a gate for the same reason and no
  other** — it is not charged here ([F6.2](#f6-2)), only stored and verified.

  **The screen states the trial's two bounds before the business commits to
  anything** ([F1.12](#f1-12)) — how many days and how many calls — because a trial whose
  ending is discovered by hitting it is not a trial, it is a surprise.

- <a id="f1-11a"></a>**F1.11a** **The trial starts the moment the checklist is complete, and it
  starts by itself.** Ringly buys the number, binds the agent, opens a
  payment-provider subscription with the trial length of [F1.12](#f1-12), and tells the
  business its number is live and free until a stated date. **No further act is
  required of the business at any point** — not to go live, and not to start
  paying.

  **The subscription is opened once the number is confirmed live** ([F1.11c](#f1-11c)),
  not when the checklist goes green, so the provider's trial end and Ringly's own
  trial start are the same instant and neither has to be corrected afterwards
  ([F1.11b](#f1-11b)).

  **The business is told two dates at once**, in the same message: the day its
  trial ends and the day its first invoice is raised. They are the same day
  ([F1.11d](#f1-11d)), and saying so once at the start is worth more than saying it twice
  at the end.

- <a id="f1-11b"></a>**F1.11b** **Provisioning touches two systems and can fail at the second,
  and the business is told the truth either way.** Opening the subscription and
  connecting a phone are separate acts.

  | If it fails at            | The business sees                                                                                                                               |
  | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
  | **The card check**        | Inline, immediately: the card was declined, try another. Nothing else changed, and **nothing has been charged** — this is a check, not a charge |
  | **Connecting the number** | "Your trial has started. Your number is being connected — we will email you the moment it is live." **Plus that email when it is**              |
  - **The second row is the one that will be seen**, because connecting a number
    depends on a third party. **The trial clock does not start until the number
    is live** ([F1.12](#f1-12)): a business must never lose trial days to Ringly's own
    provisioning, and the day count is meaningless before the phone can ring.
  - **It is raised to the operator** ([F8.6](#f8-6)), because a business sitting behind a
    number that never connected has no way to tell whether it is waiting on
    Ringly or on itself.

- <a id="f1-11c"></a>**F1.11c** **Every bind and every unbind is verified by reading the
  telephony provider's own record back.** A write that returns success and does
  not take effect is otherwise invisible until it matters, and it matters in both
  directions:
  - **A failed bind** — at provisioning ([F1.11a](#f1-11a)), or at any rebind after a
    business settles what it owes ([F6.11c](#f6-11c)) — leaves a business paying for a
    number that rings nowhere. It is discovered by a customer.
  - **A failed unbind** — when retries are exhausted ([F6.11b](#f6-11b)), on cancellation
    ([F6.12](#f6-12)), or at teardown — leaves the number **answering calls Ringly has
    decided to stop serving and stopped metering**. It is a revenue leak and a
    correctness failure at once, and **nothing else in the system would ever
    notice it**, because every other component believes service has stopped.

  **A verification that fails is treated as a failed operation**: retried, and
  raised to the operator — a failed bind under the provisioning alert, a failed
  unbind under its own alert ([F7.13a](#f7-13a)), because an unbind failure has no other
  symptom. The read-back is cheap, deterministic, and tests the thing that
  actually goes wrong.

  **It is a check against provider state, never a placed call.** Ringly does not
  dial its own number: a synthetic call costs telephony minutes on every bind and
  unbind, lands in `calls` where it corrupts the trial call count ([F1.12](#f1-12)) and
  the analytics ([F5.3](#f5-3)), and still proves only that something answered.

- <a id="f1-11d"></a>**F1.11d** **Exactly two things end a trial and start billing, and nothing
  else does.** Stated as a closed set because an automatic transition nobody can
  enumerate is a transition nobody trusts:

  1. **the trial's last day arrives** ([F1.12](#f1-12)); or
  2. **the trial's call allowance is used up** ([F1.12b](#f1-12b)).

  **Whichever happens first ends the trial**, and the other bound is discarded.
  There is no third trigger: not the operator, not a support action, not a
  business asking to start early.

  **Before that moment: no charge is possible, ever.** After it: usage is billed
  by outcome alone ([F6.6](#f6-6)) and the fixed fee runs monthly ([F6.1](#f6-1)). There is no
  third state and no gradual transition.

- <a id="f1-12"></a>**F1.12** **The trial is the whole product, free, and the only thing that
  makes it a trial is that it ends.** Every capability a paying business has, a
  trial business has, from the first minute its number is live:
  - **The number is live, public and answering** — real customers ring it, and
    Ringly does not know or care that the business is in a trial.
  - **Bookings are made for real, in the business's own Google Calendar**
    ([F2.2](#f2-2), [F4.1](#f4-1)). Not held, not simulated, not written to a sandbox. So are
    reschedules and cancellations ([F2.5](#f2-5), [F2.6](#f2-6)), against the same availability
    and conflict rules ([F2.3](#f2-3), [F2.7](#f2-7)) that apply to everyone.
  - **The dashboard, the catalogue, the opening hours and the email are all the
    real ones** ([F5](#f5--business-dashboard), [F3](#f3--service-catalogue-and-opening-hours), [F7](#f7--email)). There is no reduced tier and no feature held back.
  - **Nothing is charged. Not usage, and not the $100 fixed fee**
    ([F1.12d](#f1-12d)) — the fixed fee is charged for the first time when the trial ends
    ([F6.1a](#f6-1a)), so the trial period itself carries no fee at all. **The business
    pays Ringly nothing until it has had the entire product working on its own
    calendar for its own customers**, which is the whole argument for offering
    one.

  **A trial that withheld anything would be testing a different product than the
  one being sold**, and the business's decision at the end of it would be made on
  the wrong evidence. This also decides what a trial is _not_: it is not a demo,
  not a sandbox, and not a limited plan.

- <a id="f1-12a"></a>**F1.12a** **It is bounded twice — by days and by calls — and ends at
  whichever bound is reached first.** Both are stated to the business before it
  starts ([F1.11](#f1-11)) and both are configuration, not constants in code, changeable
  without a deploy on the same principle as every other number in this document
  ([F6.15](#f6-15)).
  - **The day bound** gives a business time to see the agent handle real calls
    across a real week, including the quiet days. A trial measured only in calls
    would be over before a Tuesday.
  - **The call bound exists because days do not bound cost.** Every trial call
    costs Ringly real telephony and LLM minutes against no revenue ([R8](Ringly_EDD_v3.md#r8)), and a
    busy business can take more free calls in a fortnight than its first month's
    fee would cover. **The call bound is the one that makes the trial safe to
    offer**; the day bound is the one that makes it useful.
  - **The trial clock starts when the number goes live**, not when the checklist
    completes ([F1.11b](#f1-11b)).

- <a id="f1-12b"></a>**F1.12b** **Reaching the call allowance ends the trial and starts billing.
  The number keeps answering.** Ringly counts the calls, and on the one that
  reaches the allowance it tells the payment provider to end the trial
  immediately; the first period opens that day and the first invoice is raised
  ([F6.1a](#f6-1a)).
  - **Service is never interrupted.** The business that has used its trial hardest
    is the one most likely to be relying on the number already, and taking its
    phone away at the moment it proved the product would be the worst-timed
    outage in the system. **Running out of free calls is not a punishment**; it is
    the moment the relationship becomes a paid one.
  - **The business is emailed by Ringly**, saying the trial has ended because the
    call allowance was used, that billing has begun, and on what terms
    ([F7.3a](#f7-3a)). The payment provider cannot send this: it was told only that the
    trial ended, never why.
  - **The invoice that follows is the ordinary first one** ([F6.1a](#f6-1a)) and carries
    no usage, because trial calls are free ([F1.12d](#f1-12d)).

- <a id="f1-12c"></a>**F1.12c** **Reaching the last day ends the trial the same way, without
  Ringly doing anything.** The subscription's own trial end is the mechanism, so
  the transition happens at the payment provider whether or not Ringly is
  running that morning ([F6.1a](#f6-1a)).
  - **Ringly emails a reminder before it**, not the provider ([F7.3a](#f7-3a)). Only
    Ringly knows both bounds, and a reminder that counts down the days while the
    business is two calls from the other bound would be wrong in the way that
    matters.
  - **Ringly emails nothing when the day arrives.** The first invoice is a money
    document and says everything there is to say ([F7.3a](#f7-3a)); a service statement
    alongside it would be a second message about an event the business was
    already warned of and can already see.

- <a id="f1-12d"></a>**F1.12d** **A call is a trial call if the trial had not yet ended when it
  arrived. That is the whole rule; there is no detection.** Trial calls are
  **free** — they are not metered, not invoiced, and never appear on any invoice,
  including the first.
  - **"Free" means both charges, not just usage** ([F1.12](#f1-12)). No fixed fee is
    raised for the trial period either: the subscription is in its trial and
    raises no invoice at all until it ends ([F6.1a](#f6-1a)). A business that used its
    whole trial and cancelled on the last day has paid Ringly **nothing**.
  - **Who is calling is not examined**, deliberately: caller ID would add a way to
    be wrong about something the account state already settles. The number is
    live and public from day one, so a real customer may well ring it during the
    trial and get a real booking. **That booking stands**, and it is free.
  - **The classification is written at the time of the call, not derived later**
    (EDD 005, `is_trial_call`). Billing status changes; a call's history must not.
    Deriving it from today's status would reclassify every one of a business's
    trial calls the instant the trial ended.
  - **After the trial there are no trial calls.** The owner ringing their own
    number is billed on the same terms as anyone else, by outcome alone ([F6.6](#f6-6),
    [F6.7](#f6-7)).
  - **Bookings taken during the trial outlive it**, and may fall as far ahead as
    the booking horizon allows ([F2.9](#f2-9)). This is accepted: a business that has
    taken real bookings is a business that has adopted the product, which is what
    the trial is for.

- <a id="f1-12e"></a>**F1.12e** **Ringly never asks the business whether the agent sounded right,
  and works it out instead.** A trial business that has taken calls and booked
  nothing is surfaced to the operator as a failing trial ([F8.6a](#f8-6a), [F8.12](#f8-12)).
  - **Asking is the weaker test.** A self-reported "it worked" depends on the
    business telling Ringly, and the business having the worst time is the least
    likely to say anything. Calls taken with nothing booked catches the business
    that never noticed the agent was mishandling callers, which no checkbox can.
  - **It asks nothing of the person who is already having a bad time**, and it is
    the last moment anything can be done: once the trial converts, the same
    business is a paying customer with a grievance ([F9.1c](#f9-1c)).

### F2 — Call handling and booking

- <a id="f2-1"></a>**F2.1** The agent answers on the business's dedicated number, identifies the
  business, and can describe services, prices, and durations.
- <a id="f2-1a"></a>**F2.1a** **Every call opens with a recording disclosure**, immediately after
  the greeting and before the caller says anything of substance.
  Around a dozen US states require all-party consent to record. **The disclosure
  is appended by Ringly and is not part of the business's editable greeting
  script** — a business can change how it introduces itself, but cannot remove or
  alter the disclosure. If a business supplies no greeting of its own, the text
  below is used verbatim.

  > "Hello, this is _[business name]_. Just to let you know, this call is
  > recorded for quality assurance. How can I help you today?"

- <a id="f2-2"></a>**F2.2** The agent books, reschedules, and cancels appointments.
- <a id="f2-2a"></a>**F2.2a** **A request for a repeating appointment books the first occurrence
  and nothing else.** Ringly has no concept of a series and never materialises
  future occurrences ([§1.4](#14-scope)), so there is nothing to book beyond the first.
  - When a caller asks for something repeating — "every Tuesday at two", "put me
    down for the same slot next month as well" — the agent **books the first
    instance only**.
  - It then **reads that one appointment back** — date, time, service and
    business ([F2.11](#f2-11)) — and **says plainly that this is the only appointment
    booked** and that they should ring again for the next one. The caller must
    never leave the call believing anything further is held for them.
  - **Nothing distinguishes the resulting appointment from any other.** A later
    call reschedules or cancels it exactly as it would a one-off ([F2.4](#f2-4)), and no
    requirement anywhere may ask whether an appointment belongs to a series.
- <a id="f2-3"></a>**F2.3** A requested time is checked against the business's own bookings **and**
  its connected calendar before anything is written; a taken slot is refused and
  the nearest open times either side are offered. _(Shipped in PR #2.)_
- <a id="f2-3a"></a>**F2.3a** If the slot is taken **between** offering it and writing it — a race
  with another caller — the agent says so and re-offers:

  > "Unfortunately, that slot has just been taken. Let's find another time for
  > your appointment. Here are some available slots…"

- <a id="f2-4"></a>**F2.4** A caller identifies an existing appointment by **name plus the
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
  > **⚠ Edge case — more than one appointment matches, and "partially" has no
  > threshold.** The requirement describes a search that either matches or does
  > not, and settles neither of the two ways that fails. **Several appointments
  > can match** — the same customer, the same service, two slots on one day, and a
  > caller who says "my haircut on Tuesday". And **"did not even partially match"
  > is not a testable condition**: it has no definition, so two implementations
  > can disagree about whether "Dave" matches "David Okonkwo" and both claim to
  > satisfy F2.4.
  >
  > **Recommendation, two parts.** _Ambiguity:_ when more than one appointment
  > matches, the agent **reads back the candidates and asks which one** rather than
  > picking. _Threshold:_ state the rule as **name matches on any spoken form the
  > caller offers; date and time must resolve to exactly one slot once the agent
  > has confirmed them back ([F2.4](#f2-4)); service matches on the catalogue entry the
  > caller names or an obvious short form of it.** The point is that a human
  > listening to the call could say whether it matched.
  >
  > **Alternatives considered.** _(a) Refuse on ambiguity_ — a customer with two
  > bookings cannot change either, which is worse than one clarifying question.
  > _(b) Take the soonest_ — silently acts on a guess, and the caller finds out by
  > turning up. _(c) A numeric similarity score_ — moves the ambiguity into a
  > constant nobody can review, and makes the behaviour untestable in the terms
  > callers actually speak.
- <a id="f2-5"></a>**F2.5** All times spoken to a caller are in the **business's** local timezone,
  never UTC and never the caller's.
- <a id="f2-6"></a>**F2.6** While the agent is waiting on any backend operation, the caller hears
  natural filler speech rather than silence. No caller-perceptible gap may exceed
  the budget in N3.
- <a id="f2-7"></a>**F2.7** **If the business's calendar cannot be reached for any reason, no
  appointment is booked.** A booking Ringly cannot verify is worse than no
  booking — it double-books the business and the customer arrives to a clash.
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
- <a id="f2-7a"></a>**F2.7a** This applies however the calendar became unreachable — provider
  outage, timeout, revoked consent, or expired credentials. **There is no case in
  which Ringly books against a calendar it could not read.** A connected calendar
  is mandatory ([F4.1](#f4-1)), so there is no configuration in which booking proceeds
  unverified.
- <a id="f2-8"></a>**F2.8** The agent answers **24 hours a day**, but appointments may only be
  **booked inside the business's opening hours** ([F3](#f3--service-catalogue-and-opening-hours), business_hours).
- <a id="f2-9"></a>**F2.9** An appointment may not be booked **more than 70 days ahead**.
  The limit is **configuration, not a constant**: a platform default that the
  **business can change from its own dashboard** ([F5.15](#f5-15)), bounded to **7–180
  days** so no business can set a value that makes availability computation
  unreasonable.
- <a id="f2-10"></a>**F2.10** **There is no escape hatch out of the agent.** Ringly does not
  transfer to a human, does not take a message, and has no voicemail. A caller
  the agent cannot help is told plainly that it cannot help with that and is
  given the business's own contact details — which the business already
  published. The call is recorded as `dropped` ([F5.4](#f5-4)), which is how the business
  finds out this is happening. Adding a transfer target would mean holding an
  owner's personal number, ringing it out of hours, and building a hand-off the
  agent cannot verify anyone answered.
- <a id="f2-11"></a>**F2.11** **The caller's booking confirmation is the agent reading it back**
  during the call — date, time, service, and business — and nothing else. Ringly
  cannot reach the caller after the call ([§1.4](#14-scope)), so the read-back is the whole
  confirmation and the agent must not promise a message that will never arrive.
- <a id="f2-12"></a>**F2.12** **No appointment is booked without the caller's phone number. There
  are no anonymous bookings.** A customer's identity is their number ([F2.4](#f2-4)), so
  an appointment with no number attached belongs to nobody: the business cannot
  tell who is coming, and a later call cannot reschedule or cancel it against a
  customer record that was never created.
  - **Caller ID supplies it in the ordinary case**, and the agent never has to
    ask. If the number is withheld or unavailable, **the agent asks for one and
    will not complete the booking until it has one.**
  - **A caller who will not give a number is refused, plainly**, and told why.
    That is a worse outcome than booking them, and it is still better than a
    diary entry the business cannot act on.
  - **This does not change how an existing appointment is found** ([F2.4](#f2-4)). A
    caller may still ring from a different phone or withhold their number when
    rescheduling, because that lookup runs over appointments rather than over
    customer records. The number is required to **create** an appointment, not to
    find one.

### F3 — Service catalogue and opening hours

- <a id="f3-1"></a>**F3.1** A business can add, edit, deactivate, and reorder services, each with
  a name, description, price, and duration.
- <a id="f3-2"></a>**F3.2** A change takes effect for the **next** caller. Target propagation ≤ 60s
  from save; the caller mid-conversation keeps the catalogue they started with.
- <a id="f3-3"></a>**F3.3** Deactivating a service never alters appointments already booked
  against it.
- <a id="f3-4"></a>**F3.4** Price and duration are versioned, and resolve at **different moments**:
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
- <a id="f3-5"></a>**F3.5** **Opening hours are editable by the business on its own dashboard**,
  on the same terms as the catalogue — same screen, same ≤60s propagation
  ([F3.2](#f3-2)). A business that cannot change its own Saturday has to ring Ringly to
  do it, which is not a product.
  - **The change is written to the database on save** and is authoritative from
    that moment. There is no draft, no review, and no operator step.
  - **Every subsequent booking decision uses the new hours** — the agent's
    availability check ([F2.8](#f2-8)) and the slots it offers either side of a taken one
    ([F2.3](#f2-3)). The only
    bound is the ≤60s the agent may take to see the change ([F3.2](#f3-2)), and a caller
    already mid-conversation keeps the hours they started with.
  - **Appointments already booked are never moved or cancelled.** One that now
    falls outside opening hours stays exactly where it is: a time was agreed with
    a customer Ringly has no way to contact ([§1.4](#14-scope)), so breaking it silently is
    worse than honouring it. The business can see it in its own calendar and
    handle it.
  - **Narrowing hours does not retroactively invalidate anything**, and widening
    them makes new slots bookable immediately.
- <a id="f3-6"></a>**F3.6** **Changing timezone is an operator action, not a self-serve one.**
  A timezone is resolved once at onboarding from the business's address ([F1.3](#f1-3))
  and is almost never genuinely wrong; changing it silently re-interprets every
  stored instant a business can see ([N5.1](#n5-1)) and every billing-period boundary
  ([N5.2](#n5-2)). Rare enough to handle by hand, and consequential enough that it should
  be.

### F4 — Scheduling integrations

- <a id="f4-1"></a>**F4.1** **A connected calendar is mandatory.** A business cannot be
  provisioned ([F1.9](#f1-9)), and cannot take bookings, without one. Ringly refuses to book a time it has not
  verified ([F2.7](#f2-7)), so a business with no calendar has no product.
- <a id="f4-2"></a>**F4.2** **Google Calendar is the only supported provider at v3 launch**, and
  is the default. Businesses on other systems are not served yet.
- <a id="f4-3"></a>**F4.3** The system is built so a further provider can be added **without
  changes to booking logic** — provider-specific code lives behind one interface
  (EDD [§2.4](Ringly_EDD_v3.md#24-data-model)).
- <a id="f4-4"></a>**F4.4** Providers targeted after launch, in priority order: Microsoft 365 /
  Outlook, CalDAV (Apple/Fastmail), then vertical booking systems (Square
  Appointments, Acuity, Calendly).
- <a id="f4-5"></a>**F4.5** **Losing or revoking provider access stops booking.** There is no
  degraded mode that books without verification — the failure is handled by [F2.7](#f2-7)
  and F2.7a. Calls are still answered and enquiries still work; only booking
  stops, loudly.

### F5 — Business dashboard

The dashboard has the following :
a) the aggregate shape of the calls Ringly handled
b) what the business has paid for them.
c) **the state of the service itself** ([F5.18](#f5-18)) and the **controls** a business
needs — the full list is F5.15.

**(a) Aggregate analysis of calls to Ringly**

- <a id="f5-1"></a>**F5.1** Each business sees only its own data, always.
- <a id="f5-2"></a>**F5.2** **One filter: the range** — `current` · `past 3` · `past 6` ·
  `past 12` **billing periods**. These four and no others; an arbitrary date
  picker invites ranges that cross a period boundary and answer nothing.
  - **There is no choice of unit**, because a billing period _is_ a month
    ([F6](#f6--billing-and-payments)) — the 14th to the 14th — and a control offering "calendar month" as
    an alternative would offer the same answer twice.
  - **It is a month offset from the calendar's**, not identical to it, and the
    page says so: a business anchored on the 14th sees March 14 – April 14, not
    March. Labelling the range with its actual dates costs nothing and stops the
    figures being read against a calendar month they do not cover.
- <a id="f5-3"></a>**F5.3** **Five top-level metric tiles, aggregate only.** There is no per-customer reporting:
  a customer cannot be reliably identified — names are not unique and one person
  rings from different numbers — so any per-customer figure would be a guess
  presented as a fact.
  - **total calls**
  - **average call duration**
  - **median call duration**
  - **total appointments booked** — the headline number, promoted to a tile
    because it is what an owner looks for first. **A call books at most one
    appointment**, because a repeating request books only its first instance
    ([F2.2a](#f2-2a)) and there are no series anywhere in the system, so this is also the
    count of calls whose outcome was a booking and is the same figure as the
    `booked` grouping in F5.4.
  - **revenue booked** — an **estimate** wherever the range includes
    future appointments, labelled as such, because price resolves at occurrence
    time ([F3.4](#f3-4)).
- <a id="f5-4"></a>**F5.4** **One chart, and its only measure is the number of calls.** It has two
  dimensions and no others:
  - **time of day** — when the call arrived, in the windows of [F5.4a](#f5-4a);
  - **outcome** — booked / rescheduled / cancelled / enquiry-only / dropped.

  How the two are combined is the business's choice, not a second chart ([F5.4b](#f5-4b)).

  **"Dropped"** covers both a caller who hung up without a resolved
  outcome **and** a call the agent could not help with. If the caller did not get
  what they rang for, it is dropped. A completed enquiry — the caller asked
  something and got a useful answer — is recorded as `enquiry_only`.

- <a id="f5-4a"></a>**F5.4a** **Time of day is reported in six four-hour windows**, starting at
  local midnight: 00–04, 04–08, 08–12, 12–16, 16–20, 20–24. Hourly resolution is
  noise at these volumes; four-hour windows are the grain at which a business can
  act — "we are missing calls in the evening".
- <a id="f5-4b"></a>**F5.4b** **The two dimensions swap roles inside that one chart. One groups,
  the other filters, and the business chooses which way round.** There is no
  second chart and no separate report:
  - **grouped by outcome, filtered by time of day** — how do evening calls end?
  - **grouped by time of day, filtered by outcome** — when do reschedules happen?

  Both configurations are reached from the same chart, and **neither renders both
  dimensions as grouping at the same time**. A single plot carrying every outcome
  across every window is unreadable at these volumes and answers neither
  question; swapping which dimension groups answers both.

- <a id="f5-5"></a>**F5.5** **Three separate trends across periods** — calls, appointments
  booked, and revenue booked — each one chart, one column per period. Kept apart
  rather than behind a measure toggle, so a period where calls rose and revenue
  did not is visible at a glance instead of requiring two clicks to notice.
- <a id="f5-6"></a>**F5.6** **What the business pays Ringly is not among the call metrics.** It
  lives in the billing history ([F5.9](#f5-9)). The call analysis is about the work done;
  the billing history is about the money.
- <a id="f5-7"></a>**F5.7** **Every outcome definition is shown on the dashboard itself**, in
  plain language, next to the figures it governs. A business must never have to
  guess what "dropped" counts.
- <a id="f5-8"></a>**F5.8** **If a definition changes, the dashboard says so prominently** — a
  notice the owner may or may not read, with no acknowledgement required and no
  state to track. It states that figures before and after the change are not
  directly comparable. Historical calls are **not** reclassified — transcripts
  are not retained ([F9.6](#f9-6)), so outcomes cannot be re-derived. This is a permanent
  property of the design, explained on the dashboard rather than hidden.

**(b) Billing history**

- <a id="f5-9"></a>**F5.9** Billing history is **one table, not a chart** — one row per billing
  period: **dates · fixed fee · billable minutes · usage charge · total · % of the
  $500 cap · date charged · status**.
  - **The current period is the first row of that same table**, not a separate
    panel beside it ([F5.10](#f5-10)). It is the row a business looks at most, and lifting
    it out would mean the one number they check daily lives somewhere different
    from the eleven they check yearly, in a different shape, having to say the
    same things twice.
  - **Billable minutes** are connected minutes on productive calls ([F6.6](#f6-6));
    enquiry-only and dropped calls consume none.
  - **Status** is what makes the current row legible next to the closed ones:
    **in progress** · paid · failed · refunded. **"Refunded" is only ever a
    goodwill gesture made by hand** — no rule in this document produces a refund,
    and none should be built.
  - **A period cut short by service stopping says so in its row** ([F6.9a](#f6-9a)).
    Without the label, a period with a full $100 and a fortnight of usage looks
    like a mistake. What it adds is that the business stopped being served
    part-way through and was **not charged for the days after that** — and that
    the fee is not refunded ([F6.11e](#f6-11e)).
  - **A business can hold two unpaid invoices at once** ([I3a](#i3a)), and the history
    shows them as two rows, not one total. They were raised for different things
    on different days and the provider chases them separately.
  - Minutes and money are different units, so nothing here is charted: a single
    plot carrying both would need two axes, which is the one construction that
    reliably misleads.
- <a id="f5-10"></a>**F5.10** **The current period's row is live** and carries what a business
  actually asks: usage accrued so far, the cap and how close they are to it, and
  **the date of the next invoice and what it is expected to carry** — this
  month's usage plus next month's fee ([F6.1a](#f6-1a)). Every other row is settled and
  final.
  > **⚠ Edge case — the billing screen during a trial.** A trialing business has
  > **no billing period at all** ([F6.1](#f6-1)), so there is no current row to render
  > live and no history behind it. [F5.9](#f5-9) and [F5.10](#f5-10) both describe a screen that
  > cannot exist yet, and the natural implementation shows an empty table to every
  > business in its first fortnight.
  >
  > **Recommendation:** during a trial the billing screen shows **the trial
  > instead of a period** — days left, calls left, the date the first invoice is
  > raised, and what it will carry ($100, no usage). It is the same question the
  > screen answers for everyone else: what will I be charged, and when.
  >
  > **Alternatives considered.** _(a) An empty table with a note_ — technically
  > honest, and it is the screen most likely to make a business think billing is
  > broken on the day it is deciding whether to keep the product. _(b) A
  > zero-valued period row_ — invents a period that does not exist, which every
  > other part of the design would then have to special-case ([I2](#i2)). _(c) Hide the
  > screen until the first invoice_ — removes the one place the trial's two bounds
  > are visible after the checklist ([F1.11](#f1-11)).

**Everything else**

- <a id="f5-11"></a>**F5.11** The dashboard is **aggregate-only**. A business cannot read individual
  transcripts, listen to recordings, search what was said, or see figures broken
  down by customer — Ringly stores no call content ([F9.6](#f9-6)) and cannot reliably
  identify a customer. Ringly's own developer inspects individual calls in
  the Retell dashboard.
- <a id="f5-12"></a>**F5.12** Figures cover **only appointments booked through Ringly**. Anything
  the owner enters directly in their own calendar is respected for conflict
  checking ([F2.3](#f2-3)) but never appears in Ringly's figures.
- <a id="f5-13"></a>**F5.13** All figures are rendered in the business's own timezone, including
  day, week and month boundaries for grouping.
- <a id="f5-14"></a>**F5.14** Dashboard queries return in ≤ 500ms p95 regardless of tenant size,
  and their cost must not grow with total call volume across all tenants.
- <a id="f5-15"></a>**F5.15** From the dashboard a business can: manage its service catalogue and
  opening hours ([F3.1](#f3-1), [F3.5](#f3-5)), set its own booking horizons ([F2.9](#f2-9)),
  reconnect a calendar after a failure ([F1.7b](#f1-7b)), update its payment method,
  opt out of the stats digest ([F7.4](#f7-4)), **cancel its service** ([F6.12](#f6-12), [F9.2](#f9-2)),
  and **resume it after a pause** ([F6.11c](#f6-11c)). **It cannot change its timezone**
  ([F3.6](#f3-6)); that stays an operator action.
- <a id="f5-16"></a>**F5.16** **The dashboard states how fresh it is, on the page, always.**
  - **A nightly rollup is the right grain for every call metric** ([F5.3](#f5-3)).
    These are questions about shape and trend — how many calls, when they
    arrive, how they end — and none of them is meaningfully different for having
    happened four hours ago. Serving them from a rollup is also what keeps [F5.14](#f5-14)
    achievable at 10,000 tenants.
  - **The consequence is that today's calls are not shown**, and the dashboard
    must **say so in plain words** next to the figures: complete to a stated
    date, today appears tomorrow. A business that has just taken a call, cannot
    find it, and is given no explanation concludes the product is broken — and it
    will do that on day one, when it is testing exactly this.
  - **Median call duration is computed live** when the dashboard loads ([F5.3](#f5-3)),
    because a median cannot be recovered from daily aggregates. It is the single
    live query against raw calls and is bounded by the selected range.
  - **Billing figures are live** ([F5.10](#f5-10)). A business asking what it owes is
    asking about now, and the numbers are small enough to compute on demand.
  - Anything live is **labelled live**, so the two kinds of figure are never read
    as one.
- <a id="f5-17"></a>**F5.17** **Every money figure states whether it is settled.** A charge that
  has cleared, a charge that is still accruing, and a charge that failed are
  three different kinds of number, and rendering them identically invites a
  business to plan around one that has not happened.
  - **Settled** — money that moved. Closed periods, completed charges.
  - **Accruing** — the current period's usage and running total, correct as of
    now and certain to change ([F5.10](#f5-10)).
  - **Outstanding** — invoiced and not paid, whether the provider is still
    retrying or the business is already paused ([F6.11](#f6-11), [F6.11b](#f6-11b)). Where there
    are two, both are shown ([I3a](#i3a)).

  **The same rule governs the operator dashboard** ([F8.8](#f8-8)), where it matters more:
  revenue there counts only money actually received, and a figure that quietly
  mixed in what is merely invoiced would misstate the business Ringly is in.

- <a id="f5-18"></a>**F5.18** **The dashboard states the current state of the service, at the top,
  always.** A business must be able to answer "is my phone being answered right
  now?" without ringing it. Three facts, in plain language:
  - **whether the number is live** — bound to an agent and taking calls, or not
    ([F9.3](#f9-3)) — and, when it is not, **why, and exactly what turns it back on**:
    settle what is owed, or resume the service ([F6.11c](#f6-11c));
  - **the number itself**, since it is the business's public identity;
  - **where the business is in its trial, while one is running** ([F1.12](#f1-12)):
    **days left and calls left, both**, because either can end it and a business
    shown only one of them is being told half the truth ([F1.11d](#f1-11d)).

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

**Billing period.** A business's period is a **month of the payment provider's
subscription**, anchored on the day its trial ended and recurring on that day of
each following month. It is a calendar month in the ordinary sense — the 14th to
the 14th — not a rolling count of 30 days.

- **The provider owns the boundary, not Ringly.** The anchor is one instant held
  by the provider; Ringly reads it and never computes it ([N5.2](#n5-2)). Two systems
  deciding when a month ends is two systems that will eventually disagree about
  which month a call belongs to.
- **A period anchored after the 28th falls back to the last day of shorter
  months** — the provider's own rule, inherited whole. A business anchored on the
  31st bills on 28 February. This is stated because it is the one place the
  ordinary meaning of "the same day each month" does not survive.

**One invoice per period, raised on its first day**, carrying both charges
([F6.1a](#f6-1a)). **One collection attempt per month**, so a card that has gone bad
fails one invoice rather than two.

- <a id="f6-1"></a>**F6.1** A **$100 fixed fee** is charged **in advance** for every period,
  irrespective of usage. There is no separate activation fee; the first such
  charge is the one raised when the trial ends ([F1.11d](#f1-11d)).
  - **The trial is not a period and carries no fee** ([F1.12](#f1-12)). A business
    receives full service for the length of its trial and is invoiced for none of
    it.
- <a id="f6-1a"></a>**F6.1a** **Every invoice carries the coming month's fee and the past month's
  usage, and nothing else.** Period _N_'s invoice, raised on its first day, is:

  | Line      | For          | Basis                                         |
  | --------- | ------------ | --------------------------------------------- |
  | Fixed fee | Period _N_   | In advance ([F6.1](#f6-1))                    |
  | Usage     | Period _N−1_ | In arrears, metered by Ringly ([F6.4](#f6-4)) |
  - **The provider raises the invoice; Ringly adds the usage line before it is
    sent.** The subscription generates the fee automatically, and Ringly appends
    the metered amount to the draft in response to the provider's own
    invoice-created notification. Ringly computes the figure; the provider
    collects it, taxes it ([F6.18](#f6-18)), sends it, and retries it.
  - **Period 1's invoice has no usage line**, because the only calls that preceded
    it were trial calls and those are free ([F1.12d](#f1-12d)). A zero line is not printed.
  - **No invoice is raised during the trial at all.** The subscription is in its
    trial period, so the fee that would otherwise fall on the first of a month
    simply does not arise ([F1.12](#f1-12)). Period 1's invoice — $100 and nothing else —
    is the first the business ever receives.
  - **If Ringly fails to add the usage line before the invoice finalises**, the
    usage is not lost: it stays unbilled and lands on the next period's invoice,
    which is late but never wrong. **Ringly never issues a second invoice to
    correct a first** — two invoices for one month is the failure this whole
    model was chosen to avoid.

- <a id="f6-2"></a>**F6.2** **The card is stored and checked before anything is provisioned**
  ([F1.11](#f1-11)), for later off-session use. The check is an authorisation, **not a
  charge**: it proves the card exists and will accept charges from Ringly, which
  is what makes it safe to buy a number and give away a trial.
  - **It is not a guarantee.** A card that authorises in January can decline in
    March, so the failure path ([F6.11](#f6-11)) exists regardless and the trial's first
    invoice is not a special case of it.
  > **⚠ Edge case — the card is removed during the trial.** Nothing stops a
  > business detaching its card in the provider's own hosted flows. The trial then
  > ends into an invoice that **cannot be attempted at all** — not declined,
  > unpayable — so the retry window passes without a single real attempt and the
  > business is stopped having never been asked for money it could refuse.
  >
  > **Recommendation:** treat "no payment method on a business whose trial is
  > running" as a condition on the operator queue **and** a banner on the business
  > dashboard ([F5.18](#f5-18)), from the moment it is observed. It is the one
  > checklist item that can regress after provisioning, and the business is the
  > only party who can fix it.
  >
  > **Alternatives considered.** _(a) Stop service immediately_ — punishes an
  > accident during a free trial, and the business may simply be replacing an
  > expiring card. _(b) Do nothing and let the invoice fail_ — the outcome above:
  > correct by the letter of [F6.11](#f6-11) and a bad surprise. _(c) Block the removal_
  > — not available; the provider's hosted flows are not Ringly's to gate.
- <a id="f6-3"></a>**F6.3** Ringly never stores, transmits, or logs raw card details. Card data is
  handled entirely by the payment provider; Ringly stores only provider
  identifiers. _(Hard requirement, not a preference.)_
- <a id="f6-4"></a>**F6.4** **Usage** accrues through a period and is charged **in arrears on the
  next period's invoice** ([F6.1a](#f6-1a)), once the total is known and the period is
  closed.
- <a id="f6-5"></a>**F6.5** **There is exactly one billable usage unit: connected minutes on
  productive calls** ([F6.6](#f6-6)), whole call duration ([F6.7](#f6-7)). No other unit is
  metered, and the pricing policy carries no dormant ones — a rate nothing
  produces is scaffolding that misleads whoever reads it next.
- <a id="f6-5a"></a>**F6.5a** **Ringly meters; the provider bills what Ringly says.** Usage is
  counted in Ringly's own database, from Ringly's own call records, and reaches
  the provider as an amount on an invoice — never as a metered price the provider
  computes. The outcome test in [F6.6](#f6-6) is a judgement about what happened on a call
  and there is no way to express it as a quantity the provider could total up.
  This also keeps the clamp ([F6.9](#f6-9)) a Ringly decision applied before the invoice
  exists, rather than a correction after it.
- <a id="f6-6"></a>**F6.6** A call is **productive** — and therefore billable — if it resulted in
  any of: a new booking; a reschedule that produced a booked appointment; or a
  cancellation of a real existing appointment. **Not billable:** general enquiry
  calls, wrong numbers, dropped calls, trial calls, and any call that changed
  nothing for the business. **Who is calling is irrelevant** — the owner, a
  customer, or Ringly's own developer are billed identically. The outcome is the
  only test.
- <a id="f6-7"></a>**F6.7** The **whole call** is billable, not only the minutes up to the
  booking. Once the trial has ended, **no caller is exempt** — Ringly does not try
  to decide whether a call came from a genuine customer, the owner, or the
  developer. The only filter is the outcome test in [F6.6](#f6-6).
- <a id="f6-7a"></a>**F6.7a** Connected seconds are summed across the **whole billing period** and
  **rounded up to a whole minute once**, at period close — not per call. A
  business making many short calls is not charged a full minute for each.
- <a id="f6-8"></a>**F6.8** Rates are **configuration, not constants in code**. The
  per-connected-minute rate is **TBD** ([Q1](#q1)) and must be settable without a
  deploy. Adding a future unit of usage means adding a column to the pricing
  policy at that time, not carrying an unused one now.
- <a id="f6-9"></a>**F6.9** **A $500 cap per invoice, inclusive of the $100 fixed fee** — so a
  month's usage is charged at most $400. Usage **keeps accruing past the cap**;
  it is recorded in full, because Ringly needs the real number for cost and
  margin ([F8](#f8--operator-dashboard-ringly-internal)). The cap is applied when the invoice is drafted, not during the
  month.
  - **Per invoice, not per period, and the two are not the same thing.**
    One invoice carries one month's fee and the previous month's usage
    ([F6.1a](#f6-1a)), so clamping the invoice is what bounds what a business can be asked
    for on any single day. It is also the only figure the business ever sees.
  - **Two ceilings, because there are two shapes of invoice.** A periodic invoice
    is clamped at **$500** including its fee; a final usage invoice ([F6.9a](#f6-9a))
    carries no fee and is clamped at **$400**. Stated as two numbers rather than
    one so that an invoice without a fixed fee cannot quietly carry $500 of usage
    when no ordinary month ever could.
- <a id="f6-9a"></a>**F6.9a** **Usage is totalled and clamped at exactly two moments**, and never
  in between:
  1. **A period rolling over** — the ordinary case, where the closed period's
     usage becomes a line on the new period's invoice ([F6.1a](#f6-1a)).
  2. **Service stopping, for any reason** — which closes the current period there
     and raises a **final invoice for the usage it had accrued**, immediately.

  **The second moment is one rule covering both exits**, and it is stated that way
  deliberately. A business that cancels ([F6.12](#f6-12)) and a business whose retries run
  out ([F6.11b](#f6-11b)) have both been served for part of a month that will never roll
  over, and the usage in it would otherwise fall through the gap between "not yet
  invoiced" and "no next invoice coming". **Service given is service billed**,
  and the route by which service ended does not change that.
  - **It carries no fixed fee.** The month's $100 was charged on its first day and
    is not refunded ([F6.11e](#f6-11e)); charging it again, or crediting part of it, are
    both things this model refuses.
  - **It is clamped at $400** — the same ceiling any single month's usage faces
    ([F6.9](#f6-9)) — because it is a month's usage, merely a short one.

  > **⚠ Edge case — both moments on the same day.** A business whose retries run
  > out, or which cancels, on the day its period rolls over has **two totalling
  > events on one date**. Whichever runs second finds the period already closed
  > and either double-invoices its usage or drops it.
  >
  > **Recommendation:** a period can be closed once, and the first close wins.
  > Service stopping on a rollover day closes the period that was open at that
  > instant and no new one opens ([I2](#i2)); a rollover arriving afterwards finds
  > nothing to close and raises no fee, because the subscription is already
  > paused.
  >
  > **Alternatives considered.** _(a) Let the rollover win_ — it would open a
  > period for a business that is no longer being served, which [I2](#i2) forbids.
  > _(b) Order them by time of day_ — makes a money outcome depend on
  > milliseconds and on which webhook the provider happened to send first.

- <a id="f6-9b"></a>**F6.9b** On crossing the cap Ringly **continues to serve the business and
  absorbs the excess**, **alerts the operator** ([F8.6](#f8-6)), and **emails the
  business** to say it has used enough to reach the cap and that everything for
  the rest of the month is on Ringly. Hitting the cap is good news for the
  business and should read that way.
  - **The business is told when it crosses, not when it is invoiced.** Ringly's
    own meter knows on the day; the invoice is up to a month later, and a
    concession the business learns about after the fact is not a concession it
    can enjoy.
- <a id="f6-10"></a>**F6.10** **Billing repeats every month with no action from the business and
  none from Ringly.** The subscription is the mechanism: it raises the invoice,
  charges the card, retries a failure, and sends the receipt. Ringly's only
  standing involvement is adding the usage line ([F6.1a](#f6-1a)) and deciding when
  service stops ([F6.11b](#f6-11b), [F6.12](#f6-12)).
- <a id="f6-10a"></a>**F6.10a** **A period never resumes; coming back always opens a new one, dated
  from the day service resumes.** Whether the business left by cancelling or by
  not paying, the subscription was paused and the month it was in ended when
  service stopped ([F6.12a](#f6-12a)). On resume the anchor is reset to that day, $100 is
  charged for the new period, and the following months run from the new anchor.
  - **The previous anchor is not kept.** Restoring a business to a billing date
    it chose months ago would charge it for days it spent dormant, or hand it a
    part-month free depending only on which day it happened to return.

- <a id="f6-11"></a>**F6.11** **A failed charge is retried by the payment provider, and service
  continues throughout.** The retry schedule — **up to three attempts across a
  configured window** ([F6.15](#f6-15)) — is the provider's to run; Ringly does not build a
  retry loop of its own and does not attempt the card alongside it.
  - **The window is the grace period, and it is not a separate concept.** Service
    lasts exactly as long as the provider is still trying. Ringly counts no clock
    of its own alongside it, because two clocks for one thing is two answers.
  - **The window must be shorter than a billing period, and this is a hard
    constraint rather than a preference.** A subscription whose invoice is unpaid
    goes on raising the next month's invoice at the next cycle. If the retries for
    March's invoice were still running when April's was raised, the business would
    hold **two** unpaid periodic invoices and be charged $100 for a month during
    which the decision to stop serving it had already been made — the exact
    accumulation [I2](#i2) exists to forbid. **Ringly must pause the subscription before
    the next cycle**, and configuring a retry window shorter than a month is what
    guarantees it does ([Q8](#q8)).
  - **The constraint also bounds the debt.** With it, a business holds at most one
    periodic invoice plus one final usage invoice ([I3a](#i3a)); without it, there is no
    ceiling at all.
  - **Usage accrued during it is billable**, and settles with its period in the
    ordinary way. Service given is service billed.
  - **The provider emails about the decline and each retry** ([F6.21](#f6-21)); Ringly
    stays silent while service is running, because there is nothing true it could
    add that the provider is not already saying.
- <a id="f6-11a"></a>**F6.11a** **A business already behind on payment can still cancel, and it does
  not cancel its way out of the debt.** Cancellation stops service immediately on
  the ordinary terms ([F6.12](#f6-12)) and a final invoice is raised for the usage served
  since the period began. **The earlier unpaid invoice stays open, exactly as it
  was.**
  - **The two are not merged and cannot be.** A finalised invoice is immutable at
    the provider, so a business that leaves owing money has two open invoices
    rather than one. Both are chased by the provider, both are visible on the
    business's billing history ([F5.9](#f5-9)), and both are summed into the departure
    record if neither is ever paid ([F9.9](#f9-9)).
  - **Cancelling is not a route out of a debt**, and it is not treated as an
    attempt at one either. There is nothing left to withhold from a business
    whose service has already stopped.
- <a id="f6-11b"></a>**F6.11b** **When the retries are exhausted, service stops and the
  subscription is paused.** The provider's last attempt failing is the trigger,
  and Ringly acts on it in one movement: **unbind the agent** and verify the
  unbind ([F1.11c](#f1-11c)), **raise the final usage invoice** for the part-month
  just served ([F6.9a](#f6-9a)), **pause the subscription**, and **email the business**
  ([F7.3a](#f7-3a)).
  - **The final invoice is raised before the pause, not during it.** The service
    it bills for was given before service stopped, so it belongs to the state
    being left rather than the one being entered ([I5](#i5)). It is also the last
    invoice that will exist until the business comes back.
  - **Paused, never cancelled.** A cancelled subscription cannot be reactivated at
    the provider, and the whole of dormancy ([F6.12b](#f6-12b)) depends on being able to
    resume this one. The single `cancel` call happens once, at teardown, and
    nowhere else ([F6.19](#f6-19)).
  - **Pausing stops new invoices, not collection of the old one.** The unpaid
    invoice stays open and the provider keeps pursuing it; what stops is the
    monthly fee for a service the business is no longer receiving.
  - **No new period opens while a business is paused**, and none opens while it
    owes anything ([I2](#i2)). This is the rule that stops a failing account
    accumulating $100 a month for a phone nobody is answering, and it is what the
    pause exists to enforce.
  - **The 60-day dormancy clock starts the day service stops** ([F6.12b](#f6-12b)) — the
    same clock, from the same event, whichever way the business left.
  - **Ringly writes this email, not the provider.** The provider knows a payment
    failed; it does not know the agent has been unbound, that the number is
    retained, that settling restores service the same day, or that everything is
    deleted in 60 days ([F6.21](#f6-21)).
- <a id="f6-11c"></a>**F6.11c** **A paused business comes back by owing nothing and asking, and
  those are two different acts for two different reasons.** In both cases Ringly
  resumes the subscription, rebinds the agent with a verified read-back, opens a
  new period ([F6.10a](#f6-10a)), and emails to say the number is answering again.
  - **A business that was paused for non-payment resumes automatically, the same
    day it settles.** The provider notifies Ringly that the invoice is paid, and
    Ringly restores it without being asked. **It is not made to ask**: it has
    already done the only thing that was being required of it, and a second step
    between paying and being served is a step that will be missed.
  - **A business that cancelled resumes by asking, from the dashboard** ([F5.15](#f5-15)).
    It owes nothing, so there is no event to trigger on and nothing to infer — it
    left deliberately and comes back deliberately.
  - **"Nothing outstanding" is the precondition for both.** A business can hold
    two open invoices ([F6.11a](#f6-11a)); clearing one of two leaves it paused, the resume
    control stays unavailable, and the email says what remains ([F6.12b](#f6-12b)).
  - **It does not matter how the payment cleared** — a provider retry, a new card,
    or the business paying the hosted invoice by hand all reach Ringly the same
    way.
  - **Either way it works only inside the dormancy window.** After teardown there
    is no subscription to resume, no number to rebind, and no data to restore
    ([F6.12b](#f6-12b)).
  > **⚠ Edge case — a business that cancelled, owing money, then pays.** The two
  > return routes are distinguished by _who initiates_, but the trigger for the
  > automatic one is a payment arriving. A business that cancels while a payment
  > is outstanding ([F6.11a](#f6-11a)) leaves two open invoices behind it; when the
  > provider finally collects one, the automatic path fires and **restores a
  > business that asked to leave** — rebinding its number and charging it $100 for
  > a period it never asked for.
  >
  > **Recommendation:** make the automatic restore conditional on _why_ service
  > stopped. Settling restores a business stopped for non-payment; a business that
  > cancelled is never restored by a payment, only by asking. Its debt is still
  > collected — the two are independent ([F9.3b](#f9-3b)).
  >
  > **Alternatives considered.** _(a) Refuse the payment_ — no: the debt is real
  > and Ringly should collect it. _(b) Restore and let them cancel again_ — no:
  > they are charged $100 for the round trip, which is a bill produced by Ringly's
  > own ambiguity. _(c) Ask them_ — an email saying "you have paid, would you like
  > to come back?" is defensible but adds a message to a business that has already
  > left, and the dashboard's resume control already says the same thing to anyone
  > who wants it.
- <a id="f6-11d"></a>**F6.11d** **A business that has paid and is still not being answered is the
  worst state in the system**, so recovery must not depend on a single message
  arriving. If the payment notification is lost, a **daily reconciliation** finds
  any paused business that owes nothing and restores it. A lost notification may
  cost such a business hours; it must never cost it days, and it must never cost
  it the account.
- <a id="f6-11e"></a>**F6.11e** **The $100 is never prorated — not on a pause, not on cancellation,
  not on deletion.** A period that delivered nine days of service still owes its
  whole fee.
  - **The fee buys the period, not the days consumed.** A business that stopped
    being served part-way through could have had the rest of its days by paying,
    or by not cancelling; it chose the timing.
  - **Usage is not prorated either — it is metered.** There is no fraction to
    take: a business is charged for the calls it actually had, up to the day it
    stopped. The two words are not interchangeable and only one of them describes
    something Ringly does.
  - **The provider's own cancel-time proration is not used**, in either
    direction. Prorating would credit the unused fee, which this requirement
    forbids; declining to prorate would discard the usage. Ringly invoices the
    metered figure itself and lets the provider prorate nothing ([F6.12a](#f6-12a)).
- <a id="f6-11f"></a>**F6.11f** **A business has at most one open period at any moment, and periods
  never overlap or stack.** A closed period is finished; a paused business opens
  none ([F6.11b](#f6-11b)); a restored business gets exactly one new one ([F6.10a](#f6-10a)). **There
  is no state in which two periods are live**, which is what keeps the billing
  history a simple ordered list a business can read down ([F5.9](#f5-9)).

- <a id="f6-12"></a>**F6.12** **Cancellation is self-serve, and it takes effect immediately.** The
  business cancels from its own dashboard ([F5.15](#f5-15)); there is no window, no
  countdown, and no operator in the path.
  - **Before it confirms, the screen states exactly what will happen**: service
    stops today, the number stops answering today, a final invoice for this
    month's usage to date follows, **the $100 already paid for this month is not
    refunded** ([F6.11e](#f6-11e)), and the account and number are held for 60 days in case
    they come back ([F6.12b](#f6-12b)). A cancellation screen that hides the bill is how a
    business ends up disputing a charge it agreed to.
  - **On confirmation, in one movement**: the agent is unbound and verified
    ([F1.11c](#f1-11c)), the subscription is paused, the final invoice is raised
    ([F6.12a](#f6-12a)), and the dashboard says plainly that the service has stopped.
  - **Immediate, rather than at period end, because the alternative is worse for
    both sides.** Running to period end means Ringly serves a business that has
    said it does not want the service and meters it for calls it did not expect to
    pay for. The fee is not refunded either way ([F6.11e](#f6-11e)), so the business loses
    nothing it would otherwise have kept except days it has chosen not to use.
  > **⚠ Edge case — the appointments already in the diary.** Cancelling stops the
  > number that day, and bookings may stand up to 70 days out ([F2.9](#f2-9)). Those
  > customers can no longer ring to reschedule or cancel, and **Ringly cannot tell
  > them anything** ([§1.4](#14-scope)). The confirmation screen does not currently mention
  > them.
  >
  > **Recommendation:** the confirmation screen states **how many future
  > appointments are booked and the date of the last one**, before the business
  > confirms. The appointments are in the business's own calendar and stay there;
  > what it needs to know is that its customers now have no way to reach it
  > through Ringly.
  >
  > **Alternatives considered.** _(a) Refuse to cancel while bookings stand_ — no:
  > a business may cancel for any reason and 70 days is too long to be held. _(b)
  > Cancel the appointments in the calendar_ — no: they are the business's, and
  > deleting a customer's booking on its behalf is not Ringly's call. _(c) Keep
  > answering until the last booking passes_ — that is cancellation at period end
  > wearing a different hat, and it can run ten weeks.
- <a id="f6-12a"></a>**F6.12a** **The final invoice is the metered usage of the current period, up
  to the moment service stopped, and nothing else** ([F6.9a](#f6-9a)). It carries no
  fixed fee — the month's fee was charged on the first day and is not refunded
  ([F6.11e](#f6-11e)) — and no usage from any earlier period, because that was invoiced at
  the start of this one ([F6.1a](#f6-1a)).
  - **It is clamped at $400** ([F6.9](#f6-9)).
  - **A final invoice of zero is not raised.** A business that cancels during its
    trial, or on the first day of a period before any productive call, owes
    nothing; an invoice for nothing is a confusing way to say so. **It is sent a
    plain message instead** — sorry to see you go, and what happens to its number
    and data — which is the only thing there was to say ([F7.3a](#f7-3a)).
- <a id="f6-12b"></a>**F6.12b** **The account then lies dormant for 60 days, fully recoverable, and
  every business gets the same 60.** Service has stopped, but **the phone number,
  the subscription and every database record are retained**, and the clock runs
  from the day service stopped — whether it stopped because the business
  cancelled ([F6.12](#f6-12)) or because its retries ran out ([F6.11b](#f6-11b)).
  - **A business that returns inside those 60 days resumes on its own number with
    its own history** — customers, appointments and past figures all intact — on a
    new period starting that day, with $100 charged that day ([F6.10a](#f6-10a)).
  - **A business that owes money must settle before it can resume** ([F6.11c](#f6-11c)).
    Coming back is not a way to get the debt written off, and resuming a paused
    subscription is the one lever Ringly can hold against it.
  - **The same 60 days for everybody**, including a business that cancelled during
    its trial and has never paid Ringly a penny. Deliberately uniform: the cost is
    one number rental, the rule fits in a sentence, and a lifecycle with two
    dormancy lengths is one that gets the short one wrong at the worst moment.
  - **Only after the 60 days is anything deleted** ([F9.8](#f9-8)), and a business
    returning after that is a wholly new account with a new number.
  > **⚠ Edge case — returning mid-trial.** A business that cancels on day 3 of a
  > 14-day trial and returns on day 40 is inside its dormancy window, so [F6.11c](#f6-11c)
  > restores it. **What it is restored to is unstated:** the rest of its trial,
  > a fresh trial, or a paid period starting that day.
  >
  > **Recommendation:** resuming always opens a paid period ([F6.10a](#f6-10a)), and any
  > unused trial is forfeited. A trial is an offer to evaluate the product once;
  > a business that evaluated it, left, and came back has made the decision the
  > trial exists to inform.
  >
  > **Alternatives considered.** _(a) Restore the remaining days_ — requires
  > holding a paused trial clock through dormancy, and lets a business bank free
  > days by cancelling the moment it stops needing the phone. _(b) A fresh trial_
  > — worse: cancel-and-return becomes an unlimited free tier. _(c) Refuse the
  > return and make them a new account_ — contradicts [F6.12b](#f6-12b)'s whole purpose,
  > which is that the number and history survive.
- <a id="f6-12c"></a>**F6.12c** The total on any invoice **never exceeds $500** ([F6.9](#f6-9)), cancellation
  or not. Worked example: a business accrues $470 of usage in a month → the next
  invoice would be `$100 + $470 = $570` → clamped to **$500**, so $400 of usage is
  charged and $70 is absorbed by Ringly.
- <a id="f6-12d"></a>**F6.12d** **If the final invoice is never paid, it is recorded and let go.**
  The amount is written to the departure record ([F9.9](#f9-9)) as owed, read from the
  provider at teardown rather than at cancellation, because the provider may
  still collect during the 60 dormant days. Ringly does not pursue a business
  whose service has already stopped — there is nothing left to withhold.
- <a id="f6-13"></a>**F6.13** The business dashboard shows current-period usage, amount accrued,
  the cap, and the date and expected amount of the next invoice.
- <a id="f6-14"></a>**F6.14** Every charge, refund, and failure is recorded immutably against the
  business for reconciliation.
- <a id="f6-15"></a>**F6.15** **The commercial terms are expected to change** once real usage is
  observed. The fixed fee, the cap, the per-unit rates, **the trial's two bounds**
  ([F1.12](#f1-12)), **the retry count and window** ([F6.11](#f6-11)), and **the definition of a
  billable call** must all be changeable without a schema migration or a redesign.
  What does **not** change: monthly billing periods, the rule that data lives as
  long as the relationship and is purged **60 days** after it ends ([F6.12b](#f6-12b),
  [F9.8](#f9-8)), and the shape of the lifecycle — trial, then service, then a pause that
  is recoverable, then removal after a final warning.
- <a id="f6-16"></a>**F6.16** A change to commercial terms **never rewrites history**. Each billing
  period is settled under the terms in force when it ran, so past invoices remain
  reproducible.
  > **⚠ Edge case — a trial in flight when the terms change.** [F6.16](#f6-16) pins a
  > _billing period_ to the terms in force when it ran, and a trial is not a
  > billing period ([F6.1](#f6-1)). Shortening `trial_days` from 21 to 14 therefore has
  > no stated effect on the businesses currently on day 16 of a 21-day trial —
  > which either ends their trial retroactively or does nothing, depending only on
  > how it is implemented.
  >
  > **Recommendation:** **a trial is pinned to the policy version in force when it
  > started**, exactly as a period is. Both bounds and both figures are fixed at
  > the moment the number goes live and never move afterwards, except by the
  > operator's explicit extension ([F9.1c](#f9-1c)).
  >
  > **Alternatives considered.** _(a) Apply the new bounds immediately_ — ends
  > trials retroactively for businesses that were told a different number on the
  > checklist screen ([F1.11](#f1-11)), which is a promise broken silently. _(b) Apply
  > only if it lengthens the trial_ — no rule should be conditional on which way it
  > moves the money; it is the kind of asymmetry nobody can predict from the
  > outside.

> **Architectural consequence.** Pricing is **policy data, not code**: rates, the
> cap, the fixed fee, the trial bounds, and the set of outcomes that count as
> billable all live in a versioned `pricing_policy` record with an effective date,
> and each `billing_periods` row records which version it was settled under (EDD
> [§2.4](Ringly_EDD_v3.md#24-data-model)/007). Widening billing to all connected minutes — the expected next
> model — becomes a new policy row, not a deploy.

- <a id="f6-17"></a>**F6.17** A **chargeback is treated exactly as non-payment**: the disputed
  invoice is outstanding, and when the provider's retries are exhausted the
  business is paused like any other ([F6.11b](#f6-11b)). **No special handling** — Ringly
  does not pause the dormancy clock while a dispute is open, does not build a
  dispute workflow, and contests or concedes disputes by hand in the provider's
  dashboard. A dispute running longer than 60 days therefore resolves after the
  business is gone; accepted, because they are rare and the alternative is
  machinery for an event that may never happen.
- <a id="f6-18"></a>**F6.18** **Sales tax is collected through Stripe Tax**, configured per US
  state. Tax is the provider's calculation, not Ringly's; Ringly stores the
  resulting amounts for reconciliation only, and the cap ([F6.9](#f6-9)) clamps Ringly's
  own charges with tax added on top.
- <a id="f6-19"></a>**F6.19** **Deleting a business tears down its external state before its own,
  in order**: capture the lifetime totals ([F9.10](#f9-10)) → **cancel the subscription**
  → **mark any unpaid invoices uncollectible** → detach the payment method →
  delete the payment-provider customer → **email the business and the operator**
  ([F9.3c](#f9-3c)) → **release the phone number to the telephony provider** ([F9.4b](#f9-4b)) →
  **delete Ringly's rows and write the departure record, together in a single
  transaction** ([F9.10](#f9-10)). Every position in that order is forced by the one before
  it:
  - **The totals are captured first** because they are read from the provider, and
    the steps that follow destroy the records they come from — including the
    amount still owed ([F9.9](#f9-9)), which is why that figure is read here and not at
    the moment service stopped ([F6.12d](#f6-12d)).
  - **The subscription is cancelled here and nowhere else.** This is the single
    `cancel` call in the whole lifecycle ([F6.11b](#f6-11b)); everything earlier is a pause,
    because a pause can be undone and this cannot. **It raises no invoice** — the
    business was paused, nothing has accrued, and an invoice against a customer
    about to be deleted is a receivable nobody can collect.
  - **Unpaid invoices are marked uncollectible, not voided.** Voiding says the
    invoice was issued in error and erases it from the provider's revenue
    reporting; uncollectible says Ringly gave up collecting a real debt. The
    departure record says the business owed money, and the provider's books
    should agree with it ([N10.6](#n10-6)).
  - **Deleting Ringly's rows first would destroy the identifier every one of those
    steps needs**, leaving a saved card on file belonging to nobody and a rented
    number belonging to nobody.
  - **The email goes before the number is released** because that step cannot be
    undone ([F9.3d](#f9-3d)).

  The full reasoning for each position is at EDD [§2.13.4](Ringly_EDD_v3.md#2134-teardown-in-order).

- <a id="f6-20"></a>**F6.20** **The division of responsibility with the payment provider is
  explicit, and nothing is done twice.** The line is **the provider owns money
  documents; Ringly owns service statements** — what is working, what stopped,
  why, and what happens next ([F6.21](#f6-21)). Where both could act, exactly one does:

  | Function                                                      | Owner                                                                               |
  | ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
  | The billing cycle, its anchor and its rollover                | **Stripe** — Ringly reads the boundary, never computes it                           |
  | Raising and sending each invoice                              | **Stripe**, carrying Ringly branding                                                |
  | The usage amount on that invoice                              | **Ringly** computes and clamps ([F6.1a](#f6-1a), [F6.9](#f6-9)); Stripe collects it |
  | Tax calculation                                               | **Stripe** — Ringly stores the amounts                                              |
  | Invoices, receipts, payment-succeeded and payment-failed mail | **Stripe**                                                                          |
  | Retrying failed payments                                      | **Stripe**, entirely ([F6.11](#f6-11))                                              |
  | Deciding that service stops, and stopping it                  | **Ringly** ([F6.11b](#f6-11b))                                                      |
  | Pausing and resuming the subscription                         | **Ringly** ([F6.11b](#f6-11b), [F6.11c](#f6-11c))                                   |
  | Ending the trial early on the call bound                      | **Ringly** ([F1.12b](#f1-12b))                                                      |
  | Every service statement (trial, stop, restore, deletion)      | **Ringly** ([F7.3a](#f7-3a))                                                        |
  | Cancelling the subscription                                   | **Ringly**, once, at teardown ([F6.19](#f6-19))                                     |
  | Refunds                                                       | **Neither, automatically** — goodwill only, by hand ([F5.9](#f5-9))                 |
  | Billing thresholds                                            | **Neither** — deliberately not configured                                           |

- <a id="f6-21"></a>**F6.21** **The provider sends the bill; Ringly says what it means for the
  service.** Both are needed and neither can write the other's message.
  - **The provider knows the money and nothing else.** It can say an invoice is
    due, a card was declined, a retry is scheduled, a payment succeeded — and it
    says all of those better than Ringly would, with a hosted payment page, a PDF
    and correct tax. **Its dunning stays on**, because it is the thing that
    actually collects.
  - **Ringly knows the consequence.** That the number is still answering, or has
    stopped; that settling restores it the same day; that the data goes in 60
    days. None of that is visible to the provider, and a business told only that
    its card failed does not know whether its phone is still being answered —
    which is the only question it actually has.
  - **The two never describe the same event twice.** Ringly sends nothing when a
    payment fails and service continues ([F6.11](#f6-11)), because there is no service
    change to report; the provider sends nothing when service stops, because it
    does not know it has.

### F6a — The billing model, end to end

**The trial.** A business signs up, verifies its email, connects its calendar and
gives a card that Ringly checks works ([F1.11](#f1-11)). Only then is a number bought and
an agent bound, and the trial starts. It runs for **a configured number of days
or a configured number of calls, whichever comes first** ([F1.12a](#f1-12a)).

**It is the full product and it is entirely free** ([F1.12](#f1-12)). The number is live
and public, real customers ring it, and the agent books, reschedules and cancels
**in the business's own Google Calendar** — the same bookings a paying business
gets, which stand after the trial ends. **No invoice is raised during it at all:
no usage, and no $100 fixed fee** ([F1.12d](#f1-12d)). The fee is charged for the first
time on the day the trial ends, for the month ahead.

**The end of the trial is the start of billing, and nothing else is.** Whichever
bound is reached first, the subscription's first period opens that day and the
first invoice is raised ([F1.11d](#f1-11d)). There is no button and no separate activation
fee.

**A period.** A month of the subscription, anchored on the day the trial ended.
**One invoice, raised on the first day**, carrying **$100 for the month ahead and
the metered usage of the month just gone** ([F6.1a](#f6-1a)). Usage accrues on
**productive calls only** — a booking, a reschedule that booked, or a
cancellation of a real appointment. Enquiries, wrong numbers and dropped calls
cost the business nothing, and who is calling never matters. Seconds are summed
across the whole month and rounded up to a minute once.

**The cap.** $500 per invoice including the fixed fee, so **a month's usage is
charged at most $400**. Usage past it is still recorded, because Ringly needs its
true cost, but the charge is clamped when the invoice is drafted. The business is
told on the day it crosses, not when it is billed ([F6.9b](#f6-9b)).

**Usage is totalled at exactly two moments** ([F6.9a](#f6-9a)): a period rolling over, and
service stopping for any reason — which raises a final invoice for whatever the
current period had accrued.

**If payment fails.** The provider retries; Ringly does nothing.

| Stage             |                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Decline           | **Service continues.** The provider emails and schedules a retry ([F6.11](#f6-11)). Usage keeps accruing and stays billable. Ringly says nothing — nothing about the service has changed                                       |
| Retries run       | Up to three attempts across a configured window, **which must be shorter than a billing period** or a second $100 invoice is raised behind it ([F6.11](#f6-11)). **This window is the grace period**; there is no second clock |
| Last retry fails  | **Service stops.** Agent unbound, subscription **paused**, final usage invoice raised, and **Ringly** emails to say what happened and what turns it back on ([F6.11b](#f6-11b))                                                |
| Paused, days 0–60 | **No new fixed fee, no new period, no new usage.** Number and all data retained. Settling what is owed restores service that day ([F6.11c](#f6-11c))                                                                           |
| ~58               | 48-hour final warning by email, itemising exactly what will be deleted                                                                                                                                                         |
| 60                | **Full stop.** Subscription cancelled, number released, data deleted, amount owed recorded permanently ([F9.9](#f9-9))                                                                                                         |

**If the business cancels.** Self-serve, from its own dashboard, **effective
immediately** ([F6.12](#f6-12)). The screen states the consequences before it confirms.
Service stops that day, the subscription is paused, and a final invoice for this
month's usage to date follows. **The $100 already paid for the month is not
refunded**, and the same 60 days of dormancy begin.

**The two exits converge.** Cancelling and running out of retries reach the same
place by different routes: service stopped, subscription paused, final usage
invoiced, 60 days to change your mind. **There is one dormancy clock and it
starts the day service stops** ([F6.12b](#f6-12b)). Coming back inside it means the same
number and the same history on a new period; a business that owes money must
settle first ([F6.11c](#f6-11c)).

**Chargebacks** follow the non-payment path exactly ([F6.17](#f6-17)).

### F6b — One business, end to end

_Illustrative, not normative. The trial bounds and retry window used here are
example values; the real ones are configuration ([F6.15](#f6-15)). Where this and
[F6](#f6--billing-and-payments) differ, [F6](#f6--billing-and-payments) wins._ A single worked life, because the rules above
are individually simple and only get hard where they meet.

**Signing up — nothing is bought.** A salon lands on the site, types its name and
address, and Ringly enriches it from Places and builds a service menu from its
website. It signs in with Google and grants calendar access. **No number has been
purchased**: the checklist is not yet green ([F1.9](#f1-9)).

**The checklist — still no money.** The owner verifies the contact email and adds
a card. Ringly authorises the card to prove it works, **charging nothing**
([F6.2](#f6-2)). All three items green.

**3 March — the trial starts by itself.** Ringly buys the number, binds the agent,
opens the subscription with a 14-day trial, and emails: your number is live, it
is free until 17 March, and your first invoice is raised that day ([F1.11a](#f1-11a)). The
salon takes 11 calls over the fortnight, books 4 appointments, and is charged
nothing for any of it ([F1.12d](#f1-12d)). Two of those bookings are in April and they
stand.

**17 March — billing begins, with no act by anyone.** The trial's last day
arrives, the subscription's first period opens (17 March – 17 April), and
**invoice 1 is raised: $100, no usage line** ([F6.1a](#f6-1a)). The provider sends it; it
is paid. Ringly sends nothing — the invoice said everything there was to say
([F1.12c](#f1-12c)).

**Period 1 runs.** 40 productive calls, 96 connected minutes. Nothing is invoiced
during the month; the meter simply runs.

**17 April — invoice 2: $100 + 96 minutes of March–April usage.** One invoice,
two lines, one collection attempt. Paid.

**17 May — invoice 3 declines.** The card expired. $100 for the coming month plus
$88 of April–May usage; $188 outstanding.

| Date          |                                                                                                                                                              | Owes     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 17 May        | Charge fails. **Service continues, untouched.** The provider emails and schedules a retry. **Ringly sends nothing** ([F6.21](#f6-21))                        | $188     |
| 17–31 May     | **Served normally.** Usage accrues to period 3 and is billable. Two more retries fail; the provider emails each time                                         | $188     |
| 31 May        | Last retry fails. **Agent unbound and verified, subscription paused, final invoice raised for 17–31 May usage ($41).** **Ringly** emails ([F6.11b](#f6-11b)) | **$229** |
| 31 May–30 Jul | **Dormant.** Nothing new is charged and nothing accrues. Number and every record retained. The debt does not move                                            | $229     |
| ~28 Jul       | 48-hour deletion warning — **and that the subscription can no longer be resumed after it** ([F9.3a](#f9-3a))                                                 | $229     |

**Two endings.**

**They pay on 20 June.** Both invoices clear. The provider notifies Ringly,
nothing is outstanding, and Ringly **resumes the subscription, rebinds the agent
and verifies it** — the number answers again that day ([F6.11c](#f6-11c)). A new period
opens 20 June, anchored there, and its **$100 is charged that day** ([F6.10a](#f6-10a)).
Billing now runs from the 20th; the old anchor does not return.

**They never pay.** At **30 July** — 60 days from the day service stopped — the
salon is emailed, the **subscription is cancelled** ([F6.19](#f6-19)), both invoices are
marked uncollectible, the number is released to the telephony provider, and every
Ringly row is deleted in the same transaction that writes a departure record
showing **$229** owed and never collected ([F9.9](#f9-9)). The customer records,
appointments and call history go with it ([F9.1a-i](#f9-1a-i)).

**What the salon paid across the whole story:** nothing for the trial, $100 for
period 1, $100 + 96 minutes for period 2, and — on the paying ending — the $229 it
owed plus $100 for the period opened on 20 June. **It was never charged for a
single day its phone was not being answered**, and the debt it had to clear on 20
June was exactly the debt it had on 31 May.

**Who does what** is one table, in [F7](#f7--email) — every scenario, who invoices and who
writes the words. **The teardown order** is [F6.19](#f6-19), with the reasoning for each
position at EDD [§2.13.4](Ringly_EDD_v3.md#2134-teardown-in-order).

### F6c — Invariants

_Normative. Every one of these should hold for every business in every state; a
change that breaks one is a change to the commercial model, not a detail._

| #                     | Invariant                                                                                                                                                                   | Exceptions                                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="i1"></a>**I1** | **A billing period is a month of the subscription and is never extended** ([F6](#f6--billing-and-payments)). Its boundary is the provider's, never Ringly's ([N5.2](#n5-2)) | **One:** service stopping ends the current period **early** ([F6.9a](#f6-9a)). Periods can be cut short; none is ever lengthened                         |
| <a id="i2"></a>**I2** | **At most one period is open at a time, and none opens while the business owes anything or is paused** ([F6.11b](#f6-11b), [F6.11f](#f6-11f))                               | None                                                                                                                                                     |
| <a id="i3"></a>**I3** | **No invoice ever exceeds $500, and no single month's usage is ever charged above $400** ([F6.9](#f6-9))                                                                    | None — but a business can hold **two** unpaid invoices at once ([I3a](#i3a))                                                                             |
| <a id="i4"></a>**I4** | **Nothing is deleted without a 48-hour warning email** ([F9.3a](#f9-3a))                                                                                                    | None                                                                                                                                                     |
| <a id="i5"></a>**I5** | **No new charge arises while a business is paused** — no fee, no usage, no period ([F6.11b](#f6-11b)). Its debt is frozen at what it owed when service stopped              | The final usage invoice is raised **as service stops**, not during the pause ([F6.9a](#f6-9a)) — the last act of the old state, not the first of the new |
| <a id="i6"></a>**I6** | **The $100 is never prorated or refunded** ([F6.11e](#f6-11e))                                                                                                              | Goodwill refunds, by hand, which no rule produces ([F5.9](#f5-9))                                                                                        |

- <a id="i3a"></a>**I3a — The most a business can owe Ringly is $900**, and it is the sum of
  the only two invoices that can be outstanding at once ([F6.11a](#f6-11a)).

  | The invoice                                                         | What it can carry                     | Ceiling  |
  | ------------------------------------------------------------------- | ------------------------------------- | -------- |
  | **The periodic one that declined** — raised on the first of a month | $100 fee + that month's arrears usage | **$500** |
  | **The final one** — raised when service stopped ([F6.9a](#f6-9a))   | Usage served since that month began   | **$400** |
  |                                                                     |                                       | **$900** |

  **Worked through, at the very worst:**

  | Date          | Event                                                                                                                                 | Outstanding |
  | ------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
  | 1 March       | Invoice raised: $100 for March + February's usage, clamped so the invoice totals $500. **Declines**                                   | **$500**    |
  | 1–20 March    | **Service continues** while the provider retries ([F6.11](#f6-11)). The business keeps taking calls, and March's usage keeps accruing | $500        |
  | 20 March      | Last retry fails. Service stops, and March 1–20's usage is invoiced — up to **$400** ([F6.9a](#f6-9a))                                | **$900**    |
  | 20 Mar–19 May | Dormant. **Nothing further is charged, ever** ([I5](#i5)). The figure does not move                                                   | $900        |
  - **Both invoices are unavoidable and neither is a penalty.** The first is the
    debt that stopped the service. The second is service Ringly actually gave
    while the provider was still trying to collect — twenty days of a working
    receptionist, which [F6.11](#f6-11) chose to keep providing rather than cut off at the
    first decline.
  - **$900 is a ceiling, not an expectation.** Reaching it needs a business at the
    cap in two consecutive months whose card fails between them. The second
    invoice is bounded by the retry window rather than by a month, so a business
    with a two-week window and ordinary volume owes a few hundred, not $900.
  - **What holds it at two invoices is the retry window being shorter than a
    billing period** ([F6.11](#f6-11)). Let the retries run past a cycle boundary and the
    subscription raises another $100 invoice behind them, and a third, and there
    is **no ceiling at all** — this invariant and that configuration constraint
    are the same fact seen from two ends.
  - **Tax sits outside it** ([F6.18](#f6-18)), and the departure record holds the figure
    exclusive of tax ([F9.9](#f9-9)) — tax was never Ringly's money and, on a debt never
    collected, was never remitted either.

**Three things that are _not_ invariants**, listed because they read like they
should be:

- **"A business always gets 60 days."** It does — but the clock starts **when
  service stops**, not when a payment fails or a cancellation is requested
  ([F6.12b](#f6-12b)). A business whose retries run for two weeks is deleted roughly 74 days
  after its first decline. **There is now exactly one deletion clock**, which is
  the single largest simplification in this model: the old three — 10 days
  unactivated, 60 from a failed charge, 60 after a cancellation window closed —
  are all gone.
- **"Free service never exceeds the trial."** The trial is bounded twice
  ([F1.12](#f1-12)), and the retry window is bounded by configuration ([F6.11](#f6-11)) — but **the
  $500 cap is deliberately unbounded within a month** ([F6.9b](#f6-9b)). A business that
  reaches the cap on day 6 is served free for the rest of the month, and Ringly
  absorbs it on purpose. That is the single largest giveaway in the model and the
  one worth watching ([R8](Ringly_EDD_v3.md#r8)).
- **"Nothing is billed once payment fails."** Usage served while the provider is
  still retrying **is billed**, on the final invoice ([F6.9a](#f6-9a)). Service given is
  service billed, and the retry window is service. What stops at the pause is the
  fixed fee, not the meter's honesty about what already happened.

### F7 — Email

- <a id="f7-1"></a>**F7.1** Business email goes to the contact address collected at onboarding
  ([F1.10](#f1-10)). Operator email goes to Ringly's own alert address.
- <a id="f7-2"></a>**F7.2** **Every email Ringly can send is declared in one place** —
  `src/emails/registry.ts`. If a message is not in that table it is not sent.
  The table fixes, per email: audience, sending identity, subject line,
  transactional status, and how its idempotency key is built.
- <a id="f7-3"></a>**F7.3** **Templates are React Email components versioned in this repository**
  (`src/emails/`). They are reviewed in pull requests like any other code, so a
  change to what a customer reads goes through the same scrutiny as a change to
  what the code does. No hosted template editor, no copy living in a vendor UI.
- <a id="f7-3a"></a>**F7.3a** **The provider sends money documents; Ringly sends service
  statements.** That one line decides every message in this section, and it is
  drawn by **who knows the fact**, not by who could technically send it
  ([F6.21](#f6-21)).
  - **Money documents are the provider's**: the invoice, the receipt, the
    payment-succeeded notice, the card-declined notice, and each retry. It sends
    them with a hosted payment page, a PDF and correct tax, all carrying Ringly
    branding. **Ringly sends none of them and never duplicates one.**
  - **Service statements are Ringly's**: your number is live, your trial ends on
    this date, your trial ended because you used your calls, your number has
    stopped answering, it is answering again, your data goes in 48 hours. **The
    provider cannot send any of these** — it does not know the phone number, does
    not know the agent has been unbound, and was never told why a trial ended
    early.
  - **The test for a new message is which of the two it is.** If the answer is
    "both", it is two messages, and the provider's goes first.
- <a id="f7-4"></a>**F7.4** **Transactional email cannot be unsubscribed from.** A business
  cannot opt out of being told its payment failed or its data is about to be
  deleted. **Only the periodic stats digest is optional.**
- <a id="f7-5"></a>**F7.5** **Sending is at-least-once, and a duplicate is the acceptable
  failure.** A worker that dies between handing a message to the provider and
  recording that it did will send it again. That is chosen, not tolerated: the
  only way to guarantee no duplicate is to risk losing the message, and **these
  are the messages a business cannot afford to miss** — that its number has
  stopped answering ([F6.11b](#f6-11b)), and the 48-hour warning that [I4](#i4) makes
  unconditional. Reading
  something twice is an annoyance. Never being told your data is about to be
  deleted is a broken promise, and it is one nobody would discover until the data
  was gone.
  - **Every email carries one line telling the reader to ignore it if they have
    already had it** ([F7.7](#f7-7)). It costs a sentence and turns a duplicate from a
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
  - **Nothing outside the registry is ever sent** ([F7.2](#f7-2)), whatever a retry
    does.

**Format defaults — every email**

- <a id="f7-6"></a>**F7.6** Plain and utilitarian. No images, no web fonts, no columns, no
  marketing voice. These are messages about money and service interruptions;
  they should read like a utility bill and survive Gmail clipping and Outlook.
- <a id="f7-7"></a>**F7.7** Structure is fixed: wordmark, one heading stating the situation, body
  copy in plain language, a facts table for any figures, **at most one call to
  action**, then the footer. **The footer carries the line telling the reader to
  ignore the message if they have already received it** ([F7.5](#f7-5)) — on every email,
  without exception, because the email that gets duplicated is the one whose
  worker died and there is no way to know in advance which that is.
- <a id="f7-8"></a>**F7.8** Every email states **what has happened, what it means for the reader,
  and what happens next if they do nothing**. An email that leaves the reader
  unsure whether they must act has failed. Email should include call to action, if needed.
- <a id="f7-9"></a>**F7.9** Amounts always carry currency; dates are always absolute ("14 August"),
  never relative ("in 3 days"), because delivery may be delayed.
- <a id="f7-10"></a>**F7.10** Subject lines are under ~60 characters, state the situation rather
  than tease it, and never use urgency the body does not justify.
- <a id="f7-11"></a>**F7.11** **Separate sending identities per stream** — billing, service,
  reports, operator alerts — so a digest nobody opens can never harm the
  reputation of the address that tells someone their payment failed.

**Business-facing email — the full set**

**Every row below is an email Ringly sends.** Invoices, receipts, payment-failed
and retry notices are **absent by design** — they are the provider's ([F7.3a](#f7-3a)),
and duplicating them is how a business ends up with two differently-worded
messages from what looks like one company ([F6.21](#f6-21)).

| Email                        | When                                                  | Tone default                                                                                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Email verification           | Contact email entered ([F1.10](#f1-10))               | Functional; one link, nothing else                                                                                                                                                                                       |
| **Trial started / now live** | Number goes live ([F1.11a](#f1-11a))                  | Welcoming; **the number itself**, that it is taking customer calls, and **both trial bounds with the end date** ([F1.12](#f1-12))                                                                                        |
| **Trial ending soon**        | Approaching either bound ([F1.12c](#f1-12c))          | Neutral; **states whichever bound is closer**, and what happens on the day. Ringly's alone — the provider knows only the day count ([F7.3a](#f7-3a))                                                                     |
| **Trial ended — calls used** | Call allowance reached ([F1.12b](#f1-12b))            | Matter-of-fact; **the number keeps answering**, billing has begun, and on what terms. The provider cannot say _why_ the trial ended                                                                                      |
| **Service stopped**          | Retries exhausted ([F6.11b](#f6-11b))                 | Direct; **leads with "your number has stopped answering"**, then that nothing has been deleted, what is owed, and that settling restores it the same day                                                                 |
| **Service restored**         | Nothing outstanding after a pause ([F6.11c](#f6-11c)) | **Leads with "your number is answering again"**; states the new period's dates, since the anchor has moved ([F6.10a](#f6-10a))                                                                                           |
| **Cancellation confirmed**   | Business cancels from the dashboard ([F6.12](#f6-12)) | Matter-of-fact; service has stopped, the fee is not refunded, a final invoice follows, and the date the account is deleted if they do not return                                                                         |
| **Sorry to see you go**      | Cancellation with nothing owed ([F6.12a](#f6-12a))    | Warm and short; **replaces the $0 invoice that is not raised**, and asks for feedback. The only email in the registry that asks the reader for anything                                                                  |
| Deletion warning             | 48 hours before deletion ([F9.3a](#f9-3a))            | Unambiguous; itemises exactly what is destroyed, **and that the subscription can no longer be resumed afterwards** ([F6.12b](#f6-12b))                                                                                   |
| Cap reached                  | Cap crossed ([F6.9b](#f6-9b))                         | **Good news** — they earned it, the rest of the month is on Ringly                                                                                                                                                       |
| Calendar access failing      | Bookings being refused ([F2.7](#f2-7))                | Urgent, explains _why_ refusing beats double-booking                                                                                                                                                                     |
| **Account deleted**          | Teardown completes, on every path ([F9.3c](#f9-3c))   | Final and factual: what was deleted, that the number is gone for good, and any amount recorded as owed. **Sent before anything irreversible — the number release and the row deletion both follow it** ([F9.3d](#f9-3d)) |
| Stats digest                 | Each billing period ([F7.4](#f7-4))                   | Light; the only unsubscribable email                                                                                                                                                                                     |

**Who raises the money and who writes the words — every scenario**

One rule underneath the table: **the provider invoices, charges, retries and
chases; Ringly decides the amounts and reports what happened to the service**
([F7.3a](#f7-3a)). **The provider's dunning is on** — it is the thing that actually
collects, and Ringly does not compete with it ([F6.21](#f6-21)).

| Scenario                          | Invoice + charge                                                               | Email to the business                                               |
| --------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Checklist complete, number live   | — nothing charged; the card is authorised only ([F6.2](#f6-2))                 | **Ringly** — trial started                                          |
| Trial running                     | — nothing charged                                                              | **Ringly** — trial ending soon                                      |
| Trial ends on the day bound       | First invoice: **Stripe**                                                      | **Stripe** only — the invoice says it all ([F1.12c](#f1-12c))       |
| Trial ends on the call bound      | First invoice: **Stripe**                                                      | **Ringly** — why it ended · Invoice: **Stripe**                     |
| Each period's invoice             | **Stripe** — Ringly adds the usage line ([F6.1a](#f6-1a))                      | Invoice + receipt: **Stripe**                                       |
| Cap crossed                       | — nothing extra charged                                                        | **Ringly**                                                          |
| Payment declines, retries running | **Stripe** retries                                                             | **Stripe** — declined, and each retry. **Ringly: nothing**          |
| Retries exhausted, service stops  | Final usage invoice: **Stripe** ([F6.9a](#f6-9a))                              | **Ringly** — service stopped · Invoice: **Stripe**                  |
| Paused and dormant                | — nothing new; the open invoices are still chased by **Stripe**                | **Ringly** — the 48-hour warning only                               |
| Settled, service restored         | New period's $100: **Stripe**                                                  | **Ringly** — restored · Invoice: **Stripe**                         |
| Cancellation, usage owed          | Final usage invoice: **Stripe**                                                | **Ringly** — confirmed · Invoice: **Stripe**                        |
| Cancellation, nothing owed        | — **no invoice is raised** ([F6.12a](#f6-12a))                                 | **Ringly** — sorry to see you go                                    |
| Deletion                          | Subscription cancelled, unpaid invoices marked uncollectible ([F6.19](#f6-19)) | **Ringly** — to the business **and** the operator ([F9.3c](#f9-3c)) |
| Refund (goodwill only)            | **Stripe**, by hand ([F5.9](#f5-9))                                            | none automated                                                      |
| Calendar unreachable              | —                                                                              | **Ringly**                                                          |
| Stats digest                      | —                                                                              | **Ringly**                                                          |

**Everything left to Ringly depends on something the provider does not know**:
what the number is doing, why a trial ended early, and what is destroyed in
forty-eight hours.

**Operator-facing email**

- <a id="f7-12"></a>**F7.12** Operator alerts are a different product from business email: read on
  a phone, at an inconvenient moment. Each **leads with the business name and
  the money at stake**, and says what happens if it is ignored. No reassurance,
  no marketing voice.
- <a id="f7-13"></a>**F7.13** The set: business hit its cap (with cost-to-serve and margin, so an
  unprofitable tenant is visible immediately), **service stopped for non-payment**
  ([F6.11b](#f6-11b)), calendar unreachable, **a failing trial** ([F8.6a](#f8-6a)), **provisioning
  stuck** ([F1.11b](#f1-11b)), **a number that would not release** ([F7.13a](#f7-13a)), and
  **business deleted** — the last carrying lifetime net revenue and the amount
  left owing, since deletion is the only moment those totals are final
  ([F9.3c](#f9-3c)).
  - **A payment merely declining is not on this list.** The provider is retrying
    and service is running ([F6.11](#f6-11)); there is nothing for a human to do, and an
    alert per decline would train the operator to ignore the one that matters.
    **The alert fires when service stops**, which is the moment a business is
    actually losing something.
- <a id="f7-13a"></a>**F7.13a** **A failed unbind is raised to the operator**, naming the business,
  the number still answering, and the reason Ringly tried to release it. [F1.11c](#f1-11c)
  establishes that a failed unbind leaves a number **answering calls Ringly has
  decided to stop serving and stopped metering** — a revenue leak and a
  correctness failure at once — and that _nothing else in the system would ever
  notice it_, because every other component believes service has stopped. An
  alert is therefore the only thing standing between that state and a number
  that answers, unmetered, until someone happens to look. It carries the same
  urgency as a cap breach: it is money leaving.
- <a id="f7-14"></a>**F7.14** These move to Slack later ([F8.6](#f8-6)). The format carries the same
  information either way, so the move is a transport change rather than a
  rewrite.

**When a message cannot be delivered**

- <a id="f7-15"></a>**F7.15** **Mail that cannot be delivered is surfaced, never swallowed.** A
  message is only useful if it arrives, and the whole of [F7](#f7--email) is built on the
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
    ([F8.12](#f8-12)). The business cannot be told by email that its email is not working,
    so a human has to reach them another way.
  - **It does not become a new operator alert email** ([F7.13](#f7-13) is a closed set).
    An address that bounces is a queue entry to work through, not a page in the
    night.
  - **An undeliverable deletion warning is the case that matters most**, because
    [I4](#i4) says nothing is deleted without one. Whether "warned" means _sent_ or
    _delivered_ is deliberately settled at [F9.3c](#f9-3c) — best effort to the address on
    file, because an unactivated business may never have confirmed an address —
    but the operator sees it, and that is the point of the queue.

### F8 — Operator dashboard (Ringly-internal)

- <a id="f8-1"></a>**F8.1** Visible **only to the operator**. No business owner may reach it by
  any route, with any credential. This is the single screen that reads across all
  tenants and is therefore treated as a walled garden (EDD [§2.11](Ringly_EDD_v3.md#211-email), [N1.1](#n1-1)).
- <a id="f8-2"></a>**F8.2** **Two filters, governing everything on the page:** a **range**
  (`current calendar month` · `past 3` · `past 6` · `past 12`) and a **business
  selector** listing every business active in that range, from which the operator
  picks one, several, or all.
- <a id="f8-2a"></a>**F8.2a** **The main view is money, and it is a table** — one row per business:
  **net revenue · cost · margin**, sortable on any column. With thousands of
  businesses no chart distinguishes them; a table sorted by margin puts the ones
  losing money at the top, which is the question the operator actually has.
- <a id="f8-2b"></a>**F8.2b** **Two charts.**
  - **Margin over time**, one column per calendar month across the selected
    range, aggregating whichever businesses are selected. Margin can go
    **negative** ([R8](Ringly_EDD_v3.md#r8)), so this chart has a **zero baseline** and distinguishes
    positive from negative — a losing month must not render as merely a shorter
    bar.
  - **Outcomes × time of day**, grouping by one and filtering the other, exactly
    as [F5.4b](#f5-4b) does for the business.
- <a id="f8-2c"></a>**F8.2c** **No per-business call volume, duration, or outcome columns in the
  table.** Those questions are about one business and are answered by opening
  that business's own dashboard ([F8.2e](#f8-2e)), one click away and in the form the
  business itself sees. The main table is money, and stays money ([F8.2a](#f8-2a)).

  **This does not exclude the aggregate outcomes × time-of-day chart** in [F8.2b](#f8-2b),
  which answers a different question — how calls behave across the platform, or
  across whichever businesses are selected — and cannot be got by opening one
  dashboard at a time.

- <a id="f8-2d"></a>**F8.2d** **No unique-caller or per-customer figures anywhere.** Same reason as
  [F5.3](#f5-3): a customer cannot be reliably identified, so the number would be a guess.
- <a id="f8-2e"></a>**F8.2e** **The operator can open any business's own dashboard**, exactly as
  that business sees it, by picking the business from a **drop-down of business
  names**. This is how a support conversation gets resolved — looking at the same
  screen the person on the phone is describing.
  - **Read-only. Every control in [F5.15](#f5-15) is absent**, not disabled — editing
    services and hours, setting horizons, updating the payment method, cancelling
    the service, and the digest opt-out. **There is no customer-deletion control to hide**, here or on the
    business's own dashboard ([F9.1a](#f9-1a)).
  - **Visibly a borrowed view**, banner-marked with the business's name.
  - **Not impersonation.** No business session is created and no business
    credential is used; the page renders inside `/ops` from the operator's own
    session (EDD [§2.11](Ringly_EDD_v3.md#211-email)).
- <a id="f8-3"></a>**F8.3** Payment reliability per business — paid on time, late, failed,
  currently past due — so irregular payers are visible at a glance.
- <a id="f8-4"></a>**F8.4** Platform totals: revenue, cost, margin, and **the number of active
  businesses**, across all businesses in the selected range.
- <a id="f8-5"></a>**F8.5** **Cost model (v1): two lines, both billed per business per call.**
  - **Telephony and the voice agent** — the number rental plus all per-call
    charges including the agent's own LLM.
  - **Outcome classification** — the model call that labels each call's outcome
    (EDD [§2.9.1](Ringly_EDD_v3.md#291-outcome-classification)). It is a separate vendor and a separate charge from the agent's
    LLM, and it is metered per call, so it belongs here rather than in platform
    overhead. It is small next to telephony and **is not therefore allowed to be
    invisible**: a cost that nobody attributes is a cost nobody notices growing.

  Deliberately excluded: the database and the application host (fixed platform
  overhead, immaterial per tenant, and **not yet chosen** — [N8](#n8--hosting-undecided-and-the-application-must-stay-portable)) and Google Places
  (one-off at onboarding, considered covered by the first $100). A cost line is
  added to this model only when something new is billed per business; nothing is
  carried here in advance of that.

- <a id="f8-6"></a>**F8.6** **Operator alerts** are the set in [F7.13](#f7-13) and no other: a business
  reaching its cap ([F6.9b](#f6-9b), with cost-to-serve and margin), a payment failure,
  a calendar unreachable ([F2.7](#f2-7)), **service stopped for non-payment**
  ([F6.11b](#f6-11b)), **a failing trial** ([F8.6a](#f8-6a)), **provisioning stuck**
  ([F1.11b](#f1-11b)), **a number that would not release** ([F7.13a](#f7-13a), [F1.11c](#f1-11c)),
  and a business deleted ([F9.3c](#f9-3c)).
  Delivered by **email** initially. _Moving operator alerting to Slack is
  deferred ([§1.9](#19-deferred))._
- <a id="f8-6a"></a>**F8.6a** **A trial that is going badly is raised to the operator, and the
  test is derived rather than self-reported**: a business inside its trial that
  has taken calls and booked nothing ([F1.12e](#f1-12e)).
  - **It replaces the old "activation stuck" alert**, which fired when a business
    used its five test calls without ticking a box saying one of them worked.
    That depended on the business telling Ringly, and the business least likely
    to tell Ringly anything is the one having the worst time.
  - **Calls but no bookings is the shape of a broken agent** — a mishearing
    prompt, a wrong service menu, a calendar that refuses every slot ([F2.7](#f2-7)) —
    and it is visible without asking anyone. It also catches the business that
    never noticed anything was wrong.
  - **It is a soft signal and will sometimes be wrong.** A tax office in a quiet
    fortnight is not broken. That is acceptable: the cost of a false positive is
    one look at a dashboard, and the cost of a false negative is a business that
    converts to paying for something that never worked and disputes the charge.
  - **This is the last useful moment.** After the trial converts, the same
    business is a paying customer with a grievance; before it, a fault is
    something Ringly can fix and hand back the days for ([F9.1c](#f9-1c)).
  - **Timed to leave room to act**, not fired on the trial's last day.
- <a id="f8-7"></a>**F8.7** **The operator dashboard follows the same freshness rule as the
  business one** ([F5.16](#f5-16)): served from the nightly rollup, complete to a stated
  date, with **median duration the one live figure and labelled as such**. One
  rule, one pipeline, one explanation — and the operator and the business looking
  at the same numbers on a support call is worth more than the operator seeing
  four hours further ahead.
  - **Money is the exception, and it is a different exception.** Revenue, cost
    and margin are only counted once they are real ([F8.8](#f8-8)), so they are as fresh
    as the payment provider's own records and no fresher. They are not "live" in
    the sense the median is; they are **settled**, which is a stronger property.
  - **The operational panels are live** — needs attention, idle numbers, payment
    reliability ([F8.12](#f8-12), [F8.9](#f8-9), [F8.3](#f8-3)). They exist to prompt action today, and a
    business whose calendar broke this morning must not first appear tomorrow.
- <a id="f8-8"></a>**F8.8** Figures are reported **by calendar month** (June, July, August), not by
  each business's own subscription month. Businesses are anchored on different
  days ([F6](#f6--billing-and-payments)), so per-period reporting cannot be summed into anything
  meaningful for accounting. Only
  **money actually received into Stripe** counts as revenue, and only **real
  incurred cost** counts as cost — neither is accrued or projected.
- <a id="f8-9"></a>**F8.9** Shows **rented phone numbers that are not earning**: numbers held for
  businesses in a trial, paused after non-payment, or dormant after cancelling
  ([F9.3](#f9-3)). Every such number is a standing cost with no revenue against it — and
  since a number is now bought only once a working card is on file ([F1.9](#f1-9)),
  every entry here is a business that got at least that far.
- <a id="f8-10"></a>**F8.10** **The operator has no cancellation control, and that is the change.**
  Cancelling is the business's own act, taken from its own dashboard and
  effective immediately ([F6.12](#f6-12), [F9.2](#f9-2)); there is no flag for a human to set,
  clear or revoke, because there is no window in which any of those would mean
  anything.
  - **What the operator can still do is pause the dormancy clock** ([F9.1b](#f9-1b),
    [F8.13](#f8-13)) and **extend a trial** ([F9.1c](#f9-1c)). Both are concessions, not
    corrections: neither changes what a business was charged.
  - **The cap-cycling worry the old control existed to answer is answered
    differently.** A business that cancels and returns opens a new period at full
    price on the day it returns ([F6.10a](#f6-10a)), so cycling buys a fresh $500 ceiling
    at the cost of a fresh $100 fee and a gap in service — which is not a way to
    get something for nothing, and is why no human needs to be in the loop.
- <a id="f8-11"></a>**F8.11** Shows the same **outcome definitions** the business sees ([F5.7](#f5-7)), so
  both sides of a conversation about the numbers are reading the same
  definitions.
- <a id="f8-12"></a>**F8.12** **"Needs attention" is a table of named conditions, not a feeling.**
  Every row is a business, the condition it is in, how long it has been in it, and
  what the operator can do. Ordered by how little time is left to act.

  **Broken now — a customer is being turned away as you read this**

  | Condition              | Trigger                                                                     | Operator action                                                                                                       |
  | ---------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
  | **Bookings failing**   | An open calendar incident ([F2.7](#f2-7))                                   | Get them to reconnect the calendar; every caller meanwhile is refused                                                 |
  | **Provisioning stuck** | The number never came up after the checklist went green ([F1.11b](#f1-11b)) | The business is waiting on Ringly and its trial clock has not started ([F1.12](#f1-12)). Nothing else will surface it |

  **About to lose the business**

  | Condition             | Trigger                                                     | Operator action                                                                          |
  | --------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
  | **Deletion imminent** | Inside the 48-hour warning ([F9.3a](#f9-3a))                | Last chance; number, data and subscription go permanently at the deadline                |
  | **Failing trial**     | Trial calls taken, nothing booked ([F8.6a](#f8-6a))         | Investigate; extend the trial if the fault was Ringly's ([F9.1c](#f9-1c))                |
  | **Service stopped**   | Retries exhausted, subscription paused ([F6.11b](#f6-11b))  | Their phone is not being answered; recoverable any day inside the 60 ([F6.11c](#f6-11c)) |
  | **Cancelled**         | The business cancelled from its dashboard ([F6.12](#f6-12)) | Dormant and recoverable; worth a conversation while the number is still theirs           |

  **Costing Ringly money**

  | Condition               | Trigger                                                               | Operator action                                                                                         |
  | ----------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
  | **At cap**              | Reached the cap for the month ([F6.9b](#f6-9b))                       | Everything further is absorbed; check the pricing fits them                                             |
  | **Negative margin**     | Cost exceeded revenue for the range ([R8](Ringly_EDD_v3.md#r8))       | The unbooked-call economics are not working for this business                                           |
  | **Number not released** | An unbind failed its read-back ([F1.11c](#f1-11c), [F7.13a](#f7-13a)) | Release it by hand. It is still answering calls nobody is metering, and no other signal will surface it |

  **Needs a human, or nothing will happen**

  | Condition               | Trigger                                                                                  | Operator action                                                                                            |
  | ----------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
  | **Clock paused**        | An operator paused a dormancy clock ([F9.1b](#f9-1b))                                    | Resolve and unpause — a paused clock never resumes itself                                                  |
  | **Dispute open**        | A chargeback was filed ([F6.17](#f6-17))                                                 | Contest or concede by hand in Stripe; may outlast the account                                              |
  | **Debt on departure**   | A final invoice was never paid ([F6.12d](#f6-12d))                                       | Informational — recorded as owed, not pursued                                                              |
  | **Email undeliverable** | A message exhausted its retries, or the recipient's server rejected it ([F7.15](#f7-15)) | Reach the business another way and correct the address. **Assume they know none of what the message said** |

  **Two conditions are deliberately absent.** **"Payment failed"** is not here:
  the provider is retrying, service is running, and there is nothing for a human
  to do until it stops ([F7.13](#f7-13)). **"Unactivated, expiring"** is not here because
  the state does not exist — a trial converts by itself and nothing is deleted for
  failing to become a customer ([F9.1](#f9-1)).

  A business can appear under several conditions at once and is listed once per
  condition, because they need different actions.

- <a id="f8-13"></a>**F8.13** The operator can **pause the 60-day dormancy clock** on an
  individual business ([F9.1b](#f9-1b)), and see which businesses are paused and since
  when. A pause is an explicit act with a visible owner, never a side-effect.
  **It is the only lifecycle clock in the product** ([F9.3](#f9-3)), so this is the only
  such control.

### F9 — Account lifecycle, dormancy and data retention

- <a id="f9-1"></a>**F9.1** **A business is never deleted for failing to become a customer.**
  The trial converts by itself ([F1.11d](#f1-11d)), so there is no state in which a
  business sits provisioned, unbilled and going nowhere — the state the old
  ten-day clock existed to clear up.
  - **What bounds Ringly's exposure now is the trial** ([F1.12](#f1-12)): a configured
    number of days and a configured number of calls, both stated up front, after
    which the business is either paying or has cancelled.
  - **A business is deleted for exactly one reason: sixty days with its phone not
    answering** ([F9.3](#f9-3)). Whether that happened because it cancelled or because its
    payments failed makes no difference to the clock, the warnings, or what is
    destroyed.
  - **Nothing is provisioned before a working card** ([F1.9](#f1-9)), which is what makes
    a single clock affordable: every number Ringly holds belongs to a business
    that has already proved it can be served and can pay.

- <a id="f9-1a"></a>**F9.1a** **A consumer has no direct route to Ringly**, and does not need
  one. A caller wanting their data removed asks the **business**, which is who
  they have a relationship with; Ringly is the business's service provider
  ([N6.5](#n6-5)) and offers the caller no interface.

  **Customer PII is destroyed on exactly one occasion: when the business itself
  is deleted.** There is no second occasion and no partial one. Nobody at Ringly
  can do it, the business cannot do it from its dashboard, and no support action
  reaches it.

  **There is deliberately no way to delete a single customer**, and its absence
  is the design:
  - **A per-customer delete is a per-customer lookup**, and Ringly does not have
    one. Every figure in this product is aggregate precisely because a customer
    cannot be reliably identified ([F5.3](#f5-3), [F5.11](#f5-11)) — the same person rings from two
    phones and becomes two records ([F2.4](#f2-4)). A control that resolves a phone number
    to a customer in order to erase them is the per-customer view the dashboard
    exists to exclude, arriving through a side door.
  - **Deleting one customer rewrites settled figures or lies about them.** Their
    past appointments carry revenue the rollups already counted ([F5.3](#f5-3)) and
    invoices already settled against them ([F6.16](#f6-16)). Either those figures move,
    which breaks [F6.16](#f6-16), or the appointment is kept with the name stripped, which
    means the deletion was partial and the product said it was not.
  - **A deletion path nobody can reach cannot be got wrong**, and this one would
    be reached rarely and tested least.

  **The consequence is stated rather than hidden** ([R23](Ringly_EDD_v3.md#r23)): a business that
  receives a consumer erasure request cannot action it through Ringly except by
  ending its own account. Ringly is the processor and the business is the
  controller ([N6.5](#n6-5)), so the obligation is the business's — but Ringly's ability
  to assist with it is, deliberately, all-or-nothing.

- <a id="f9-1a-i"></a>**F9.1a-i** **Every customer goes when the business does, automatically, and
  only then.** When the dormancy clock runs out — 60 days after service stopped,
  by either route and with no other deadline in the product ([F9.3](#f9-3)) — the sweeper
  deletes the tenant, and **customers, appointments and calls are ordinary tenant
  rows caught by that** ([F9.8](#f9-8)). **Nobody requests it and nobody performs it.**

  **They are deleted in the same transaction that writes the departure record**
  ([F9.10](#f9-10)). Not before it and not after it: the business ceasing to exist and its
  customer data ceasing to exist are one event, and there is no window in which
  either has happened without the other.

  **Exactly one thing survives, and it contains no consumer data by
  construction**: `departed_businesses` ([F9.9](#f9-9)) — the business's id and name, when
  it joined and left, how it ended, what it owed, and what Ringly earned from it.
  **No caller name, no caller number, no appointment.** That is a property to
  preserve, not a coincidence: the departure record must never become a way for
  customer data to outlive the deletion that was supposed to remove it.

- <a id="f9-1b"></a>**F9.1b** **The operator can pause the 60-day dormancy clock on any individual
  business**, from the operator dashboard ([F8.13](#f8-13)). A business disputing a charge,
  waiting on a bank, or caught by a Ringly fault would otherwise be deleted while
  the problem is being worked. **Silence is not a pause:** absent an explicit
  operator action the default stands and the business is deleted at day 60.
  > **⚠ Edge case — a pause has no ceiling.** Nothing bounds how long a clock may
  > stay paused. A business paused during an investigation that nobody closes
  > holds a rented number and a full database indefinitely, and **the pause is
  > invisible to every other part of the product** — it looks like an ordinary
  > dormant account.
  >
  > **Recommendation:** a pause carries an **expiry of its own, defaulting to 30
  > days**, after which the clock resumes on its own and the operator is emailed.
  > Extending it is another explicit act. The operator queue already lists paused
  > businesses ([F8.12](#f8-12)); what it cannot do is act on one nobody revisits.
  >
  > **Alternatives considered.** _(a) Leave it unbounded_ — the status quo, and the
  > failure is silent and slow, which is the shape this document treats as worst.
  > _(b) A hard maximum with no resume_ — deletes a business mid-investigation,
  > which is exactly what pausing exists to prevent. _(c) Require a reason and
  > review it weekly_ — a process, not a mechanism; it works until the week
  > somebody is on holiday.
  - **It is the only lifecycle clock there is** ([F9.3](#f9-3)), so this is the only
    pause control in the product.
- <a id="f9-1c"></a>**F9.1c** **The operator can extend a trial** — more days, more calls, or both
  ([F1.12](#f1-12)) — for a business whose trial was spent on a fault of Ringly's.
  - **A trial that went badly is not the same as a trial that ran out.** A
    business whose agent misheard every caller has used its allowance and learned
    nothing, and converting it to paying on that basis is how a refund request
    starts. The operator sees these as failing trials ([F8.12](#f8-12)) and can hand back
    what the fault consumed.
  - **It does not rebind anything**, because nothing was unbound: reaching the
    call allowance does not stop the phone answering ([F1.12b](#f1-12b)), so there is
    nothing to restore but the allowance itself.
  - **Extending a trial moves the subscription's trial end at the provider**, so
    the two never disagree about when billing starts ([F6.20](#f6-20)).
- <a id="f9-2"></a>**F9.2** **Cancellation is self-serve, from the business's own dashboard**
  ([F5.15](#f5-15), [F6.12](#f6-12)). It is the one account action a business takes itself, and it
  takes effect the moment it is confirmed.
  - **There is nothing to revoke, so there is no revocation route.** The old
    email-based flow existed to serve a reconsideration window, and needed a way
    back through the same channel because a window nobody can reverse is a
    window nobody uses. **The window is gone** ([F6.12](#f6-12)): a business changes its
    mind by coming back, which it can do any day inside the 60 ([F6.12b](#f6-12b)) and
    which restores its number, its history and its subscription.
  - **The screen carries the whole consequence before the button does anything**
    ([F6.12](#f6-12)). An immediate, self-serve, irreversible-today action is only
    defensible if the person taking it has been told what it costs, and the one
    thing it must not do is bury the final invoice.
  - **Deletion and reactivation are not separate requests.** Deletion happens on
    its own at day 60 and cannot be brought forward; reactivation is the business
    signing back in and resuming ([F6.11c](#f6-11c)). Neither needs a channel to Ringly.
  - **Ringly's contact address remains published** ([Q3](#q3)) for everything else a
    business might need a human for. It is **not load-bearing for any lifecycle
    transition**, which is the point: no account action depends on Ringly reading
    an inbox.
- <a id="f9-3"></a>**F9.3** **There is one lifecycle path out, and both exits join it at the
  same point: the day service stops.** Cancellation and non-payment differ only
  in how they get there.

  **Getting there — two routes:**

  | Route                | What happens                                                                                                                                                                                             |
  | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | **Payment fails**    | Service continues while the provider retries ([F6.11](#f6-11)). Usage accrues and stays billable. The provider emails; Ringly does not. When the last retry fails, **service stops** ([F6.11b](#f6-11b)) |
  | **Business cancels** | Self-serve, from its own dashboard ([F6.12](#f6-12)). **Service stops the same day**, with the consequences stated on screen before it confirms                                                          |

  **From there — one path, identical either way:**

  | Day               | What happens                                                                                                                                                                  |
  | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | 0                 | Agent unbound and verified. **Final invoice raised** for the part-month served ([F6.9a](#f6-9a)). **Subscription paused, never cancelled** ([F6.11b](#f6-11b)). Ringly emails |
  | 0–60              | **Dormant.** Number, subscription and every record retained. **Nothing new is charged and nothing accrues** ([I5](#i5)). Any open invoice is still chased by the provider     |
  | Any day inside it | **Fully recoverable.** Settle anything owed and service resumes that day, on the same number with the same history, on a new period ([F6.11c](#f6-11c), [F6.10a](#f6-10a))    |
  | ~58               | **48-hour final warning by email**, itemising exactly what will be deleted **and that the subscription can no longer be resumed afterwards**                                  |
  | 60                | **Full stop.** Subscription cancelled, number released, Ringly-held data deleted, amount owed recorded permanently ([F9.9](#f9-9))                                            |

  **There is exactly one deletion clock in the product. It starts when the phone
  stops answering and it runs 60 days** — the same clock, the same warnings and
  the same teardown whichever route a business took to get there.

  Those 60 days cost Ringly almost nothing — service has already stopped, and only
  the number rental continues — so the window is long, because the business's
  number is worth far more to them than the rental is to Ringly. **It costs the
  business nothing at all**, which is the point: Ringly does not charge for a
  phone it is not answering.

  **A business still in its trial takes the same path.** Cancelling during a trial
  stops service that day, raises no invoice ([F6.12a](#f6-12a)), and begins the same 60
  days. It has paid Ringly nothing and is held on exactly the same terms as a
  business that paid for a year ([F6.12b](#f6-12b)).

- <a id="f9-3a"></a>**F9.3a** **Nothing is ever deleted without a 48-hour warning email first.**
  This applies to both paths and is not conditional on the business having read
  earlier emails.
- <a id="f9-3b"></a>**F9.3b** **A business that has cancelled is still pursued for what it owes.**
  Cancelling pauses the subscription but does not close the invoices already
  raised against it, and the provider keeps chasing them on its own schedule
  ([F6.11a](#f6-11a)). What stops is billing for service, not collection of a debt — the
  two are different things and conflating them is how a business cancels its way
  out of a bill.
- <a id="f9-3c"></a>**F9.3c** **Deletion is confirmed by email to the business and to the
  operator** — always 60 days after service stopped ([F9.3](#f9-3)), whichever route took
  it there.
  - **To the business:** what has been deleted, that **the number is gone
    permanently and cannot be recovered** ([F9.4b](#f9-4b)), and any amount recorded as
    owed ([F9.9](#f9-9)). The 48-hour warning said this was coming ([F9.3a](#f9-3a)); this says it
    has happened. A business that ignored the warning and rings its own number a
    week later deserves a better answer than a dead line.
  - **To the operator:** the same event, with the money — lifetime net revenue
    and the amount left owing — because deletion is the moment a customer
    relationship ends and the only moment those totals are final ([F7.13](#f7-13)).
  - **It is sent even when the address has stopped working** ([F7.15](#f7-15)). Every
    provisioned business verified its contact address once ([F1.10](#f1-10), [F1.11](#f1-11)),
    but an address that worked in March can bounce in September, and the operator
    queue may already be carrying it as undeliverable. **Best effort to the
    address on file is better than deleting in silence**, and the queue entry is
    what prompts a human to reach them another way.
- <a id="f9-3d"></a>**F9.3d** **The deletion email is sent before anything irreversible happens to
  the business.** Two constraints fix its position and both are load-bearing:
  - **Before the tenant rows are deleted**, because `departed_businesses`
    deliberately keeps no contact details ([F9.9](#f9-9)) and once teardown removes the
    tenant row there is no address left to write to.
  - **Before the number is released** ([F9.4b](#f9-4b)), because that step cannot be
    undone: the number goes back to the carrier and neither Ringly nor the
    business can have it again. Sending first means a send that fails outright
    halts teardown while the business is still whole and still recoverable,
    rather than after it is neither.

  **The send is enqueued, not waited on.** The idempotency key is written before
  the send ([F7.5](#f7-5)), so the message is durable the moment it is queued and teardown
  never blocks on the email provider retrying ([N7](#n7--third-party-dependencies-and-degradation)). A rented number must not stay
  open, billing Ringly, because Resend is slow.

  This fixes the position of the send inside the teardown order ([F6.19](#f6-19), EDD
  [§2.13.4](Ringly_EDD_v3.md#2134-teardown-in-order)) — it is not a step that can be moved to the end for tidiness.

- <a id="f9-4"></a>**F9.4** A business's telephone number is its public identity, printed on
  signage and listings, and losing it is not recoverable. **It is held for 60
  days after service stops, and the reason service stopped makes no difference**
  ([F9.3](#f9-3)) — non-payment, chargeback and the business's own cancellation all get
  the same 60 days, fully recoverable throughout ([F6.12b](#f6-12b)).
  - **Holding it costs Ringly only the rental; releasing it early costs the
    business its identity.** That asymmetry is the whole argument, and it does not
    change with the reason for leaving.
  - **A business still in its trial is held on the same terms**, having paid
    nothing. Two dormancy lengths would mean getting the short one wrong at the
    worst possible moment ([F6.12b](#f6-12b)).
- <a id="f9-4a"></a>**F9.4a** **A number is never reassigned while any business still holds it.**
  Dormancy stops the number being answered, which makes it look unused; it is
  not. A number leaves a business **only at deletion**, 60 days after service
  stopped, and never during dormancy however idle it appears.
- <a id="f9-4b"></a>**F9.4b** **At deletion the number is handed back to the telephony provider,
  not retained in a Ringly pool for the next business.** Recorded with its
  reasoning so the question is settled:
  - **There is no purchase price to save.** Retell numbers are a **$2/month
    rental with no one-time purchase fee**, so holding one costs $2/month for as
    long as it sits idle and buying a fresh one when needed costs the same $2/month
    starting only when needed. Pooling is strictly more expensive, and it
    manufactures exactly the cost [F8.9](#f8-9) exists to surface.
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
- <a id="f9-5"></a>**F9.5** **Deleting a business deletes Ringly's own database only**, plus the
  external teardown in [F6.19](#f6-19). Transcripts and recordings expire on their own
  **30-day TTL** with the telephony provider ([F9.6](#f9-6)), and **Ringly does not chase
  them on any path**.
  - **The TTL is always shorter than the deletion clock now.** Deletion is 60 days
    after service stopped ([F9.3](#f9-3)) and the last call a business can have taken was
    on the day service stopped, so provider-held content has expired at least 30
    days before Ringly's own rows go.
  - **There is no path on which it is false**, which is what makes "Ringly chases
    none of it" a rule rather than a rule with an exception. A single deletion
    clock is what buys that ([F9.3](#f9-3)).
- <a id="f9-6"></a>**F9.6** **Ringly stores neither transcripts nor recordings.** Both remain
  with the telephony provider and are fetched on demand when needed. Retention is
  configured **on every provisioned agent**, never inherited from a default:
  - **Recordings: 30 days.** Deliberately generous for now so early calls can be
    reviewed while the product is being proven; to be reduced once recordings are
    shown to behave.
  - **Transcripts: at least 30 days**, and never shorter than recordings.
- <a id="f9-7"></a>**F9.7** Because transcript and recording retention live with the provider,
  **call content older than 30 days is not retrievable** — by the business or by
  Ringly. Any requirement that depends on older call content must be read against
  this limit.
- <a id="f9-8"></a>**F9.8** **Retention of Ringly's own data: everything lives as long as the
  business does.** Ringly does not age out any table while a business is active.
  Call records, customers, appointments, usage, costs and money records are all
  needed by the business dashboard, the operator dashboard, and invoice
  reconciliation — all of which look back over months, not days.
  - The **only** thing on a 30-day clock is what Ringly does **not** store:
    transcripts and recordings, held by the telephony provider ([F9.6](#f9-6)).
  - Everything Ringly holds is destroyed when the relationship is over, on the
    single clock that governs every ending ([F9.3](#f9-3), [F9.4](#f9-4)): **60 days after
    service stops**, whatever stopped it.
  - **It all goes at once, in the transaction that writes the departure record**
    ([F9.1a-i](#f9-1a-i), [F9.10](#f9-10)) — customers, appointments, calls, usage and costs together.
  - There is no partial or rolling deletion, no field-level expiry, and **no way
    to delete any part of it early** ([F9.1a](#f9-1a)).
- <a id="f9-9"></a>**F9.9** **A departed business leaves a permanent financial record.** When a
  business is deleted, Ringly retains, indefinitely and outside the purge:
  - the business's **id and name**;
  - the **date it joined and the date it left**, and how it ended;
  - the **amount it still owed** at departure — **read from the payment provider
    at teardown, not at the moment service stopped**, because the provider goes
    on collecting throughout the 60 dormant days and a business that settled on
    day 50 must not be recorded as a debtor forever ([F6.12d](#f6-12d));
  - the **lifetime net revenue** Ringly earned from it, **after payment-processor
    fees**.

  This record contains **business identity and money only — never consumer data**.
  No caller names, no phone numbers, no appointments. It exists so Ringly can
  answer "what did this customer earn us, and what did they leave owing" years
  later, and must not become a way for customer records to survive deletion.

- <a id="f9-10"></a>**F9.10** **The financial record is captured before teardown begins, and
  written by the same transaction that removes the business.** Net revenue is
  derived from payment-processor records that the teardown deletes, so the order
  is fixed: **capture the totals → tear down the payment provider, cancelling the
  subscription and marking unpaid invoices uncollectible ([F6.19](#f6-19)) → send the
  deletion emails ([F9.3d](#f9-3d)) → release the number → delete Ringly's rows and write
  the departure record, together, in one transaction.** Each step destroys
  something the one before it needed: the totals — including the amount still
  owed ([F9.9](#f9-9)) — come from Stripe, and the emails need an address on the tenant
  row.
  - **Cancelling the subscription is a teardown step and appears nowhere else.**
    Every earlier stop is a pause ([F6.11b](#f6-11b)), because a paused subscription can be
    resumed and a cancelled one cannot. **It raises no invoice**: the business was
    paused, nothing has accrued since, and billing a customer who is being
    deleted in the same minute is a receivable nobody can collect.
  - **The last two are one transaction because they are the only two that can
    be.** Every other step is a call to an external provider and cannot join a
    database transaction; these two are both local to Ringly's own database.
  - **Ordering them against each other was the mistake.** Writing the record
    first leaves a window in which a business is both present and departed —
    still counted among active businesses ([F8.4](#f8-4)) if the process then dies.
    Deleting first leaves a window in which a crash loses a money record
    permanently, which is worse ([N10.1](#n10-1), [N10.6](#n10-6)). **Committing them together
    removes both windows**, and there is no third state to reason about: either
    the business is gone and its record exists, or neither happened and teardown
    can be run again.

---

## 1.6 Non-functional requirements

### N1 — Multi-tenancy and isolation

- <a id="n1-1"></a>**N1.1** Every row of business data belongs to exactly one business, and no
  query path can return another business's rows. Isolation is enforced by the
  database, not only by application code.
- <a id="n1-2"></a>**N1.2** Server-side code paths that bypass row-level security (webhook
  handlers using a service role) must scope every query by business explicitly,
  and that scoping must be covered by tests.
- <a id="n1-3"></a>**N1.3** A tenant's data is **deleted** completely when the relationship ends
  ([F9.8](#f9-8)). **Ringly offers no export**, deliberately: every appointment already
  lives in the business's own calendar, which they keep; transcripts and
  recordings were never Ringly's to give; and everything else is Ringly's
  operational record of a relationship that has ended. There is nothing a
  business would receive that it does not already hold.

### N2 — Scale

- <a id="n2-1"></a>**N2.1** Target: **10,000 businesses**, each with up to **10,000 customers** and
  a comparable number of historical appointments and calls — order 10⁸ rows in
  the largest tables.
- <a id="n2-2"></a>**N2.2** No feature may degrade as a function of _total_ platform size; only of
  the requesting tenant's own size.
- <a id="n2-3"></a>**N2.3** Scheduled background work — analytics
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
and most of them do not ([F2.7](#f2-7)). Six seconds of the agent saying "let me just
check that for you" costs a slightly awkward pause; abandoning at 1.5 seconds
costs the business the booking. The agent covers the wait with filler speech
([F2.6](#f2-6)), so the caller hears someone working rather than silence.

**The ceiling is not a licence to be slow.** A provider routinely taking seconds
is a provider failing its p95, and that is an operational problem to raise
([N7.3](#n7-3)) rather than absorb quietly.

- <a id="n3-1"></a>**N3.1** Any backend operation on the call path has a hard timeout and a
  defined outcome on expiry. **Slow is treated as failed** — and for the
  scheduling provider, failed means the booking is refused ([F2.7](#f2-7)), not that it
  proceeds unverified. There is no "degrade" to fall back to: the only thing to
  degrade _to_ would be a booking Ringly cannot stand behind.
- <a id="n3-2"></a>**N3.2** Work not needed to answer the caller is done after responding, never
  before.

### N4 — Serving cost

- <a id="n4-1"></a>**N4.1** Per-business fixed monthly infrastructure cost (excluding telephony
  and LLM minutes, which are usage-driven) is the metric to minimise; it must not
  grow faster than linearly with tenants.
- <a id="n4-2"></a>**N4.2** Repeated reads of slow-changing configuration on the call path must
  not hit paid third-party APIs or the primary database every time.
- <a id="n4-3"></a>**N4.3** Dashboard analytics must be served from pre-aggregated data, not from
  scanning raw call history per request.
- <a id="n4-4"></a>**N4.4** Paid third-party calls (Places, LLM, telephony) are attributable per
  business so unit economics are measurable.

### N5 — Timezone correctness

- <a id="n5-1"></a>**N5.1** Every instant is stored in UTC and rendered in the business's IANA
  timezone.
- <a id="n5-2"></a>**N5.2** All day, week, and month boundaries **for availability and analytics
  grouping** are computed in the business's timezone, not the server's and not
  UTC.
  - **Billing periods are the exception, and they are not Ringly's to compute.**
    A period boundary is one instant held by the payment provider ([F6](#f6--billing-and-payments)); Ringly
    reads it and renders it in the business's timezone, but never derives it.
    Two systems computing when a month ends is two systems that will eventually
    disagree about which month a call belongs to, and the provider is the one
    that raises the invoice.
  - **The consequence is that a billing month is anchored to a UTC instant**, so
    a business far from UTC may see its invoice dated a few hours either side of
    its own local midnight. Accepted, and stated so nobody treats it as a
    defect.
- <a id="n5-3"></a>**N5.3** Behaviour is correct across DST transitions, including the duplicated
  and skipped local hours.

### N6 — Security and compliance

- <a id="n6-1"></a>**N6.1** Provider refresh tokens are encrypted at rest.
- <a id="n6-2"></a>**N6.2** Card data never touches Ringly infrastructure ([F6.3](#f6-3)), keeping us out
  of PCI-DSS scope beyond SAQ-A.
- <a id="n6-3"></a>**N6.3** All inbound webhooks verify provider signatures before acting.
- <a id="n6-4"></a>**N6.4** Customer PII (name, phone) is per-tenant and is destroyed **wholesale
  and automatically when the tenant leaves** ([N1.3](#n1-3), [F9.1a-i](#f9-1a-i)), in the transaction
  that writes the departure record. **That is the only deletion path, and it
  needs no human in the loop** — it neither waits on anyone at Ringly nor offers
  anyone a control to press. **There is deliberately no per-customer deletion**
  ([F9.1a](#f9-1a)).
- <a id="n6-5"></a>**N6.5** **Ringly is a service provider to the business, not a controller of
  the caller's data.** The business owns its customer relationship and its own
  privacy obligations; Ringly processes on its behalf and offers the caller no
  interface ([F9.1a](#f9-1a)). Every consumer request therefore arrives through the
  business, and Ringly's duty is to be able to action it ([N6.4](#n6-4)), not to
  adjudicate it.

### N7 — Third-party dependencies and degradation

Ringly is assembled from services it does not control. Pretending otherwise
produced the wrong behaviour once already ([R1](Ringly_EDD_v3.md#r1)), so the dependencies and their
failure modes are stated explicitly.

| Dependency                                                                                            | Used for                    | If it is down                                                                                                                           |
| ----------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Retell**                                                                                            | Telephony, STT, LLM, TTS    | **Total outage.** No call is answered. Nothing Ringly can do; not survivable by design.                                                 |
| **Supabase**                                                                                          | All tenant data             | **Total outage.** The agent cannot resolve the business or its catalogue. Not survivable.                                               |
| **Application host** ([N8](#n8--hosting-undecided-and-the-application-must-stay-portable), undecided) | The application itself      | **Total outage.**                                                                                                                       |
| **Google Calendar** (or other scheduling provider)                                                    | Verifying a slot is free    | **Booking fails audibly** ([F2.7](#f2-7)). The caller is told; nothing is written. Enquiries still work.                                |
| **Stripe**                                                                                            | Charging, refunds, tax      | Calls continue. Charges queue and settle later; usage accrues locally regardless (EDD [§2.10](Ringly_EDD_v3.md#210-billing)).           |
| **Resend**                                                                                            | Business and operator email | Calls continue. Email retries; delivery is delayed. A message that still cannot be delivered surfaces to the operator ([F7.15](#f7-15)) |
| **Google Places**                                                                                     | Onboarding enrichment       | New onboarding degrades to manual entry. Existing businesses unaffected.                                                                |

- <a id="n7-1"></a>**N7.1** A failure in a **non-critical** dependency (Stripe, Resend, Places)
  must never prevent an existing business from answering calls. Retell, Supabase
  and the application host are **critical** — their loss is a Ringly outage, and
  no design mitigates it.
- <a id="n7-2"></a>**N7.2** **Scheduling-provider failure is fail-closed, not fail-open.** Ringly
  will not book a time it could not verify. The caller hears an error and no row
  is written.
- <a id="n7-3"></a>**N7.3** Every degraded path is logged, surfaced to the business, and alerted
  to the operator. **Silent degradation is a defect** — see [R1](Ringly_EDD_v3.md#r1), which is exactly
  this bug in the shipped code.

### N8 — Hosting: undecided, and the application must stay portable

**Where Ringly runs is an open decision ([Q6](#q6)).** The two candidates are **Vercel**
and **Google Cloud Run**, and nothing in this document assumes either.

- <a id="n8-1"></a>**N8.1** No requirement in this document depends on the choice. Everything the
  application needs from its host is ordinary: serve HTTP, hold environment
  secrets, and run scheduled work on a timer.
- <a id="n8-2"></a>**N8.2** **The application must not become unportable while the decision is
  open.** Host-specific primitives — a proprietary cron, a proprietary
  key-value or queue product, a runtime only one platform offers — are not to be
  adopted without recording the decision to be locked in. This is cheap to hold
  now and expensive to undo later.
- <a id="n8-3"></a>**N8.3** **Scheduled work is the only place the two hosts differ materially**,
  and it is where every background worker in this design lives (EDD [§2.2](Ringly_EDD_v3.md#22-architecture)). The
  design therefore specifies workers as **idempotent HTTP endpoints invoked by
  an external timer**, which both platforms can drive and neither owns.
- <a id="n8-4"></a>**N8.4** Whichever is chosen must run in a **US region**, alongside the
  database, so the call path does not cross a continent inside a 400ms budget
  ([N3](#n3--latency-on-the-call-path)).

### N9 — Cost control on the unauthenticated surface

**Sized for the traffic actually expected, which is low.** Onboarding is not a
consumer signup funnel — a realistic day is a handful of businesses, not
thousands — so this is a **cost guardrail, not an anti-abuse system**. Build the
cheap version; revisit only if the cost figures say otherwise.

- <a id="n9-1"></a>**N9.1** **Onboarding enrichment is a paid endpoint reachable without a login**
  (EDD [§2.5.1](Ringly_EDD_v3.md#251-the-flow) step 2: Google Places, a website crawl, and a model call). It carries
  a **simple per-IP limit and a daily spend ceiling**, above which it degrades to
  manual entry ([F1.4](#f1-4)) rather than continuing to spend. Both are configuration.
- <a id="n9-2"></a>**N9.2** The spend is **attributable** even before a business exists ([N4.4](#n4-4)), so
  a runaway is visible in the operator's cost figures rather than appearing as
  unexplained margin loss. **Visibility is doing most of the work here** — at
  this volume, noticing is worth more than preventing.
- <a id="n9-3"></a>**N9.3** Nothing chargeable to Ringly beyond enrichment — buying a number,
  creating an agent — may happen before a Google sign-in (EDD [§2.5.1](Ringly_EDD_v3.md#251-the-flow) step 7). This is
  the real bound: a bot that gets through the limiter costs one enrichment call,
  never a phone number.

### N10 — Durability of money records

**This is the strictest requirement in the document.** Everything else can be
rebuilt from a provider or asked for again; the record of what a business was
charged, under which terms, and what it still owes exists nowhere else in full.
Stripe holds the payments but not the periods, the policy versions, the clamped
totals, or the usage they were derived from.

- <a id="n10-1"></a>**N10.1** **The money tables are `billing_events`, `usage_records`,
  `billing_periods`, `pricing_policy` and `departed_businesses`.** They are named
  here so the protections below apply to a definite list rather than a feeling
  about which data is important.
- <a id="n10-2"></a>**N10.2** **Two copies in v3:**
  1. **Point-in-time recovery** on the primary database — covers a bad
     migration, an errant delete, corruption.
  2. **Automated backups replicated to a second region**, retained ≥ 90 days —
     covers losing a region.
- <a id="n10-3"></a>**N10.3** **RPO ≤ 1 hour for the money tables, RTO ≤ 4 hours.** An hour is
  below any billing interval in this design, so at most one hour of usage
  records — not one period's, and never a settled charge — can be at risk.
- <a id="n10-4"></a>**N10.4** **Nothing in the money tables is ever hard-deleted or updated in
  place once settled** ([F6.16](#f6-16)). Corrections are new rows. A durable copy of a
  table that gets rewritten protects nothing, and this costs nothing to hold to
  from the first migration.
- <a id="n10-5"></a>**N10.5** **Restores are exercised on a schedule and the result recorded.** A
  backup never restored is a belief.
- <a id="n10-6"></a>**N10.6** **Deleting a business is not an exception.** The departure record is
  written by the transaction that removes the tenant, and deliberately outlives
  it ([F9.9](#f9-9), [F9.10](#f9-10)); it is a money record and is covered by the above. **It is
  never left unwritten and never written alone**: a business cannot be deleted
  without its record, and no record can exist for a business still present.
- <a id="n10-7"></a>**N10.7** **Stripe is a second copy of the payments, though not of the
  reasoning.** Every charge, refund and dispute also exists in Stripe's own
  records, which fail independently of Ringly's infrastructure. What Stripe does
  **not** hold is which period a payment settled, under which policy version,
  against how many seconds of usage, and clamped by how much — so Stripe is a
  meaningful partial backstop for v3, and not a substitute for N10.2.

> **Deferred, deliberately ([§1.9](#19-deferred)): a third copy outside the provider account.**
> Both copies above live in the same provider account and share its fate — a
> credential compromise or an account closure takes them together. The fix is an
> append-only export to storage under separate credentials, and it is **not built
> in v3**: it is real work for a failure mode that is rare, and Stripe ([N10.7](#n10-7))
> covers the payments half of it in the meantime. Recorded so the gap is a
> decision rather than an oversight, and revisited once there is revenue worth
> the effort.

## 1.7 Success metrics

**v3 measures two transitions, not one**, because the business's commitment and
its first payment are different events. It commits when it gives a
working card and its number goes live ([F1.11](#f1-11)); it starts paying when the trial
ends by itself, days or calls later ([F1.11d](#f1-11d)). Measuring only the second would
attribute to the product a delay that is the trial length by design.

| Metric                                                    | Target                 | Measured from → to                                                   |
| --------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| **Time to live** — land → own number answering            | p50 < 15 min           | First keystroke → number bound and trial started ([F1.11a](#f1-11a)) |
| **Checklist completion** — land → all three green         | > 70%                  | Of businesses reaching the checklist ([F1.11](#f1-11))               |
| **Trial conversion** — trial started → first invoice paid | > 75%                  | Of businesses whose number went live                                 |
| **Trial engagement** — a booking taken during the trial   | > 60%                  | Of trials; the leading indicator for conversion ([F8.6a](#f8-6a))    |
| Caller-perceived silence per turn                         | p95 ≈ 0, no gap > 1.5s |                                                                      |
| Booking conflicts reaching a customer                     | 0                      |                                                                      |
| Dashboard load                                            | p95 ≤ 500 ms           |                                                                      |
| Monthly infra cost per business                           | tracked, trending down |                                                                      |

**Time to live is minutes, not hours**, where the old time-to-activated was under
a day. The inbox round-trip is still there — the contact email must be verified
([F1.10](#f1-10)) — but nothing waits on a business deciding whether to pay, because that
decision has moved to the end of the trial and is made by not cancelling.

**Trial engagement is the metric worth watching.** Conversion is decided during
the trial and observed a fortnight later; a booking taken is the earliest signal
that the product worked, and it is the same signal the operator alert uses
([F8.6a](#f8-6a)).

## 1.8 Decisions and open questions

**Still open:**

- <a id="q1"></a>**Q1 — The per-connected-minute rate.** TBD; held as configuration
  ([F6.8](#f6-8)), so billing can be built and tested with a placeholder but **cannot be
  switched on for real customers until it is set**.
- <a id="q3"></a>**Q3 — Ringly's contact email address.** No longer load-bearing for any
  lifecycle transition ([F9.2](#f9-2)) — cancellation and resumption are both self-serve
  — but still needed in the footer of every message Ringly sends and as the route
  to a human for everything else.
- <a id="q6"></a>**Q6 — Where the application is hosted ([N8](#n8--hosting-undecided-and-the-application-must-stay-portable)).** **Vercel** or **Google Cloud
  Run**; undecided. It does not block any phase — [N8.2](#n8-2) keeps the application
  portable while it is open — but it must be settled before the first paying
  customer, because moving a live phone system is not a thing to do casually.
  The decision turns on how scheduled work is run ([N8.3](#n8-3)) and on whether the
  Next.js-native deployment is worth more than the container control.
- <a id="q7"></a>**Q7 — The trial's two bounds** ([F1.12](#f1-12)): how many days and how many calls.
  Both are configuration and neither blocks building the trial, but they cannot
  be left unset at launch — they are stated to the business on the checklist
  screen before it commits ([F1.11](#f1-11)), so a placeholder is visible to a customer in
  a way a placeholder rate is not.
- <a id="q8"></a>**Q8 — The retry count and window** ([F6.11](#f6-11)). Three attempts is the working
  assumption; the window they span decides how long a business with a failed card
  keeps being served free, which is the largest uncontrolled giveaway left in the
  model after the cap ([F6.9b](#f6-9b)).
  - **It is bounded above by one billing period and that bound is not negotiable**
    ([F6.11](#f6-11)): a window running past the next cycle raises a second $100 invoice
    against a business already being stopped. Whatever is chosen, it is a value
    strictly under 28 days — the shortest month a period can be.
  - The provider's own retry scheduling spreads attempts across the window, so
    the question is really "how many days of free service is a recoverable
    customer worth", and it should be answered with the same reasoning that made
    dormancy 60 days: the number rental is cheap and a lost customer is not.

**Action items — work that is not a question and not a phase:**

- <a id="a1"></a>**A1 — Manual QA against the real Google, Retell and Resend, before launch.**
  The automated suite fakes all three (EDD [§2.15.4](Ringly_EDD_v3.md#2154-what-is-faked-and-what-is-not)), so it proves Ringly reacts
  correctly to a simulated calendar failure, not that Google fails that way. What
  only a human can confirm is listed at **EDD [§2.15.6](Ringly_EDD_v3.md#2156-what-the-suite-cannot-prove)**: that the agent actually says
  the disclosure and sounds right, that a real granular-consent decline and a real
  token revocation behave as designed, and that mail from all four identities
  lands in an inbox rather than a spam folder. **Owner: the operator.** This is
  the untested half of the system, and no amount of green tests substitutes for
  it.
- <a id="a2"></a>**A2 — A load exercise against the [N2.1](#n2-1) targets** (10,000 businesses × 10,000
  customers), which an end-to-end suite cannot express (EDD [§2.15.6](Ringly_EDD_v3.md#2156-what-the-suite-cannot-prove)).
- <a id="a3"></a>**A3 — A restore drill** proving [N10.5](#n10-5), including from the cross-region copy.
- <a id="a4"></a>**A4 — Prove the subscription lifecycle against a payment-provider test clock,
  end to end.** The model now depends on provider behaviour at four points, and
  each is cheap to confirm and expensive to be wrong about:
  1. **A usage line can be added to a subscription invoice before it finalises**,
     reliably, on the provider's own invoice-created notification ([F6.1a](#f6-1a)).
  2. **A paused subscription raises no new invoice and its open one is still
     pursued** ([F6.11b](#f6-11b)) — the pair the whole dormancy design rests on.
  3. **A paused subscription resumes with its anchor reset to the resume date**
     ([F6.10a](#f6-10a)), and the business keeps its customer, its card and its history.
  4. **Ending a trial early on the call bound raises the first invoice that day**
     ([F1.12b](#f1-12b)).

  **Blocks charging a real customer**; blocks nothing about building the billing
  path, which can be written and tested against the answer either way.

---

## 1.9 Deferred

"v1", "v2" and "v3" refer only to **documents**; product scope is either _in v3_
or listed below. **Nothing here is scaffolded in advance** — no dormant table, no
unused column, no dead code path held open against a future that may not arrive
(EDD [§2.4](Ringly_EDD_v3.md#24-data-model)/005, [F6.5](#f6-5)).

### Soon after v3

- **Operator alerting via Slack**, replacing email ([F8.6](#f8-6)).
- **A third copy of the money records, outside the primary provider account**
  ([N10](#n10--durability-of-money-records)). v3 ships point-in-time recovery plus cross-region backups, which both
  live in one account and share its fate. The eventual fix is an append-only
  daily export under separate credentials with object lock (EDD [§2.14.5](Ringly_EDD_v3.md#2145-durability-of-money-records-n10) records the
  shape). **Deferred because it is real work against a rare failure**, and
  because Stripe independently holds the payments half in the meantime ([N10.7](#n10-7)).
  Worth doing once there is enough revenue to miss.
- **The provider's own customer portal**, for payment-method updates and invoice
  history. Ringly builds the minimum itself in v3 ([F5.15](#f5-15)); the portal would do
  it better and for free. **Not adopted now because its cancellation flow is the
  provider's, not Ringly's** — it would cancel the subscription outright where
  [F6.12](#f6-12) requires a pause, and a cancelled subscription cannot be resumed, which
  would silently destroy dormancy ([F6.12b](#f6-12b)). Adopting it means configuring it
  for payment methods only.
- **Plan changes and annual billing.** A subscription makes both cheap for the
  first time — the provider handles proration between prices — and neither is
  expressible in the old hand-rolled model. Not now, because there is one plan
  ([§1.4](#14-scope)).

### Not planned

These are **out of scope with no date**, listed so nobody re-proposes them as
oversights. Each is a boundary stated in [§1.4](#14-scope), repeated here because that is
where people look.

- **Any channel to the calling customer**, and therefore every feature built on
  one: appointment confirmations after the call, appointment reminders, no-show
  follow-up.
- **Recurring appointments** ([§1.4](#14-scope)). A repeating request books its first
  instance and stops there ([F2.2a](#f2-2a)); series scheduling is not deferred, it is
  not planned.
- **Call transfer to a human, and voicemail** ([F2.10](#f2-10)).
- **Staff logins and roles** ([§1.4](#14-scope)).
- **Healthcare businesses**, until a BAA exists ([§1.4](#14-scope), [R11](Ringly_EDD_v3.md#r11)).

# Ringly — Engineering Design (v3.0)

_Written 2026-08-01 against [`Ringly_PRD_v3.md`](./Ringly_PRD_v3.md), which is
the document this one is answerable to. Supersedes Part 2 of
`Ringly_PRD_EDD_v2.md`._

> **Read the PRD first.** Every `F` and `N` reference here points into it. This
> design is derived from those requirements rather than from the code in this
> repository, and **where the two disagree the code is what changes**.

> **Where to start.** **[§2.1](#21-what-the-design-is-answerable-to)** is the six properties every later section cites
> instead of re-arguing. Every design section then ends with a **Testing** block
> naming what is observable from outside, what is internal and may never appear in
> a test body, and the behaviours that section owes the scenario catalogue.
> **[§2.15](#215-test-strategy-and-the-tdd-workflow)** is the test strategy those blocks feed; **[§2.16](#216-delivery-plan)** is the delivery
> plan; **[§2.18](#218-risks-and-open-questions)** carries the risk register, whose numbers are cited from the PRD
> and from commit messages and are therefore stable.

> **Not yet written: the scenario catalogue** ([§2.19](#219-scenario-catalogue)), and with it the
> requirement coverage it carries — each scenario names the requirement it holds,
> so the catalogue _is_ the coverage map. Until it lands, `tests/behaviour/` still
> describes the withdrawn catalogue.

> **Revision history is in `git log docs/Ringly_EDD_v3.md`** — one commit per
> decision, each carrying the reasoning for that decision alone.

---

_Derived from the PRD rather than from the code that exists, and where the two
disagree the code is what changes._

**How to read this.** Every design section ends with a **Testing** block naming
three things: what is **observable** from outside the system and may therefore
be asserted on, what is **internal** and may never appear in a test body, and
the **behaviours** that section owes the scenario catalogue. That split is not
documentation of the tests — it is a constraint on the design. A requirement
with no observable consequence cannot be tested, and a design that makes a
required behaviour observable only through a table name has failed before a
line of it is written.

**The test suite is written first.** [§2.15](#215-test-strategy-and-the-tdd-workflow) sets out the loop; each section's
Testing block is what that loop consumes.

---

## 2.1 What the design is answerable to

Six properties come out of the PRD and constrain every decision below. They are
listed here so that a later section can say "because 2.1.3" instead of
re-arguing.

**2.1.1 — A booking Ringly cannot verify is worse than no booking.** [F2.7](Ringly_PRD_v3.md#f2-7) and
[N7.2](Ringly_PRD_v3.md#n7-2) make the scheduling provider a hard dependency of the write path: if the
calendar cannot be read, nothing is written and the caller is told to ring back.
This removes every design in which booking proceeds optimistically and
reconciles later. It also means the provider's latency is on the call path and
inside [N3](Ringly_PRD_v3.md#n3--latency-on-the-call-path)'s budget, which shapes [§2.6](#26-the-call-path) and [§2.7](#27-scheduling-providers).

**2.1.2 — There is no channel to the calling customer.** [§1.4](Ringly_PRD_v3.md#14-scope) is absolute: the
agent reading a booking back during the call is the entire confirmation. Nothing
in this design may grow a notification path to a caller, and every event that
would otherwise want one — a failure, a change, a deletion — resolves to telling
the **owner** instead. It is also why customer PII is thin (a name and a phone
number) and why deleting it is cheap.

**2.1.3 — The money records are the strictest thing in the system.** [N10](Ringly_PRD_v3.md#n10--durability-of-money-records) names
five tables that are never hard-deleted, never updated in place once settled,
and must survive losing a region. Everything else can be rebuilt from a provider
or asked for again; what a business was charged, under which policy version, and
against how many seconds of usage exists nowhere else in full. This forces
append-only ledgers, versioned pricing policy, and the transaction at the end of
teardown ([§2.13](#213-lifecycle-suspension-and-teardown)).

**2.1.4 — Exactly one act starts billing.** [F1.12b](Ringly_PRD_v3.md#f1-12b) enumerates, negatively, every
thing that must not: call volume, elapsed time, a confirmed test call, a stored
card, an operator. There is therefore exactly one code path that can create
period 1 and take the first $100, and it is reached only from the Activate
button. This is a structural claim, not a policy one — a second path is a defect
even if it never fires.

**2.1.5 — Nothing may degrade with total platform size.** [N2.1](Ringly_PRD_v3.md#n2-1) targets 10,000
businesses × 10,000 customers, order 10⁸ rows in `calls` and `appointments`.
[N2.2](Ringly_PRD_v3.md#n2-2) permits degradation only as a function of the requesting tenant's own size.
Every tenant table therefore leads its primary index with `business_id`, and no
dashboard query is allowed to scan raw call history ([N4.3](Ringly_PRD_v3.md#n4-3)) — which is what makes
the rollup in [§2.9](#29-analytics-and-the-two-dashboards) mandatory rather than an optimisation.

**2.1.5a — The delivery plan is downstream of this design, never an input to
it.** No decision in this document is justified by when something is scheduled to
be built. Where a table lands is decided by what depends on it; where a mechanism
lives is decided by the requirement it serves. A design shaped by build order
encodes the build order permanently — the schema outlives the plan, and a column
placed to suit a phase is still there long after the phase is forgotten.
[§2.16](#216-delivery-plan) is therefore **derived from** the sections above it
and is the one section expected to change without any of them changing.

**2.1.6 — The host is undecided and must stay that way.** [N8](Ringly_PRD_v3.md#n8--hosting-undecided-and-the-application-must-stay-portable) leaves Vercel and
Cloud Run both open. No host-specific primitive is adopted ([N8.2](Ringly_PRD_v3.md#n8-2)): no proprietary
cron, queue, or key-value product. Background work is specified as idempotent HTTP
endpoints driven by an external timer ([§2.2](#22-architecture)), which both platforms can do and
neither owns.

---

## 2.2 Architecture

**One deployable, one database, and a timer.** That is the whole of it, and the
simplicity is deliberate: 2.1.6 forbids the managed queue or scheduler that
would otherwise absorb the background work.

### 2.2.1 The four surfaces

The application serves four kinds of traffic that differ in who is
authenticated, and the difference matters more than the code layout:

| Surface               | Who is authenticated                                                | Isolation                                                                                                   |
| --------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Onboarding**        | Nobody, until the Google sign-in                                    | No tenant exists yet; spend-capped ([N9](Ringly_PRD_v3.md#n9--cost-control-on-the-unauthenticated-surface)) |
| **Business app**      | The owner's Google identity ([F1.7](Ringly_PRD_v3.md#f1-7))         | Row-level security, scoped to one business ([N1.1](Ringly_PRD_v3.md#n1-1))                                  |
| **`/ops`**            | The operator, separately                                            | The only cross-tenant reader in the system; its own module ([§2.12](#212-the-operator-surface))             |
| **Provider webhooks** | Nobody — a signature, not a session ([N6.3](Ringly_PRD_v3.md#n6-3)) | Service role, so every query scopes by business **explicitly** ([N1.2](Ringly_PRD_v3.md#n1-2))              |

The webhook surface is the dangerous one and is treated as such throughout: it
runs without RLS, it is on the call path under [N3](Ringly_PRD_v3.md#n3--latency-on-the-call-path)'s budget, and it is where a
missing `business_id` predicate becomes a cross-tenant read rather than an
error.

### 2.2.2 Request paths and background work

**Nothing that a caller is waiting on is done in the background, and nothing a
caller is not waiting on is done in the foreground.** [N3.2](Ringly_PRD_v3.md#n3-2) states the rule; the
split falls out of it.

On the call path ([§2.6](#26-the-call-path)): resolve the tenant, check availability, write the
booking, answer. Off it: persisting the call record, metering usage,
classifying the outcome, rolling up analytics, sending mail.

**Six workers, each an idempotent HTTP endpoint invoked by an external timer**
([N8.3](Ringly_PRD_v3.md#n8-3)), which both candidate hosts can drive and neither owns ([N8.1](Ringly_PRD_v3.md#n8-1)). Idempotent is the load-bearing word: the timer may fire twice, a
deploy may overlap a run, and neither may produce a second charge or a second
email.

| Worker                     | Cadence         | Owns                                                                                                  |
| -------------------------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| **Analytics rollup**       | Nightly, per tz | Yesterday's `daily_call_rollups` and `cost_records` for every business                                |
| **Billing settlement**     | Hourly          | Periods due to open or settle; the cap clamp ([§2.10](#210-billing))                                  |
| **Lifecycle sweeper**      | Hourly          | Deadlines that have come due and are not paused; suspension; teardown                                 |
| **Email dispatcher**       | Minutely        | Sending what is queued, with retry ([§2.11](#211-email))                                              |
| **Billing reconciliation** | Daily           | Suspended businesses that owe nothing and were never restored ([F6.10b-i](Ringly_PRD_v3.md#f6-10b-i)) |
| **Calendar health probe**  | Every 5 min     | Businesses with an open calendar incident ([§2.6.4](#264-fail-closed-concretely))                     |
| **Classification**         | Hourly          | Submits and reaps outcome-classification batches ([§2.9.1](#291-outcome-classification))              |

That is seven rows against "six workers" because **classification and the
calendar probe are the same deployment concern and different jobs**; count them
as you like. What matters is that each is a URL, each processes only rows that
have come due, and each is safe to invoke twice.

There is no recurrence materialiser. Recurring appointments left the product
([§1.4](Ringly_PRD_v3.md#14-scope)), and the worker that generated future occurrences went with them.

**Hourly, not daily, for settlement and the sweeper**, because both carry
deadlines a business feels: a period opening late means a business is served
without a period to bill it to, and a suspension arriving a day late is a free
day nobody decided to give. Both are cheap — they process only rows that have
come due, which is also what satisfies [N2.3](Ringly_PRD_v3.md#n2-3): a worker's cost is bounded by the
number of due rows, not by total platform size, so steady-state lag stays bounded
as tenants arrive.

**Why not a queue.** Every job above is a scan of rows that have become due,
which a table already expresses. A queue would add a second source of truth
about what is outstanding, a second thing to keep exactly-once, and a host
dependency 2.1.6 forbids. `lifecycle_deadlines` and the pending-email table are
the queues.

### 2.2.3 What runs where

Everything in one region in the US ([N8.4](Ringly_PRD_v3.md#n8-4)), alongside the database, because the
call path has a 400ms budget for the handler and 80ms of it is the datastore.
A cross-continent hop spends the whole budget on physics.

**Testing this section**

_Observable_ — that a worker's effects happen when time passes rather than when
a test asks; that running a worker twice produces the effects once; that a call
is answered while a background failure is in flight.

_Internal_ — worker endpoint paths, their schedule expressions, the host, the
framework, whether a job is one process or five.

_Behaviours owed to the catalogue_

- Advancing the clock past a due deadline produces its effect with no explicit
  trigger.
- A clock paused part-way and resumed later falls due that much later, with the
  time remaining unchanged.
- A deletion never happens without a warning 48 hours before it, on every path.
- Running any worker twice over the same due work produces one charge, one
  email, one state change.
- A worker failing part-way leaves no half-applied state that a later run
  cannot correct.
- Calls continue to be answered while the email provider, the payment provider
  or the enrichment provider is down ([N7.1](Ringly_PRD_v3.md#n7-1)).

---

## 2.3 Multi-tenancy and isolation

**Two mechanisms, because one is not enough** ([N1.1](Ringly_PRD_v3.md#n1-1), [N1.2](Ringly_PRD_v3.md#n1-2)).

### 2.3.1 Row-level security is the floor, not the ceiling

Every tenant table carries `business_id` and an RLS policy keyed to the
authenticated owner's business. That covers the business app completely: a
missing predicate in a dashboard query returns nothing rather than someone
else's rows.

**It does not cover the webhook surface**, which runs under the service role
precisely because there is no session — the caller is a stranger on a phone.
There, isolation is the application's job:

- Every query issued under the service role names `business_id` explicitly.
- The business is resolved **once** per call, from the dialled number, and
  passed down; nothing downstream re-derives it from caller-supplied data.
- [N1.2](Ringly_PRD_v3.md#n1-2) requires that scoping to be covered by tests, so it is a behaviour in
  [§2.6](#26-the-call-path)'s list rather than a convention in a style guide.

### 2.3.2 `/ops` is the only thing that reads across tenants

And it is the one screen that must ([F8.1](Ringly_PRD_v3.md#f8-1), [F8.2a](Ringly_PRD_v3.md#f8-2a)). It is a separate module with
its own database role, its own routes, and no shared session with the business
app. **The operator's view of a business's dashboard is a render, not an
impersonation** ([F8.2e](Ringly_PRD_v3.md#f8-2e)): no business session is created and no business
credential is used.

### 2.3.3 Physical layout

One Postgres database, one schema, `business_id` on every tenant table. Not a
schema or a database per tenant: 10,000 schemas breaks migrations, connection
pooling, and every cross-tenant query the operator needs.

**Every index on a tenant table leads with `business_id`.** This is the whole of
[N2.2](Ringly_PRD_v3.md#n2-2) in one rule — a query that begins by narrowing to one business cannot
degrade as other businesses arrive. The composite indexes that matter:

```
calls          (business_id, started_at desc)
appointments   (business_id, starts_at)
customers      (business_id, phone)          unique
usage_records  (business_id, period_id)
rollups        (business_id, day)            unique
```

**Testing this section**

_Observable_ — what a business can see; what an operator can see; that a caller
to one business never reaches another's data.

_Internal_ — RLS policy names, roles, the schema, index definitions.

_Behaviours owed to the catalogue_

- A business's dashboard shows only its own figures, with a second busy tenant
  present throughout.
- A booking for business A never appears in business B's calendar, figures or
  billing.
- Two businesses sharing a customer phone number keep separate customer records.
- Dashboard queries return within budget with a second tenant holding 10⁴
  customers.
- The operator can open any business's dashboard; a business cannot reach `/ops`
  by any route or credential.
- A webhook that names no business, or names one it was not signed for, is
  rejected.

---

## 2.4 Data model

Migrations are forward-only and immutable, sequentially numbered, one concern
per file. `001`–`004` have run; new work starts at `005`.

**Nothing here is scaffolded in advance** ([§1.9](Ringly_PRD_v3.md#19-deferred)). There is no dormant column for
a feature that may arrive, and no table for recurrence.

### 005 — foundations

```
businesses(id pk, name, address, timezone, website, business_type,
           contact_email, contact_email_verified_at, test_call_confirmed_at,
           phone_number, telephony_agent_id, agent_bound_at,
           billing_status, activated_at,
           booking_horizon_days default 70 check between 7 and 180,
           test_calls_used, created_at)

billing_events(id pk, business_id fk, kind, amount_cents null,
               provider_ref null, period_id fk null, occurred_at)

services(id pk, business_id fk, name, description, position, active,
         deleted_at, created_at)

service_versions(id pk, service_id fk, price_cents, duration_minutes,
                 effective_from, created_at)

business_hours(business_id fk, weekday, opens_at, closes_at)

customers(id pk, business_id fk, phone, name, created_at,
          unique (business_id, phone))

appointments(id pk, business_id fk, customer_id fk not null,
             service_id fk not null on delete restrict,
             starts_at, duration_minutes, status,
             provider_event_id, created_at)

calls(id pk, business_id fk, provider_call_id unique,
      started_at, ended_at, connected_seconds,
      is_test_call, calendar_incident_id fk null,
      outcome null, outcome_ruleset_version null, classified_at null)

call_sessions(provider_call_id pk, business_id fk, snapshot jsonb,
              opened_at, expires_at)
```

The decisions in that block that are load-bearing:

**`billing_events` is in 005, not in 007 with the rest of billing.** It is the
append-only money ledger ([F6.14](Ringly_PRD_v3.md#f6-14), [N10.4](Ringly_PRD_v3.md#n10-4)), and a ledger has to exist before the
first thing worth recording — which is a stored card, in the checklist, before
any period exists. [N10.4](Ringly_PRD_v3.md#n10-4)'s "nothing is ever hard-deleted or updated in place"
is explicitly cheapest to hold from the first migration, and holding it from the
_second_ one means the first payment fact the product learns has nowhere to go.
**`amount_cents` and `provider_ref` are nullable** because the ledger records
events that carry no money — a payment method attached, a SetupIntent confirmed —
and those are exactly the ones the checklist reads ([§2.5.1.7](#2517-the-checklist-step-8)).

**The checklist's three items split by who owns the fact, and that is
deliberate**: `contact_email_verified_at` and `test_call_confirmed_at` are
Ringly's own and live here; **the card is Stripe's, and is read from Stripe**
([§2.5.1.7](#2517-the-checklist-step-8), [§2.10.10a](#21010a-the-card-facts-stripe-answers-the-ledger-remembers)).
There is no `payment_method_attached_at` column and no ledger row standing in for
one — the payment-method rows below are history, not an answer.

**`test_call_confirmed_at` is a timestamp rather than a boolean for one honest
reason: every "has this happened" in this schema is a nullable `*_at`.**
`contact_email_verified_at`, `agent_bound_at`, `activated_at`, `classified_at`,
`closed_at`, `bounced_at`, `warned_at`, `revoked_at`, `usage_settled_at` — a
boolean here would be the single exception, and two idioms for one concept cost
a reader more than seven bytes saves. A nullable timestamp is also a strict
superset at the same price: `IS NULL` reads exactly as `= false` would.
**Nothing reads the value today** — [§2.5.4](#254-the-test-call-allowance)'s alert test is `IS NULL` — and that
is stated rather than dressed up. Where it would earn its keep is a support
conversation and [F8.6a](Ringly_PRD_v3.md#f8-6a) outreach, neither of which is a stated requirement.

**`is_test_call` is written at the time of the call, never derived** ([F1.13c](Ringly_PRD_v3.md#f1-13c)).
Billing status changes; a call's history must not. Deriving it from today's
status would reclassify every test call the instant a business activated.

**`duration_minutes` is on the appointment, `price` is not** ([F3.4](Ringly_PRD_v3.md#f3-4)). Duration is
locked at booking and never moves, or appointments booked around it silently
overlap. Price resolves at the _time of the appointment_, so it is looked up
from `service_versions` rather than copied — the business charges its customer
after the appointment happens, and the price it will collect is the current one.

**A deleted service keeps its versions.** `services.deleted_at` is a soft delete
and `service_versions` rows are never removed, which is what makes [F3.4](Ringly_PRD_v3.md#f3-4)'s "an
appointment is valued at the last known price" a query rather than a stamped
copy. An appointment never becomes unpriceable because the catalogue moved on.

**`customers` is unique on `(business_id, phone)`**, because a customer's
identity is their phone number ([F2.4](Ringly_PRD_v3.md#f2-4)). The same person ringing from two phones
becomes two records and Ringly cannot tell; [F2.4](Ringly_PRD_v3.md#f2-4) accepts that explicitly.

**`appointments.service_id` is NOT NULL, and that is the same decision as the
soft delete above.** They are a pair and neither survives alone. Because a
deleted service keeps its row and its versions, the foreign key target always
exists, so the column can never legitimately be null — and if it were nulled the
appointment would become precisely what [F3.4](Ringly_PRD_v3.md#f3-4) forbids: unpriceable, because
nulling the reference is exactly how the link to the last known price is lost.
`on delete restrict` rather than `set null`, so an implementation that tries to
hard-delete a service fails loudly instead of quietly producing that state.

**`appointments.customer_id` is NOT NULL, and there is no path that ever makes it
null.** Two rules meet here and both point the same way. **No appointment is
booked without the caller's number** ([F2.12](Ringly_PRD_v3.md#f2-12)) — there are no anonymous bookings,
so it is never null at creation. And **there is no per-customer deletion**
([F9.1a](Ringly_PRD_v3.md#f9-1a)) — customers are destroyed only when the business is, in the transaction
that removes it ([§2.13.5](#2135-customer-pii)), so there is never a surviving appointment whose
customer has gone. A nullable column here would model a state the product does
not have and invite a `set null` that silently orphans revenue the rollups have
already counted.

**`calls` has no `created_at`, deliberately.** A call already carries
`started_at` and `ended_at`, and the row is written seconds after the second of
them, so a creation timestamp would be a third near-identical instant that
nothing reads — scaffolding of exactly the kind [§1.9](Ringly_PRD_v3.md#19-deferred) forbids. **The timestamp
that does earn its place is `classified_at`**, because it is genuinely later than
the call and the rollup has to reason about that gap ([§2.9.2](#292-the-rollup)).

**`call_sessions` is a per-conversation freeze, not a cache.** It holds the
configuration resolved at call start so every tool call in that conversation sees
the same catalogue, hours and horizon — [F3.2](Ringly_PRD_v3.md#f3-2)'s "a caller mid-conversation keeps
what they started with". It is a table rather than process memory because the two
webhooks of one conversation can land on different instances, and it doubles as
the tenancy boundary for a surface with no session ([§2.6.6.2](#2662-the-per-call-snapshot--freezing-config-for-one-conversation)). Rows are deleted
at call end and swept at `expires_at`.

**`calls.calendar_incident_id` records that a call was refused because the
calendar could not be read**, written at the time of the refusal in the same
spirit as `is_test_call`. It is what makes "how many customers did this outage
turn away" answerable, and **the answer is a query rather than a counter** —
counting the calls that point at an incident cannot drift from the calls
themselves, where a maintained tally on `calendar_incidents` would be a second
copy of a fact and therefore a second thing that can be wrong.

It cannot be derived without this column, which is why it is a column. A
refused booking ends `dropped`, but so does a caller the agent could not help
([F2.10](Ringly_PRD_v3.md#f2-10)), and an enquiry during an outage still succeeds ([F4.5](Ringly_PRD_v3.md#f4-5)) — outcome alone
cannot separate "we lost this customer to the calendar" from "we lost this one
anyway".

### 006 — scheduling credentials (F4)

```
scheduling_credentials(business_id pk, provider, encrypted_refresh_token,
                       granted_scopes, connected_at, revoked_at, last_ok_at)

calendar_incidents(id pk, business_id fk, opened_at, closed_at, last_error)
```

`provider` exists from the first migration even though Google is the only value
([F4.2](Ringly_PRD_v3.md#f4-2)), because [F4.3](Ringly_PRD_v3.md#f4-3) requires a second provider to arrive without touching
booking logic and a column added later means a backfill on 10⁴ rows.

`calendar_incidents` is what makes [F2.7](Ringly_PRD_v3.md#f2-7)'s "one email per incident, not one per
lost customer" expressible: the open incident is a row, not a counter. The first
failure opens it and sends; later failures attach to it silently; the first
successful read closes it.

**What the incident is worth reading for is how much it cost**, and that is
carried by the calls that point at it ([§2.4](#24-data-model)/005). The dashboard banner, the
operator's "bookings failing" row and any look back at a closed incident all show
**the number of callers turned away while it was open** — counted from
`calls.calendar_incident_id`, never stored on the incident. An outage that fails
forty calls should say forty, and it should still say forty a month later when
somebody asks what it cost.

### 007 — billing (F6)

```
pricing_policy(id pk, version, effective_from,
               fixed_fee_cents, per_minute_rate_cents, cap_cents,
               billable_outcomes text[], test_call_allowance)

billing_periods(id pk, business_id fk, policy_id fk,
                starts_on, ends_on,
                fixed_fee_state, fixed_fee_invoice_ref,
                usage_settled_at null, usage_invoice_ref null,
                billable_seconds, usage_charge_cents, total_cents,
                was_suspended_during, status)

usage_records(id pk, business_id fk, period_id fk null, call_id fk,
              connected_seconds, created_at)
```

**`billing_events` is not here — it is in 005** (above), because the ledger has to
predate the first payment fact the product learns, which arrives in the checklist
before any period exists.

**Pricing is policy data, not code** ([F6.15](Ringly_PRD_v3.md#f6-15), [F6.8](Ringly_PRD_v3.md#f6-8)). The fixed fee, the cap, the
per-minute rate, the test-call allowance and **the set of outcomes that count as
billable** all live in a versioned row with an effective date. Each
`billing_periods` row records which version it settled under, which is the whole
of [F6.16](Ringly_PRD_v3.md#f6-16): a change to commercial terms never rewrites history, because history
points at the terms it ran under.

**`usage_records.period_id` is nullable, and the null case is a requirement**
([F6.11c-ii](Ringly_PRD_v3.md#f6-11c-ii)). When the failed charge _was_ a period's settlement, that period
closes the same day and the grace week that follows has no open period to bill
to. Those seconds are recorded and never charged. A non-null constraint here
would force the design to invent a period to hold them — which is exactly the
$100 charge [F6.11c](Ringly_PRD_v3.md#f6-11c) refuses to manufacture.

**`billing_events` is the append-only ledger of everything the payment provider
tells Ringly** ([F6.14](Ringly_PRD_v3.md#f6-14), [N10.4](Ringly_PRD_v3.md#n10-4)), not only of money moving. Charges, refunds,
failures and chargebacks are rows; so are `setup_intent_succeeded`,
`payment_method_attached` and `payment_method_detached`, which carry no amount
and are what [§2.5.1.7](#2517-the-checklist-step-8) reads to answer "has this business added a card". Nothing
in it is updated; corrections are new rows.

**One event, one row, whoever observes it first.**

```sql
CREATE UNIQUE INDEX billing_events_provider_ref_per_kind
    ON billing_events (kind, provider_ref) WHERE provider_ref IS NOT NULL;
```

A payment method attaching may be observed twice — `setup_intent.succeeded` and
`payment_method.attached` both describe it — and this index collapses them to one
history row rather than two. Same technique as the calendar incident's partial
index ([§2.6.4](#264-fail-closed-concretely)): the writer does not check first, it
writes and reads what came back. **Nothing depends on this for correctness now**
that the checklist asks Stripe
([§2.10.10a](#21010a-the-card-facts-stripe-answers-the-ledger-remembers)); it keeps
the history clean, which is a smaller claim than the one it used to carry.

**Recording the whole payment lifecycle rather than only the money is the point.**
A ledger that holds charges but not the card those charges will be made against
forces every other part of the design to ask Stripe directly, which is how a
second source of truth for a Stripe fact gets invented in three different places.
One table, one answer.

**`usage_records.created_at` earns its place where `calls.created_at` did not.**
This is a money table ([N10.1](Ringly_PRD_v3.md#n10-1)): it is append-only, corrections arrive as new rows
rather than edits ([N10.4](Ringly_PRD_v3.md#n10-4)), and reconciling it against the payment provider means
being able to order the writes and say what existed at a given moment. [N10.3](Ringly_PRD_v3.md#n10-3)'s
"at most one hour of usage records at risk" is a claim about write time, and it
is unanswerable without one. A call's creation time is a duplicate of its end
time; a money row's is part of the audit trail.

### 008 — lifecycle (F9)

```
lifecycle_deadlines(id pk, business_id fk, kind, due_at,
                    warned_at null, paused_at null, paused_by null, reason null,
                    unique (business_id, kind))

departed_businesses(business_id pk, name, joined_at, left_at, ended_by,
                    owed_at_departure_cents, lifetime_net_revenue_cents)
```

**A deadline is a stored row, not a computed offset.** `created_at + interval
'10 days'` cannot be paused, and [F9.1b](Ringly_PRD_v3.md#f9-1b) requires the operator to pause exactly
that. A `due_at` with a nullable `paused_at` can.

**The table is a to-do list for the sweeper, one row per clock a business is
currently under.** The sweeper's entire query is _rows where `due_at` has passed
and `paused_at` is null_; everything else about lifecycle is which rows exist.
**Silence never pauses anything** — absent an explicit operator action the
default stands.

**`kind` is a closed set, and each has exactly one thing that creates it and one
thing that clears it.** A business usually has none; a failing one has two.

| `kind`                      | Created when                                                     | Due                                          | Cleared when                                                    | On due                                                         |
| --------------------------- | ---------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| `unactivated_deletion`      | The business row is created                                      | +10 days ([F9.1](Ringly_PRD_v3.md#f9-1))     | It activates                                                    | Teardown ([§2.13.4](#2134-teardown-in-order))                  |
| `grace_expiry`              | The **first** charge fails ([F6.11](Ringly_PRD_v3.md#f6-11))     | +7 days                                      | Nothing is owed                                                 | Suspend: unbind the agent                                      |
| `nonpayment_deletion`       | The **first** charge fails ([F9.3](Ringly_PRD_v3.md#f9-3))       | +60 days                                     | Nothing is owed                                                 | Teardown                                                       |
| `cancellation_window_close` | The operator marks cancelled ([F6.10a](Ringly_PRD_v3.md#f6-10a)) | +7 days or period end, whichever sooner      | The cancellation is revoked ([F6.12a](Ringly_PRD_v3.md#f6-12a)) | Settle early, stop service ([F6.12b](Ringly_PRD_v3.md#f6-12b)) |
| `dormancy_deletion`         | The cancellation window closes                                   | +60 days ([F6.12e](Ringly_PRD_v3.md#f6-12e)) | The business returns                                            | Teardown                                                       |

**Both non-payment rows are created together, at the first decline**, not one
after the other. The 60-day clock runs from the failure, not from the suspension
([F9.3](Ringly_PRD_v3.md#f9-3)), so creating it at day 7 would give away a week. It is also why
`unique (business_id, kind)` is per-kind rather than per-business: a business in
grace legitimately has two clocks running.

**`warned_at` is how [F9.3a](Ringly_PRD_v3.md#f9-3a) is kept unconditional.** Nothing is deleted without a
48-hour warning, so the sweeper's second job is to warn on any deletion row
falling due within 48 hours that has not been warned yet, and stamp it. Making
the warning a milestone on the deadline it warns about — rather than a sixth
`kind` — means a paused clock cannot warn, an extended clock re-warns at the
right time, and a deletion whose warning never sent is visible as a due row with
a null `warned_at` rather than being invisible.

**Pausing stops the clock; it does not cancel the deadline.** On pause,
`paused_at` is stamped. On resume, `due_at` moves forward by however long the
pause lasted and `paused_at` returns to null. A clock paused on day 4 of 10 and
resumed three days later is due on day 13, with six days left — the operator
bought the business investigation time, not a different deadline. The alternative
of leaving `due_at` fixed would mean a business emerging from a long pause is
deleted immediately, which is the opposite of what pausing was for.

**`departed_businesses` carries no consumer data by construction** ([F9.9](Ringly_PRD_v3.md#f9-9)) — no
caller name, no number, no appointment. It has no RLS policy and is reachable
only through `/ops`. It also carries no phone number: the number is released at
deletion ([F9.4b](Ringly_PRD_v3.md#f9-4b)) and recording it would outlive the business's claim to it.

### 009 — analytics (F5, F8)

```
daily_call_rollups(business_id fk, day,
                   calls, connected_seconds, duration_seconds_sum,
                   appointments_booked, revenue_booked_cents,
                   counts_by_outcome_window jsonb,
                   computed_at,
                   primary key (business_id, day))

cost_records(id pk, business_id fk null, day, source, amount_cents)
```

**`counts_by_outcome_window` is a 5 × 6 matrix per business per day** — five
outcomes against six four-hour windows ([F5.4a](Ringly_PRD_v3.md#f5-4a)). This single structure is what
serves [F5.4](Ringly_PRD_v3.md#f5-4)'s one chart in both of its configurations: grouping by outcome and
filtering by window is a sum along one axis, grouping by window and filtering by
outcome is a sum along the other. Two separate count arrays could not answer the
second question without a second scan, and a flat outcome count could not answer
either.

**No median column, deliberately.** A median cannot be recovered from daily
aggregates, which is why [F5.16](Ringly_PRD_v3.md#f5-16) makes it the one live query in the dashboard.

**`cost_records.source` has exactly three values.** Two bill per business —
`telephony` and `classifier` ([F8.5](Ringly_PRD_v3.md#f8-5)) — and `enrichment` covers onboarding spend
that has no business to bill to yet. **`business_id` is nullable for exactly that
third case** ([N9.2](Ringly_PRD_v3.md#n9-2)): a runaway enrichment loop must appear in the operator's cost
figures even before a tenant exists.

### 010 — email (F7)

```
email_sends(id pk, reason_key unique, business_id (no fk), kind,
            to_address, identity, subject, body,
            queued_at, claimed_at null, sent_at null, attempts,
            last_error null, provider_idempotency_key,
            provider_message_id null, bounced_at null)
```

**Delivery is at-least-once, and the row is what makes it so** ([F7.5](Ringly_PRD_v3.md#f7-5)). The
dispatcher claims a row, sends, then records the send. A worker dying between the
send and the record leaves a claimed row that a later run retries — so the
message may arrive twice, and **that is the failure this design chooses**. The
alternative, recording the intent before sending, loses the message when the same
crash happens, and the messages here are the ones a business cannot afford to
miss: [I4](Ringly_PRD_v3.md#i4) makes the 48-hour deletion warning unconditional, and an at-most-once
deletion warning is an invariant that silently is not one.

Three things keep the duplicate cheap:

- **`provider_idempotency_key` is sent as Resend's `Idempotency-Key` header**,
  so a redelivery is collapsed at the provider before it reaches an inbox.
  **Resend's window is 24 hours and the whole retry ladder is ≈14¾ hours**
  ([§2.11.7](#2117-retry-backoff-and-what-happens-to-a-message-that-will-never-send)), so every retry of one message falls inside it — the ladder was sized
  against [I4](Ringly_PRD_v3.md#i4)'s 48-hour deadline and happens to clear this too, which is worth
  knowing before anyone lengthens it.
- **Every template's footer says to ignore the message if it has already
  arrived** ([F7.7](Ringly_PRD_v3.md#f7-7)).
- **`reason_key` is unique and is a different thing from delivery.** It carries
  [F7.5](Ringly_PRD_v3.md#f7-5)'s three shapes — per period, per incident, per event — and answers "is
  there a reason to send this at all", which is what stops an outage emailing a
  business once per lost customer. Delivery may repeat; a reason may not.

**`business_id` is a plain value and deliberately not a foreign key.** Teardown
enqueues the deletion email at step 6 and deletes the business at step 8
([§2.13.4](#2134-teardown-in-order)), so a constrained reference would either block the deletion or take the
queued message with it — losing precisely the email whose whole purpose is to
tell someone the business is gone.

**`subject` and `body` are rendered at enqueue, not at send.** For the same
reason: by the time the dispatcher runs, the tenant row a template would read
from may no longer exist. A message that cannot be rendered after its subject has
been deleted is a message that will not be sent on the one path that needs it
most.

### 011 — operator economics (F8)

Views and indexes only; no new tenant data. Per-business revenue, cost and
margin ([F8.2a](Ringly_PRD_v3.md#f8-2a)) are derived from `billing_events` and `cost_records`, and the
"needs attention" queue ([F8.12](Ringly_PRD_v3.md#f8-12)) is derived from lifecycle, billing and incident
state. **Nothing about the operator's dashboard is stored separately**, because
a second copy of "is this business suspended" is a second thing that can be
wrong.

**Testing this section**

_Observable_ — what the product does with the data: an appointment keeps its
duration when a service is re-timed, is valued at the current price, survives
its service being deleted; a customer's deletion leaves past appointments
intact.

_Internal_ — every table name, column name, index, constraint, and the migration
numbers themselves. No test body names any of them.

_Behaviours owed to the catalogue_

- Repricing a service changes what an existing appointment is worth but not when
  it is or how long it runs.
- Deleting a service leaves its appointments valued at the last price it had.
- Deactivating a service never alters an appointment already booked against it.
- A call's test-call status does not change when the business activates.
- Grace usage served while no period is open is recorded and never charged.
- A policy change applies to the next period and leaves settled ones untouched.
- No appointment can exist without a customer or without a service, by any route.

---

## 2.5 Onboarding and activation

[F1](Ringly_PRD_v3.md#f1--onboarding-and-identity) in order. Three things in this section are harder than they look, and each
gets its own subsection: an unauthenticated endpoint that spends money ([N9](Ringly_PRD_v3.md#n9--cost-control-on-the-unauthenticated-surface)), a
single button that must take money exactly once across systems that fail
separately ([F1.12a-i](Ringly_PRD_v3.md#f1-12a-i)), and a provider write that reports success without taking
effect ([F1.12a-ii](Ringly_PRD_v3.md#f1-12a-ii)).

### 2.5.1 The flow

Nine steps. **Steps 1–6 are synchronous and the person is waiting; 7 is
background; 8–9 are a screen they come back to.** The numbering is load-bearing
— [N9.1](Ringly_PRD_v3.md#n9-1) cites step 2 and [N9.3](Ringly_PRD_v3.md#n9-3) cites step 7 — so it is preserved exactly.

1. **Free-form intake** ([F1.1](Ringly_PRD_v3.md#f1-1)) — one text box, no structured fields. **The
   prompt is spoken aloud and the answer is typed** ([F1.2](Ringly_PRD_v3.md#f1-2)); speech-to-text input
   is deferred, so the voice is output only and nothing depends on it.
2. **Enrichment, one request** ([F1.3](Ringly_PRD_v3.md#f1-3), [F1.6](Ringly_PRD_v3.md#f1-6)) — Places for name, address, phone,
   hours, IANA timezone and website; a website crawl and one model call for the
   service list ([F1.4](Ringly_PRD_v3.md#f1-4), ≤15 items). This is the unauthenticated paid endpoint of
   [N9](Ringly_PRD_v3.md#n9--cost-control-on-the-unauthenticated-surface) and is spend-capped. Detail in [§2.5.1.1](#2511-enrichment-is-a-chain-not-a-fan-out)–[§2.5.1.3](#2513-what-each-step-does-when-it-fails).
3. **The draft is shown, every field editable** ([F1.5](Ringly_PRD_v3.md#f1-5)). Upload and manual entry
   are first-class fallbacks, not error states — a business whose website has no
   price list is normal. **Timezone is editable here and nowhere else**: [F1.5](Ringly_PRD_v3.md#f1-5)
   makes it correctable before commit, [F3.6](Ringly_PRD_v3.md#f3-6) makes it an operator action after,
   and this step is the seam between the two.
4. **Google sign-in and calendar consent, in one dialog** ([F1.7](Ringly_PRD_v3.md#f1-7)). The reason for
   every scope is stated **before** the redirect ([F1.7c](Ringly_PRD_v3.md#f1-7c)).
5. **Commit** — the business row is created from the draft, keyed to the Google
   identity, and **the user is told that their Google login is now their Ringly
   login** ([F1.8](Ringly_PRD_v3.md#f1-8)). There is no password to set and no second account to
   remember, which is only reassuring if it is said. The `unactivated_deletion`
   deadline is written here ([§2.10.1](#2101-states)).
6. **Scopes actually granted are checked, never assumed** ([F1.7a](Ringly_PRD_v3.md#f1-7a)). Granular
   consent means sign-in can succeed while calendar is refused; a refusal stops
   here on the explanation screen with a re-consent button ([F1.7b](Ringly_PRD_v3.md#f1-7b)) and the
   committed draft is what makes "the work already done" survive it.
7. **Number purchase and agent provisioning, in the background** ([F1.9](Ringly_PRD_v3.md#f1-9)). Nothing
   chargeable to Ringly happens before this point ([N9.3](Ringly_PRD_v3.md#n9-3)): a bot that gets past
   the rate limiter costs one enrichment call, never a phone number.
8. **The checklist** ([F1.12](Ringly_PRD_v3.md#f1-12)) — three tasks in any order, with test calls
   remaining shown alongside.
9. **Activate** ([F1.12a](Ringly_PRD_v3.md#f1-12a)).

**Steps 5 and 6 are in that order deliberately, and the previous draft had them
the other way round.** Checking consent before committing means a declined
calendar leaves the enriched draft in the browser and nowhere else, so a closed
tab, a cleared store or a resumed session on another device costs the business
everything it just typed and costs Ringly a second enrichment call. Committing
first makes [F1.7b](Ringly_PRD_v3.md#f1-7b)'s promise durable rather than hopeful: the row exists, the
services exist, the hours exist, and the only thing missing is the credential
the re-consent button fetches. Nothing is lost by committing early because
[F4.1](Ringly_PRD_v3.md#f4-1) already blocks activation without a calendar and [F9.1](Ringly_PRD_v3.md#f9-1)'s ten-day clock
already removes a business that never comes back.

#### 2.5.1.1 Enrichment is a chain, not a fan-out

```
                                                             cache   ceiling
1  places:searchText   free text            → candidates[]      —       ✓
   └─ 0 candidates → manual entry;  >1 → return them, no spend
2  places/{id}         place_id             → the F1.3 fields   24h     ✓
   └─ displayName, formattedAddress, nationalPhoneNumber,
      regularOpeningHours, websiteUri, timeZone.id (IANA)
3  GET websiteUri + ≤2 likely sub-pages     → text (parallel)   24h     ✓
4  one small-model call over that text      → ≤15 services      24h     ✓
```

**Steps 1→2→3→4 are strictly sequential because each needs the previous one's
output**, and no amount of design makes them concurrent: Details needs a
`place_id`, the crawl needs a `websiteUri`, the model needs text. **The only
concurrency available is inside step 3** — the homepage and at most two
sub-pages whose paths look like a menu (`/menu`, `/services`, `/prices`, and
their obvious variants) are fetched together under one shared ceiling, because
price lists are usually not on the homepage and a second sequential fetch would
double the wait for the same answer.

**Places (New) returns the IANA timezone on the Details response** (`timeZone.id`),
so there is no second geocoding call and no offset-to-zone inference. This
matters more than it looks: [N5.2](Ringly_PRD_v3.md#n5-2) computes every billing and analytics boundary
in that zone, and an offset is not a zone — it cannot survive a DST transition.

**One model call, not one per page** ([F1.4](Ringly_PRD_v3.md#f1-4)). The pages are concatenated and
truncated to a fixed character budget before the call, so the spend per
enrichment is bounded by the budget rather than by how large the business's
website is.

**[F1.6](Ringly_PRD_v3.md#f1-6)'s "single request" is a claim about round-trips to the user, not about
concurrency.** The candidate-picker is the one exception and it is a
disambiguation rather than a retry: the second request carries the chosen
`place_id` and therefore skips step 1 entirely, so an ambiguous business costs
one Text Search and one Details, not two of each.

**Rejected: returning the Places fields immediately and streaming the services
in after.** It would let the owner start editing sooner and it is precisely what
[F1.6](Ringly_PRD_v3.md#f1-6) forbids. The wait is bounded by [§2.5.1.2](#2512-two-guards-and-what-degrades-means)'s ceilings instead.

#### 2.5.1.2 Two guards, and what "degrades" means

[N9.1](Ringly_PRD_v3.md#n9-1) asks for a per-IP limit and a daily spend ceiling, both configuration. [R17](#r17)
adds caching as the third leg and sizes all three as a cost guardrail rather
than an abuse system.

**The per-IP limit is one statement, so there is no read-then-write race:**

```sql
INSERT INTO enrichment_requests (ip_hash, day, attempts)
     VALUES ($1, current_date, 1)
ON CONFLICT (ip_hash, day)
  DO UPDATE SET attempts = enrichment_requests.attempts + 1
  RETURNING attempts;
```

`ip_hash` is an HMAC of the address under a server-side key, so the table holds
no address in the clear and nothing here becomes a record of who visited. Rows
older than two days are removed by the lifecycle sweeper on its ordinary pass
([§2.2.2](#222-request-paths-and-background-work)) — it already runs hourly and this is one bounded delete.

**Decision, not settled by the PRD — `enrichment_requests` is a table.**
[N9.1](Ringly_PRD_v3.md#n9-1) requires a per-IP counter and a daily spend
ceiling, and 2.1.6 forbids the managed key-value product that would otherwise
hold the counter, so it has to be a row. It is not tenant data, it is not a money
table, and it holds nothing a business can see, so it carries no RLS policy and
no retention clock.

**The daily ceiling needs no new state at all**, because [N9.2](Ringly_PRD_v3.md#n9-2) already requires
the spend to be attributable before a business exists and [§2.4](#24-data-model)/009 already
carries it:

```sql
SELECT coalesce(sum(amount_cents), 0)
  FROM cost_records
 WHERE source = 'enrichment' AND business_id IS NULL AND day = current_date;
```

This is the one index in the system that deliberately does **not** lead with
`business_id` ([§2.3.3](#233-physical-layout)), because the rows it serves have none; it is
`(source, day)`. And the day is a **UTC** day rather than a business's local day
([N5.2](Ringly_PRD_v3.md#n5-2)), because there is no business yet whose timezone could define it — stated
here so it is a decision rather than an accident.

**The ceiling is checked once, before the first paid call of a request, and the
cost is recorded after each.** Checking between steps would triple the query to
protect against an overshoot of at most one request's spend, which is pennies.
The maximum overshoot is therefore one enrichment, and that is the price of not
querying between every call.

**Per-SKU amounts are configuration, on the same principle as every other
number** ([F6.15](Ringly_PRD_v3.md#f6-15)): a Places price change is a config change, not a deploy.

**Degrading is not an error path — it is the same response with one field
missing.** Over either guard, the endpoint returns `200` with the draft empty
and a flag saying enrichment did not run, and the UI shows the manual form it
already has for a business with no website ([F1.4](Ringly_PRD_v3.md#f1-4)). There is no error branch to
write, because a business that typed its own details is the normal case, not a
degraded one. This is what "degrades to manual entry rather than continuing to
spend" means concretely ([N9.1](Ringly_PRD_v3.md#n9-1), [§2.14.4](#2144-serving-cost-and-the-unauthenticated-surface-n4-n9)): the guard is checked **before** the
first paid call, never after.

**Caching is process-local with a 24-hour TTL**, keyed by `place_id` for step 2
and by URL for steps 3–4, using the same mechanism and the same argument as
[§2.6.6.1](#2661-the-60-second-cache--avoiding-a-query-per-call) — no shared cache product (2.1.6), each instance warms independently, a
miss costs money rather than correctness. It exists because the common repeat is
a user going back to correct their query and resubmitting, which is one person
being careful and should not read as a second business.

#### 2.5.1.3 What each step does when it fails

**Nothing in this table is an error page.** Every row lands the user on the same
editable draft with fewer fields filled in.

| Step fails                                 | Ceiling    | Draft carries                                              | Owner sees                             |
| ------------------------------------------ | ---------- | ---------------------------------------------------------- | -------------------------------------- |
| Text Search errors or times out            | 3 s        | nothing                                                    | The manual form                        |
| Text Search finds nothing                  | —          | nothing                                                    | "We could not find it" + manual form   |
| Text Search is ambiguous                   | —          | nothing yet                                                | A candidate list; no spend on the pick |
| Details errors or times out                | 3 s        | nothing                                                    | The manual form                        |
| No `websiteUri` on the record              | —          | every [F1.3](Ringly_PRD_v3.md#f1-3) field, empty catalogue | Draft + empty service list             |
| Crawl fails, times out, or is not HTML     | 5 s shared | every [F1.3](Ringly_PRD_v3.md#f1-3) field, empty catalogue | Draft + empty service list             |
| Model call fails or returns nothing usable | 15 s       | every [F1.3](Ringly_PRD_v3.md#f1-3) field, empty catalogue | Draft + empty service list             |
| Whole request exceeds its deadline         | 25 s       | whatever had resolved                                      | Draft, partially filled                |

**The services branch can be dropped without dropping the draft**, which is why
its failures are the cheapest ones. It is also why the crawl and the model call
sit last in the chain rather than first: everything [F1.3](Ringly_PRD_v3.md#f1-3) promises is already in
hand by the time the optional part is attempted.

**[N7.1](Ringly_PRD_v3.md#n7-1) holds throughout** — none of this can affect a business that already
exists. Enrichment touches no tenant row.

#### 2.5.1.4 Sign-in, and checking the scopes actually granted

**Four scopes, and the calendar one is the only one that can be refused
separately:**

| Scope                                             | For                                                                               |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `openid`, `email`, `profile`                      | The Ringly session ([F1.7](Ringly_PRD_v3.md#f1-7), [F1.8](Ringly_PRD_v3.md#f1-8)) |
| `https://www.googleapis.com/auth/calendar.events` | Everything in [§2.7](#27-scheduling-providers)                                    |

**`calendar.events` and not something broader or narrower.** [§2.7](#27-scheduling-providers)'s four
operations are `events.list`, insert, patch and delete on the owner's primary
calendar; `calendar.readonly` cannot create an event, and the full `calendar`
scope grants calendar creation and sharing that Ringly never uses. It is also
the smallest ask that still works, and the consent screen is where a larger ask
costs conversions. It is a **sensitive** scope requiring verification, which is
[R2](#r2) — a calendar-week dependency that gates real customers regardless of
what is built when.

The authorisation request is `access_type=offline` with `prompt=consent`,
because the refresh token is returned only on a fresh consent and [§2.7](#27-scheduling-providers) needs it
for every server-side read thereafter.

**[F1.7a](Ringly_PRD_v3.md#f1-7a) is a check on the token response, not an inference from its absence of
error.** Granular consent returns `200` with a narrower `scope` string, so:

```
1. exchange the code                         → { access_token, refresh_token, scope }
2. granted ← scope.split(' ')
3. calendar.events ∈ granted ?
   ├─ yes → INSERT scheduling_credentials (business_id, 'google',
   │          encrypt(refresh_token), granted, now())
   └─ no  → no credential row; stop on the F1.7b screen
```

**`granted_scopes` is persisted** ([§2.4](#24-data-model)/006) rather than recomputed, because a
scope that was granted and later narrowed is otherwise indistinguishable from
one that was never granted, and the two need different screens.

**The refresh token is encrypted before it reaches the database** ([N6.1](Ringly_PRD_v3.md#n6-1)),
AES-256-GCM with a key held only in the environment, stored as
`iv:tag:ciphertext`. The plaintext exists in one function's local scope and is
never logged. **The encryption is not the database's** — a key that lives beside
the ciphertext protects against a stolen backup file and nothing else.

**Re-consent is incremental.** The button on the [F1.7b](Ringly_PRD_v3.md#f1-7b) screen re-runs the
authorisation with `include_granted_scopes=true` and only the calendar scope
requested, because the identity is already established and asking a business to
sign in again to fix a checkbox reads as a failure of the first attempt.

#### 2.5.1.5 What crosses the redirect

**The `state` parameter carries a nonce and nothing else** — a random value set
in an `HttpOnly`, `SameSite=Lax`, ten-minute cookie and compared on return. It
is CSRF protection, not a transport.

**The draft crosses in the browser**, because the OAuth redirect returns to the
same browser by construction and because the unauthenticated surface should
store as little as possible ([§2.2.1](#221-the-four-surfaces)). It stops being the only copy at step 5,
which is the whole point of committing before checking scopes ([§2.5.1](#251-the-flow)): the
window in which the draft exists in exactly one fragile place is the width of
one redirect, and after that it is a row.

#### 2.5.1.6 Provisioning (step 7)

Background, off the response, and **gated on the calendar credential existing.**

```
1  candidate ← a number held by no business row, bound to no agent   (§2.13.3)
   └─ none → buy one from the telephony provider
2  UPDATE businesses SET phone_number = $1 WHERE id = $2
3  create the agent; set its retention explicitly                    (R10, F9.6)
4  UPDATE businesses SET telephony_agent_id = $1
5  bind, and verify by reading back                                  (§2.5.3)
6  UPDATE businesses SET agent_bound_at = now()
```

**Decision, ratified 2026-08-01 — provisioning waits for the calendar.** [F1.9](Ringly_PRD_v3.md#f1-9)
says number purchase runs in the background but does not say from what moment.
[F4.1](Ringly_PRD_v3.md#f4-1) says a business without a connected calendar cannot activate and cannot
take bookings, so buying it a number is spending on an account that cannot
become a customer. Gating on the credential row is the same argument as [N9.3](Ringly_PRD_v3.md#n9-3)
one step further along, and it costs the business nothing: the moment consent
lands, provisioning starts.

**A crash between 1 and 2 leaves a rented number belonging to nobody, and that
is self-healing** — step 1's candidate query is the reusable-number query of
[§2.13.3](#2133-a-number-leaves-a-business-only-at-deletion), which is built from every business row that holds a number whatever its
billing status, so the orphan is picked up by the next signup rather than
leaking. The reverse order is not available: the number does not exist until it
has been bought.

**Step 6 is written only after step 5's read-back agrees**, because
`agent_bound_at` is this design's record of _observed_ provider state, not of
intent ([§2.5.3.1](#2531-intended-bind-state-is-derived-never-stored)). Setting it from a write's return value would make the one
thing that can detect a silent bind failure believe the write instead.

#### 2.5.1.7 The checklist (step 8)

Three items, no ordering, each answered from a single row read so the screen is
never stale ([F5.18](Ringly_PRD_v3.md#f5-18) applies the same rule to the dashboard):

| Item                   | Answered by                                                                                                                          | Cleared by                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Contact email verified | `businesses.contact_email_verified_at`                                                                                               | Editing the address                          |
| Test call confirmed    | `businesses.test_call_confirmed_at`                                                                                                  | Nothing; it is the owner's judgement         |
| Card added             | **Stripe, live** — does the customer have a payment method ([§2.10.10a](#21010a-the-card-facts-stripe-answers-the-ledger-remembers)) | Nothing to clear; the answer is never stored |
| Test calls remaining   | allowance − `businesses.test_calls_used`                                                                                             | —                                            |

**The three items have three different owners, and the schema follows the
ownership rather than the screen.**

**Item 2 is Ringly's own fact and cannot be anything else.** [F1.12](Ringly_PRD_v3.md#f1-12) makes the test
call explicitly _the owner's judgement, not something Ringly infers_, so there is
no signal in `calls` that could produce it — a ninety-second call that sounded
like gibberish is indistinguishable from a ninety-second call that sounded
perfect. `test_call_confirmed_at` therefore lives on `businesses` ([§2.4](#24-data-model)/005), is
written by one `UPDATE` when the owner presses confirm, and is never inferred and
never cleared. It is also the column that makes [F1.13d](Ringly_PRD_v3.md#f1-13d)'s business B and business
C different people: [§2.5.4](#254-the-test-call-allowance) raises the activation-stuck alert **only** when it is
null, and without it the operator queue either alerts on every spent allowance —
which [F1.13a](Ringly_PRD_v3.md#f1-13a) says would make it meaningless — or on none, and businesses that can
never activate are never rescued ([F9.1b](Ringly_PRD_v3.md#f9-1b), [F9.1c](Ringly_PRD_v3.md#f9-1c)).

**Item 3 is Stripe's fact, and Ringly stores no second copy of it.** _(Decision,
ratified 2026-08-01, replacing an earlier `payment_method_attached_at` column.)_
The checklist asks Stripe, on every render, whether the customer has a payment
method ([§2.10.10a](#21010a-the-card-facts-stripe-answers-the-ledger-remembers)).
**Nothing about the card is stored to answer this**, because any stored answer is
a copy of somebody else's state — and that is true of a `billing_events` row
standing in for the column just as much as of the column. A copy with three
writers and a repair sweep is still a copy. A dedicated column would be a second
copy of somebody else's state, and it drifts in exactly the direction that hurts:
a card detached or a SetupIntent invalidated leaves the column saying "added", so
the Activate button is available, the press charges, and the charge declines —
reaching [F1.12a-i](Ringly_PRD_v3.md#f1-12a-i)'s declined-card row _through a green checklist_, which is the
state the checklist exists to prevent.

**The cost of asking Stripe every time is small and was measured, not assumed**
([§2.10.10a](#21010a-the-card-facts-stripe-answers-the-ledger-remembers)): no
per-request fee, rate limits far above this volume, and a population bounded by
the ten-day clock, because only unactivated businesses ever see this screen. Items
1 and 2 still render from Ringly's own rows if Stripe is slow, and item 3 says so
— which costs nothing real, since a business cannot add a card while Stripe is
down and Ringly could not charge one either.

**Editing the contact address clears its verification**, because [F1.11](Ringly_PRD_v3.md#f1-11) exists to
stop the 48-hour deletion warning going to an address nobody reads, and a
verified flag that survives an edit is precisely that failure with a green tick
on it.

**The verification link is a signed token, not a row** — an HMAC over
`(business_id, address, issued_at)` with a 24-hour expiry, single-use by virtue
of the route setting `contact_email_verified_at` and refusing an address that no
longer matches. Nothing to store, nothing to sweep.

**Decision, ratified 2026-08-01 — an address Google has already verified needs
no second link.** The user has just proved control of it to Google, and sending a
link there adds a click that proves nothing and pads a three-item checklist with
a no-op.

**The test is the claim, not the string.** `contact_email_verified_at` is stamped
at commit when **both** hold: the contact address equals the signed-in identity's
address, **and** the ID token carried `email_verified: true` for it in the same
exchange as the sign-in. A string comparison alone is not enough — some Google
account types carry an unverified primary address, and in that case Ringly has
been told nothing and the link is sent.

Any address the owner types instead takes the link, which is the common case since
billing and personal mail usually differ. And **editing the address clears the
verification either way** — [F1.11](Ringly_PRD_v3.md#f1-11) exists to stop the 48-hour deletion warning
going somewhere nobody reads, and a verified tick that survives an edit is that
failure wearing a green badge.

**Adding a card stores it off-session and charges nothing** ([F6.2](Ringly_PRD_v3.md#f6-2), [F6.3](Ringly_PRD_v3.md#f6-3)). Raw
card details never reach Ringly ([N6.2](Ringly_PRD_v3.md#n6-2)); the browser talks to the payment
provider directly and Ringly stores the resulting identifiers.

### 2.5.2 Activation touches three systems and can fail at each

[F1.12a-i](Ringly_PRD_v3.md#f1-12a-i) is a specification of what the business sees, and the design has to
make each row reachable independently.

| Fails at               | Design response                                                                                       | Business sees                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------- |
| **The card**           | Nothing else has happened yet. The charge is attempted first, precisely so this row is clean          | Declined, try another. No state |
| **Recording it**       | The charge succeeded, so Ringly owns the inconsistency: retry against its own database until it lands | Progress, then success          |
| **Binding the number** | Activation stands. The bind retries; the operator is alerted ([F8.6](Ringly_PRD_v3.md#f8-6))          | "Activated; number connecting"  |

**The order is charge → record → bind**, and it is chosen so that the only
failure the business is asked to act on is the only one they can act on. A card
that declines is theirs to fix. Everything after the charge is Ringly's.

It is also the only order in which a partial failure is not a lie. Record-then-charge
would put a `billing_periods` row and a $100 line in the business's history for
a payment that never cleared, and [§2.6](#26-the-call-path) would begin metering against it — a
period that exists for an unpaid activation is worse than a charge with no
period, because the first is visible to the business and the second is visible
only to Ringly (2.1.3).

#### 2.5.2.1 One press, and what makes it exactly one

**The idempotency key is derived, not generated**, so a double-click, a retried
`POST`, a proxy replay and a resumed background run all produce the same key
without needing to have agreed on one:

```
idem = 'activate:v1:' || business_id || ':' || payment_method_id
```

**The payment method is in the key deliberately.** Without it, a business whose
card declines and who then adds a different card would re-press Activate and
receive a replay of the first decline — the payment provider returns the
original response for a repeated key, and the original response was "no". With
it, changing the card changes the key, which is correct because a new card is a
new act; pressing again with the _same_ card replays, which is also correct
because that press is the one [F1.12a-i](Ringly_PRD_v3.md#f1-12a-i) says must never take money twice.

**Two presses in flight at once do not race.** The second reaches the provider
with the key already in use and receives that provider's in-use error, which the
handler maps to "in progress" — the same thing the poll says. Nothing local
needs a lock.

**Decision, not settled by the PRD — Activate is submit-and-poll, not
request-response.** [F1.12a-i](Ringly_PRD_v3.md#f1-12a-i)'s "no failure is ever handed back as press it
again" cannot be satisfied by a design where the screen's state is the `POST`'s
response, because a response can be lost to a closed laptop lid, a proxy
timeout, or a deploy. So the button's state is read from `GET /api/activation`,
which is a pure function of durable state, and the `POST` is merely what starts
the work. A lost response is then not a lost activation, and the client never
needs to know whether its request arrived.

**The poll answers from durable state alone**, which is what makes it honest:

| Poll says     | True when                                                                |
| ------------- | ------------------------------------------------------------------------ |
| `ready`       | Three checklist items green, no attempt row                              |
| `in_progress` | An attempt row exists with neither a charge nor a failure row against it |
| `declined`    | The latest attempt has a failure row and no charge row                   |
| `connecting`  | `billing_status = 'active'` and `agent_bound_at IS NULL`                 |
| `live`        | `billing_status = 'active'` and `agent_bound_at IS NOT NULL`             |

#### 2.5.2.2 The sequence, and the one transaction in it

```
1  (sync, local)   INSERT INTO billing_events                              ← the intent
                     (business_id, kind, amount_cents, provider_ref, occurred_at)
                   VALUES ($1, 'activation_charge_attempted',
                           $policy.fixed_fee_cents, $idem, now())
                   ON CONFLICT (provider_ref) DO NOTHING
2  (sync, remote)  PaymentIntent: off_session, confirm, Idempotency-Key: $idem,
                   metadata { business_id, purpose: 'activation' }
   ├─ declined        → INSERT billing_events 'activation_charge_failed'  → respond
   ├─ key in use      → respond 'in_progress'
   └─ succeeded       ↓
3  (sync, local)   ── ONE TRANSACTION ────────────────────────────────────
                   INSERT INTO billing_periods (business_id, policy_id,
                       starts_on, ends_on, fixed_fee_state, fixed_fee_invoice_ref, …)
                     ON CONFLICT (business_id, starts_on) DO NOTHING
                   INSERT INTO billing_events (kind 'activation_charge',
                       provider_ref = payment_intent.id, period_id, amount_cents)
                     ON CONFLICT (provider_ref) DO NOTHING
                   UPDATE businesses SET billing_status = 'active',
                       activated_at = $starts_on
                     WHERE id = $1 AND billing_status = 'unbilled'
                   DELETE FROM lifecycle_deadlines
                     WHERE business_id = $1 AND kind = 'unactivated_deletion'
                   ── COMMIT ────────────────────────────────────────────
4  (sync, remote)  ensure bound, verified by read-back                     (§2.5.3)
5  (async)         enqueue the "you're live" email                         (§2.11)
```

**Step 3 is one transaction because every write in it is local to one Postgres,
and it is the only step that can be.** Steps 2 and 4 are HTTP calls to other
companies; the same argument as [§2.6.3](#263-booking-in-order)'s steps 5 and 6, and the same conclusion
— pick an order in which the unwind is in the safe direction rather than
pretending a distributed transaction exists.

**What is durable after each step:**

| After | At Stripe                 | In Ringly's database                                     |
| ----- | ------------------------- | -------------------------------------------------------- |
| 1     | nothing                   | the attempt row, carrying the idempotency key            |
| 2     | a succeeded PaymentIntent | the attempt row, unchanged                               |
| 3     | as above                  | `active`, period 1, the ledger row, no deletion deadline |
| 4     | as above                  | `agent_bound_at`                                         |
| 5     | as above                  | a queued email row                                       |

**Step 1 exists to make step 2's window recoverable locally.** The attempt row
carries the exact key step 2 used, so any repair path can re-issue byte-identical
create call and receive the original PaymentIntent back rather than charging a
second time. Without it, the repair would have to search the payment provider by
metadata to discover a charge Ringly does not know it made — possible, but a
scan of somebody else's system standing in for a row of our own. The cost is one
extra ledger row per activation, and `billing_events` is append-only anyway
([N10.4](Ringly_PRD_v3.md#n10-4), [F6.14](Ringly_PRD_v3.md#f6-14)), so the row is a permanent and accurate statement that a press
happened.

**The uniqueness that makes step 3 safe to run repeatedly is in the database,
not in the application** — the same choice as [§2.6.4](#264-fail-closed-concretely)'s partial index:

```sql
CREATE UNIQUE INDEX billing_events_provider_ref_unique
    ON billing_events (provider_ref) WHERE provider_ref IS NOT NULL;

ALTER TABLE billing_periods ADD CONSTRAINT one_period_per_start
    UNIQUE (business_id, starts_on);
```

**`starts_on` is the charge's date rendered in the business's timezone ([N5.2](Ringly_PRD_v3.md#n5-2)),
not today's date.** This is the detail that makes the second constraint work as
a guard rather than as a coincidence: a repair running a day after the charge
must compute the same `starts_on`, or it inserts a second period, gives the
business a free day, and moves every subsequent boundary for the life of the
account. Deriving the date from the payment provider's `created` timestamp makes
the period's identity a function of the charge — which is what [F6.1](Ringly_PRD_v3.md#f6-1) says it is —
and makes the constraint idempotent forever rather than for a day.

**The in-request retry ladder for step 3 is immediate, then 250 ms, 1 s, 4 s** —
four attempts, about five seconds — after which the handler returns and the poll
keeps saying `in_progress`. It is short because the failures it covers are
transient local ones; anything longer is a fault that needs the repair paths
below, not a fifth attempt.

#### 2.5.2.3 What a crash between any two steps leaves behind

| Crash                              | Left behind                             | Repaired by                                                                                                                                                  |
| ---------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Before 1                           | Nothing. The press did not happen       | Nothing to repair; the button is still available                                                                                                             |
| Between 1 and 2                    | An attempt row, no money moved          | The sweep replays 2 with the recorded key; the provider either has the intent or charges once                                                                |
| Between 2 and 3                    | **Money taken, nothing local**          | The `payment_intent.succeeded` webhook, or the sweep, replays 2 (same object returned) then runs 3                                                           |
| Inside 3                           | Nothing partial — it is one transaction | Rolled back; the sweep re-runs it                                                                                                                            |
| Between 3 and 4                    | Activated, charged, possibly unbound    | [§2.5.3.1](#2531-intended-bind-state-is-derived-never-stored)'s reconciliation: intent says answer, provider says no agent                                   |
| Inside 4, after the bind, before 5 | Activated and bound, no email           | The dispatcher; `reason_key` makes it one message however many times it is enqueued ([§2.11.2](#2112-enforcing-if-it-is-not-in-the-registry-it-is-not-sent)) |

**Row three is the one the design exists for**, and it is the only window in
which money exists and Ringly does not know it. It is closed by two independent
mechanisms because [F1.12a-i](Ringly_PRD_v3.md#f1-12a-i)'s row two must never reach the screen: the payment
provider's own webhook, which is push and usually arrives in seconds, and the
**hourly settlement worker** ([§2.2.2](#222-request-paths-and-background-work)), which scans attempt rows older than a few
minutes with neither a charge nor a failure row against them. Both call the same
function. Both are safe to run concurrently, because step 3's constraints
arbitrate rather than the caller's care.

**The sweep's cost is bounded by the number of activations in flight**, which in
steady state is zero — the same property [§2.2.2](#222-request-paths-and-background-work) requires of every worker, and
the reason this does not become a scan that grows with tenants ([N4.1](Ringly_PRD_v3.md#n4-1)).

#### 2.5.2.4 The three rows, made independently reachable

**Row one — the card.** The decline is a _known_ outcome, which is what makes it
the one case where re-pressing is correct rather than dangerous: [F1.12a-i](Ringly_PRD_v3.md#f1-12a-i)'s
prohibition is on handing back an outcome the business cannot interpret. A
`billing_events` row of kind `activation_charge_failed` is written ([F6.14](Ringly_PRD_v3.md#f6-14)
records failures, not only charges), `billing_status` is untouched, the deletion
deadline still stands, and the checklist still reads three green. Nothing about
the account changed.

**Row two — the record.** Never surfaced. The handler retries in-process, then
the webhook, then the sweep; the poll says `in_progress` throughout and the
button shows progress. **There is no user-visible state between "charging" and
"activated"**, which is exactly [F1.12a-i](Ringly_PRD_v3.md#f1-12a-i)'s requirement that a charge and no
explanation is impossible.

**Row three — the bind.** The one that will be seen, because it depends on a
third party. Activation stands; the poll says `connecting`; the "you're live"
email is sent from step 4 rather than step 3, because [F7](Ringly_PRD_v3.md#f7--email)'s registry has it state
that the number is now taking customer calls, and sending it while the number
answers nowhere would make Ringly's own confirmation the thing that misleads.
The operator alert is raised at the same moment, not on a later pass ([F1.12a-ii](Ringly_PRD_v3.md#f1-12a-ii)
requires a failed verification to be retried _and_ raised).

### 2.5.3 Bind and unbind are verified by reading provider state back

[F1.12a-ii](Ringly_PRD_v3.md#f1-12a-ii), and it is the one piece of vendor interaction the design does not
trust. A write that reports success and does not take effect is invisible until
a customer finds it — R25.

#### 2.5.3.1 Intended bind state is derived, never stored

**Every bind and unbind in the system is the same operation: make what the
provider holds agree with what the business's own row already implies.**

```sql
-- what Ringly intends, computed, never written down
should_answer(b) :=
     b.billing_status IN ('active', 'grace', 'cancelling')
  OR (b.billing_status = 'unbilled' AND b.test_calls_used < allowance)

-- what Ringly last observed
is_bound(b) := b.agent_bound_at IS NOT NULL
```

`grace` and `cancelling` are in the first set because service continues
unchanged through both ([§2.10.4](#2104-when-a-charge-fails), [§2.10.7](#2107-cancellation)); `suspended` and `dormant` are not.
That predicate is the whole of [§2.13.2](#2132-unbinding-is-the-one-mechanism-for-stopping-service)'s three unbind moments and [§2.5](#25-onboarding-and-activation)'s two
bind moments in one expression.

**This is what makes a failed unbind retryable at all.** The alternative — a
column recording "we meant to unbind" — has to be written before the provider
call and cleared after it, so a crash between the two leaves a stored intent
that disagrees with reality in the direction nothing checks. Deriving the intent
from state that was already durable removes the window entirely: after a failed
unbind, `should_answer` is false and `agent_bound_at` is non-null, and that
disagreement is the repair queue.

**The lifecycle sweeper owns the reconciliation** — every business where
`should_answer <> is_bound` — because it already owns every unbind and rebind in
the system ([§2.13.2](#2132-unbinding-is-the-one-mechanism-for-stopping-service)) and giving activation its own worker would mean two
components issuing binds for one number. This is a decision the PRD does not
make; [F1.12a-ii](Ringly_PRD_v3.md#f1-12a-ii) says a failed verification is retried, and this says by whom.
The cadence is the sweeper's hourly one, which is slow for a business waiting to
go live; it is accepted because a bind that has already failed its own retry
ladder has an operator alert against it, and [F9.1c](Ringly_PRD_v3.md#f9-1c)'s rebind is the fast path.

**One predicate covers three separate faults** and that is the point: a
provisioning bind that never landed ([F1.9](Ringly_PRD_v3.md#f1-9)), an activation bind that never landed
([F1.12a-i](Ringly_PRD_v3.md#f1-12a-i) row three), and an unbind that never landed ([F7.13a](Ringly_PRD_v3.md#f7-13a)) are all one
disagreement between intent and observation, repaired by one query.

**What the design deliberately does not add** is a periodic diff of every
number Ringly holds against the provider's list. It would catch a number bound
by something outside this system, it costs a provider call per business on every
pass, and it grows with tenants against N4.1. [F7.13a](Ringly_PRD_v3.md#f7-13a) places the burden on the
alert instead, and this section keeps it there.

#### 2.5.3.2 The read-back, and its backoff

Two calls, always, in both directions:

```
bind:    set the number's inbound agents to [ { agent_id, weight: 1 } ]
         read the number back
         assert agent_id ∈ inbound_agents

unbind:  set the number's inbound agents to [ ]
         read the number back
         assert inbound_agents is empty
```

**The assertion is on list membership, not on a scalar field.** The telephony
provider replaced a single inbound-agent field with a weighted list, so a
read-back written against the old shape would find `undefined`, compare it to
`undefined`, and pass on a number bound to somebody else's agent. This is the
specific way a read-back can be present and useless, so it is named here.

**In-request ladder: one write, then reads at 1 s, 2 s and 4 s.** Provider state
is not guaranteed to be read-your-writes, so a single immediate read would
produce false failures and false alerts, which is worse than no check because a
team learns to ignore it. Three reads over seven seconds is enough for the
common case to report `live` before the owner has finished reading the screen.

**Past that ladder the request returns.** It does not hold the connection for
another minute: the poll already reports `connecting`, the sweeper owns the
retry ([§2.5.3.1](#2531-intended-bind-state-is-derived-never-stored)), and the alert has already been raised. A handler that blocked
for two minutes would be a handler that a proxy kills at ninety seconds, turning
a bounded failure into an unbounded one.

**The sweeper runs the same ladder on each pass**, so a provider outage that
resolves in twenty minutes resolves itself without a human.

#### 2.5.3.3 When it will not take

| Direction  | Alert                                                                                     | Also appears as                                        |
| ---------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Bind**   | Activation stuck ([F1.12a-ii](Ringly_PRD_v3.md#f1-12a-ii), [F8.6](Ringly_PRD_v3.md#f8-6)) | [F8.12](Ringly_PRD_v3.md#f8-12), "Activation stuck"    |
| **Unbind** | Its own alert ([F7.13a](Ringly_PRD_v3.md#f7-13a)) — no other symptom                      | [F8.12](Ringly_PRD_v3.md#f8-12), "Number not released" |

**A failed unbind gets its own alert because it has no other symptom.** Every
other component believes service has stopped: no period is metering, no
dashboard shows a live number, no rollup counts the calls. The number answers,
Ringly pays for the minutes, and nothing in the system disagrees with itself
except the reconciliation above. The alert names the business, the number still
answering, and why Ringly tried to release it, so the operator can release it by
hand ([F8.12](Ringly_PRD_v3.md#f8-12)).

**It is a read of provider state, never a placed call** ([F1.12a-ii](Ringly_PRD_v3.md#f1-12a-ii)). A synthetic
call costs minutes on every bind, lands in `calls` where it corrupts both the
test-call count ([§2.5.4](#254-the-test-call-allowance)) and the analytics ([§2.9](#29-analytics-and-the-two-dashboards)), and still proves only that
something answered. Whether the agent _sounds_ right is a human judgement and
[F1.12](Ringly_PRD_v3.md#f1-12)'s checklist item 2 exists for exactly that.

### 2.5.4 The test-call allowance

A call is a test call if the business had not pressed Activate when it arrived
([F1.13c](Ringly_PRD_v3.md#f1-13c)) — the whole rule, with no detection and no examination of who is
calling. At the fifth, the agent is unbound and the sixth call is **not answered
at all** ([F1.13a](Ringly_PRD_v3.md#f1-13a)): a recorded refusal would still be a connected call and would
still cost the minutes the limit exists to bound.

#### 2.5.4.1 The counter is a column, and that is not an optimisation

`businesses.test_calls_used` ([§2.4](#24-data-model)/005) against
`pricing_policy.test_call_allowance` ([§2.4](#24-data-model)/007), the second being configuration
rather than a constant ([F1.13](Ringly_PRD_v3.md#f1-13), [F6.15](Ringly_PRD_v3.md#f6-15)).

**A count over `calls WHERE is_test_call` would be derivable and is still
wrong**, because [F9.1c](Ringly_PRD_v3.md#f9-1c) lets the operator reset the allowance. A reset against a
derived count means deleting or restamping call rows — which is precisely the
reclassification of history [F1.13c](Ringly_PRD_v3.md#f1-13c) forbids, arriving through the back door. A
column can be set to zero without touching a single call's record of what it
was.

**It is also the one number two screens read on every render** — the checklist
([F1.12](Ringly_PRD_v3.md#f1-12)) and the dashboard's service state ([F5.18](Ringly_PRD_v3.md#f5-18)) — and both are required to be
current rather than rolled up, so a single-row read is the cheap answer and a
scan of `calls` is not ([N4.3](Ringly_PRD_v3.md#n4-3)).

**The allowance resolves from `pricing_policy`, like every other number in the
commercial model.** [F1.13](Ringly_PRD_v3.md#f1-13) makes it "configuration, not a
constant" on the same principle as [F6.15](Ringly_PRD_v3.md#f6-15), so the platform
default lives in the versioned policy row while per-business consumption lives in
`businesses.test_calls_used` — which is what lets
[F9.1c](Ringly_PRD_v3.md#f9-1c)'s operator reset change one business without
moving the default for everyone.

#### 2.5.4.2 The crossing, and the race at the boundary

**Incremented at call end, in the same transaction that writes the call row**
([§2.6.2.3](#2623-call-end)), which is what makes the counter and `is_test_call` agree by
construction rather than by care — both are decided from one read of the
business's status inside one transaction, so there is no interval in which a
call is classified one way and counted the other.

```sql
-- inside the call-end transaction, only if the call row actually inserted
UPDATE businesses
   SET test_calls_used = test_calls_used + 1
 WHERE id = $1 AND billing_status = 'unbilled'
RETURNING test_calls_used;
```

**The increment is conditional on the call row having been inserted.**
[§2.6.2.3](#2623-call-end)'s `ON CONFLICT (provider_call_id) DO NOTHING` makes a redelivered
webhook a no-op for the call; the increment must be a no-op for the same
redelivery, or a provider retry silently spends one of the five.

**The crossing is decided from the returned integer, and exactly one call can
own it.** Postgres serialises the two `UPDATE`s on the row lock, so two calls
ending at the same instant with `test_calls_used = 4` receive 5 and 6, in some
order, and never both receive 5. The crosser is the one whose returned value `n`
satisfies `n - 1 < allowance <= n` — expressed against the allowance rather than
as `n = allowance` so that a platform default lowered while a business is mid-way
still produces exactly one crossing rather than none.

The crosser, and only the crosser:

1. enqueues the "test calls exhausted" email ([F7](Ringly_PRD_v3.md#f7--email)'s registry) with
   `reason_key = 'test_calls_exhausted:' || call_id`. Keying it to the call
   rather than to the business is what lets a business emailed once, reset by
   the operator ([F9.1c](Ringly_PRD_v3.md#f9-1c)) and exhausted again be emailed a second time — a
   business-keyed reason would suppress the message on the one occasion it is
   most needed;
2. **after the transaction commits**, unbinds and verifies ([§2.5.3](#253-bind-and-unbind-are-verified-by-reading-provider-state-back)), then clears
   `agent_bound_at`. The provider call is outside the transaction because it is
   HTTP, and after the commit because a rolled-back transaction must not leave a
   number unbound;
3. raises the operator alert **only if `test_call_confirmed_at IS NULL`**
   ([F1.13a](Ringly_PRD_v3.md#f1-13a), [F8.12](Ringly_PRD_v3.md#f8-12)). A business with three green boxes that simply has not pressed
   the button is deciding, not stuck, and raising it would make the queue
   meaningless.

**The business is charged nothing at any point in this** ([F1.13](Ringly_PRD_v3.md#f1-13), [F1.13d](Ringly_PRD_v3.md#f1-13d)). There
is no code path from the counter to `billing_events`, which is 2.1.4 restated:
the number of calls placed has no bearing on billing status whatsoever.

**One boundary this design has to pick, and [F1.13c](Ringly_PRD_v3.md#f1-13c) picks it.** A call that
connects while the business is `unbilled` and ends after Activate has been
pressed is a test call — "the business had not yet pressed Activate when it
arrived" is the requirement's own wording, and it is a rule about arrival. The
status must therefore be read from the per-call snapshot frozen at call start
([§2.6.6.2](#2662-the-per-call-snapshot--freezing-config-for-one-conversation)), not from the live row at call end. Reading the live row at call end
would disagree in exactly this one window, and [F1.13c](Ringly_PRD_v3.md#f1-13c) is what settles it.
**[§2.6.2.3](#2623-call-end) states the same rule at the point of use**, and the two may not be
allowed to drift apart.

#### 2.5.4.3 The two ways out

[F1.13b](Ringly_PRD_v3.md#f1-13b), and which one applies is a query, not a judgement.

| Condition                                     | Route                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test_call_confirmed_at` set, other two green | Activate still works. The charge runs, and step 4 of [§2.5.2.2](#2522-the-sequence-and-the-one-transaction-in-it) is a rebind rather than a no-op |
| `test_call_confirmed_at` null                 | Cannot activate. Operator investigates, pauses the clock ([F9.1b](Ringly_PRD_v3.md#f9-1b)), resets and rebinds ([F9.1c](Ringly_PRD_v3.md#f9-1c))  |

**Activating with a spent allowance takes the identical path as activating with
allowance to spare**, and this falls out of [§2.5.3.1](#2531-intended-bind-state-is-derived-never-stored) rather than being coded
twice: `should_answer` becomes true the instant `billing_status` becomes
`active`, so the same "make the provider agree" step that is a verified no-op
for one business is a verified rebind for the other. **Running out of test calls
is not a bar to activating** ([F1.13b](Ringly_PRD_v3.md#f1-13b)), and the reason it cannot accidentally
become one is that no branch in the activation path asks about the allowance.

**The ten-day clock keeps running through all of it unless an operator pauses
it** ([F9.1](Ringly_PRD_v3.md#f9-1), [§2.13.1](#2131-deadlines-and-the-sweeper)). The two limits are independent and bite in either order.

### 2.5.5 Decisions this section makes, and one correction

Collected so they are reviewable as decisions rather than discovered as
implementation:

| #   | Decision                                                                                                                                                                           | Because                                                                                                                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Commit the business row **before** checking granted scopes (steps 5 and 6 swapped)                                                                                                 | [F1.7b](Ringly_PRD_v3.md#f1-7b)'s "the draft is kept" is only durable if it is a row                                                                                                                                                                                |
| 2   | `enrichment_requests` and `test_call_confirmed_at` are tables/columns in `005`; `billing_events` sits there too, with the rest of the foundations                                  | Each lands where the things that depend on it can reach it — [N9.1](Ringly_PRD_v3.md#n9-1), [F1.12](Ringly_PRD_v3.md#f1-12), and a money ledger that must predate the first payment fact. **Ratified 2026-08-01: delivery order does not get to decide the schema** |
| 3   | Provisioning waits for the calendar credential                                                                                                                                     | [F4.1](Ringly_PRD_v3.md#f4-1) makes a calendar-less business unable to become a customer; [N9.3](Ringly_PRD_v3.md#n9-3)'s argument, one step on                                                                                                                     |
| 4   | The idempotency key includes the payment method id                                                                                                                                 | Otherwise a second card replays the first decline                                                                                                                                                                                                                   |
| 5   | Activate is submit-and-poll                                                                                                                                                        | [F1.12a-i](Ringly_PRD_v3.md#f1-12a-i)'s "never press it again" cannot survive the state living in a response                                                                                                                                                        |
| 6   | An `activation_charge_attempted` ledger row precedes the charge                                                                                                                    | Makes the charge-without-record window repairable from Ringly's own data                                                                                                                                                                                            |
| 7   | `starts_on` comes from the charge's timestamp, not from the clock at repair time                                                                                                   | A late repair must compute the same period boundary or it moves every one after it                                                                                                                                                                                  |
| 8   | Intended bind state is derived from `billing_status` and never stored                                                                                                              | A stored intent has a crash window; a derived one has none, and it is what makes a failed unbind retryable                                                                                                                                                          |
| 9   | The lifecycle sweeper owns bind reconciliation                                                                                                                                     | It already owns every other bind and unbind ([§2.13.2](#2132-unbinding-is-the-one-mechanism-for-stopping-service)); two components issuing binds for one number is worse than an hour of latency                                                                    |
| 10  | An address carrying Google's `email_verified` claim needs no second link. **Ratified 2026-08-01**                                                                                  | The proof already happened in the token exchange. The test is the claim, not a string comparison                                                                                                                                                                    |
| 11  | **Nothing about the card is stored.** The card item asks Stripe on every render ([§2.10.10a](#21010a-the-card-facts-stripe-answers-the-ledger-remembers)). **Ratified 2026-08-03** | A column is a second copy of a Stripe fact and drifts toward a green checklist over a dead card — the one state the checklist exists to prevent                                                                                                                     |
| 12  | `test_call_confirmed_at` is a nullable timestamp, not a boolean                                                                                                                    | Every "has this happened" in this schema is a nullable `*_at`; a second idiom costs a reader more than seven bytes saves. Nothing reads the value today, and that is stated rather than dressed up ([§2.4](#24-data-model)/005)                                     |

**Testing this section**

_Observable_ — what the draft contains after enrichment; which fields can be
edited; whether enrichment ran at all; what the checklist shows; whether the
Activate button is available; whether pressing it twice charges twice; whether
the number answers; what the business is charged; what arrives in its inbox;
what the operator queue holds.

_Internal_ — the provisioning sequence, the OAuth flow's shape, the idempotency
key's construction, the attempt row, the retry ladders and their intervals, the
read-back's two calls, the sweeper's predicate, the agent identifier,
`billing_status` values, every table and column named above.

_Behaviours owed to the catalogue_

- One free-form submission yields name, address, phone, hours, timezone, website
  and services in a single request.
- Every enriched field can be corrected before commit, and the correction is what
  is committed.
- An unreachable website falls back to manual entry rather than failing.
- Enrichment past its daily ceiling, or past the limit for one origin, returns
  the manual form and spends nothing.
- A repeated enrichment of the same business within the day spends nothing the
  second time.
- A business whose enrichment did not run reaches activation by the same route as
  one whose did.
- Sign-in succeeding while calendar consent is declined keeps the account and the
  draft, blocks activation, and explains why.
- A business that declined calendar consent has no number bought for it, and
  gets one when it re-consents.
- Granting the calendar scope later completes onboarding without a second
  sign-in.
- The checklist can be completed in any order; none of the three items activates
  anything on its own.
- Changing the contact email after verifying it makes the item un-green again.
- Adding a card stores it and charges nothing.
- Pressing Activate charges $100 once, opens period 1, and makes the number live.
- Pressing Activate twice in quick succession charges $100 once.
- A declined card at activation charges nothing and changes nothing, and a
  different card then succeeds.
- A charge that succeeds while the local write fails still leaves the business
  activated, charged once, and never asked to press again.
- A period opened by a repair that runs the next day starts on the day of the
  charge, not the day of the repair.
- A bind that silently does not take effect is detected, retried, and raised.
- An unbind that silently does not take effect is detected and raised under its
  own alert.
- A number left bound after service should have stopped is picked up without
  anyone looking for it.
- The fifth test call unbinds the number; the sixth is not answered; the business
  is emailed and never charged.
- Two test calls ending at the same instant on the boundary unbind once and email
  once.
- A redelivered call-end webhook does not spend a test call.
- A call that starts before Activate and ends after it is a test call and is not
  billed.
- A business that never confirmed a working test call cannot activate and is
  raised as stuck.
- A business with all three items green that has not pressed Activate is not
  raised as stuck.
- Activating after the allowance is spent rebinds the number immediately.
- An operator reset after an exhausted allowance emails the business again the
  next time it is exhausted.

## 2.6 The call path

The only latency-sensitive code in the system, and the only place where a
mistake is heard by a stranger.

### 2.6.1 Budget

[N3](Ringly_PRD_v3.md#n3--latency-on-the-call-path), restated as the thing implementations are held to:

| Segment                            | p95 target | Hard ceiling | Implemented as                                                     |
| ---------------------------------- | ---------- | ------------ | ------------------------------------------------------------------ |
| Ringly's handler, end to end       | ≤ 400 ms   | **6000 ms**  | Route-level deadline, checked per await                            |
| — of which our own datastore       | ≤ 80 ms    | 1000 ms      | `statement_timeout` on the connection                              |
| — of which the scheduling provider | ≤ 250 ms   | **5000 ms**  | `AbortSignal.timeout(5000)` on the fetch                           |
| Caller-perceived silence           | ≈ 0        | —            | Agent-side filler, not Ringly code ([F2.6](Ringly_PRD_v3.md#f2-6)) |

**Slow is failed** ([N3.1](Ringly_PRD_v3.md#n3-1)): at the ceiling the request is aborted and the booking
is refused exactly as an outage would be (2.1.1). But the ceiling sits at six
seconds, not one and a half, because **abandoning early costs a customer**
([N3](Ringly_PRD_v3.md#n3--latency-on-the-call-path)) — the agent covers the wait with filler speech, and a caller who hears
"let me check that for you" for five seconds is a caller who is still on the
phone.

**The deadline is per handler invocation, not per call.** It is established when
the webhook is received and every subsequent `await` is bounded by what remains
of it, so a slow database read followed by a slow provider read cannot sum past
the ceiling. Concretely: `const deadline = Date.now() + 6000` at entry, and each
outbound call gets `AbortSignal.timeout(Math.min(perStepCeiling, deadline - Date.now()))`.

**Nothing retries inside the handler.** A retry inside a 6-second budget either
does not fit or doubles the tail, and the caller is waiting for both attempts.
Failure is returned to the agent, which apologises; the incident machinery
([§2.6.4](#264-fail-closed-concretely)) is what notices.

### 2.6.2 Three webhooks

All three are `POST`, all three verify the provider's signature **before parsing
the body** ([N6.3](Ringly_PRD_v3.md#n6-3)) using the vendor's own helper, and all three reject anything
whose signature does not check with `401` and no side effect.

| Webhook        | Fires              | Sync work                                      | Returns to the agent               |
| -------------- | ------------------ | ---------------------------------------------- | ---------------------------------- |
| **Call start** | Call connects      | Resolve business, build and persist a snapshot | Dynamic variables for the greeting |
| **Tool call**  | Agent calls a tool | Availability / book / reschedule / cancel      | The tool result                    |
| **Call end**   | Call hangs up      | Persist the call row and its usage record      | `204`                              |

#### 2.6.2.1 Call start

```
1. verify signature                                  (reject → 401)
2. business_id ← number_index[to_number]             (miss → single query, cache)
3. snapshot    ← config_cache[business_id]           (miss → single query, cache)
4. INSERT INTO call_sessions (provider_call_id, business_id, snapshot, expires_at)
     VALUES ($1, $2, $3, now() + interval '4 hours')
     ON CONFLICT (provider_call_id) DO NOTHING
5. return { business_name, greeting, services_summary, timezone }
```

**`to_number` is the only routing input, and it is trustworthy because the
signature covers it.** Nothing here reads the caller's number, and nothing
downstream re-derives the tenant (2.3.1).

**Step 4 is what makes "resolved once, passed down" real.** Without it, "passed
down" is an aspiration: the tool webhook arrives at a _different process_, with
no session, carrying only a call id.

#### 2.6.2.2 Tool call

```
1. verify signature                                  (reject → 401)
2. session ← SELECT business_id, snapshot FROM call_sessions
               WHERE provider_call_id = $1           (miss → refuse + alert)
3. dispatch on tool name, scoped to session.business_id
4. return the tool result
```

**Every query in step 3 names `session.business_id` explicitly.** This surface
runs under the service role with no RLS (2.3.1), so the single-row lookup in step
2 _is_ the tenancy boundary. A payload field naming a business is never trusted;
there is no such field.

**A missing session row is fail-closed, not fail-back.** It cannot happen in
normal operation — the row is written before the agent can speak — so it means a
Ringly fault. The booking is refused, the caller gets the standard apology, and
the operator is alerted. Re-resolving the tenant from the payload instead would
turn a Ringly bug into a cross-tenant risk.

**The four tools, as the agent sees them:**

| Tool                    | Input                                            | Output                                          |
| ----------------------- | ------------------------------------------------ | ----------------------------------------------- |
| `check_availability`    | `{ service, from, to }`                          | `{ slots: [...] }` or `{ refused, reason }`     |
| `book_appointment`      | `{ service, at, customer_name, customer_phone }` | `{ booked, at, service }` or `{ refused, ... }` |
| `find_appointment`      | `{ name, date, time, service }`                  | `{ match }` or `{ refused, unmatched_field }`   |
| `reschedule` / `cancel` | `{ appointment_ref, to? }`                       | `{ done }` or `{ refused, reason }`             |

`appointment_ref` is issued by `find_appointment` and is opaque and
session-scoped — the agent never handles an appointment id, so a hallucinated
identifier cannot address someone else's booking.

`customer_phone` is required on `book_appointment` ([F2.12](Ringly_PRD_v3.md#f2-12)); the agent asks for it
when caller ID does not supply one, and the tool refuses without it.

#### 2.6.2.3 Call end

```
1. verify signature                                  (reject → 401)
2. INSERT INTO calls (...) ON CONFLICT (provider_call_id) DO NOTHING
3. INSERT INTO usage_records (...) if the period is open
4. DELETE FROM call_sessions WHERE provider_call_id = $1
5. return 204
```

**`is_test_call` comes from the snapshot, not from the business row.** [F1.13c](Ringly_PRD_v3.md#f1-13c)
defines a test call by whether the business had pressed Activate **when the call
arrived** — so the value is `session.snapshot.was_unbilled`, captured at call
start ([§2.6.6.2](#2662-the-per-call-snapshot--freezing-config-for-one-conversation)) and never re-read here. The window where this matters is narrow
but real: a caller who dials at 14:59:58 and hangs up at 15:02, with Activate
pressed at 15:00, is a test call by [F1.13c](Ringly_PRD_v3.md#f1-13c) and would be billed by any
implementation that asked the business row at call end. `outcome` is left null
for [§2.9.1](#291-outcome-classification), and the `ON CONFLICT` makes a redelivered webhook a no-op rather than
a double-metered call.

### 2.6.3 Booking, in order

Steps 1–3 are local and cost nothing; step 4 is the only external call and owns
the whole provider budget ([§2.6.1](#261-budget)).

```
1. resolve the requested time in the business's timezone   (N5.2)     local
2. reject beyond booking_horizon_days                      (F2.9)     local
3. reject outside opening hours                            (F2.8)     local
4. read provider busy-intervals AND own appointments       (F2.3)     ≤5000 ms
   └─ failure of any kind → refuse, open/attach incident (§2.6.4)
5. INSERT the appointment                                  (F2.3a)    local
   └─ unique violation → "that slot has just been taken", re-offer
6. create the provider event                               (F2.11)    ≤5000 ms
   └─ failure → DELETE the appointment, refuse
7. return the confirmation for the agent to read back
```

**Steps 5 and 6 are not a transaction and cannot be**, because one of them is an
HTTP call to somebody else. The order is chosen so the failure is recoverable in
the safe direction: taking the local row first means the slot is held against a
concurrent caller, and unwinding it on provider failure leaves no booking rather
than a booking the business will never see in its own calendar. The reverse order
would leave an orphaned calendar event nobody can cancel.

**The race is arbitrated by the database, not by checking first** ([F2.3a](Ringly_PRD_v3.md#f2-3a)):

```sql
CREATE UNIQUE INDEX no_overlap_per_business ON appointments
  USING gist (business_id WITH =, tstzrange(starts_at, ends_at) WITH &&)
  WHERE status = 'booked';
```

Two callers offered the same nearest-open slot both attempt the insert; one gets
a unique violation and hears "that slot has just been taken." At these volumes
that is the normal consequence of offering the same time to both, not an exotic
case.

**A repeating request books its first instance and stops** ([F2.2a](Ringly_PRD_v3.md#f2-2a)). There is no
series, nothing is materialised, and no requirement downstream may ask whether an
appointment belongs to one.

### 2.6.4 Fail-closed, concretely

When the calendar cannot be read the caller gets an apology and is asked to ring
back ([F2.7](Ringly_PRD_v3.md#f2-7)); the business gets a banner and **one email per incident, not per
call**; the operator sees the business under "bookings failing" ([F8.12](Ringly_PRD_v3.md#f8-12)).

**Nothing ever reads `calendar_incidents` to decide what to do.** There is no
`SELECT`, no "is an incident open?" check, and no branch on cached state. Every
call issues **exactly one statement**, and that statement is a _write whose
`WHERE` clause is the check_ — evaluated by the database as part of the write,
which is what makes it safe under concurrency. Both statements run **after the
handler has answered the agent** ([N3.2](Ringly_PRD_v3.md#n3-2)), so neither is on the caller's clock.

```sql
-- the calendar read SUCCEEDED. Runs on every successful call.
UPDATE calendar_incidents SET closed_at = now()
 WHERE business_id = $1 AND closed_at IS NULL;

-- the calendar read FAILED. Runs on every failed call.
INSERT INTO calendar_incidents (business_id, opened_at, last_error)
VALUES ($1, now(), $2)
    ON CONFLICT DO NOTHING
  RETURNING id;   -- ← a row here means THIS call opened the incident
```

**Four cases, one statement each, and no case needs prior knowledge:**

| Calendar read | An incident was already open | Statement | What happens                       | Email   |
| ------------- | ---------------------------- | --------- | ---------------------------------- | ------- |
| succeeded     | no                           | `UPDATE`  | Matches 0 rows. A no-op            | no      |
| succeeded     | yes                          | `UPDATE`  | Matches 1 row. The incident closes | no      |
| failed        | no                           | `INSERT`  | Inserts; an id is returned         | **yes** |
| failed        | yes                          | `INSERT`  | Conflicts; nothing is returned     | no      |

**The returned id is the entire decision procedure for the email.** The handler
does not need to know, before it writes, whether an incident existed — it finds
out by whether the insert gave it a row back. That is the difference between this
and check-then-act, and it is the whole reason forty simultaneous failures send
one email rather than forty.

**Yes, that is one write per call, and it is the right trade.** A successful call
on a healthy business issues an `UPDATE` that matches nothing. It costs a single
indexed lookup against a table with roughly zero rows, it happens after the
response, and at [N2.1](Ringly_PRD_v3.md#n2-1)'s volumes it is well under one write per second across the
whole platform. The alternative — keeping state to avoid it — is what the removed
flag tried to do, and it was both wrong and unnecessary (below).

**The uniqueness is a database constraint, not application discipline:**

```sql
CREATE UNIQUE INDEX one_open_incident_per_business
    ON calendar_incidents (business_id) WHERE closed_at IS NULL;
```

That partial index is what makes [F2.7](Ringly_PRD_v3.md#f2-7)'s "one email per incident" true under
concurrency. Forty calls failing simultaneously all attempt the insert; exactly
one wins and gets a row back, and only that one queues an email. Without it,
"check then insert" races and forty callers become forty emails on the worst
possible day for the business to receive them.

**"Was the call healthy" is not a lookup.** It is the return value of the read
the handler just performed, in the handler, on the stack. There is no state to
consult and nothing to keep in sync: step 4 of [§2.6.3](#263-booking-in-order) either returned busy
intervals or it did not, and that boolean is the whole input to the transition.

**An earlier draft cached an `hasOpenCalendarIncident` flag to skip the no-op
`UPDATE` on healthy calls. It is removed, and it was wrong twice over.**

- **It could not work.** The config cache is process-local ([§2.6.6](#266-configuration-on-the-call-path)) and the
  application runs many instances. A failure handled by instance A sets a flag
  instance B has never seen, so B's next successful call would skip the close
  anyway. The flag would have been correct only in a single-process deployment,
  which this is not.
- **It optimised nothing worth optimising.** The `UPDATE` is already scoped to
  `closed_at IS NULL`, so on a healthy business it matches no rows, touches no
  pages, and returns. It runs **after the response** ([N3.2](Ringly_PRD_v3.md#n3-2)), so it is not on the
  caller's clock, and at [N2.1](Ringly_PRD_v3.md#n2-1)'s volumes it is well under one write per second
  across the whole platform.

So the `UPDATE` is issued unconditionally after responding. The cheapest correct
thing beat the fastest incorrect one, and the design carries one less piece of
state that could drift.

**The probe is what makes the banner honest when nobody rings.** Closing on "the
first successful read" is fine while calls are arriving and useless otherwise: a
business whose calendar broke at 6pm and reconnected at 8pm should not keep a
red banner all night waiting for a customer to dial. The **calendar health probe**
([§2.2.2](#222-request-paths-and-background-work)) runs every five minutes over businesses with an open incident, performs
one cheap availability read each, and closes on success. Its cost is bounded by
the number of open incidents, which in steady state is zero.

**Which of the three transitions does what:**

| Trigger                         | Opens | Closes | Emails            |
| ------------------------------- | ----- | ------ | ----------------- |
| A call's calendar read fails    | ✓     | —      | Only if it opened |
| A call's calendar read succeeds | —     | ✓      | —                 |
| The probe's read succeeds       | —     | ✓      | —                 |

The probe never opens an incident. A calendar that is down but has no callers is
costing the business nothing yet, and an incident opened by a probe would email a
business about a failure no customer has hit.

### 2.6.5 Identifying an existing appointment

[F2.4](Ringly_PRD_v3.md#f2-4) is a matching problem, not a lookup, and the design has to be explicit
about it because voice input is lossy.

- The caller gives **a name plus the appointment's date, time and service**.
- **Caller ID is not the identifying factor here.** A customer may ring from a
  different phone or withhold the number; the search runs over appointments, not
  over customer records.
- **No attribute has to match exactly.** "Dave" matches "David", "Tuesday"
  matches the date, "two" matches 14:00, "a cut" matches "Ladies' Cut". Each
  attribute is scored for partial match.
- **If any one attribute fails to match even partially, the caller is refused
  and told which one** — name, date, time or service. A refusal that does not
  say what was wrong sends the caller away with no way to correct it.
- **A correction re-runs the search** against the corrected values ([F2.4](Ringly_PRD_v3.md#f2-4)).
- **A relative day means the next one**: "Tuesday at 2" is the nearest future
  Tuesday, and the agent states the full date back and waits for confirmation
  before acting.

### 2.6.6 Configuration on the call path

Two different problems, deliberately solved by two different mechanisms. Getting
them confused is how a caller ends up hearing prices change mid-conversation.

#### 2.6.6.1 The 60-second cache — avoiding a query per call

[N4.2](Ringly_PRD_v3.md#n4-2) forbids re-reading slow-changing configuration from the database on every
call. A **process-local, in-memory cache** with a **60-second TTL** holds two
maps:

| Map            | Key           | Value                                                                                                                                   | Invalidated by |
| -------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `number_index` | `to_number`   | `business_id`                                                                                                                           | TTL            |
| `config_cache` | `business_id` | timezone, horizon, greeting, active services with price and duration, opening hours, `was_unbilled` ([F1.13c](Ringly_PRD_v3.md#f1-13c)) | TTL            |

**The 60 seconds is the requirement, not a tuning choice.** [F3.2](Ringly_PRD_v3.md#f3-2) gives a
catalogue or hours change ≤60s to reach the next caller, so the TTL _is_ the
propagation guarantee. Raising it would break [F3.2](Ringly_PRD_v3.md#f3-2); lowering it would buy nothing
a business can perceive.

**Nothing invalidates it on write.** An owner saving a price does not notify
running processes — there is no bus to notify them over, and 2.1.6 forbids
adopting one. Expiry is the whole mechanism, and it is why the guarantee is
stated as "within 60 seconds" rather than "immediately".

**No shared cache product.** 10⁴ tenants × a few KB is a few tens of MB per
process, each instance warms independently, and a miss costs one indexed query.
Redis would add a host dependency (2.1.6) and a second thing to be down.

**A cold process is correct, just slower** — every miss falls through to the
database. There is no path where a cache miss produces a wrong answer, only a
slower one, which is what keeps the 400ms p95 an average-case concern rather than
a correctness one.

#### 2.6.6.2 The per-call snapshot — freezing config for one conversation

The cache above is emphatically **not** what the tool webhook reads. If it were,
a caller quoted £40 at the start of a call could be booked at £45 sixty seconds
later, because the TTL expired mid-conversation. [F3.2](Ringly_PRD_v3.md#f3-2) says the opposite: _a
caller already mid-conversation keeps the catalogue they started with._

So the call-start webhook **writes the resolved configuration once**, and every
tool call in that conversation reads that frozen copy:

```
call_sessions(provider_call_id pk, business_id, snapshot jsonb,
              opened_at, expires_at)
```

- **Written once**, at call start, never updated during the call.
- **Read by primary key** on every tool call — a single-row lookup, ~1ms, inside
  the 80ms datastore budget.
- **Deleted** by the call-end webhook; a sweeper removes rows past `expires_at`
  (4 hours) for calls whose end webhook never arrived.

It has to be a table rather than a process-local map for the same reason the
incident flag failed: **the tool webhook may reach a different instance than the
call-start webhook did.** Process-local memory is not a place two webhooks of one
conversation can meet.

It also earns its place twice. Besides freezing the catalogue, it is the
mechanism behind [§2.3.1](#231-row-level-security-is-the-floor-not-the-ceiling)'s "resolved once and passed down" — the row _is_ the
passing down, and the tenancy boundary on a surface with no session ([§2.6.2.2](#2622-tool-call)).

#### 2.6.6.3 What is deliberately not cached

- **Calendar busy intervals.** Read live on every booking ([R6](#r6)). A stale
  conflict check is worse than a slow one — it is 2.1.1 with extra steps.
- **Calendar incident state.** Not cached anywhere; see [§2.6.4](#264-fail-closed-concretely) for why the flag
  was removed.
- **Anything about money.** Billing state is read live where it is needed and
  never on the call path.

**Testing this section**

_Observable_ — what the caller hears; whether an appointment exists afterwards;
what the connected calendar holds; the dashboard banner; what the business is
emailed; the recorded outcome and duration.

_Internal_ — webhook routes and payload shapes, the tool names exposed to the
agent, the cache, the timeout values, the unique constraint.

_Behaviours owed to the catalogue_

- A caller books a free slot and hears the date, time, service and business read
  back.
- A taken slot is refused and the nearest open times either side are offered.
- Two callers racing for one slot: one books, the other is told it has just gone
  and is re-offered.
- A slot outside opening hours is refused, at 3am and on a day the business is
  shut.
- A slot beyond the booking horizon is refused; changing the horizon changes
  where the refusal starts.
- A calendar that is unreachable, slow, revoked or expired all produce the same
  refusal, and none writes an appointment.
- An outage spanning many calls emails the business once; the first successful
  read clears the banner.
- The number of callers turned away by an outage is visible while it is open and
  still correct after it has closed.
- Enquiries still work while booking is refused.
- A reschedule matches on name plus date, time and service, partially and
  case-insensitively.
- A reschedule where one attribute cannot be matched is refused and names that
  attribute.
- A corrected detail re-runs the search and succeeds.
- A caller ringing from a number the business has never seen can still reschedule.
- "Tuesday at 2" resolves to the next Tuesday and is stated back before acting.
- A repeating request books exactly one appointment and says so.
- A caller with a withheld number is asked for one and is refused if they will not
  give it; a caller with a withheld number can still reschedule an existing
  appointment.
- A catalogue change reaches the next caller within 60 seconds and does not
  disturb a caller mid-conversation.
- A caller the agent cannot help is given the business's own details and recorded
  as dropped.
- Every call opens with the recording disclosure, and a business's custom
  greeting cannot remove it.

---

## 2.7 Scheduling providers

[F4.3](Ringly_PRD_v3.md#f4-3) requires a second provider to arrive **without changes to booking logic**.
That is an interface requirement, and the interface is small — four operations.
Everything difficult about this section is on the other side of it: credentials
that expire, consent that is withdrawn, a vendor that is slow, and a caller on
the phone while all three are being resolved.

The section is organised the way an implementer meets it: the shape ([§2.7.1](#271-the-interface-in-full)),
the failure vocabulary ([§2.7.2](#272-one-error-at-the-boundary-eight-classifications-inside)), the credential lifecycle ([§2.7.3](#273-credentials-and-the-token-lifecycle)), the Google
mapping ([§2.7.4](#274-google-calendar-concretely)), the budget ([§2.7.5](#275-timeouts-cancellation-and-the-absence-of-retry)), and what the next provider costs
([§2.7.6](#276-what-a-second-provider-costs-and-where-this-interface-breaks)).

### 2.7.1 The interface, in full

**Four operations, and everything else stays out.** The interface exposes no
provider concepts — no calendar ids, no attendee lists, no recurrence rules
(there is no recurrence to express, [§1.4](Ringly_PRD_v3.md#14-scope)). [§2.6.3](#263-booking-in-order) steps 4 and 6 call only these,
so adding Microsoft 365 or CalDAV is a new implementation and a row in
`scheduling_credentials.provider` ([§2.4](#24-data-model)/006), not a change to the code that
decides whether a slot is free.

```ts
// ── Vocabulary. All instants are UTC (N5.1); the timezone travels separately
//    because the provider needs it to write an event a human will read.

type ProviderName = "google"; // 006's `provider`; one value at v3 (F4.2)

type Interval = { readonly startsAt: Date; readonly endsAt: Date };

type ProviderEventId = string & { readonly __brand: "ProviderEventId" };

type Connection = {
  readonly businessId: string;
  readonly provider: ProviderName;
  readonly refreshToken: string; // decrypted; in memory only, never logged
  readonly grantedScopes: readonly string[];
  readonly timezone: string; // IANA, from businesses.timezone (N5.2)
};

type CallContext = {
  readonly connection: Connection;
  readonly signal: AbortSignal; // the caller's remaining budget (§2.6.1)
};

type NewEvent = {
  readonly appointmentId: string; // appointments.id — the idempotency key
  readonly startsAt: Date;
  readonly endsAt: Date; // startsAt + duration_minutes (§2.4/005)
  readonly serviceName: string;
  readonly customerName: string;
  readonly customerPhone: string;
};

// ── The interface itself.

type SchedulingProvider = {
  availability(ctx: CallContext, window: Interval): Promise<Interval[]>;
  create(ctx: CallContext, event: NewEvent): Promise<ProviderEventId>;
  move(ctx: CallContext, id: ProviderEventId, to: Interval): Promise<void>;
  cancel(ctx: CallContext, id: ProviderEventId): Promise<void>;
};
```

**Every method throws `CalendarUnavailable` and nothing else.** Not a
`GaxiosError`, not a `TypeError` from a null field, not an `AbortError`. The
adapter catches everything, including its own bugs, and re-throws one type
([§2.7.2](#272-one-error-at-the-boundary-eight-classifications-inside)). A call site that has to know which library it is talking to is a call
site that has not been decoupled from it.

**Three decisions in that block are load-bearing.**

**`availability` returns busy intervals, not free ones.** Free is a function of
opening hours ([F2.8](Ringly_PRD_v3.md#f2-8)), the booking horizon ([F2.9](Ringly_PRD_v3.md#f2-9)) and Ringly's own appointments
([F2.3](Ringly_PRD_v3.md#f2-3)), none of which the provider knows. Returning "free" would put three
Ringly rules inside the adapter and make [F4.3](Ringly_PRD_v3.md#f4-3)'s "without changes to booking
logic" false the moment a business edited its Saturday. The intervals come back
sorted by start and **unmerged** — [§2.6.3](#263-booking-in-order) tests one candidate time for overlap,
which is a scan, and merging would be work performed for no reader.

**`create` returns the event id and `move`/`cancel` take one.** The id is stored
on `appointments.provider_event_id` ([§2.4](#24-data-model)/005) and handed back on the next call,
so the adapter is stateless between operations. It holds no map from appointment
to event and therefore has nothing that can drift out of step with the row that
is authoritative.

**`signal` is a parameter, not something the adapter constructs.** [§2.6.1](#261-budget)
establishes one deadline per handler invocation and derives each step's signal
from what remains of it. An adapter that made its own timeout would be able to
overrun the handler's, which is exactly the failure the per-invocation deadline
exists to prevent ([§2.7.5](#275-timeouts-cancellation-and-the-absence-of-retry)).

**`NewEvent` carries `appointmentId`, and that is not a convenience.** It is the
idempotency key from which the Google event id is derived ([§2.7.4](#274-google-calendar-concretely)), which is what
makes the unwind in [§2.6.3](#263-booking-in-order) step 6 completable rather than best-guess.

### 2.7.2 One error at the boundary, eight classifications inside

**[F2.7a](Ringly_PRD_v3.md#f2-7a) is a requirement about the call site, not about the adapter.** Provider
outage, timeout, revoked consent and expired credentials must be
_indistinguishable to [§2.6](#26-the-call-path)_, because they have identical consequences: no
appointment is written, the caller is apologised to, an incident opens ([§2.6.4](#264-fail-closed-concretely)).
A `switch` on the cause in the booking path could only ever produce a second way
to reach the same outcome, and [R1](#r1) is what happens when that second way is subtly
different from the first.

**They are emphatically not indistinguishable to the adapter**, which must
refresh for one, mark a credential dead for another, and do nothing at all for a
third. So: one thrown type, carrying a classification that is **diagnostic, never
control flow**.

```ts
type CalendarFailure =
  | "unreachable" // socket error, DNS, TLS, or 5xx from the provider
  | "timed_out" // our AbortSignal fired first — slow is failed (N3.1)
  | "rate_limited" // 403 rateLimitExceeded / userRateLimitExceeded, or 429
  | "auth_expired" // 401 despite a token we believed current
  | "revoked" // refresh rejected: the grant is gone and will not return
  | "scope_missing" // the grant no longer covers calendar.events (F1.7a)
  | "event_gone" // the event we were asked to move is not there (R13)
  | "malformed"; // 400 — a Ringly bug, never the business's

class CalendarUnavailable extends Error {
  constructor(
    readonly failure: CalendarFailure,
    readonly businessId: string,
    readonly provider: ProviderName,
    readonly providerStatus: number | null, // HTTP status, when there was one
    options?: { cause?: unknown },
  ) {
    super(`calendar unavailable: ${failure}`, options);
  }
}
```

**What each classification costs, and who pays it:**

| Observed                                                                          | Classification  | What the adapter does about it                                                                                                                  | What [§2.6](#26-the-call-path) sees |
| --------------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Socket error, DNS failure, 5xx                                                    | `unreachable`   | Nothing. The provider is having a bad minute                                                                                                    | Refusal                             |
| `ctx.signal` aborted                                                              | `timed_out`     | Nothing. Abandons the in-flight request                                                                                                         | Refusal                             |
| 403 `rateLimitExceeded` / `userRateLimitExceeded`, 429                            | `rate_limited`  | Nothing on the call path; logged loudly, because it is an operational fact about Ringly, not about the business ([N7.3](Ringly_PRD_v3.md#n7-3)) | Refusal                             |
| 401 with a token we thought valid                                                 | `auth_expired`  | Evicts the cached access token so the next call refreshes                                                                                       | Refusal                             |
| Token endpoint returns `invalid_grant`                                            | `revoked`       | Stamps `revoked_at` ([§2.7.3](#273-credentials-and-the-token-lifecycle)) — the only durable write                                               | Refusal                             |
| `grantedScopes` lacks `calendar.events`, or 403 with an insufficient-scope reason | `scope_missing` | Stamps `revoked_at`, identically                                                                                                                | Refusal                             |
| 404 / 410 on `move`                                                               | `event_gone`    | Nothing. The owner deleted it in their own calendar ([R13](#r13))                                                                               | Refusal                             |
| 404 / 410 on `cancel`                                                             | —               | **Treated as success.** Gone is what cancel wanted                                                                                              | Success                             |
| 400                                                                               | `malformed`     | Operator alert. The request was wrong before it was sent                                                                                        | Refusal                             |

**The right-hand column has one value for eight rows, and that is the point.**
[F2.7a](Ringly_PRD_v3.md#f2-7a) is satisfiable only if it is structurally true rather than maintained by
discipline, so `CalendarUnavailable` carries no method for asking "was this
retryable" and [§2.6](#26-the-call-path) has no branch that could consume one.

**`cancel` returning success on 404 is the one asymmetry, and it is deliberate.**
`move` on a missing event fails because the caller asked for a new time and did
not get one; `cancel` on a missing event succeeds because the caller asked for
the slot to be free and it is. Modelling both as failure would refuse a caller
whose appointment the owner had already deleted by hand — which is [R13](#r13)'s
scenario, and turning it into an apology serves nobody.

**Where the classification does become durable is `calendar_incidents.last_error`
([§2.4](#24-data-model)/006).** The string written there is the classification plus the provider
status — `revoked` and `timed_out` want different operator responses, and the
incident row is the only place that distinction is worth money. It is written
after the handler has answered ([N3.2](Ringly_PRD_v3.md#n3-2)), with the incident transition, so nothing
here is on the caller's clock.

### 2.7.3 Credentials and the token lifecycle

**One row per business, and it holds exactly one secret.**
`scheduling_credentials(business_id pk, provider, encrypted_refresh_token,
granted_scopes, connected_at, revoked_at, last_ok_at)` ([§2.4](#24-data-model)/006). The refresh
token is encrypted at rest with AES-256-GCM under a key held in the environment
([N6.1](Ringly_PRD_v3.md#n6-1), [§2.14.2](#2142-security-and-compliance-n6)) and is decrypted into `Connection.refreshToken` for the duration
of one operation.

**The access token is never persisted, and that is a decision.** _(The PRD does
not settle it; [N6.1](Ringly_PRD_v3.md#n6-1) speaks only of refresh tokens.)_ It lives in a process-local
map, `business_id → { accessToken, expiresAt }`, on exactly the reasoning of
[§2.6.6.1](#2661-the-60-second-cache--avoiding-a-query-per-call): the application runs many instances, each warms independently, a cold
instance costs one token round trip, and a miss produces a slower answer rather
than a wrong one. Persisting it would put a second encrypted secret at rest, add
a column to 006, and buy a saving on a value that expires in an hour.

**Refresh is proactive, never a reaction to a 401.** The vendor's own client owns
it — `google.auth.OAuth2` from `googleapis`, per the project rule against
hand-rolling auth flows. The adapter sets `refresh_token` plus the cached
`expiry_date` on the client and the library refreshes ahead of the request when
the token is inside its eager-refresh threshold (`eagerRefreshThresholdMillis`,
which defaults to five minutes). The newly issued token is captured from the
client's `tokens` event and written back to the process map. **The `tokens` event
also carries a rotated refresh token when Google issues one**, and when it does,
the adapter re-encrypts and stores it — dropping a rotated refresh token is a
credential that dies silently a week later, which is [R2](#r2)'s failure mode arriving
by a second route.

**A 401 that arrives anyway is not retried.** `forceRefreshOnFailure` is left at
its default of `false`, so the library will not refresh-and-replay. This is not
a tuning choice: [§2.6.1](#261-budget) says nothing retries inside the handler, and a 401 that
survives a proactive refresh means the grant is gone, which a second attempt with
the same grant cannot fix. The cached token is evicted, `auth_expired` is thrown,
and the caller hears the standard apology.

**A refresh race between two concurrent calls is left to race.** Two tool calls
for one business — two turns of the same conversation, two callers at once, or
the same business on two instances — can both find the access token stale and
both refresh. **Nothing arbitrates this, deliberately.** Google issues a fresh
access token per request without invalidating the previous one, so both requests
proceed with valid credentials and the later writer to the process map wins; the
cost of the race is one redundant token request. The alternative — a Postgres
advisory lock keyed on `business_id` — would put a database round trip and a
serialisation point **inside the 5000ms provider budget on the call path**, to
prevent an outcome that is already correct. Paying latency on every booking to
avoid an occasional duplicate HTTP request is the wrong trade at 2.1.1's stakes.
_(Decision; the PRD does not address concurrency in the credential path.)_

**Permanent failure has exactly one signature: `invalid_grant`.** Google's token
endpoint answers `400 { "error": "invalid_grant" }` when the refresh token has
been revoked by the user, has expired unused, or was invalidated by the app
sitting in _Testing_ for more than seven days — which is [R2](#r2), and is why [R2](#r2) is a
launch blocker rather than a chore. It is terminal: there is no endpoint that
revives a revoked grant, and the only remedy is a fresh consent.

```
refresh fails with invalid_grant, or the grant no longer covers calendar.events
  └─ UPDATE scheduling_credentials
        SET revoked_at = now()
      WHERE business_id = $1 AND revoked_at IS NULL     -- idempotent; async (N3.2)
  └─ throw CalendarUnavailable("revoked" | "scope_missing", ...)
        └─ §2.6.4 opens the incident and emails, on its own terms
```

**`revoked_at` and the incident are two different facts and both are needed.**
The open incident says _customers are being turned away right now_ — it drives
the banner, the one email per incident ([F2.7](Ringly_PRD_v3.md#f2-7)) and the operator's "bookings
failing" row ([F8.12](Ringly_PRD_v3.md#f8-12)). `revoked_at` says _what the owner has to do about it_,
which is the difference between a banner that reports weather and a banner that
is actionable. [F5.18](Ringly_PRD_v3.md#f5-18) renders service state from current state and never from the
rollup, and a non-null `revoked_at` is what turns that block into "your calendar
is disconnected — reconnect it", with the reconnect control [F5.15](Ringly_PRD_v3.md#f5-15) owes and [F1.7b](Ringly_PRD_v3.md#f1-7b)
names.

**Reconnect is the same flow as first connect, minus the account.** It re-runs
[§2.5.1](#251-the-flow) steps 4–5: consent with every scope's reason stated before the redirect
([F1.7c](Ringly_PRD_v3.md#f1-7c)), then a check of the scopes _actually_ granted rather than assumed
([F1.7a](Ringly_PRD_v3.md#f1-7a)), because granular consent means a user can complete the dialog and still
withhold the calendar. On success the row takes a new
`encrypted_refresh_token` and `granted_scopes`, `connected_at` is re-stamped, and
`revoked_at` is cleared. **Clearing `revoked_at` does not close the incident** —
[§2.6.4](#264-fail-closed-concretely) owns that, and it closes on a successful _read_, which the calendar health
probe will perform within five minutes ([§2.2.2](#222-request-paths-and-background-work)). Two mechanisms, one each for the
two facts, and neither reaching into the other's state.

**The revoked business needs no special case anywhere.** Every subsequent
operation fails at the refresh, classifies as `revoked`, and attaches to the
already-open incident silently. The probe fails the same way and does not close
the incident, which is correct: nothing has been fixed.

**`last_ok_at` is written coarsely, and this is a decision the schema implies but
does not state.** [§2.6.4](#264-fail-closed-concretely) is explicit that no call writes on the happy path, so
stamping it on every successful read would contradict that directly. It is
therefore written after the response ([N3.2](Ringly_PRD_v3.md#n3-2)) and only when it is already stale:

```sql
UPDATE scheduling_credentials SET last_ok_at = now()
 WHERE business_id = $1 AND last_ok_at < now() - interval '15 minutes';
```

At most four writes an hour per business rather than one per call. The column
exists so an operator can answer "when did this credential last work" for a
business with no open incident and no recent calls; that question has never
needed minute precision, and buying it would cost a write per booking.

### 2.7.4 Google Calendar, concretely

**The target is always the authenticated identity's `primary` calendar.**
_(Decision: the PRD does not mention calendar selection.)_ [F1.7](Ringly_PRD_v3.md#f1-7) grants calendar
access in the same dialog as sign-in, so the Google identity _is_ the business,
and its primary calendar is the one the owner already looks at. A calendar picker
would be a screen in onboarding ([F1](Ringly_PRD_v3.md#f1--onboarding-and-identity) has none), a column in 006, and a support
question — for a choice a single-location business does not have. It is also what
lets `Connection` stay free of provider concepts ([§2.7.1](#271-the-interface-in-full)). The cost, recorded
honestly: a business that keeps bookings on a secondary calendar cannot be
served, and adding that later means a nullable column and a settings control,
not a redesign.

**Verified 2026-07-30 ([§2.17](#217-verified-vendor-capabilities)):** `calendar.events` is a **sensitive** scope
requiring verification; refresh tokens are revoked after seven days while the app
is in _Testing_ ([R2](#r2)); granular consent permits calendar to be declined
independently of sign-in ([F1.7a](Ringly_PRD_v3.md#f1-7a)).

| Operation      | Google API call | Failure that is not a failure |
| -------------- | --------------- | ----------------------------- |
| `availability` | `events.list`   | —                             |
| `create`       | `events.insert` | 409 on our derived id → adopt |
| `move`         | `events.patch`  | —                             |
| `cancel`       | `events.delete` | 404 / 410 → success           |

**`events.list`, not `freebusy`**, for three reasons that compound:

1. **`freebusy` returns opaque blocks with no event metadata** — no
   `transparency`, no `status`, no id. It cannot be asked to leave out an event
   the owner deliberately marked as free, so it would report a business busy
   during time it has told its own calendar it is available.
2. **`freebusy` merges overlapping intervals**, so the boundaries between two
   adjacent commitments are lost. Nothing in [§2.6](#26-the-call-path) needs them today; a design that
   throws them away before they are asked for cannot get them back.
3. **Event ids.** `move` and `cancel` need one, and the stored
   `appointments.provider_event_id` is the primary source — but when it has
   drifted ([R13](#r13): the owner recreated the event by hand), `events.list` is the
   only surface that could recover it. `freebusy` closes that door permanently.

**`availability` — the query:**

```ts
calendar.events.list(
  {
    calendarId: "primary",
    timeMin: window.startsAt.toISOString(), // lower bound on event END
    timeMax: window.endsAt.toISOString(), // upper bound on event START
    singleEvents: true, // expand recurrences into instances
    orderBy: "startTime", // requires singleEvents
    showDeleted: false, // a cancelled event does not occupy a slot
    maxResults: 2500, // the documented per-page maximum
    timeZone: ctx.connection.timezone,
  },
  { signal: ctx.signal, retryConfig: { retry: 0 } },
);
```

**`timeMin` and `timeMax` read backwards from their names and it matters.**
`timeMin` bounds an event's _end_ and `timeMax` bounds its _start_, which is
precisely the definition of "overlaps the window" — an event that began before
the window and runs into it is returned, and that event is the one most likely to
be missed by a naive filter and most likely to cause a double booking.

**`singleEvents: true` is not optional.** Without it the API returns the
recurring event's definition rather than its occurrences, and a business with a
weekly team meeting would have that hour reported busy exactly once, in the week
the series was created. Ringly does not create recurring events ([§1.4](Ringly_PRD_v3.md#14-scope)) but its
customers' owners certainly do.

**Busy intervals are derived by dropping two kinds of event and expanding a
third:**

| Event                                 | Treatment                                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `transparency === "transparent"`      | **Dropped.** Google defines transparent as "does not block time"                               |
| `status === "cancelled"`              | Dropped. Filtered server-side by `showDeleted: false`; re-checked in case                      |
| All-day (`start.date`, no `dateTime`) | Expanded to `[startOfDay(date, tz), startOfDay(date + 1, tz))` ([N5.2](Ringly_PRD_v3.md#n5-2)) |
| Everything else                       | `[start.dateTime, end.dateTime)`                                                               |

**`transparency` is the whole filter, and no `eventTypes` filter is applied.**
Working-location events are _required_ by Google to carry
`transparency: "transparent"`, so they fall out for free; focus-time and
out-of-office events are `opaque` and correctly block, which is what their owner
intended. Filtering by `eventTypes` instead would be an allow-list, and an
allow-list that omits a type Google adds next year silently starts double-booking
— the failure runs in the unsafe direction, so the design does not use one.

**All-day events are expanded in the business's timezone, not the server's**
([N5.2](Ringly_PRD_v3.md#n5-2)). A public holiday on the owner's calendar is a `date`, and rendering it as
UTC midnight would leave the first hours of the business's day bookable in
UTC+0 territories and block the last hours of the previous day in UTC−8 ones.

**Pagination is followed, and a partial result is never returned.** If
`nextPageToken` comes back the adapter follows it under the same
`ctx.signal`, so a calendar dense enough to need a second page spends the same
budget and, if it exhausts it, times out into the ordinary refusal. **A truncated
busy set is the one result this method must never produce**, because a missing
interval is not a slower answer, it is a double booking — 2.1.1 with extra steps.
In practice the window is the caller's `{ from, to }` from `check_availability`
([§2.6.2.2](#2622-tool-call)), bounded above by `booking_horizon_days` ([F2.9](Ringly_PRD_v3.md#f2-9)), and 2500 events
inside it is not a business Ringly serves.

**`create` — the insert:**

```ts
calendar.events.insert(
  {
    calendarId: "primary",
    requestBody: {
      id: derivedEventId(event.appointmentId), // see below
      summary: `${event.serviceName} — ${event.customerName}`,
      description: `Phone: ${event.customerPhone}\nBooked by Ringly`,
      start: { dateTime: iso(event.startsAt), timeZone: tz },
      end: { dateTime: iso(event.endsAt), timeZone: tz },
      transparency: "opaque", // explicit: a Ringly booking blocks the slot
    },
  },
  { signal: ctx.signal, retryConfig: { retry: 0 } },
);
```

**The event id is supplied by Ringly, derived from `appointments.id`.** Google
accepts a caller-chosen id in base32hex — lowercase `a`–`v` and `0`–`9`, 5 to
1024 characters — so the appointment's UUID re-encoded into that alphabet is a
legal id and a deterministic one. It buys the thing [§2.6.3](#263-booking-in-order)'s unwind actually
needs: **after a `timed_out` insert, Ringly can address the event it may or may
not have created without having been told its id.** [§2.6.3](#263-booking-in-order) step 6 deletes the
local appointment and refuses; the compensating `events.delete` on the derived id
is issued after the response ([N3.2](Ringly_PRD_v3.md#n3-2)) and is a no-op if the insert never landed,
because 404 on cancel is success. A 409 on the insert means a previous attempt
did land, and the adapter adopts that event rather than creating a second one.

That is a genuine improvement on the alternative and it does not close the hole
entirely, which is worth stating plainly: **if the compensating delete also
fails, the business keeps a calendar event for an appointment that does not
exist.** That is the safe direction of wrong — a phantom hold refuses a slot
rather than double-booking it, and the owner can see and delete it in their own
calendar — but it is a residual, and it belongs next to [R13](#r13) rather than being
counted as solved.

**Derived from the appointment id, never from the slot.** Google does not
immediately free the id of a deleted event, so an id derived from
`(business, time)` would collide permanently after the first cancellation of that
slot. The appointment UUID is fresh per booking and has no such problem.

**No attendees, ever.** Adding the caller would require an email address Ringly
does not hold (`customers` is name and phone, [§2.4](#24-data-model)/005) and would open a channel
to the calling customer that 2.1.2 forbids the design to grow. It also means no
invitation mail is sent, so `sendUpdates` is moot.

**`move` uses `events.patch` and sends only `start` and `end`.** `events.update`
is a full replacement and would silently discard anything the owner had added to
the event — a note, a location, a colour, a second attendee they invited
themselves. **`events.move` is a different operation entirely** (it moves an
event between calendars) and is named here only so nobody reaches for it by
autocomplete. 404 or 410 classifies `event_gone` ([R13](#r13)).

**`cancel` uses `events.delete`**, not a patch to `status: "cancelled"`. A
deleted event leaves the owner's view; a cancelled one remains as a struck-through
entry they then have to tidy up. 404 and 410 are success ([§2.7.2](#272-one-error-at-the-boundary-eight-classifications-inside)).

**[F5.12](Ringly_PRD_v3.md#f5-12) is upheld by omission, not by a filter.** Events the owner created
directly are read for conflicts and are never written to `appointments`, so
nothing in the rollups ([§2.9.2](#292-the-rollup)) can see them. There is no code that excludes
them from Ringly's figures, because there is no path by which they could enter.

### 2.7.5 Timeouts, cancellation, and the absence of retry

**The 5000ms provider ceiling from [§2.6.1](#261-budget) is enforced by the caller and honoured
by the adapter.** [§2.6](#26-the-call-path) constructs
`AbortSignal.timeout(Math.min(5000, deadline - Date.now()))` and passes it in as
`ctx.signal`; the adapter threads that one signal through **every** HTTP request
the operation makes.

**Including the token refresh, which is the part that is easy to get wrong.** An
operation that needs a refresh makes two requests, and if each got its own
5000ms the provider step could take ten seconds and blow the 6000ms handler
ceiling that [F2.6](Ringly_PRD_v3.md#f2-6)'s filler speech is sized against ([N3](Ringly_PRD_v3.md#n3--latency-on-the-call-path)). One signal for the whole
operation means a refresh spends budget that the calendar call then does not
have, which is the correct accounting: the caller is waiting for the operation,
not for its steps.

```
tool webhook arrives            deadline = Date.now() + 6000        (§2.6.1)
  ├─ local checks 1–3                                               ~ms
  ├─ signal = AbortSignal.timeout(min(5000, deadline - now()))
  ├─ availability(ctx, window)
  │    ├─ refresh token if inside the eager threshold   ← same signal
  │    └─ events.list (+ any pages)                     ← same signal
  └─ abort → CalendarUnavailable("timed_out") → refuse (N3.1)
```

**`AbortSignal` reaches the wire through the vendor's own option, not through a
race with a timer.** `googleapis` method options extend gaxios's, so
`{ signal }` on the second argument aborts the underlying request rather than
merely abandoning a promise that keeps running. A `Promise.race` against a
`setTimeout` would leave the request in flight, holding a socket and eventually
resolving into nothing — which at [N2.1](Ringly_PRD_v3.md#n2-1)'s volumes is how a slow provider turns
into an exhausted connection pool.

**Client-library retry is switched off explicitly** — `retryConfig: { retry: 0 }`
on every request. gaxios retries 429 and 5xx when retries are enabled, and
whether they are enabled by default in the pinned version is a five-minute check
that the code makes irrelevant by setting it either way. A retry the caller did
not ask for is still a retry inside the caller's budget, and [§2.6.1](#261-budget) forbids it:
inside six seconds a second attempt either does not fit or doubles the tail, and
the caller is waiting through both.

**Nothing retries, not even on 429, and this is a deliberate departure from the
vendor's guidance.** Google's error documentation recommends exponential backoff
for 403 rate-limit, 429 and 5xx. Ringly does not follow it here, because backoff
is advice for a batch job and the caller is on the phone. **The retry that exists
is the caller ringing back** ([F2.7](Ringly_PRD_v3.md#f2-7)) and **the calendar health probe** ([§2.2.2](#222-request-paths-and-background-work)),
which re-reads every five minutes off the call path and closes the incident when
the provider recovers — so an outage that ends at 8pm clears the banner at 8pm
rather than waiting for the next customer.

**A sustained `rate_limited` is an operational fact about Ringly, not about the
business**, and [N7.3](Ringly_PRD_v3.md#n7-3) requires it to be alerted rather than absorbed. It means the
project's quota is undersized for the traffic, and no amount of backoff on the
call path fixes that.

### 2.7.6 What a second provider costs, and where this interface breaks

**The interface is shaped by what comes next, in priority order** ([F4.4](Ringly_PRD_v3.md#f4-4)):
Microsoft 365 / Outlook, then CalDAV for Apple and Fastmail, then vertical
booking systems such as Square Appointments, Acuity and Calendly.

**The first two fit the four operations as they stand.** _The mappings below are
sketched from each vendor's documented surface and have **not** been verified to
[§2.17](#217-verified-vendor-capabilities)'s standard — only Google was, on 2026-07-30. They are a sizing estimate,
not a specification._

| Operation      | Google          | Microsoft 365 (Graph)                                                             | CalDAV                                                        |
| -------------- | --------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `availability` | `events.list`   | `GET /me/calendarView` with `startDateTime` / `endDateTime` (expands recurrences) | `REPORT` `calendar-query` with a `VEVENT` `time-range` filter |
| `create`       | `events.insert` | `POST /me/events`                                                                 | `PUT` an `.ics` at a client-chosen href                       |
| `move`         | `events.patch`  | `PATCH /me/events/{id}`                                                           | `PUT` the revised `.ics` with `If-Match: <etag>`              |
| `cancel`       | `events.delete` | `DELETE /me/events/{id}`                                                          | `DELETE` the href                                             |

**Three things a new provider must supply beyond the four methods**, and only the
first is free:

1. **A classification function from its own error surface onto `CalendarFailure`
   ([§2.7.2](#272-one-error-at-the-boundary-eight-classifications-inside)).** This is the work, and it cannot be shared. Graph reports a revoked
   grant differently from Google, and CalDAV reports it as a 401 that looks
   exactly like every other 401 — so `revoked` versus `auth_expired` becomes a
   judgement the adapter has to make from repetition rather than from a distinct
   error code. Getting it wrong in one direction leaves the reconnect control
   hidden while a business is refusing every caller; wrong in the other, a
   transient blip marks a healthy credential dead.
2. **A credential lifecycle that maps onto 006's three states** — valid,
   refreshable, terminally revoked. Graph does this with OAuth refresh tokens and
   fits directly. **CalDAV has no refresh token at all**: it authenticates with a
   username and an app-specific password, so `encrypted_refresh_token` holds a
   long-lived secret and the column name lies. That is a rename, not a redesign,
   and the honest time to note it is before the column has been read by twelve
   call sites.
3. **An event identifier that survives the owner editing the event.** Google's
   id does. Graph offers immutable ids behind a request header
   (`Prefer: IdType="ImmutableId"`), which a Graph adapter should opt into rather
   than storing the default id. **CalDAV's identity is the href plus the `UID`,
   and its `ETag` changes on every edit** — so `provider_event_id` must hold the
   href, and the etag must be fetched at write time for `If-Match` rather than
   stored. A CalDAV adapter that stored an etag as its event id would break the
   first time the owner moved the appointment by five minutes.

**The third group is where this interface is expected to need a second shape.**
A vertical booking system owns the appointment rather than storing an event, and
that changes four things at once:

- **`create` stops returning an identifier for a record Ringly owns** and starts
  returning _their_ booking. Two systems then hold an appointment and both
  believe they are authoritative, and the question "what is this appointment"
  has two answers. [§2.4](#24-data-model)/005's `provider_event_id` — a pointer from Ringly's row
  to a subordinate calendar entry — no longer describes the relationship.
- **Service becomes a foreign key, not a string.** `NewEvent.serviceName` works
  because a calendar event's title is free text. Square and Acuity have their own
  service catalogue with their own ids, durations and prices, so [F3.1](Ringly_PRD_v3.md#f3-1)'s Ringly
  catalogue turns into a mapping problem and [F3.4](Ringly_PRD_v3.md#f3-4)'s pricing has a second source.
- **They enforce availability rules Ringly cannot see** — staff rosters,
  inter-appointment buffers, resource limits, per-service lead times. This is the
  actual break: **a busy/free interface cannot express "this slot is bookable, but
  only by Sam, and only once the previous customer's fifteen-minute buffer
  clears".** The right question inverts from _what time is occupied_ to _what can
  I book_.
- **They may confirm to the customer themselves**, by SMS or email. [§1.4](Ringly_PRD_v3.md#14-scope) and
  2.1.2 say Ringly has no channel to the caller and [F2.11](Ringly_PRD_v3.md#f2-11) makes the agent reading
  it back the entire confirmation. A vertical system would hand Ringly that
  channel whether it wanted it or not, and deciding what to do about it is a
  product change, not an adapter.

**The eventual second shape is `slots(window) → bookable slots` plus
`book(slot) → booking`**, with slot derivation moved from [§2.6](#26-the-call-path) into the provider.
Google, Graph and CalDAV can all implement it — by deriving slots from busy
intervals, opening hours and duration, which is what [§2.6.3](#263-booking-in-order) does today — so the
migration is a rewrite of the boundary between [§2.6](#26-the-call-path) and [§2.7](#27-scheduling-providers), not a third
implementation behind the current one.

**It is deliberately not built now.** [F4.2](Ringly_PRD_v3.md#f4-2) makes Google the only provider at
launch, [R9](#r9) puts switching provider out of scope, and building the general shape
against one implementation would be guessing at the constraints of a vendor
nobody has integrated. **[R5](#r5) — provider capability mismatch — is the risk that
carries this**, and it is declared rather than assumed. Recording the break here
means the eventual redesign is a known cost with a known trigger, not a surprise
in the middle of a sales conversation.

**Testing this section**

_Observable_ — that a booking appears in the connected calendar with the right
time and duration; that an event created directly by the owner is respected for
conflicts but never appears in Ringly's figures ([F5.12](Ringly_PRD_v3.md#f5-12)); that all failure modes
refuse identically; what the dashboard's status block says and which control it
offers; whether an event survives a reschedule as one event.

_Internal_ — the interface's method names and type definitions, the vendor, the
API surface and its query parameters, the error class and its classifications,
token storage, the refresh threshold, the derived event id, the timeout values.

_Behaviours owed to the catalogue_

- A booking appears in the business's own calendar with the right time and
  duration.
- An event the owner created directly blocks that slot for callers.
- That same event never appears in the business's Ringly figures.
- Rescheduling moves the provider's event rather than creating a second one.
- Cancelling removes it.
- Revoked consent surfaces a reconnect control on the dashboard.
- An event the owner marked "free" in their own calendar does not block a caller
  from booking that time.
- An all-day event on the owner's calendar blocks the whole of that day in the
  business's own timezone, not in UTC.
- A recurring event on the owner's calendar blocks every one of its occurrences,
  not only the first.
- An event that starts before the requested window and runs into it still blocks
  the slot.
- Cancelling an appointment the owner had already deleted by hand succeeds and
  tells the caller so.
- Rescheduling onto an appointment the owner deleted by hand is refused like any
  other calendar failure.
- A reschedule preserves a note the owner added to the event themselves.
- A provider that never answers refuses the booking at the ceiling and writes no
  appointment, and the caller is not left waiting past it.
- A provider that answers slowly but inside the ceiling still books.
- An expired access token is refreshed without the caller noticing.
- Revoked consent refuses the booking, is recorded once, and shows the owner what
  to do about it — not merely that something is wrong.
- Reconnecting a revoked calendar makes the next caller's booking succeed and
  clears the banner without anyone pressing anything else.
- A calendar that is unreachable, slow, revoked, out of scope or rate-limited
  produces the same refusal and the same apology.
- A booking that times out after the calendar event was created leaves no
  appointment, and does not leave the caller booked.
- Nothing the provider does causes a second attempt within one call.

---

## 2.8 Catalogue and opening hours

[F3](Ringly_PRD_v3.md#f3--service-catalogue-and-opening-hours), and it is mostly about time.

**A change is written on save and is authoritative from that moment** ([F3.5](Ringly_PRD_v3.md#f3-5)).
No draft, no review, no operator step. The only bound is the ≤60s the agent may
take to see it ([F3.2](Ringly_PRD_v3.md#f3-2), [§2.6.6](#266-configuration-on-the-call-path)).

**Price and duration resolve at different moments** ([F3.4](Ringly_PRD_v3.md#f3-4)), which is why
`service_versions` exists:

- **Price** — the version in force **at the appointment's start time**, because
  these businesses charge after the appointment happens.
- **Duration** — copied onto the appointment **at booking** and never revisited.

A worked consequence: a business raises a haircut from $40 to $45 on the 10th.
An appointment booked on the 5th for the 15th is worth $45. An appointment
booked on the 5th for the 8th is worth $40. Neither changes length, and neither
overlaps its neighbours.

**Narrowing hours never moves or cancels an existing appointment** ([F3.5](Ringly_PRD_v3.md#f3-5)). A
time was agreed with a customer Ringly has no way to contact (2.1.2), so
breaking it silently is worse than honouring it. Widening makes new slots
bookable immediately.

**Timezone is not self-serve** ([F3.6](Ringly_PRD_v3.md#f3-6)). It is resolved once at onboarding and
changing it re-interprets every stored instant and every billing boundary, so it
is an operator action.

**Testing this section**

_Observable_ — what the catalogue shows and in what order; what a caller is
offered and quoted; what an existing appointment is worth and how long it is.

_Internal_ — the versioning tables, effective-date resolution, the save path.

_Behaviours owed to the catalogue_

- A service added, edited, deactivated or reordered is reflected for the next
  caller, in the order chosen.
- A deactivated service is not offered but its existing appointments are intact.
- An appointment's value follows the price in force when it happens, not when it
  was booked.
- An appointment's duration does not change when the service is re-timed.
- Widening hours makes a previously refused slot bookable; narrowing them refuses
  new bookings and leaves existing ones alone.
- A business cannot change its own timezone.

---

## 2.9 Analytics and the two dashboards

One pipeline, two readers ([F5](Ringly_PRD_v3.md#f5--business-dashboard), [F8](Ringly_PRD_v3.md#f8--operator-dashboard-ringly-internal)). [F8.7](Ringly_PRD_v3.md#f8-7) requires the operator's dashboard to
follow the same freshness rule as the business's, so there is one rollup and one
explanation rather than two.

### 2.9.1 Outcome classification

An outcome is a judgement — "did the caller get what they rang for" is not
mechanically derivable from a transcript — so it is produced by a model. Every
decision below follows from three constraints: it must not touch the call path,
Ringly stores no transcripts ([F9.6](Ringly_PRD_v3.md#f9-6)), and an unclassified call must be safe
([§2.9.1.4](#2914-failure-is-safe-by-construction)).

#### 2.9.1.1 Where it runs

Not on the call path, not in the post-call webhook.
The webhook writes the call row with `outcome = null` and returns. Classification
is a **batch job** submitted by the classification worker ([§2.2.2](#222-request-paths-and-background-work)), hourly.

Batching rather than one request per call, for three reasons: the Message Batches
API is **50% cheaper** than the same requests made individually; outcomes are not
needed until the nightly rollup, so latency is irrelevant; and one submission per
business-hour is far kinder to rate limits than a request per call.

#### 2.9.1.2 The call

Anthropic's Messages API via `@anthropic-ai/sdk`, already a dependency.

```ts
await client.messages.batches.create({
  requests: unclassified.map((call) => ({
    custom_id: call.id, // §2.9.1.5
    params: {
      model: policy.classifierModel, // "claude-haiku-4-5"
      max_tokens: 256,
      output_config: {
        format: { type: "json_schema", schema: OUTCOME_SCHEMA },
      },
      system: rulesetPrompt(policy),
      messages: [{ role: "user", content: fullTranscript }],
    },
  })),
});
```

**`claude-haiku-4-5`.** Five mutually exclusive labels against a transcript that
already contains the answer is the shape Haiku is for, and the cheapest model
that can do a job correctly is the right one when the job runs on every call. The
id is a **`pricing_policy` column, not a constant** ([F6.15](Ringly_PRD_v3.md#f6-15)), so moving up a tier
if labels disappoint is a configuration change and a cost decision, not a deploy.

**The whole transcript goes, never an excerpt.** Whether a caller got what they
rang for is frequently settled in the last few turns — a booking agreed and then
abandoned, an enquiry that became a reschedule. Truncating to save tokens would
trade away the thing being measured for a rounding error: at Haiku's batch rate a
1,500-token transcript costs about a tenth of a cent, and Haiku 4.5's 200K
context makes even a very long call a non-issue.

**Two request-shape details are specific to Haiku 4.5 and easy to get wrong:**

- **No `output_config.effort`.** Effort is not supported on Haiku 4.5 and sending
  it is a `400`. Depth is not a lever here; the schema is.
- **No `thinking` field.** Haiku 4.5 predates adaptive thinking, so omitting the
  parameter already means no thinking — which is what a five-way classification
  wants. `{type: "adaptive"}` would be a `400`;
  `{type: "enabled", budget_tokens: N}` would work and would be waste.

#### 2.9.1.3 The schema is the contract

Structured outputs (`output_config.format`)
constrain the response, so there is no parsing of prose and no regex:

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "required": ["outcome", "confidence"],
  "properties": {
    "outcome": {
      "enum": ["booked", "rescheduled", "cancelled", "enquiry_only", "dropped"],
    },
    "confidence": { "enum": ["high", "low"] },
  },
}
```

Five values and no sixth: the enum is generated from the same policy row that
renders the dashboard's definitions panel ([§2.9.4](#294-the-business-dashboard)), so a ruleset change moves the
prompt, the schema, and the business's explanation together or moves none of them.

**Prompt caching is deliberately not used, and the reason is a number.** The
ruleset system prompt is byte-identical across every request — the ideal shape
for caching — but **Haiku 4.5's minimum cacheable prefix is 4,096 tokens** and
the ruleset is a few hundred. A `cache_control` marker below that floor does not
error; it silently does nothing and reports `cache_creation_input_tokens: 0`.
Padding a prompt to reach the floor would cost more than the cache saves.

Written down because it is exactly the kind of thing someone "fixes" by adding
the marker back. If the classifier ever moves to a model whose floor it clears —
512 tokens on Opus 5, 1,024 on Sonnet — caching becomes worth adding and the cost
figures below change.

#### 2.9.1.4 Failure is safe by construction

Six things can go wrong and all six
land in the same place: **the call stays unclassified, and an unclassified call is
not billed** ([F6.6](Ringly_PRD_v3.md#f6-6)).

| Failure                               | Detected as                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| The batch has not returned yet        | `processing_status !== "ended"`                                                                          |
| One request errored                   | `result.type === "errored"`                                                                              |
| The batch expired (24h ceiling)       | `result.type === "expired"`                                                                              |
| Safety classifiers declined           | `stop_reason === "refusal"` — schema not honoured on a refusal, so check this **before** reading content |
| The transcript is past its 30-day TTL | Provider fetch 404s — the call is permanently unclassifiable ([F9.7](Ringly_PRD_v3.md#f9-7))             |
| `stop_reason === "max_tokens"`        | Truncated JSON; retry once, then leave it                                                                |

**This fails in the business's favour, deliberately** ([R23](#r23)). The alternative —
guessing an outcome — bills a business for a call that may have been an enquiry,
and a billing error costs more trust than a missing bar on a chart.

#### 2.9.1.5 Idempotency and ordering

`custom_id` is the call id, and **batch
results arrive in arbitrary order** — they are keyed by `custom_id`, never by
position. Ingestion is a conditional update:

```sql
UPDATE calls SET outcome = $2, outcome_ruleset_version = $3, classified_at = now()
 WHERE id = $1 AND outcome IS NULL
```

so re-reaping a batch, or a call somehow appearing in two batches, cannot
reclassify it. Submission selects `WHERE outcome IS NULL AND classified_at IS NULL`
and records the batch id, so the same call is not resubmitted while a batch
holding it is in flight.

#### 2.9.1.6 The transcript is fetched, used, and dropped

Ringly stores neither
transcripts nor recordings ([F9.6](Ringly_PRD_v3.md#f9-6)). The worker fetches each transcript from the
telephony provider at submission time, sends it, and never writes it anywhere.
The only durable residue of a transcript is a five-value enum.

That is also why classification cannot be deferred indefinitely: the provider's
retention is 30 days ([F9.6](Ringly_PRD_v3.md#f9-6)), after which the input no longer exists. An hourly
cadence leaves ~700 hours of margin.

#### 2.9.1.7 Cost, and where it lands

Haiku 4.5 is $1.00 / $5.00 per MTok; the Batch API halves both to **$0.50 /
$2.50**. A representative call — a ~1,500-token transcript, a ~600-token ruleset,
a ~30-token answer:

|                              | Tokens |         Rate |          Cost |
| ---------------------------- | -----: | -----------: | ------------: |
| Input (transcript + ruleset) |  2,100 | $0.50 / MTok |      $0.00105 |
| Output (the JSON object)     |     30 | $2.50 / MTok |      $0.00008 |
| **Per classified call**      |        |              | **≈ $0.0011** |

A business taking 100 calls in a period spends about **12 cents** of
classification against its $100. Two comparisons give it scale: it is roughly
**1% of what the same call costs in telephony**, and across [N2.1](Ringly_PRD_v3.md#n2-1)'s 10⁴ tenants it
is a four-figure annual line rather than a rounding error.

**It is attributed per business** ([F8.5](Ringly_PRD_v3.md#f8-5)): written to `cost_records` with source
`classifier` alongside `telephony`, and reflected in the operator's cost and
margin columns ([§2.9.5](#295-the-operator-dashboard)). Small is not the same as invisible — a cost nobody
attributes is a cost nobody notices growing, and this one grows with call volume,
which is precisely the axis the margin table exists to watch.

#### 2.9.1.8 What is not tested here

Whether the model labels a real transcript
correctly is a model evaluation with its own dataset, not a scenario ([§2.15.6](#2156-what-the-suite-cannot-prove)).
The behaviour suite fakes the classifier and injects labels, so everything
downstream of the label stays deterministic.

#### 2.9.1.9 Definitions never rewrite history

Historical calls are **not**
reclassified when a ruleset changes ([F5.8](Ringly_PRD_v3.md#f5-8)) — transcripts are gone, so outcomes
cannot be re-derived. Each call keeps the `outcome_ruleset_version` it was
labelled under and the dashboard says the figures are not comparable across the
change.

### 2.9.2 The rollup

Nightly, per business, in that business's timezone ([N5.2](Ringly_PRD_v3.md#n5-2)). It writes one
`daily_call_rollups` row per business per day: counts, durations, appointments
booked, revenue booked, and the 5 × 6 outcome-by-window matrix.

**This is what makes [N4.3](Ringly_PRD_v3.md#n4-3) and [F5.14](Ringly_PRD_v3.md#f5-14) achievable at 10,000 tenants.** A dashboard
that scanned raw calls would degrade with total platform volume, which [N2.2](Ringly_PRD_v3.md#n2-2)
forbids.

**A day can be rolled up before all of its outcomes exist**, because
classification is batched and asynchronous ([§2.9.1](#291-outcome-classification)). The rollup therefore records
`computed_at` and **recomputes any day holding a call whose `classified_at` is
later than that** — which is the reason the call carries the timestamp. Without
the rule, a call classified after its day was rolled up is counted in the totals
and missing from the outcome breakdown, and the two figures disagree permanently
with nothing on the page to explain why.

**The consequence is that today's calls are not shown**, and the dashboard must
say so in plain words ([F5.16](Ringly_PRD_v3.md#f5-16)): complete to a stated date, today appears
tomorrow. A business that has just taken a call, cannot find it, and is given no
explanation concludes the product is broken — and it will do that on day one,
when it is testing exactly this.

### 2.9.3 What is live, and why each one is

| Figure                      | Source      | Why                                                                                  |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| Call counts, outcomes       | Rollup      | Questions about shape and trend; a day old is fine                                   |
| **Median duration**         | **Live**    | Cannot be recovered from daily aggregates                                            |
| **Billing figures**         | **Live**    | A business asking what it owes is asking about now ([F5.10](Ringly_PRD_v3.md#f5-10)) |
| **Service status**          | **Live**    | "Is my phone being answered?" is never stale ([F5.18](Ringly_PRD_v3.md#f5-18))       |
| Operator money              | **Settled** | Only money actually received counts ([F8.8](Ringly_PRD_v3.md#f8-8))                  |
| Operator operational panels | **Live**    | They exist to prompt action today ([F8.7](Ringly_PRD_v3.md#f8-7))                    |

**Anything live is labelled live**, so the two kinds of figure are never read as
one ([F5.16](Ringly_PRD_v3.md#f5-16)).

### 2.9.4 The business dashboard

Three things, in this order ([F5](Ringly_PRD_v3.md#f5--business-dashboard)):

**(a) The shape of the calls.** Two filters govern the whole page — unit
(calendar month or billing period) and range (current / past 3 / 6 / 12), and no
arbitrary date picker ([F5.2](Ringly_PRD_v3.md#f5-2)). Five tiles ([F5.3](Ringly_PRD_v3.md#f5-3)), one chart ([F5.4](Ringly_PRD_v3.md#f5-4)), three trends
([F5.5](Ringly_PRD_v3.md#f5-5)).

**The one chart is one measure and two dimensions** ([F5.4](Ringly_PRD_v3.md#f5-4)). Its measure is the
number of calls. Its dimensions are time of day and outcome, and **one groups
while the other filters, with the business choosing which way round** ([F5.4b](Ringly_PRD_v3.md#f5-4b)).
The 5 × 6 matrix in [§2.4](#24-data-model)/009 serves both configurations from the same row, which
is why it is stored as a matrix rather than as two count arrays.

**(b) Billing history.** One table, not a chart — minutes and money are
different units and a single plot with two axes is the one construction that
reliably misleads ([F5.9](Ringly_PRD_v3.md#f5-9)). The current period is the first row of that same
table, live, not a separate panel beside it.

**(c) Service status and controls.** Status at the top, never stale ([F5.18](Ringly_PRD_v3.md#f5-18)).
Controls per F5.15.

**Every outcome definition is shown on the page itself**, in plain language, next
to the figures it governs ([F5.7](Ringly_PRD_v3.md#f5-7)) — a business must never have to guess what
"dropped" counts. **If a definition changes, the dashboard says so prominently**
([F5.8](Ringly_PRD_v3.md#f5-8)) and states that figures before and after are not directly comparable.
Historical calls are not reclassified ([§2.9.1](#291-outcome-classification)). The definitions render from the
policy row rather than from hardcoded copy, so one change moves both the figures
and the explanation.

**Every money figure states whether it is settled** ([F5.17](Ringly_PRD_v3.md#f5-17)). A charge that has
cleared, one still accruing and one that failed are three different kinds of
number, and rendering them identically invites a business to plan around one that
has not happened:

| State           | Means                                                 |
| --------------- | ----------------------------------------------------- |
| **Settled**     | Money that moved — closed periods, completed charges  |
| **Accruing**    | The current period's running total, certain to change |
| **Outstanding** | Invoiced and not paid, whether in grace or suspended  |

The same rule governs the operator dashboard, where it matters more: revenue
there counts only money actually received, and a figure that quietly mixed in
what is merely invoiced would misstate the business Ringly is in.

**Aggregate only, always** ([F5.11](Ringly_PRD_v3.md#f5-11)). No transcripts, no recordings, no
per-customer breakdown — Ringly stores no call content ([F9.6](Ringly_PRD_v3.md#f9-6)) and cannot
reliably identify a customer.

### 2.9.5 The operator dashboard

**The main view is money and it is a table** ([F8.2a](Ringly_PRD_v3.md#f8-2a)) — one row per business,
revenue, cost, margin, sortable. With thousands of businesses no chart
distinguishes them; a table sorted by margin puts the ones losing money on top,
which is the question the operator actually has.

**Reported by calendar month, not by each business's 30-day period** ([F8.8](Ringly_PRD_v3.md#f8-8)). No
two businesses share a period, so per-period figures cannot be summed into
anything an accountant can use. **Only money actually received counts as
revenue, and only real incurred cost counts as cost** — neither is accrued nor
projected.

**Cost model v1 is two lines, both per business per call** ([F8.5](Ringly_PRD_v3.md#f8-5)): **telephony
and the voice agent** — number rental plus per-call charges including the agent's
own LLM — and **outcome classification** ([§2.9.1.7](#2917-cost-and-where-it-lands), ≈$0.0011/call). Separate
vendors, separate meters; collapsing them would hide the one that grows fastest
with volume.

Deliberately excluded — the database and application host (fixed overhead,
immaterial per tenant, and the host is not yet chosen) and Places (one-off at
onboarding, covered by the first $100). A cost line is added when something new
is billed per business, not in advance of it.

**Two filters govern the page** ([F8.2](Ringly_PRD_v3.md#f8-2)): a range — current calendar month, past 3,
6 or 12 — and a business selector listing every business active in that range,
from which the operator picks one, several, or all.

**Two charts, and only two** ([F8.2b](Ringly_PRD_v3.md#f8-2b)). Margin over time, one column per calendar
month, with a **zero baseline**, because margin can go negative ([R8](#r8)) and a losing
month must not render as merely a shorter bar. And calls by outcome and time of
day, grouping by one and filtering the other exactly as [F5.4b](Ringly_PRD_v3.md#f5-4b) does for the
business — served from the same 5 × 6 matrix, summed across the selected
businesses instead of one.

**No per-business call, duration or outcome columns in the money table**
([F8.2c](Ringly_PRD_v3.md#f8-2c)). Those are questions about one business and are answered by opening that
business's own dashboard, one click away and in the form the business itself
sees. The aggregate chart stays, because it answers a different question — how
calls behave across the platform — that opening one dashboard at a time cannot.

**Three operational panels, all live** ([F8.7](Ringly_PRD_v3.md#f8-7)): payment reliability per business
([F8.3](Ringly_PRD_v3.md#f8-3)), so irregular payers are visible at a glance; the needs-attention queue
([§2.12](#212-the-operator-surface)); and **rented numbers that are not earning** ([F8.9](Ringly_PRD_v3.md#f8-9)) — held for businesses
that never activated, are suspended, or are otherwise not paying the $100
minimum. Each is a standing cost with no revenue against it. They are live rather
than rolled up because they exist to prompt action today, and a business whose
calendar broke this morning must not first appear tomorrow.

**Platform totals across the selected range** ([F8.4](Ringly_PRD_v3.md#f8-4)): revenue, cost, margin, and
the number of active businesses.

**The same outcome definitions the business sees** ([F8.11](Ringly_PRD_v3.md#f8-11)), so both sides of a
support conversation are reading the same words.

**No per-customer figures anywhere** ([F8.2d](Ringly_PRD_v3.md#f8-2d)), for the same reason as F5.3.

**Testing this section**

_Observable_ — every figure on both dashboards; which are labelled live; the
date the figures are complete to; what the chart shows under each configuration;
the operator's money table and queue.

_Internal_ — the rollup table and its columns, the matrix encoding, when the
worker runs, the classifier's prompt and batching.

_Behaviours owed to the catalogue_

- A day's calls appear in the figures after the rollup, and the dashboard states
  the date it is complete to.
- Today's calls are absent and the dashboard says why.
- Median duration is live and labelled live; the tile figures are not.
- The chart grouped by outcome and filtered to a time window agrees with the same
  data grouped by window and filtered to that outcome.
- Calls are counted in the four-hour window of the business's local time, not
  UTC.
- An unclassified call is counted as a call, excluded from outcomes, and not
  billed.
- Changing an outcome definition does not reclassify history and the dashboard
  says so.
- Revenue booked is marked an estimate when the range contains future
  appointments.
- Appointments the owner created directly in their own calendar never appear.
- Two tenants' figures never mix.
- The operator's revenue counts only money received; a failed charge does not
  appear as revenue.
- Margin can be negative and renders as negative.
- Dashboard queries stay within budget with a large tenant present.

---

## 2.10 Billing

The most intricate part of the product, and the part where an error is a wrong
charge on a real card. [F6](Ringly_PRD_v3.md#f6--billing-and-payments) is long because the failure paths are; this section
follows the same order.

**How to read it.** [§2.10.1](#2101-states)–[§2.10.7](#2107-cancellation) are the rules and the code that implements
them; [§2.10.8](#2108-the-division-with-the-payment-provider) is the split with Stripe; [§2.10.9](#2109-the-stripe-object-lifecycle-end-to-end)–[§2.10.13](#21013-what-24-must-gain) are the mechanics those
earlier sections stand on — the Stripe object lifecycle, the webhook endpoint,
the transaction boundaries, the arithmetic, and what [§2.4](#24-data-model) has to gain before any
of it can be written. An implementer reading top to bottom will meet forward
references to those five; they are deliberate, because the rules are what the
mechanics are answerable to and not the other way round.

### 2.10.1 States

A transition table rather than a diagram, because the side effects are the part
an implementation gets wrong:

| From         | Event                      | To           | Side effects                                                                                                                    |
| ------------ | -------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| —            | Onboarding commits         | `unbilled`   | `unactivated_deletion` deadline at +10d                                                                                         |
| `unbilled`   | **Activate pressed**       | `active`     | Charge $100, open period 1, bind agent, clear the deadline                                                                      |
| `unbilled`   | Day 10 elapses             | _deleted_    | Teardown ([§2.13.4](#2134-teardown-in-order))                                                                                   |
| `active`     | A charge fails             | `grace`      | `grace_expiry` +7d **and** `nonpayment_deletion` +60d, both from today                                                          |
| `grace`      | Nothing owed               | `active`     | Clear both deadlines                                                                                                            |
| `grace`      | Day 7 elapses              | `suspended`  | **Unbind the agent**, verified ([§2.5.3](#253-bind-and-unbind-are-verified-by-reading-provider-state-back)). No new charge ever |
| `suspended`  | Nothing owed               | `active`     | Rebind, email, open a period **only if none is running** ([F6.11b-iii](Ringly_PRD_v3.md#f6-11b-iii))                            |
| `suspended`  | Day 60 elapses             | _deleted_    | Teardown; debt recorded on the departure record                                                                                 |
| `active`     | Operator marks cancelled   | `cancelling` | `cancellation_window_close` at min(+7d, period end). Usage stops being billed                                                   |
| `cancelling` | **Operator marks revoked** | **`active`** | Clear the deadline; the window's usage **becomes billable again** ([F6.12a](Ringly_PRD_v3.md#f6-12a))                           |
| `cancelling` | Window closes              | `dormant`    | Settle early, clamp, stop service, closing statement, `dormancy_deletion` +60d                                                  |
| `dormant`    | Business returns           | `active`     | Rebind, open a new period, charge $100 that day ([F6.12e](Ringly_PRD_v3.md#f6-12e))                                             |
| `dormant`    | 60 days elapse             | _deleted_    | Teardown                                                                                                                        |

**Exactly four callers may write `businesses.billing_status`**, and naming them
is what keeps the table above a specification rather than a diagram someone
drew afterwards:

| Caller                                                           | Transitions it may cause                                   |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| The **activation route**                                         | `unbilled → active` — the only one, by 2.1.4               |
| `settleAndAdvance()` ([§2.10.3](#2103-settlement-and-the-clamp)) | `active → grace` on a decline                              |
| `reevaluate()` ([§2.10.6](#2106-coming-back))                    | `grace → active`, `suspended → active`                     |
| The **lifecycle sweeper**                                        | `grace → suspended`, `cancelling → dormant`, and deletions |

Operator controls ([§2.12](#212-the-operator-surface)) create and clear `lifecycle_deadlines` rows; the
sweeper is what turns those rows into transitions. **The operator never writes a
status directly**, because a control that both records an intention and effects
it is a control whose two halves can disagree.

**Every one of those writes is guarded on the state it expects**, so a repeated
worker tick or a redelivered webhook is a no-op rather than a second effect
([N2.3](Ringly_PRD_v3.md#n2-3), [§2.2.2](#222-request-paths-and-background-work)):

```sql
UPDATE businesses SET billing_status = 'grace'
 WHERE id = $1 AND billing_status = 'active'
RETURNING id;                 -- no row → somebody got here first; do nothing more
```

The `RETURNING` is load-bearing: the deadline rows, the email and the operator
alert are all conditional on a row coming back, exactly as [§2.6.4](#264-fail-closed-concretely) makes the
incident email conditional on the insert.

**`cancelling → active` is the transition most likely to be got wrong**, and it
is not the same as never having cancelled. Revoking makes the free usage served
during the window retroactively billable ([F6.12a](Ringly_PRD_v3.md#f6-12a)), so the transition rewrites
`usage_records.period_id` for the window's rows rather than merely clearing a
flag ([§2.10.7](#2107-cancellation)). A `cancelling → active` implemented as "unset cancelled" silently
gives the business a free week it was only ever lent.

**`grace` is not a state a business can be in twice for one debt.** The two
deadlines are created together at the first decline ([§2.4](#24-data-model)/008) and cleared
together when nothing is owed; a second decline while already in `grace` starts
no second clock ([F6.11c](Ringly_PRD_v3.md#f6-11c)). The `WHERE billing_status = 'active'` guard above is
what enforces it — the second decline's update matches nothing.

**`unbilled` is not a trial.** It is the state before any commercial relationship
exists. No path leads from it to `active` except the button (2.1.4).

**No test asserts on these names.** Every state above is observable through its
consequences — does the number answer, is anything owed, what arrived in the
inbox — and that is what the Testing block below permits.

### 2.10.2 A period

**Rolling 30 days from activation, never a calendar month, never extended**
([F6.11b](Ringly_PRD_v3.md#f6-11b)). `starts_on` and `ends_on` are written when the period opens and never
move.

**They are `date` columns, not timestamps, and that is the DST answer** ([N5.2](Ringly_PRD_v3.md#n5-2),
[§2.14.1](#2141-timezone-n5)). A period that opens on 3 March ends on 1 April in the business's own
timezone whether or not the clocks moved in between; a `timestamptz` boundary
would drift by an hour twice a year and [R14](#r14)'s "timezone changes re-interpret
every period boundary" would become true of ordinary daylight saving as well.
The instant a period ends is derived at read time:

```sql
(p.ends_on + 1)::timestamp AT TIME ZONE b.timezone   -- local midnight, ending ends_on
```

**Thirty days inclusive**: `ends_on = starts_on + 29`. Period 1 of a business
activating on the 3rd runs the 3rd to the 1st; period 2 opens on the 2nd.

**At most one period is open, and periods never overlap — both enforced by the
database, not by the worker** ([F6.11f](Ringly_PRD_v3.md#f6-11f), [I2](Ringly_PRD_v3.md#i2)). This is [§2.6.4](#264-fail-closed-concretely)'s argument applied to
money: forty concurrent calls could not be trusted to produce one incident row,
and two overlapping worker ticks cannot be trusted to produce one period.

```sql
CREATE UNIQUE INDEX one_open_period_per_business
    ON billing_periods (business_id) WHERE usage_settled_at IS NULL;

ALTER TABLE billing_periods ADD CONSTRAINT periods_never_overlap
  EXCLUDE USING gist (business_id WITH =,
                      daterange(starts_on, ends_on, '[]') WITH &&);
```

**"Open" is `usage_settled_at IS NULL` and nothing else.** There is deliberately
no boolean beside it: a settled period is finished ([F6.16](Ringly_PRD_v3.md#f6-16)) and a second column
saying so is a second thing that can be wrong. `billing_periods.status` earns its
place by recording **which** of [F6.9a](Ringly_PRD_v3.md#f6-9a)'s three moments closed the period —
`settled`, `settled_early`, `settled_at_deletion` — which is not derivable and
which the closing statement and the departure record both need.

**Opening a period is one statement and it is idempotent:**

```sql
INSERT INTO billing_periods
       (business_id, policy_id, starts_on, ends_on, fixed_fee_state,
        billable_seconds, usage_charge_cents, total_cents, was_suspended_during)
SELECT $1, $2, $3::date, $3::date + 29, 'pending', 0, 0, 0, false
 WHERE NOT EXISTS (SELECT 1 FROM billing_periods
                    WHERE business_id = $1 AND usage_settled_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM lifecycle_deadlines
                    WHERE business_id = $1 AND kind = 'cancellation_window_close')
ON CONFLICT DO NOTHING
RETURNING id;
```

Three requirements are in that one statement. The first `NOT EXISTS` is F6.11f.
The second is [F6.10](Ringly_PRD_v3.md#f6-10) — **a business that has asked to cancel is never charged
again**, and the cancellation is durable as a deadline row ([§2.10.7](#2107-cancellation)), so the
check is a join rather than a flag. The `ON CONFLICT DO NOTHING` against the
partial index is what survives two ticks racing; the `WHERE NOT EXISTS` is what
makes the common case cheap.

**`policy_id` is pinned at open and never re-read** ([F6.16](Ringly_PRD_v3.md#f6-16)). The rate, the cap,
the fee and the billable-outcome set that settle this period are the ones in
force on the day it opened, so a policy change lands on the next period and
rewrites nothing ([§2.4](#24-data-model)/007).

**Usage accrues on productive calls only** ([F6.6](Ringly_PRD_v3.md#f6-6)) — a booking, a reschedule that
produced a booking, or a cancellation of a real appointment. Enquiries, wrong
numbers, dropped calls and pre-activation test calls are not billable. **Who is
calling is irrelevant**: the owner, a customer and Ringly's own developer are
billed identically, because the outcome is the only test ([F6.7](Ringly_PRD_v3.md#f6-7)). **The whole call
is billable, not the minutes up to the booking** ([F6.7](Ringly_PRD_v3.md#f6-7)).

**A `usage_records` row is written for every non-test call at call end; whether
it is billable is `period_id`, not the row's existence.** [§2.6.2.3](#2623-call-end)'s step 3 reads
"if the period is open" and this is the precise form of it:

```sql
INSERT INTO usage_records (business_id, period_id, call_id, connected_seconds, created_at)
SELECT b.id,
       CASE WHEN b.billing_status = 'cancelling' THEN NULL
            ELSE (SELECT p.id FROM billing_periods p
                   WHERE p.business_id = b.id AND p.usage_settled_at IS NULL) END,
       $2, $3, now()
  FROM businesses b
 WHERE b.id = $1
ON CONFLICT (call_id) DO NOTHING;
```

- **`period_id` is stamped at call end and never derived afterwards**, for the
  same reason `is_test_call` is ([§2.4](#24-data-model)/005): billing state changes and a call's
  history must not. Deriving it later would move usage between periods every time
  a business's status moved.
- **Null when no period is open** is [F6.11c-ii](Ringly_PRD_v3.md#f6-11c-ii)'s case (b) grace — recorded,
  never charged ([§2.4](#24-data-model)/007).
- **Null when the business is `cancelling`** is [F6.12](Ringly_PRD_v3.md#f6-12)'s free window.
- **`ON CONFLICT (call_id)`** makes a redelivered call-end webhook a no-op rather
  than a double-metered call, matching the `calls` insert beside it.

**The outcome is not known yet at this moment and that is fine** — classification
is hourly and asynchronous ([§2.9.1](#291-outcome-classification)), and the settlement query is what applies the
outcome filter. Nothing here waits on a model call.

**"The two charges never fall on the same day" is delivered by ordering, not by
the calendar — and this is a deliberate reading of [F6](Ringly_PRD_v3.md#f6--billing-and-payments) that needs ratifying.**
A period's usage cannot be summed until the period is over, and the instant it is
over is the instant its successor begins; so the settlement of _N_ and the fee
for _N+1_ are inherently adjacent, and [F6b](Ringly_PRD_v3.md#f6b--one-business-end-to-end)'s "day 30 … day 31" is not achievable
without either losing the last hours of _N_'s usage or extending _N_, both of
which [F6](Ringly_PRD_v3.md#f6--billing-and-payments) forbids elsewhere ([F6.7a](Ringly_PRD_v3.md#f6-7a), [F6.11b](Ringly_PRD_v3.md#f6-11b)/I1). What [F6](Ringly_PRD_v3.md#f6--billing-and-payments) says the separation exists
to produce is preserved exactly: _"a card that has gone bad therefore fails one
charge at a time, and there is only ever one grace clock."_ The design produces
that by making the second charge **conditional on the first having cleared** —
[§2.10.3](#2103-settlement-and-the-clamp)'s ordered worker settles _N_, and opens and charges _N+1_ only if nothing
is then outstanding ([F6.11c](Ringly_PRD_v3.md#f6-11c)). Two charges minutes apart with the second
conditional on the first can still only start one clock, which is stronger than
calendar separation and does not depend on a worker's cadence.

### 2.10.3 Settlement and the clamp

Settlement happens at exactly three moments ([F6.9a](Ringly_PRD_v3.md#f6-9a)), and the $500 clamp is
applied at each:

1. **Normal period end.**
2. **A cancellation window closing** ([F6.12](Ringly_PRD_v3.md#f6-12)), which settles the period early.
3. **Final deletion for non-payment** ([F9.3](Ringly_PRD_v3.md#f9-3)), where the clamped figure is what
   the business is recorded as owing ([F9.9](Ringly_PRD_v3.md#f9-9)) even though it is never collected.

**All three call the same function, and only the third does not raise an
invoice.** `settle(period, mode)` computes and writes; whether Stripe is asked
for money is a parameter. Three separate implementations of the clamp is three
places for it to be wrong on the one path — deletion — where nobody would notice,
because nothing is collected there and the only consumer is a departure record
read years later.

**What the worker selects.** Hourly ([§2.2.2](#222-request-paths-and-background-work)), bounded by due rows rather than by
platform size ([N2.3](Ringly_PRD_v3.md#n2-3)):

```sql
SELECT p.id, p.business_id, p.policy_id
  FROM billing_periods p
  JOIN businesses    b ON b.id = p.business_id
 WHERE p.usage_settled_at      IS NULL
   AND p.settlement_claimed_at IS NULL
   AND now() >= ((p.ends_on + 1)::timestamp AT TIME ZONE b.timezone)
 ORDER BY p.ends_on
   FOR UPDATE OF p SKIP LOCKED
 LIMIT 200;
```

`FOR UPDATE ... SKIP LOCKED` is what stops two overlapping ticks selecting the
same period; `settlement_claimed_at` is what stops a tick that started after the
first one committed. **Both are needed and they answer different questions** —
the lock covers concurrent runs, the column covers sequential ones, and a design
with only the lock double-charges the moment a deploy overlaps a run.

**The sum, once, in integer seconds** ([F6.7a](Ringly_PRD_v3.md#f6-7a)):

```sql
SELECT COALESCE(SUM(u.connected_seconds), 0)::bigint AS billable_seconds
  FROM usage_records u
  JOIN calls        c ON c.id = u.call_id
 WHERE u.period_id  = $1
   AND c.is_test_call = false
   AND c.outcome = ANY($2::text[]);   -- policy.billable_outcomes, from the pinned policy
```

**An unclassified call has `outcome IS NULL` and is excluded by `= ANY`**, which
is [R24](#r24)'s mitigation arriving for free: the business is under-billed rather than
guessed at ([§2.9.1.4](#2914-failure-is-safe-by-construction)). Classification is hourly and settlement is hourly, so a
call in the last minutes of a period may not be labelled when its period settles;
**it is then not billed, permanently**, because [N10.4](Ringly_PRD_v3.md#n10-4) forbids reopening a settled
period. That is a known, bounded leak in the business's favour and it is the
right direction to be wrong in.

**The clamp, in integers, applied before Stripe sees anything** ([F6.9](Ringly_PRD_v3.md#f6-9), [F6.12d](Ringly_PRD_v3.md#f6-12d)):

```
minutes     = (billable_seconds + 59) / 60              -- integer division: one rounding, at close
raw_cents   = minutes * policy.per_minute_rate_cents
usage_cents = max(0, min(raw_cents, policy.cap_cents - policy.fixed_fee_cents))
total_cents = policy.fixed_fee_cents + usage_cents
```

- **`cap_cents - fixed_fee_cents` and not "cap minus what was collected".** The
  fee is part of the period's total whether or not it cleared, which is why [F6c](Ringly_PRD_v3.md#f6c--invariants)'s
  case (a) reaches $500 and case (b) reaches $400 — the difference is what was
  collected, not what was clamped.
- **Stripe is only ever told `usage_cents`.** The unclamped `raw_cents` never
  leaves Ringly; `billable_seconds` and `usage_charge_cents` are both stored, so
  the absorbed difference is a subtraction the operator can run per business ([F8](Ringly_PRD_v3.md#f8--operator-dashboard-ringly-internal),
  [R8](#r8)) and is not lost.
- **Tax is added by Stripe on top of the clamped figure** ([F6.18](Ringly_PRD_v3.md#f6-18), [F6c](Ringly_PRD_v3.md#f6c--invariants)): the cap
  clamps Ringly's own charges, and the departure record holds the figure
  exclusive of tax ([F9.9](Ringly_PRD_v3.md#f9-9)).

**Then, in order, in one worker pass over one business:**

```
1  claim the period                                    T1, local
2  compute billable_seconds, minutes, usage_cents      local, no I/O
3  raise and pay the usage invoice (§2.10.9)           external      ← skipped in mode=deletion
4  record: usage_settled_at, figures, billing_events   T2, local
5  if nothing is now outstanding (§2.10.6):
     open the successor period                         local
     raise and pay its fixed fee (§2.10.9)             external
6  else: this decline is a failure — §2.10.4
```

**Step 5's condition is [F6.11c](Ringly_PRD_v3.md#f6-11c) in one line**, and it is the same predicate the
restore path uses. A settlement that declines therefore cannot be followed by a
successor in the same pass, which is case (b) falling out of the code rather than
being special-cased in it.

**Usage keeps accruing past the cap and is recorded in full** ([F6.9](Ringly_PRD_v3.md#f6-9)), because
Ringly needs the true number for cost and margin ([F8](Ringly_PRD_v3.md#f8--operator-dashboard-ringly-internal)). The cap is applied at
settlement, not during the period.

**The cap notice is detected by the same worker, on open periods, and is made
once-only by the email registry rather than by a new column** ([F6.9b](Ringly_PRD_v3.md#f6-9b)):

```sql
-- open periods whose accrued, unclamped usage has reached the clamp ceiling
SELECT p.id, p.business_id
  FROM billing_periods p
  JOIN pricing_policy  pol ON pol.id = p.policy_id
 WHERE p.usage_settled_at IS NULL
   AND accrued_cents(p.id) >= pol.cap_cents - pol.fixed_fee_cents;
```

A `reason_key` of `cap_reached:{period_id}` is unique in `email_sends`
([§2.4](#24-data-model)/010), and [F7.5](Ringly_PRD_v3.md#f7-5) makes that key "at most one reason per business per billing
period" — so the second hourly tick that sees the same period raises no second
email and no second operator alert. **A `cap_notified_at` column would be a
second copy of a fact the email table already holds**, and [§2.6.4](#264-fail-closed-concretely)'s removed
incident flag is the precedent for not adding it. On crossing, Ringly continues
to serve, absorbs the excess, alerts the operator with cost-to-serve and margin
([F7.13](Ringly_PRD_v3.md#f7-13)), and emails the business to say the rest of the period is on Ringly.
Hitting the cap is good news for the business and reads that way.

**The dashboard's live accrued figure uses the identical query** ([F5.10](Ringly_PRD_v3.md#f5-10), [F6.13](Ringly_PRD_v3.md#f6-13)),
outcome filter included, so the number a business watches during the period is
the number it is charged at the end of it. A dashboard that counted unclassified
calls and an invoice that did not would differ by a few pounds every month with
nothing on the page to explain it.

### 2.10.4 When a charge fails

| Day  | What happens                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------ |
| 0    | Charge fails. Service continues, usage keeps accruing, business emailed                          |
| 0–7  | **Grace.** Calls answered normally. Follow-up emails. This usage **is** billable                 |
| 7    | **Suspended.** The agent is unbound. Number and all data retained                                |
| 7–60 | **Charged nothing whatsoever.** Fully recoverable — paying restores service that day             |
| ~58  | 48-hour final warning                                                                            |
| 60   | Number released, data deleted, the period settled for what was served, debt recorded permanently |

**Not every error is a failed charge, and treating them alike would suspend a
business for Ringly's outage.** [F6.11](Ringly_PRD_v3.md#f6-11) says "a failed charge"; the design reads
that as _the customer's money did not move_, never _Ringly could not reach
Stripe_. The taxonomy is explicit because the wrong branch here is a
customer-visible catastrophe with no other symptom:

| Class                                                                  | Ringly's response                                                                                                                       | Clocks  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `card_error` — declined, expired, insufficient funds                   | The invoice stays `open` and enters Smart Retries. `active → grace`, both deadlines, payment-failed email                               | **Yes** |
| `invoice.payment_action_required` (SCA)                                | Same as a decline — an off-session charge that needs the cardholder is a charge that did not happen                                     | **Yes** |
| `charge.dispute.created` (chargeback, [F6.17](Ringly_PRD_v3.md#f6-17)) | Treated exactly as non-payment. The disputed amount becomes outstanding ([§2.10.6](#2106-coming-back))                                  | **Yes** |
| `api_connection_error`, `rate_limit_error`, Stripe 5xx                 | **Nothing changes.** The claim is released and the next hourly tick retries. No email, no clock, no state change                        | No      |
| `idempotency_error`, `invalid_request_error`                           | A Ringly defect. Operator alert, claim left in place so it cannot loop, no state change                                                 | No      |
| "Invoice is already paid" / `invoice_no_payment_required`              | **Success.** Stripe's own automatic attempt won the race ([§2.10.9](#2109-the-stripe-object-lifecycle-end-to-end)); record and continue | No      |

**A transient error must never be allowed to look like a decline**, because the
two differ in who has to act and [F1.12a-i](Ringly_PRD_v3.md#f1-12a-i) is built entirely on that distinction:
a declined card is the business's to fix and everything else is Ringly's.

Three rules do the work, and they are the ones easiest to get wrong:

**No new period ever opens while the business owes anything** ([F6.11c](Ringly_PRD_v3.md#f6-11c)). Not
during grace, not during suspension. It lives in exactly one place — step 5 of
[§2.10.3](#2103-settlement-and-the-clamp)'s ordering, shared with [§2.10.6](#2106-coming-back) — because a rule written twice is a rule
that will be true in one of the two places. This is the single rule that stops a
failing account accumulating $100 fees for periods it never asked for and mostly
did not receive. A business in trouble is only ever dealing with one period and
one debt, and **the debt never grows while it is unpaid** — a business deciding
on day 55 whether to come back owes exactly what it owed on day 8.

**The period clock never stops, and a suspended business loses service days it
has already paid for** ([F6.11b](Ringly_PRD_v3.md#f6-11b)). That is the intended outcome. `starts_on` and
`ends_on` are never updated after insert — there is no code path that writes
them, which is what makes [I1](Ringly_PRD_v3.md#i1) structural rather than a discipline. On the
`grace → suspended` transition the open period, if any, is stamped
`was_suspended_during = true` in the same transaction, because [F5.9](Ringly_PRD_v3.md#f5-9) requires the
billing history row to say so or a period with low usage and a full $100 looks
like a mistake.

**What pauses is the meter, not the collection** ([F6.11b-i](Ringly_PRD_v3.md#f6-11b-i)). The outstanding
invoice stays open and due, Stripe keeps retrying the card, and Ringly keeps
sending follow-ups — a suspended business is chased as hard as any other debtor.
What it must never receive is a _new_ charge for a service it is not getting.
**The mechanism that makes both true at once is [§2.10.8](#2108-the-division-with-the-payment-provider)**, and it is R21.

### 2.10.5 Two failure cases that are not symmetric

[F6.11d](Ringly_PRD_v3.md#f6-11d) works both through in full. The design must produce both — and, worth
saying plainly, **it produces them without a branch**. Nothing in [§2.10.3](#2103-settlement-and-the-clamp) or
[§2.10.6](#2106-coming-back) asks which charge failed; the asymmetry comes entirely from whether a
period happens to be open at the moment of failure, which is the state the
`WHERE usage_settled_at IS NULL` predicate is already reading.

**(a) The fixed fee fails**, on day 1 of period _N_. Period _N_ runs to its own
end; usage in days 1–8 accrues to it and is billable, because the call-end insert
found an open period and stamped `period_id`. If the business is still suspended
on day 30, _N_ settles on time for what was served and **no _N+1_ opens** — step
5's predicate is false. Paying inside _N_ resumes it with nothing new charged,
because the open-period insert's first `NOT EXISTS` is false. Paying after _N_
has ended opens a fresh period that day with its own $100.

**(b) The usage settlement fails**, on the last day of _N_. _N_ closes that same
day — `usage_settled_at` is stamped in T2 whether or not the invoice was paid,
because a settlement is a computation Ringly performed and [F6.16](Ringly_PRD_v3.md#f6-16) says it never
reopens. **No successor ever opens.** The grace week that follows runs with no
period open, so the call-end insert stamps `period_id = NULL` and **that usage is
not billed** ([F6.11c-ii](Ringly_PRD_v3.md#f6-11c-ii)) — there is nothing to bill it to, and inventing a period
to hold it would manufacture exactly the $100 charge [F6.11c](Ringly_PRD_v3.md#f6-11c) refuses. **The cost is
still recorded** in `cost_records`, which do not belong to a period ([§2.4](#24-data-model)/009),
because what Ringly absorbs, Ringly measures.

**Ceilings differ because the fee was collected in one case and not the other**:
case (a) tops out at $500, case (b) at $400 ([F6c](Ringly_PRD_v3.md#f6c--invariants)). Both fall out of
`usage_cents = min(raw, cap − fee)` with nothing case-specific in it.

### 2.10.6 Coming back

**Payment clearing is the trigger; restoration is the consequence** ([F6.10b](Ringly_PRD_v3.md#f6-10b)).
Ringly does not charge a suspended business to bring it back — it is already
being charged, continuously, by retries that never stopped. **The moment nothing
is outstanding, service resumes that day**: the agent is rebound (and verified,
[§2.5.3](#253-bind-and-unbind-are-verified-by-reading-provider-state-back)) and the business is emailed.

**"Outstanding" is a question about Stripe, answered against the invoices Ringly
raised.** Ringly is the authority on what was asked for; Stripe is the authority
on whether money moved ([N10.7](Ringly_PRD_v3.md#n10-7)). The predicate is one function, and everything in
this section calls it:

```
outstanding(business) =
    Σ invoice.amount_remaining
      for invoices in stripe.invoices.list({ customer, status: 'open' })
      whose metadata.ringly_business_id matches
  + Σ dispute.amount
      for billing_events of kind 'dispute_opened' with no matching 'dispute_closed(won)'
```

- **A part payment cannot clear it**, because a Stripe invoice stays `open` with
  `amount_remaining > 0` until it is paid in full. That behaviour is structural
  rather than a check Ringly performs, which is why it cannot be forgotten.
- **Chargebacks have to be added by hand**, because a dispute withdraws funds
  without reopening the invoice — an implementation that asked Stripe only about
  invoices would silently restore a business that had just charged back ([F6.17](Ringly_PRD_v3.md#f6-17),
  [R15](#r15)).
- **Clearing one of two debts leaves it suspended**, and the follow-up email says
  what remains ([F6.10b](Ringly_PRD_v3.md#f6-10b)).
- **It does not matter how it cleared** — an automatic retry, a new card, or the
  business paying the invoice by hand all produce the same `invoice.paid` event
  and the same answer here.

**`reevaluate(business)` is the whole of restoration, and it is the only thing
that performs it.** The webhook handler calls it and the daily reconciliation
worker calls it; **the webhook is not a different path, only a faster one**:

```
reevaluate(business):
  0  if outstanding(business) > 0 → return                            read-only, no writes
  1  T1: UPDATE businesses SET billing_status = 'active'
           WHERE id = $1 AND billing_status IN ('grace','suspended')
         RETURNING billing_status AS previous
         DELETE FROM lifecycle_deadlines
           WHERE business_id = $1 AND kind IN ('grace_expiry','nonpayment_deletion')
      └─ no row returned → already active → return. This is the idempotency.
  2  if previous = 'suspended': rebind the agent, read provider state back   external (§2.5.3)
      └─ failure → alert (F7.13a); the business is active and unanswered — retried next tick
  3  open a period, only if none is running and no cancellation stands  local (§2.10.2)
      └─ no row returned → the original period is still running → nothing more is charged
  4  raise and pay that period's fixed fee                             external (§2.10.9)
      └─ a decline here is a fresh failure with a fresh clock (F6.11b-iv)
  5  enqueue the service-restored email, naming the new period end date
```

**Steps 1 and 3–4 are [F6.11b-iii](Ringly_PRD_v3.md#f6-11b-iii)'s ordering as code: the debt clears, then the
new period's fee is charged.** The order is not cosmetic — step 0 is the gate, so
the new period cannot exist until the old debt is settled, and a business paying
its way out on a day a new period opens is charged twice that day, both movements
appearing separately in its billing history ([F5.9](Ringly_PRD_v3.md#f5-9)).

**Step 2 comes before step 4 deliberately.** Service resumes the same day
([F6.10b](Ringly_PRD_v3.md#f6-10b)) and the new fee is a consequence of resuming, not a condition of it; if
that fee then declines, [F6.11b-iv](Ringly_PRD_v3.md#f6-11b-iv) gives the business a full fresh grace during
which it must be _served_. Charging first and rebinding second would leave a
business unanswered inside a grace period it is entitled to.

**Step 4's failure re-enters [§2.10.4](#2104-when-a-charge-fails) from the top** — new deadlines, new
7-day clock, new 60-day clock — because the previous ones were deleted in step 1.
A business is never carried straight from suspension back into suspension without
the full grace it is owed.

**A business that has paid and is still not answered is the worst state in the
system** ([F6.10b-i](Ringly_PRD_v3.md#f6-10b-i)), so recovery does not depend on a single message arriving.
**The daily reconciliation worker runs `reevaluate()` over every business in
`grace` or `suspended`** — the same function, the same writes, the same
idempotency. A lost webhook may cost such a business hours; it must never cost it
days, and it must never cost it the account.

**It also reconciles in the other direction**, which is the half a dropped
webhook makes necessary and which no requirement would notice missing: for every
business, any Stripe invoice carrying `metadata.ringly_business_id` that has no
corresponding `billing_events` row is logged and raised, because that is what a
crash between [§2.10.11](#21011-transaction-boundaries-and-what-a-crash-leaves)'s T1 and T2 leaves behind and it is otherwise invisible.

### 2.10.7 Cancellation

**A short reconsideration window, then settlement** ([F6.12](Ringly_PRD_v3.md#f6-12)). The window runs
from the request until whichever comes first: 7 days later, or the end of the
current period.

**The cancellation is durable as a `lifecycle_deadlines` row of kind
`cancellation_window_close`, and that row is the fact** — `requested_at` when the
business sent the email, `due_at` at `min(requested_at + 7d, period end)`. Two
requirements need the request instant and neither can use the row's absence:
[F9.2](Ringly_PRD_v3.md#f9-2) judges a revocation **by when the business sent it, not when Ringly read
it**, so `requested_at` is operator-supplied and may be earlier than the row's
creation; and [F6.12a](Ringly_PRD_v3.md#f6-12a) needs it to identify which usage records the window covers.

- **Service continues unchanged** through it. A business that changes its mind
  finds everything as it was.
- **Usage stops being billed** from the request onward, though the service is
  still given. Ringly absorbs it. The mechanism is `period_id = NULL` at call
  end ([§2.10.2](#2102-a-period)), not a filter at settlement — so the free window is visible in
  the data as it accrues rather than inferred at the end.
- **Revoking erases the window retroactively** ([F6.12a](Ringly_PRD_v3.md#f6-12a)) and the usage served
  during it **becomes billable after all**. This is the one write-back in the
  money tables and it is bounded to an unsettled period, which is what keeps it
  inside [N10.4](Ringly_PRD_v3.md#n10-4):

  ```sql
  UPDATE usage_records u
     SET period_id = p.id
    FROM billing_periods p
   WHERE p.business_id = $1 AND p.usage_settled_at IS NULL
     AND u.business_id = $1
     AND u.period_id IS NULL
     AND u.created_at >= $2;              -- the deadline row's requested_at
  ```

  **`period_id IS NULL` makes it idempotent** — a second run matches nothing —
  and the `usage_settled_at IS NULL` join is what makes it legal: no settled
  figure moves, so [F6.16](Ringly_PRD_v3.md#f6-16) holds. The guard is safe because a business behind on
  payment never reaches `cancelling` at all ([F6.11a](Ringly_PRD_v3.md#f6-11a)), so the only null-period
  rows a `cancelling` business has are the window's.

- **A revocation actioned after the window closed must unwind the settlement**
  ([F9.2](Ringly_PRD_v3.md#f9-2)). The early settlement is not deleted — [N10.4](Ringly_PRD_v3.md#n10-4) forbids that — so the
  unwind is: refund or void the settlement invoice by hand in Stripe, write the
  reversing `billing_events` rows, reopen nothing, and let the period run to its
  original `ends_on` under a fresh settlement claim. **It is deliberately the one
  operator-assisted path in billing**, because it is rare, it is the only case
  where a settled figure must change, and a code path for it would be the least
  exercised and most dangerous in the system.
- **When it closes**, the sweeper calls `settle(period, 'settled_early')` for
  usage up to the request, clamped. **The $100 is not refunded, in whole or in
  part** ([F6.12b](Ringly_PRD_v3.md#f6-12b), [F6.11e](Ringly_PRD_v3.md#f6-11e), [I6](Ringly_PRD_v3.md#i6)). There is no proration arithmetic anywhere in the
  design; Stripe's proration is left off ([§2.17](#217-verified-vendor-capabilities)) so that none can arrive by
  accident.
- **If that settlement charge fails, it is recorded and let go** ([F6.12f](Ringly_PRD_v3.md#f6-12f)). No
  grace clock, no suspension, no retry loop of Ringly's own — the amount is
  written to the departure record as owed ([F9.9](Ringly_PRD_v3.md#f9-9)). Service has already stopped and
  there is nothing left to withhold. **This is the one decline that does not
  enter [§2.10.4](#2104-when-a-charge-fails)**, and the branch is on the business's state (`dormant`), not on
  which charge it was.
- **Then 60 days dormant**, fully recoverable, number and every record retained
  ([F6.12e](Ringly_PRD_v3.md#f6-12e)). A business returning inside it resumes on its own number with its own
  history, on a new period charged that day.
- **A business already behind on payment cannot cancel into free service**
  ([F6.11a](Ringly_PRD_v3.md#f6-11a)). The status guard `WHERE billing_status = 'active'` is what enforces
  it: the operator's action still records the cancellation deadline row, so
  [F6.10](Ringly_PRD_v3.md#f6-10)'s "never charged again" holds, but the row is written with
  `due_at = requested_at` — a zero-length window — and the grace and deletion
  clocks are untouched. It is treated as non-paying, and the suspension clock
  keeps running.

### 2.10.8 The division with the payment provider

**Stripe invoices, charges and retries; Ringly decides the amounts and writes
every message except the three Stripe already sends well** ([F6.20](Ringly_PRD_v3.md#f6-20)).

| Function                                    | Owner                                               |
| ------------------------------------------- | --------------------------------------------------- |
| Tax calculation                             | **Stripe Tax** — Ringly stores the amounts          |
| Invoices, receipts, payment-succeeded email | **Stripe**, carrying Ringly branding                |
| Retrying failed payments                    | **Stripe** — Ringly builds no retry loop            |
| Every failure-path email                    | **Ringly**                                          |
| The $500 cap and the clamp                  | **Ringly** computes, Stripe executes                |
| Refunds                                     | Neither automatically — goodwill, by hand           |
| End-of-dunning behaviour and teardown       | **Ringly**                                          |
| Billing thresholds                          | Neither — deliberately not configured               |
| Self-service portal                         | **Disabled** ([§1.9](Ringly_PRD_v3.md#19-deferred)) |

**The account-level settings that make that table true**, all of which are
configuration rather than code and all of which must be asserted by the
integration's own start-up check, because a dashboard toggle nobody owns is a
toggle that drifts:

| Setting                                 | Value              | Because                                                                                                             |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Smart Retries                           | **On, 2 months**   | The longest window Stripe offers, matching [F9.3](Ringly_PRD_v3.md#f9-3)'s 60 days                                  |
| End-of-dunning action                   | **Leave past due** | Teardown is Ringly's ([F6.19](Ringly_PRD_v3.md#f6-19)); nothing Stripe does may end it                              |
| "Email customers about failed payments" | **Off**            | [F6.21](Ringly_PRD_v3.md#f6-21), [F6.11b-ii](Ringly_PRD_v3.md#f6-11b-ii) — Ringly writes every failure-path message |
| Receipts and finalised-invoice emails   | **On**             | [F7.3a](Ringly_PRD_v3.md#f7-3a) — the three things Stripe sends well                                                |
| Customer portal                         | **Off**            | [§1.9](Ringly_PRD_v3.md#19-deferred) — cancellation is not self-serve ([F9.2](Ringly_PRD_v3.md#f9-2))               |
| Automatic tax                           | **On**             | [F6.18](Ringly_PRD_v3.md#f6-18)                                                                                     |
| Billing thresholds                      | **Not configured** | [F6.20](Ringly_PRD_v3.md#f6-20)                                                                                     |
| Proration                               | **Off**            | [F6.11e](Ringly_PRD_v3.md#f6-11e), [I6](Ringly_PRD_v3.md#i6) — no path may produce a prorated figure                |

**Stripe's dunning is switched off throughout, including during suspension**
([F6.21](Ringly_PRD_v3.md#f6-21), [F6.11b-ii](Ringly_PRD_v3.md#f6-11b-ii)). Stripe's email can say a card was declined; it cannot say
that service continues for seven days, that nothing has been deleted yet, or
what is destroyed in 48 hours. Those are Ringly's timelines and Ringly's data,
and two differently-worded messages from what looks like one company is the
failure this prevents.

#### 2.10.8.1 R21, and the decision that dissolves it

**[R21](#r21) is that suspension must stop new invoices while preserving retries on the
open one, and that these are usually configured together.** The verified
behaviour of the control they are usually configured through:

| `pause_collection.behavior` | New invoices                       | The already-open invoice         |
| --------------------------- | ---------------------------------- | -------------------------------- |
| `void`                      | Voided                             | **Also voided — kills the debt** |
| `mark_uncollectible`        | Marked uncollectible               | Continues to be retried          |
| `keep_as_draft`             | Stay `draft`, `auto_advance=false` | **Continues to be retried**      |

So `keep_as_draft` is the correct setting and `void` is the trap — but
`keep_as_draft` leaves draft invoices **accumulating** for every cycle spent
suspended, and resuming collection requires setting `auto_advance = true` on the
drafts you want. **A restore that forgot to void them would raise exactly the
charge [F6.11b](Ringly_PRD_v3.md#f6-11b) forbids**, silently, for a phone nobody answered.

<a id="d1"></a>**Decision D1, ratified 2026-08-01 — Ringly uses no Stripe `Subscription`
object. Every charge is a standalone invoice raised by the settlement worker
([§2.10.9](#2109-the-stripe-object-lifecycle-end-to-end)).**

**The decisive reason is structural and was confirmed against Stripe's
documentation, not assumed.** A subscription bills the recurring fee **one
service interval in advance** and combines it with the closing period's metered
usage **on a single invoice at the period boundary** — Stripe's own wording is
that at the end of the period it "sends an invoice that combines the flat fee
with any usage". [F6](Ringly_PRD_v3.md#f6--billing-and-payments) requires the opposite, deliberately: the fee on day 1, that
period's usage on day 30, the next fee on day 31, **so that a card which has gone
bad fails one charge at a time and there is only ever one grace clock**. Under a
subscription a single decline is both charges failing together, and [F6.11d](Ringly_PRD_v3.md#f6-11d)'s two
asymmetric cases — fee-fails with a $500 ceiling, settlement-fails with a $400
one — collapse into a third case the PRD does not describe.

**None of the ways out are cheaper than not using one:**

| Way out                                         | Why it is worse                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| Two subscriptions with offset anchors           | Two dunning states, two things to pause, [R21](#r21) doubled                   |
| Subscription for the fee, manual usage invoices | The manual path **plus** a subscription, not instead of one                    |
| Prebilling the fee                              | Stripe: "Prebilling doesn't apply to any usage-based prices in a subscription" |

**The second reason is that [R21](#r21)'s mitigation rests on behaviour Stripe does not
document unambiguously.** Suspension needs two things pulled apart that are
normally set together — stop raising new invoices ([F6.11b](Ringly_PRD_v3.md#f6-11b)) while the outstanding
one keeps being retried ([F6.11b-i](Ringly_PRD_v3.md#f6-11b-i)). `pause_collection.behavior = 'keep_as_draft'`
was the candidate, and the pause guide says both of these:

> "All invoices created before the `resumes_at` date remain in `draft` status and
> `auto_advance` is set to `false`."

> "Invoices created before subscriptions are paused continue to be retried unless
> you void them."

Those cannot both hold for the already-finalised, already-open invoice, and the
API reference does not distinguish it — it says only "Keep all invoices as
`draft` while collection is paused". **If `keep_as_draft` reaches back and sets
`auto_advance: false` on the open invoice, retries stop and the entire recovery
path dies silently**, which is the failure [R21](#r21) exists to warn about. `void`
stops retries by definition and `mark_uncollectible` stops collection, so if that
reading is the true one, **no pause behaviour satisfies [F6.11b](Ringly_PRD_v3.md#f6-11b) and [F6.11b-i](Ringly_PRD_v3.md#f6-11b-i) at
once** and a subscription cannot meet the requirements at all.

**[D1](#d1) removes [R21](#r21) rather than mitigating it.** With no recurring-invoice generator
there is nothing to pause: "no new invoice during suspension" becomes "the
worker's step 5 predicate is false", which is [F6.11c](Ringly_PRD_v3.md#f6-11c), which is already tested.
Retries on the open invoice are untouched because nothing touches them. **Both of
[R21](#r21)'s failure modes are silent, and the best mitigation for a silent failure is a
design in which it is unreachable.**

**Third, `billing_periods` becomes the only clock.** With a subscription there
are two — Stripe's cycle anchor and Ringly's period — and [F6.11b-iii](Ringly_PRD_v3.md#f6-11b-iii)'s "a new
period opens on the day service is restored" becomes a `billing_cycle_anchor`
reset with `proration_behavior: 'none'`, on a system where two clocks silently
disagreeing is a wrong charge.

**Two smaller things a subscription cannot express anyway.** [F6.9](Ringly_PRD_v3.md#f6-9)'s $500 clamp is
inclusive of the fee and applied at settlement; under a subscription it means
intercepting `invoice.created` and injecting a negative line before finalisation,
mutating Stripe's own invoice inside a webhook. And [F6.12b](Ringly_PRD_v3.md#f6-12b)'s cancellation wants
**no** proration — the fee is not refunded and usage to the request date is
charged — which is most of what a subscription offers at cancellation.

**What [D1](#d1) costs, stated plainly.** Ringly raises every invoice on time itself,
and gives up Stripe's dashboard analytics — MRR, churn, subscriber counts — which
is the one real loss, partly covered by the operator dashboard ([F8.2a](Ringly_PRD_v3.md#f8-2a), [F8.4](Ringly_PRD_v3.md#f8-4)). The
customer portal is already disabled ([§1.9](Ringly_PRD_v3.md#19-deferred)), proration and plan changes are out of
scope, and billing thresholds are deliberately unconfigured ([F6.20](Ringly_PRD_v3.md#f6-20)). The invoice
scheduling it gives up is work the hourly settlement worker does anyway, driven
by rows that have come due ([§2.2.2](#222-request-paths-and-background-work)), and a period that opens late is visible as a
due row rather than as a missing charge.

**Consequential edits, now made rather than proposed:** [§2.13.4](#2134-teardown-in-order)'s step 2 is an
_assertion_ that no subscription exists for the customer rather than a
cancellation — kept as a step, because one created by hand during support would
otherwise survive teardown and bill a deleted business. [F6.19](Ringly_PRD_v3.md#f6-19) carries the same
wording. [R21](#r21) is recorded as dissolved rather than mitigated, and **its acceptance
test is unchanged and remains the criterion**: suspend, cross a would-be period
boundary, restore, then assert that no new invoice was raised and that the
original was retried throughout.

**What [D1](#d1) does not settle, and what still needs a test account ([A4](Ringly_PRD_v3.md#a4)).** Ringly
depends on Stripe retrying **one standalone open invoice for as long as
suspension lasts**, and that is a longer window than it first appears: in
[F6.11d](Ringly_PRD_v3.md#f6-11d)'s case (a) the fee fails on day 1 and deletion is at day 60, so the
invoice must be retried for **59 days** against a Smart Retries window of roughly
two months. [F6.11b-i](Ringly_PRD_v3.md#f6-11b-i)'s "retries that never stopped" is the whole recovery path,
and it is running very close to the edge of what Stripe will do unprompted. This
question exists under [D1](#d1) exactly as it would have under a subscription.

**A chargeback is treated exactly as non-payment** ([F6.17](Ringly_PRD_v3.md#f6-17)): same grace, same
suspension, same 60 days. No dispute workflow, no pausing of the deletion clock,
contested or conceded by hand.

### 2.10.9 The Stripe object lifecycle, end to end

**Four objects and no others**: `Customer`, `SetupIntent`, `Invoice`,
`InvoiceItem`. Every one Ringly creates carries
`metadata.ringly_business_id`, and every invoice also carries
`metadata.ringly_period_id` and `metadata.ringly_kind` — because reconciliation
([§2.10.6](#2106-coming-back)) has to be able to ask Stripe "what have you got for this business" and
get an answer that does not depend on Ringly's own rows being intact.

**At card-add — a `SetupIntent`, and no charge** ([F6.2](Ringly_PRD_v3.md#f6-2), [F6.3](Ringly_PRD_v3.md#f6-3)):

```
1  create-or-get Customer { email, name, address, metadata }        idempotency key: customer:{business_id}
     └─ address is required, because Stripe Tax needs a US 5-digit postal code (F6.18)
2  SetupIntent { customer, usage: 'off_session', payment_method_types: ['card'] }
3  return client_secret to the browser; Stripe Elements confirms it
4  on confirmation — from the browser's return AND from setup_intent.succeeded, whichever first —
     Customer.invoice_settings.default_payment_method = si.payment_method
5  store the customer id locally (§2.10.13). Nothing else about the card is stored.
```

**Card details never reach Ringly's servers or logs** ([F6.3](Ringly_PRD_v3.md#f6-3), a hard
requirement): the confirmation happens browser-to-Stripe and Ringly sees a
`SetupIntent` id and a `PaymentMethod` id. **The brand and last four digits are
deliberately not stored either** — the dashboard reads them from Stripe when it
renders, because a copy of them is a copy that goes stale when the card is
replaced and there is no requirement that survives the network being down.

**Step 4 is written to be reached twice** — the browser's return and the webhook
race, and out-of-order delivery means either can win ([§2.10.10](#21010-the-webhook-endpoint)). Setting a
default payment method is idempotent, so the design does not choose between them.

**At every charge — one invoice, built in a fixed order:**

```
1  invoice = stripe.invoices.create({
       customer, collection_method: 'charge_automatically', auto_advance: true,
       automatic_tax: { enabled: true },
       pending_invoice_items_behavior: 'exclude',        ← the important one
       description, metadata: { ringly_business_id, ringly_period_id, ringly_kind } },
     { idempotencyKey: `${kind}:${period_id}:v1` })
2  stripe.invoiceItems.create({ customer, invoice: invoice.id, currency: 'usd',
       amount: <clamped integer cents>, description }, { idempotencyKey: ... })
3  stripe.invoices.finalizeInvoice(invoice.id)
4  stripe.invoices.pay(invoice.id, { off_session: true })
```

- **The invoice is created before the item, with `pending_invoice_items_behavior:
'exclude'`.** Creating the item first and letting the invoice sweep up pending
  items means any stray item on that customer lands on this invoice — and on a
  product with a $500 clamp computed in advance, an invoice whose total is not
  the number Ringly computed is the exact failure the clamp exists to prevent.
  `exclude` is the API default; it is passed explicitly because a default is not a
  decision anybody can see.
- **Steps 3 and 4 are explicit because `auto_advance` alone is not prompt
  enough.** Stripe finalises and attempts payment about **an hour** after the
  invoice is created, and the Activate button must resolve now ([F1.12a-i](Ringly_PRD_v3.md#f1-12a-i)). So
  Ringly finalises and pays synchronously.
- **`auto_advance: true` is still set**, so that a decline in step 4 leaves the
  invoice `open` and inside Smart Retries — which is the entire recovery path
  ([F6.11b-i](Ringly_PRD_v3.md#f6-11b-i)) and the reason Ringly builds no retry loop of its own. Stripe's own
  automatic attempt, an hour later, finds a paid invoice and does nothing; if it
  should ever win the race, step 4 errors with "already paid", which [§2.10.4](#2104-when-a-charge-fails)
  classifies as success.
- **The idempotency key is derived from the period id, not generated.** Two
  worker ticks racing produce the same key and Stripe returns the first result.
  **This protects a same-run retry only** — Stripe prunes v1 keys after about 24
  hours — so it is the cheap outer guard and not the real one. The real one is
  [§2.10.11](#21011-transaction-boundaries-and-what-a-crash-leaves)'s claim-then-record, plus:

  ```sql
  CREATE UNIQUE INDEX one_fee_invoice_per_period
      ON billing_events (period_id) WHERE kind = 'fixed_fee_invoiced';
  CREATE UNIQUE INDEX one_usage_invoice_per_period
      ON billing_events (period_id) WHERE kind = 'usage_invoiced';
  ```

  **At most one invoice of each kind can ever be recorded against a period**, and
  the constraint is in the database rather than in the worker for the same reason
  [§2.6.4](#264-fail-closed-concretely)'s is: the worker is not the only thing that will ever run.

**At activation** the sequence above runs inside [§2.5.2](#252-activation-touches-three-systems-and-can-fail-at-each)'s charge → record → bind
order, which is what makes [F1.12a-i](Ringly_PRD_v3.md#f1-12a-i)'s three rows independently reachable. The
charge is attempted first precisely so that "the card was declined" is a clean
state with nothing to unwind.

**At teardown** ([§2.13.4](#2134-teardown-in-order), [F6.19](Ringly_PRD_v3.md#f6-19)): capture lifetime totals from balance
transactions **before** anything is deleted, then void open invoices, detach the
payment method, delete the Customer. Deleting the Customer destroys the balance
transactions the totals come from, which is why step 1 is step 1.

**The API version is pinned in code**, not inherited from the account's default.
Stripe's recent versions have moved invoice fields (`invoice.subscription`,
`invoice.payment_intent`) and a version that changes underneath a running
integration changes what a webhook payload contains. The pin is asserted at
start-up alongside the settings table in [§2.10.8](#2108-the-division-with-the-payment-provider).

### 2.10.10 The webhook endpoint

`POST /api/webhooks/stripe`. It is on the webhook surface ([§2.2.1](#221-the-four-surfaces)): no session, a
signature, and the service role — so every query names `business_id` explicitly
([N1.2](Ringly_PRD_v3.md#n1-2), [§2.3.1](#231-row-level-security-is-the-floor-not-the-ceiling)).

```
1  raw = await req.text()                                   ← the raw body, never the parsed one
2  event = stripe.webhooks.constructEvent(raw, sig, endpointSecret)
     └─ throws → 400, no side effect, nothing logged from the body
3  INSERT INTO provider_events (id, provider, type, created_at, received_at)
     VALUES (event.id, 'stripe', event.type, to_timestamp(event.created), now())
     ON CONFLICT (id) DO NOTHING RETURNING id
     └─ no row → already handled → 200 immediately
4  business_id ← event's object metadata.ringly_business_id
                 (fall back to a lookup on the customer id; miss → 200 and alert)
5  reevaluate(business_id)  — plus the per-type work in the table below
6  return 200
```

**`stripe.webhooks.constructEvent` is the only signature check** (CLAUDE.md):
never a hand-rolled HMAC comparison, and never on a body that has already been
JSON-parsed and re-serialised, because the signature covers the exact bytes.
Next.js will hand back a parsed body if asked for one, so the route reads
`req.text()` and parses nothing itself. This is a different helper from Retell's
(`Retell.verify`, [§2.6.2](#262-three-webhooks)) and the two are not interchangeable.

**Step 3 is the idempotency, and it is a unique constraint rather than a check.**
Stripe delivers at least once, and a redelivery after a timeout is the common
case rather than an exotic one.

**Step 5 is why out-of-order delivery is not a problem this design has.** Stripe
does not guarantee ordering. **A webhook is a trigger to re-evaluate, never a
fact to apply**: the handler does not read "paid" out of the event and mark
something paid — it asks `outstanding()` what is true right now ([§2.10.6](#2106-coming-back)) and
acts on the answer. An `invoice.paid` overtaking an `invoice.payment_failed`
therefore cannot re-suspend a business, because the later-processed failure event
still leads to a live reading in which nothing is outstanding.

**It is also why the reconciliation backstop is credible** ([F6.10b-i](Ringly_PRD_v3.md#f6-10b-i)): the daily
worker and the webhook handler run the same function over the same state. The
backstop is not a second implementation that might disagree with the first — it
is the first one, on a timer.

**Events subscribed, and what each adds beyond `reevaluate()`:**

| Event                             | Additional work                                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invoice.paid`                    | `billing_events` row; stamp `fixed_fee_state`/`usage_*` observed state                                                                                                                                      |
| `invoice.payment_failed`          | `billing_events` row; enter [§2.10.4](#2104-when-a-charge-fails) if the cause is a card error                                                                                                               |
| `invoice.payment_action_required` | Treated as a decline ([§2.10.4](#2104-when-a-charge-fails))                                                                                                                                                 |
| `invoice.finalized`               | Record `provider_ref` if T2 never landed ([§2.10.11](#21011-transaction-boundaries-and-what-a-crash-leaves))                                                                                                |
| `invoice.voided`                  | `billing_events` row — teardown and hand-corrections both produce it                                                                                                                                        |
| `invoice.marked_uncollectible`    | `billing_events` row; should not occur, so it also alerts                                                                                                                                                   |
| `charge.refunded`                 | `billing_events` row. Goodwill only; no rule produces one ([F5.9](Ringly_PRD_v3.md#f5-9))                                                                                                                   |
| `charge.dispute.created`          | `billing_events` row; enters [§2.10.4](#2104-when-a-charge-fails) exactly as a decline ([F6.17](Ringly_PRD_v3.md#f6-17))                                                                                    |
| `charge.dispute.closed`           | `billing_events` row; a win clears the synthesised debt ([§2.10.6](#2106-coming-back))                                                                                                                      |
| `setup_intent.succeeded`          | Set the customer's default payment method ([§2.10.9](#2109-the-stripe-object-lifecycle-end-to-end), step 4); write the attach row ([§2.10.10a](#21010a-the-card-facts-stripe-answers-the-ledger-remembers)) |
| `payment_method.attached`         | Write a `payment_method_attached` ledger row ([§2.10.10a](#21010a-the-card-facts-stripe-answers-the-ledger-remembers))                                                                                      |
| `payment_method.detached`         | Write a `payment_method_detached` ledger row; alert — a business with no card cannot be charged next period                                                                                                 |

**Nothing outside that list is subscribed to.** An endpoint receiving events it
does not handle is an endpoint whose logs cannot be read for what went wrong.

**Every state the handler writes, it writes as an observation.** `fixed_fee_state`
and the settled figures on `billing_periods` are the last thing Stripe said, kept
locally because [N10](Ringly_PRD_v3.md#n10--durability-of-money-records) requires the money record to survive Stripe being
unreachable — but **`outstanding()` is never answered from them**. A cached
answer to "does this business owe anything" is the single most dangerous stale
value in the product: too high and a paying business stays suspended, too low and
a debtor is served for free.

### 2.10.10a The card facts: Stripe answers, the ledger remembers

**"Does this business have a card" is asked of Stripe, every time it is asked.**
Not of a column ([§2.5.1.7](#2517-the-checklist-step-8)), and not of the ledger
either. Stripe owns payment methods; anything Ringly stores about them is a copy
of somebody else's state, and the whole argument for deleting
`payment_method_attached_at` applies just as well to a `billing_events` row that
stands in for it. A copy with three writers and a repair sweep is still a copy.

```
checklist render
  ├─ items 1 and 2  ← one local row read              (Ringly's own facts)
  └─ item 3         ← stripe.paymentMethods.list({ customer, limit: 1 })
                       AbortSignal.timeout(3000), issued in parallel with the above
```

**What that costs, measured rather than assumed:**

|                       |                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Per-request fee       | **None.** Stripe prices per transaction, not per API call                                                                             |
| Rate limit            | 100 req/s live, 25 req/s per endpoint — not the binding constraint                                                                    |
| Read allocation       | Average **≤500 reads per transaction**, floor **10,000/month**                                                                        |
| Ringly's transactions | ~2 per business per month (fee, settlement) — 20,000/month at [N2.1](Ringly_PRD_v3.md#n2-1)'s 10⁴ businesses, so a 10M read allowance |
| Latency               | One same-region round trip. Bounded by the 3s timeout, not by Stripe's median                                                         |

**The allocation floor is what to watch, not the rate limit.** Early on, 10,000
reads a month is the ceiling regardless of how few transactions there are, and it
is comfortable only because **the checklist is seen by unactivated businesses
alone** — a population bounded by the ten-day clock ([F9.1](Ringly_PRD_v3.md#f9-1))
and by onboarding volume that [N9](Ringly_PRD_v3.md#n9--cost-control-on-the-unauthenticated-surface)
already describes as a handful of businesses a day.

**Which makes one implementation detail load-bearing: the card is read on page
load, never on a timer.** The activation screen does poll — [§2.5.2](#252-activation-touches-three-systems-and-can-fail-at-each)'s
submit-and-poll needs it — but it polls **Ringly's own activation state**, not
Stripe. A five-second poll that included the card read would turn one ten-minute
session into 120 reads and put a handful of businesses through the monthly
allocation on their own.

**Stripe being slow or down degrades one item, never the page.** Items 1 and 2
are Ringly's facts and always render. On timeout item 3 reads _"can't check right
now"_ and Activate stays unavailable — which is not a degradation at all, because
a business cannot add a card while Stripe is down, and Ringly could not charge one
either. **The screen was always Stripe-dependent; this makes the dependency
visible instead of pretending a local row had escaped it.**

**The ledger still records `payment_method_attached` and
`payment_method_detached`, and that is not a contradiction.** They are history,
not the answer — the record of what Stripe told Ringly and when, which is what
`billing_events` is for ([F6.14](Ringly_PRD_v3.md#f6-14), [N10.4](Ringly_PRD_v3.md#n10-4)).
Support asking _"when did they add a card?"_ is answered from it; the checklist
never is.

**That inversion is the whole simplification.** When the ledger was the answer, a
lost webhook was a wrong answer and needed three independent writers, a
`(kind, provider_ref)` uniqueness rule, and a daily sweep over unactivated
businesses to repair a missed detach. Now a lost webhook is **a gap in history**:
it costs a support question its precise date and costs the product nothing. None
of that repair machinery exists, because there is nothing left for it to repair.

### 2.10.11 Transaction boundaries, and what a crash leaves

**The rule is [§2.13.4](#2134-teardown-in-order)'s rule, applied to charging: a database transaction may
never contain an external call.** Every charge is therefore three parts, and the
design's job is to make the middle one recoverable rather than to pretend it is
atomic.

| Part            | Contents                                                                                         | Kind        |
| --------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| **T1 — claim**  | `settlement_claimed_at`, the computed figures, the deterministic key                             | Transaction |
| **X — charge**  | Invoice create + item + finalise + pay ([§2.10.9](#2109-the-stripe-object-lifecycle-end-to-end)) | External    |
| **T2 — record** | `usage_settled_at`, `*_invoice_ref`, `billing_events`, status, deadline rows                     | Transaction |

**T1 commits before X begins.** The alternative — hold the transaction open
across the Stripe call — takes a row lock and a connection for the duration of
somebody else's HTTP request, and a Stripe timeout then rolls back a charge that
did happen.

**What a crash leaves, per boundary:**

| Crash point            | State left behind                                           | Who fixes it                                                                            |
| ---------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Before T1              | Nothing                                                     | Next tick selects the period again                                                      |
| T1 committed, before X | A claimed, unsettled period; no invoice                     | Next tick: claim is stale past a threshold → re-drive X                                 |
| During X               | Possibly an invoice at Stripe with no local row             | The idempotency key within 24h; **`metadata.ringly_period_id` after**                   |
| X done, before T2      | Money may have moved with no local record — **the bad one** | Reconciliation ([§2.10.6](#2106-coming-back)) searches Stripe by metadata and writes T2 |
| After T2               | Correct                                                     | —                                                                                       |

**The row that matters is the fourth**, because it is the only one where the
business's money and Ringly's record disagree, and 2.1.3 says the record is the
strictest thing in the system. Three things make it recoverable and they are
listed in the order they are reached:

1. **The idempotency key is deterministic**, so a retry inside 24 hours returns
   the same invoice rather than raising a second.
2. **The metadata is deterministic**, so past 24 hours the invoice can still be
   found: `stripe.invoices.search({ query: "metadata['ringly_period_id']:'…'" })`.
   This is why every object created in [§2.10.9](#2109-the-stripe-object-lifecycle-end-to-end) carries it — not for reporting,
   for this.
3. **The partial unique indexes in [§2.10.9](#2109-the-stripe-object-lifecycle-end-to-end)** make a second `billing_events` row
   for the same period and kind impossible, so a recovery that runs twice cannot
   double-record what it could not double-charge.

**T2 is one transaction and it must be**, for the same reason [§2.13.4](#2134-teardown-in-order)'s step 8
is: the period's settled figures, the ledger row and the state change describe
one event, and a business that is settled but has no ledger row is a business
whose billing history disagrees with its invoice.

**Nothing in the money tables is deleted or updated in place once settled**
([N10.4](Ringly_PRD_v3.md#n10-4), 2.1.3). Corrections are new `billing_events` rows. The two writes to
already-existing money rows in the whole design are `usage_settled_at` and the
figures beside it (writing a row that was open), and [§2.10.7](#2107-cancellation)'s revoke back-fill
(bounded to an unsettled period). Both are stated here so that a third one is
visible as a change of rule rather than as a patch.

### 2.10.12 Money is integer cents

**Every amount in the design is an integer number of cents, in a column named
`*_cents`, and no float touches any of it.** Not as a style preference: a
binary float cannot represent a hundredth exactly, and the one place the error
shows is the place a clamp compares two amounts and picks the wrong one.

- **Columns are `bigint`.** `integer` would hold every figure this product can
  produce — the cap is 50,000 cents — but lifetime revenue on the departure
  record accumulates, and a money column that has to be widened later is a
  migration on the one table [N10.6](Ringly_PRD_v3.md#n10-6) forbids rewriting.
- **`numeric` is not used either.** It is exact, but it admits fractional cents,
  and a fractional cent that reaches Stripe is a rounding decision made by
  whichever layer truncates first.
- **There is exactly one division in the whole of billing**, and it is integer:
  `minutes = (billable_seconds + 59) / 60`. That is [F6.7a](Ringly_PRD_v3.md#f6-7a)'s "rounded up to a
  whole minute **once**, at period close" written so that it cannot be done
  twice — there is no per-call rounding anywhere to sum up.
- **Comparisons are integer comparisons.** `min`/`max` in the clamp,
  `amount_remaining > 0` in `outstanding()`, `>= cap_cents − fixed_fee_cents` in
  the cap notice.
- **Stripe agrees**, which removes the last conversion: its amounts are integer
  minor units, so `usage_charge_cents` is passed through unchanged and no
  `× 100` or `÷ 100` exists on any path that decides anything.
- **Division by 100 happens once, in the renderer**, for display, and never
  upstream of a comparison or a stored value.

### 2.10.13 What §2.4 must gain

Collected here rather than scattered, so the migration is reviewable as one
thing. None of `005`–`011` has run anywhere, so amending them breaks no
forward-only rule; **where each table lands is a question of what depends on it,
never of when it is scheduled to be built.**

**Two tables 007 does not currently declare:**

```
billing_customers(business_id pk fk, provider, provider_customer_id unique,
                  default_payment_method_ref null, created_at)

provider_events(id pk, provider, type, created_at, received_at)
```

- **`billing_customers` is the missing home for the Stripe customer id.**
  [§2.4](#24-data-model)/007 stores invoice refs on `billing_periods` but nothing holds the
  customer, and without it a business cannot be charged twice. It is a separate
  table rather than columns on `businesses` because 005 is the foundations
  migration and billing is 007 — one concern per file — and because `provider`
  earns its column here for the same reason it does on
  `scheduling_credentials` ([§2.4](#24-data-model)/006).
- **`provider_events` is a delivery log and is deliberately _not_ a money
  table.** [N10.1](Ringly_PRD_v3.md#n10-1) names the money tables and this is not one: it holds no amount,
  and losing it costs at most one redelivered webhook being processed twice,
  which `reevaluate()` is already safe against. Saying so explicitly keeps
  [N10.1](Ringly_PRD_v3.md#n10-1)'s list definite rather than growing by association.

**One column 008 needs:** `lifecycle_deadlines.requested_at timestamptz null` —
operator-supplied, for `cancellation_window_close` only. [F9.2](Ringly_PRD_v3.md#f9-2) judges a
revocation by when the business sent it and [F6.12a](Ringly_PRD_v3.md#f6-12a) needs the instant to identify
the window's usage records; the row's own creation time is when Ringly read the
email, which is the wrong instant and would cost a business its account to
Ringly's inbox latency.

**Columns 007 needs on `billing_periods`:** `settlement_claimed_at timestamptz
null` ([§2.10.3](#2103-settlement-and-the-clamp)), and value domains for two columns it already declares —
`fixed_fee_state ∈ ('pending','invoiced','paid','failed','void')` and
`status ∈ ('open','settled','settled_early','settled_at_deletion')`, the latter
recording which of [F6.9a](Ringly_PRD_v3.md#f6-9a)'s three moments closed the period.

**`billing_events.kind` is a closed set**, so that the append-only ledger can be
summed without a `LIKE`: `fixed_fee_invoiced`, `fixed_fee_paid`,
`fixed_fee_failed`, `usage_invoiced`, `usage_paid`, `usage_failed`,
`invoice_voided`, `refunded`, `dispute_opened`, `dispute_closed`.

**Constraints and indexes, gathered:**

```sql
CREATE UNIQUE INDEX one_open_period_per_business
    ON billing_periods (business_id) WHERE usage_settled_at IS NULL;

ALTER TABLE billing_periods ADD CONSTRAINT periods_never_overlap
  EXCLUDE USING gist (business_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&);

CREATE UNIQUE INDEX one_fee_invoice_per_period
    ON billing_events (period_id) WHERE kind = 'fixed_fee_invoiced';
CREATE UNIQUE INDEX one_usage_invoice_per_period
    ON billing_events (period_id) WHERE kind = 'usage_invoiced';

CREATE UNIQUE INDEX one_usage_record_per_call ON usage_records (call_id);
```

`usage_records (business_id, period_id)` is already in [§2.3.3](#233-physical-layout) and is what makes
the settlement sum and the dashboard's live accrued figure bounded by the
tenant's own size ([N2.2](Ringly_PRD_v3.md#n2-2)).

**Testing this section**

_Observable_ — what a business is charged and when; what it owes; the billing
history rows and their status; whether the number answers; what arrives in the
inbox; what the operator queue shows; the departure record; what exists in the
payment provider's own records for that business.

_Internal_ — `billing_status` and every other state name, the settlement
worker, Stripe object ids, invoice mechanics, idempotency and metadata keys,
webhook routes and event names, table and column names, the constraints above.

_Behaviours owed to the catalogue_

- Activation charges $100 once and opens period 1.
- Usage accrues only on productive calls; enquiries, dropped calls and wrong
  numbers cost nothing.
- The whole call is billed, not the part before the booking.
- Seconds are summed across the period and rounded up once, not per call.
- The fixed fee and the usage settlement never fall on the same day.
- A period is exactly 30 days and is never extended, by anything.
- $470 of usage in a period produces a $500 charge and $70 absorbed.
- Crossing the cap keeps the business served, emails it, and alerts the operator.
- Crossing the cap twice in one period emails once.
- A failed charge starts one 7-day grace, and a second decline does not start a
  second clock.
- Grace usage is billable when a period is open, and free when the failed charge
  was itself a settlement.
- No new period opens while anything is owed.
- A suspended business accrues nothing and is charged nothing new; its debt does
  not grow between day 8 and day 55.
- Paying inside the original period resumes it with nothing new charged.
- Paying after it ended opens a new period that day, charged that day, with the
  debt clearing first.
- A decline on that new period gets a full fresh grace period.
- A dropped payment webhook is caught by reconciliation and the business is
  restored.
- The same webhook delivered twice restores once.
- A payment-succeeded notification arriving before the failure it followed does
  not suspend the business.
- A part payment does not clear the debt or restore service.
- Two settlement runs over the same due period produce one invoice and one
  ledger row.
- A settlement interrupted after the charge and before the record is completed by
  reconciliation, and the business is not charged twice.
- The payment provider being unreachable delays a charge and starts no grace
  clock; a declined card starts one.
- An unclassified call at the end of a period is not billed, and is never billed
  later.
- The amount the dashboard shows accruing is the amount the period is charged.
- Cancelling continues service, stops billing usage, and settles early when the
  window closes.
- Revoking inside the window makes the free usage billable again.
- Revoking twice makes it billable once.
- A revocation sent inside the window but actioned after it closed is honoured,
  and the early settlement is unwound.
- A departing business whose settlement charge fails is recorded as owing it and
  is neither suspended nor chased.
- The $100 is never refunded or prorated on any path.
- A business behind on payment cannot cancel into free service, and its clocks
  keep running.
- A cancelled business that later clears its debt is not charged for a new
  period.
- A chargeback follows the non-payment path exactly, and a chargeback won clears
  the debt.
- A period during which service was suspended says so in its billing-history row.
- Policy is data: changing the fee, the cap, the rate or the billable outcome set
  affects the next period and no settled one.
- No unsigned or wrongly-signed payment webhook has any effect.

## 2.11 Email

The only outbound channel in the product, and it goes to businesses and to the
operator — never to a caller (2.1.2). Nothing here is on a caller's clock: every
send is queued by something else and drained by the minutely dispatcher ([§2.2.2](#222-request-paths-and-background-work)).

**The section is short on prose about tone and long about two mechanisms**,
because those are the parts an implementation gets wrong: a registry that is a
_type_ rather than a document, and a claim/send/record loop whose only failure is
a duplicate.

### 2.11.1 The registry is a type, not a list of documentation

`src/emails/registry.ts` declares every email Ringly can send ([F7.2](Ringly_PRD_v3.md#f7-2)). It is a
value the compiler checks against a mapped type over the closed set of kinds, so
"the registry is complete" and "the registry is the only thing that can be sent"
are both compile-time facts rather than review discipline.

```ts
// src/emails/kinds.ts — the closed set (F7.2)
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
  | "test_calls_exhausted"
  | "account_deleted"
  | "stats_digest";

export type OperatorEmailKind =
  | "operator_cap_reached"
  | "operator_payment_failed"
  | "operator_calendar_unreachable"
  | "operator_activation_stuck"
  | "operator_unactivated_expiring"
  | "operator_number_release_failed"
  | "operator_business_deleted";

export type EmailKind = BusinessEmailKind | OperatorEmailKind;
export type SendingIdentity = "billing" | "service" | "reports" | "operator";
```

Sixteen business kinds are exactly the rows of [F7](Ringly_PRD_v3.md#f7--email)'s business-facing table, and
seven operator kinds are exactly [F7.13](Ringly_PRD_v3.md#f7-13)'s set — **no more, and the sets are closed
on purpose**: [F8.6](Ringly_PRD_v3.md#f8-6) says the operator alerts are "the set in [F7.13](Ringly_PRD_v3.md#f7-13) and no other",
so adding an eighth is a requirement change, not an implementation choice.
`recurring_change` is absent because recurrence left the product ([§2.15.7](#2157-what-changes-in-the-existing-harness)).

**Each kind declares what its template is given, and nothing wider.** A template
that receives a `Business` row would silently start depending on the tenant
existing at render time, which [§2.13.4](#2134-teardown-in-order) forbids.

```ts
// src/emails/props.ts
export type EmailProps = {
  calendar_access_failing: {
    businessId: BusinessId;
    incidentId: IncidentId;
    openedAt: Instant;
    callsRefused: number;
  };
  stats_digest: {
    businessId: BusinessId;
    periodId: PeriodId;
    periodEndsOn: Day;
    calls: number;
    appointmentsBooked: number;
  };
  deletion_warning: {
    businessId: BusinessId;
    deadlineId: DeadlineId;
    dueAt: Instant;
    deletesOn: Day;
    itemised: readonly string[];
  };
  // …one member per EmailKind, and the mapped type below requires all of them
};
```

**The entry type is a discriminated union on audience**, so the combinations that
must not exist cannot be written:

```ts
// src/emails/registry.ts
type Suppression =
  | { readonly transactional: true }
  | {
      readonly transactional: false;
      readonly suppressedWhen: (p: {
        businessId: BusinessId;
      }) => Promise<boolean>;
    };

type Common<K extends EmailKind, P> = {
  readonly kind: K;
  readonly subject: (p: P) => string; // ≤ 60 chars (F7.10)
  readonly template: (p: P) => ReactElement; // src/emails/templates/<kind>.tsx (F7.3)
  readonly reason: (p: P) => ReasonKey; // §2.11.4
};

type BusinessEntry<K extends BusinessEmailKind, P> = Common<K, P> &
  Suppression & {
    readonly audience: "business";
    readonly identity: Exclude<SendingIdentity, "operator">;
    readonly recipient: (p: P) => BusinessId; // → businesses.contact_email (F7.1)
  };

type OperatorEntry<K extends OperatorEmailKind, P> = Common<K, P> & {
  readonly audience: "operator";
  readonly identity: "operator"; // never one of the other three
  readonly transactional: true; // F7.4 gives the operator no opt-out
};

type Entry<K extends EmailKind> = K extends BusinessEmailKind
  ? BusinessEntry<K, EmailProps[K]>
  : K extends OperatorEmailKind
    ? OperatorEntry<K, EmailProps[K]>
    : never;

export const REGISTRY: { readonly [K in EmailKind]: Entry<K> } = {
  /* … */
} as const;
```

**Three impossible states fall out of that shape, and each is a bug someone would
otherwise have written**: a business email sent from the operator identity; an
operator alert a business could opt out of; and a non-transactional email with no
predicate saying who opted out — `transactional: false` cannot compile without
`suppressedWhen`, so "unsubscribable" and "we check the unsubscribe" are one
decision instead of two ([F7.4](Ringly_PRD_v3.md#f7-4)).

**Two real entries**, one of each shape:

```ts
calendar_access_failing: {
  kind: "calendar_access_failing",
  audience: "business",
  identity: "service",
  transactional: true,                                    // F7.4
  recipient: (p) => p.businessId,
  subject: () => "Ringly can't reach your calendar",      // 34 chars (F7.10)
  template: CalendarAccessFailing,
  reason: (p) => perIncident("calendar_access_failing", p.incidentId),   // F2.7
},

stats_digest: {
  kind: "stats_digest",
  audience: "business",
  identity: "reports",
  transactional: false,                                   // the only one (F7.4)
  suppressedWhen: ({ businessId }) => digestOptedOut(businessId),
  recipient: (p) => p.businessId,
  subject: (p) => `Your Ringly summary to ${formatDay(p.periodEndsOn)}`,
  template: StatsDigest,
  reason: (p) => perPeriod("stats_digest", p.periodId),
},
```

**Templates are React Email components versioned in this repository** ([F7.3](Ringly_PRD_v3.md#f7-3)),
reviewed in pull requests like any other code. No hosted template editor and no
copy living in a vendor UI, because a change to what a customer reads deserves
the same scrutiny as a change to what the code does.

**Ringly does not send the success path** ([F7.3a](Ringly_PRD_v3.md#f7-3a)). Receipts, invoices and
payment-succeeded notices are Stripe's, and their absence from `EmailKind` is how
that is enforced rather than remembered — there is no `receipt` kind to call.

### 2.11.2 Enforcing "if it is not in the registry it is not sent"

**Three layers, because each closes a different hole, and the interesting one is
the third.**

| Layer                                                                | Catches                                                   | Why the others do not                                                            |
| -------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Type** — `enqueue<K extends EmailKind>(kind: K, p: EmailProps[K])` | An unknown kind, or a known kind with the wrong props     | Compile-time only; says nothing about code that skips `enqueue`                  |
| **Runtime** — `CHECK (kind IN (…))` on `email_sends` (010)           | A row inserted by a script, a migration, or `/ops`        | The type is erased at runtime and the database is reachable by more than the app |
| **Lint** — the vendor SDK is importable from one file only           | Somebody calling the provider directly and never queueing | Neither of the above sees a send that never becomes a row                        |

**The type-level constraint is the front door.** The sending module exports
exactly one function, and it takes a kind and that kind's props — never a subject
and never a body:

```ts
export async function enqueue<K extends EmailKind>(
  kind: K,
  props: EmailProps[K],
): Promise<void>;
```

There is no overload accepting free-form content, so composing an unregistered
message is not something the API can express.

**The runtime guard is the database, not an `if`.** `email_sends.kind` carries a
`CHECK` against the literal list, added by migration 010 alongside the table
([§2.4](#24-data-model)/010). An application-level check would be a fourth copy of the same list
that could drift; a constraint is one the database enforces against every writer,
including a hand-run `INSERT` during an incident.

**The lint rule is the one that actually closes it.** Neither of the first two
stops an engineer importing the delivery SDK into a route handler and calling
`send()` on it. So `no-restricted-imports` forbids the vendor package everywhere
except `src/emails/dispatcher.ts`, and that file is the only place a message
reaches the network. **A type system constrains what goes through the door; the
lint rule is what stops somebody building a second door.**

### 2.11.3 Four sending identities, and how a template is bound to one

Billing, service, reports and operator alerts each send from their own address
([F7.11](Ringly_PRD_v3.md#f7-11)), so a digest nobody opens can never harm the reputation of the address
that tells someone their payment failed.

**Separation has to be at the subdomain, not just the local part.** Four `From`
addresses on one sending domain share one reputation and one DKIM key, which
would make [F7.11](Ringly_PRD_v3.md#f7-11) decorative — so the four identities are four sending
subdomains, each with its own DKIM key and its own warm-up. _(Decision — [F7.11](Ringly_PRD_v3.md#f7-11)
requires separate identities and does not say at what level; [§2.11.10](#21110-decisions-this-section-makes-that-the-prd-does-not).)_

| Identity   | Carries                                                                                                      | What its reputation must survive                      |
| ---------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `billing`  | Upcoming charge, payment failure and follow-ups, suspension, closing                                         | Nothing — this is the stream that must reach an inbox |
| `service`  | Verification, welcome, calendar failure, deletion warning, deletion                                          | Nothing — [I4](Ringly_PRD_v3.md#i4) depends on it     |
| `reports`  | The stats digest, and only the digest                                                                        | Being ignored, marked as spam, and unsubscribed from  |
| `operator` | The seven alerts in [F7.13](Ringly_PRD_v3.md#f7-13), to Ringly's own address ([F7.1](Ringly_PRD_v3.md#f7-1)) | Volume, and being filtered by one recipient           |

**Binding is by data, in one place.** The registry entry names an identity;
`src/emails/identities.ts` maps each identity to `{ from, replyTo, domain }` read
from configuration; the dispatcher takes no from-address argument at all. So the
envelope address for a stream is written once, and a template cannot choose its
own.

**Which identity and which reason shape each kind uses**, in full — this is the
table an implementer copies:

| Kind                             | Identity   | Shape      | Anchor the key is built from                                                   |
| -------------------------------- | ---------- | ---------- | ------------------------------------------------------------------------------ |
| `email_verification`             | `service`  | per event  | `business_id` + digest of the normalised address                               |
| `welcome_now_live`               | `service`  | per event  | `business_id` — `activated_at` is set once ([F1.12a](Ringly_PRD_v3.md#f1-12a)) |
| `upcoming_charge`                | `billing`  | per period | `billing_periods.id`                                                           |
| `payment_failed`                 | `billing`  | per event  | the `grace_expiry` deadline id — created only at the first decline             |
| `payment_follow_up`              | `billing`  | per event  | the `nonpayment_deletion` deadline id + the schedule offset in days            |
| `suspension_notice`              | `billing`  | per event  | the `grace_expiry` deadline id                                                 |
| `service_restored`               | `billing`  | per event  | the `billing_events.id` of the payment that cleared the debt                   |
| `deletion_warning`               | `service`  | per event  | the deadline id **+ its `due_at`**                                             |
| `cap_reached`                    | `billing`  | per period | `billing_periods.id`                                                           |
| `cancellation_confirmed`         | `service`  | per event  | the `cancellation_window_close` deadline id                                    |
| `cancellation_countdown`         | `service`  | per event  | the same deadline id + the schedule offset in days                             |
| `closing_statement`              | `billing`  | per event  | the `cancellation_window_close` deadline id                                    |
| `calendar_access_failing`        | `service`  | incident   | `calendar_incidents.id`                                                        |
| `test_calls_exhausted`           | `service`  | per event  | the `calls.id` of the fifth call                                               |
| `account_deleted`                | `billing`  | per event  | `business_id`                                                                  |
| `stats_digest`                   | `reports`  | per period | `billing_periods.id`                                                           |
| `operator_cap_reached`           | `operator` | per period | `billing_periods.id`                                                           |
| `operator_payment_failed`        | `operator` | per event  | the `grace_expiry` deadline id                                                 |
| `operator_calendar_unreachable`  | `operator` | incident   | `calendar_incidents.id`                                                        |
| `operator_activation_stuck`      | `operator` | per event  | the `calls.id` of the fifth call                                               |
| `operator_unactivated_expiring`  | `operator` | per event  | the `unactivated_deletion` deadline id + its `due_at`                          |
| `operator_number_release_failed` | `operator` | per event  | `business_id` + the reason the unbind was attempted                            |
| `operator_business_deleted`      | `operator` | per event  | `business_id`                                                                  |

**The business notice and the operator alert for the same fact share an anchor
and differ in kind**, which is exactly why the kind is a component of every key
([§2.11.4](#2114-reason-keys-constructed-so-two-workers-agree)): one calendar outage produces one email to the business and one to the
operator, and the unique index does not collapse them.

### 2.11.4 Reason keys, constructed so two workers agree

`reason_key` is unique ([§2.4](#24-data-model)/010) and answers **"is there a reason to send this at
all"** — a different question from how many times a send is attempted, and
conflating them is what produced the earlier at-most-once design. Deduplicating
the _reason_ is correct and cheap; deduplicating the _delivery_ costs the message
when a worker dies at the wrong moment.

```ts
// src/emails/reason.ts
export type ReasonKey = string & { readonly __reasonKey: unique symbol };

const key = (...parts: readonly string[]) => parts.join(":") as ReasonKey;

export const perPeriod = (k: EmailKind, period: PeriodId) =>
  key(k, "period", period);
export const perIncident = (k: EmailKind, incident: IncidentId) =>
  key(k, "incident", incident);
export const perEvent = (k: EmailKind, ...anchor: readonly string[]) =>
  key(k, "event", ...anchor);
```

**The one rule that makes independent computation agree: every component is a
primary key or an immutable stored column — never a clock, never a formatted
date, never `now()`.** Two dispatchers, two sweeper runs or a retried timer all
read the same `billing_periods.id`, so they compute the same string without
coordinating. A key containing a rounded timestamp would have two workers either
side of a minute boundary disagree, and the business would receive the digest
twice for one reason.

**Per period** — the digest, the upcoming-charge notice and the cap notice, keyed
on `billing_periods.id`. The period id rather than a month, because a suspended
business's periods do not line up with calendar months ([F6.11b](Ringly_PRD_v3.md#f6-11b)) and a month
string would merge two of them.

**Per incident** — the calendar outage, keyed on `calendar_incidents.id`. The id
comes from the `RETURNING id` of [§2.6.4](#264-fail-closed-concretely)'s `ON CONFLICT DO NOTHING` insert, so only
the call that _opened_ the incident has one to key on. **The partial unique index
does the arbitration and the reason key is the second belt**: forty simultaneous
failures produce one incident row, hence one email, and if a retry of that same
handler ran twice the reason key would still collapse it ([F2.7](Ringly_PRD_v3.md#f2-7)).

**Per event** — one reason per discrete occurrence, and the anchor is whichever
row already records that occurrence ([§2.11.3](#2113-four-sending-identities-and-how-a-template-is-bound-to-one)'s table). Three of these are worth
spelling out because the obvious anchor is wrong:

- **`deletion_warning` includes the deadline's `due_at`, not just its id.**
  [§2.4](#24-data-model)/008 requires that a paused clock cannot warn and an extended clock re-warns
  at the right time. Keying on the deadline id alone would suppress the second
  warning after a pause and resume — a business would be deleted having been
  warned about a date that moved. `due_at` is a stored column both workers read,
  so the key changes exactly when the thing being warned about changes.
- **`test_calls_exhausted` is keyed on the fifth `calls.id`**, not on the
  business. The operator can reset the allowance ([F9.1c](Ringly_PRD_v3.md#f9-1c)) and the business can
  exhaust it again; keyed on `business_id` the second exhaustion would be silent
  and the number would stop answering with nobody told ([F1.13a](Ringly_PRD_v3.md#f1-13a)).
- **`operator_number_release_failed` is keyed on the business plus the reason for
  the unbind.** The same business can fail to release at the test-call limit and
  again at suspension, and those are two different alerts. Repeated failures of
  the _same_ attempt are one reason to alert; the persistent surface is the
  "Number not released" row in the operator's queue ([F8.12](Ringly_PRD_v3.md#f8-12)), not a second email.

**The enqueue is the same shape as [§2.6.4](#264-fail-closed-concretely)'s incident insert, and deliberately
so** — one statement, no read-then-write, no application lock:

```sql
INSERT INTO email_sends (reason_key, business_id, kind, to_address, identity,
                         subject, body, provider_idempotency_key, queued_at, attempts)
VALUES ($1, $2, $3, $4, $5, $6, $7, gen_random_uuid(), now(), 0)
ON CONFLICT (reason_key) DO NOTHING
RETURNING id;
```

Nothing returned means another worker already had this reason, and the caller
does nothing — no error, no log line worth reading. **Where the enqueue follows a
database write, it is in that write's transaction**: the sweeper stamps
`warned_at` on the deadline and inserts the email row together, so a crash between
them is impossible and re-running the sweeper is a no-op twice over. The one
exception is the call path, where the enqueue happens after the handler has
answered the agent ([N3.2](Ringly_PRD_v3.md#n3-2), [§2.6.4](#264-fail-closed-concretely)).

**`provider_idempotency_key` is a fresh UUID, not the reason key.** It is sent
with the message so the provider collapses a redelivery before it reaches an
inbox ([F7.5](Ringly_PRD_v3.md#f7-5)), and it is random because the reason key contains internal row ids
that have no business appearing in a header at a third party.

### 2.11.5 Rendering happens at enqueue, not at send

`subject` and `body` are rendered when the row is written ([§2.4](#24-data-model)/010). **Teardown
is the reason, and it is not a corner case**: [§2.13.4](#2134-teardown-in-order) enqueues the deletion email
at step 6 and deletes the business's rows at step 8, so a template that resolved
the tenant at send time would fail on the one path where the message matters most.
`to_address` is stored for the same reason — the contact address lives on the
tenant row and `departed_businesses` deliberately keeps none ([F9.9](Ringly_PRD_v3.md#f9-9)).

Two consequences worth stating because they are properties, not accidents:

- **A template change never rewrites a queued message.** What a business receives
  is what was true when the event happened, not what the deploy at 3am says.
- **The dispatcher needs no tenant read at all.** It selects a row and posts it;
  it never touches `businesses`, never resolves a service or a price, and
  therefore cannot be broken by tenant state changing under it. That is also what
  keeps it cheap enough to run minutely at [N2.1](Ringly_PRD_v3.md#n2-1)'s scale.

The cost is that a figure baked into a body can go stale between enqueue and
delivery. Acceptable, because [F7.9](Ringly_PRD_v3.md#f7-9) requires absolute dates and stated amounts
precisely so a delayed message still reads correctly.

### 2.11.6 The dispatcher: claim, send, record

The email dispatcher ([§2.2.2](#222-request-paths-and-background-work)) is an idempotent HTTP endpoint invoked minutely by
an external timer ([N8.3](Ringly_PRD_v3.md#n8-3)). It may be invoked twice concurrently, and a deploy may
overlap a run, so **the claim has to be safe against a second worker rather than
assume there is not one**.

```sql
WITH due AS (
  SELECT id
    FROM email_sends
   WHERE sent_at IS NULL
     AND attempts < 8
     AND (claimed_at IS NULL
          OR claimed_at < now() - interval '1 minute'
                                  * least(power(3, attempts)::int, 240))
   ORDER BY queued_at
   LIMIT 50
   FOR UPDATE SKIP LOCKED
)
UPDATE email_sends e
   SET claimed_at = now(),
       attempts   = e.attempts + 1
  FROM due
 WHERE e.id = due.id
RETURNING e.id, e.kind, e.to_address, e.identity, e.subject, e.body,
          e.provider_idempotency_key;
```

**`FOR UPDATE SKIP LOCKED` is what makes two workers safe**: the second worker's
`SELECT` steps over the rows the first has locked and claims the next fifty
instead, so both make progress and neither waits. Without `SKIP LOCKED` the second
worker blocks on the first's transaction for as long as the batch takes, which at
a minutely cadence means the runs pile up behind each other.

**`attempts` is incremented at claim, not at outcome, and that is the load-bearing
choice.** A worker that dies mid-send has already spent its attempt, so a message
whose content reliably kills the process is retried seven more times and stops —
not for ever. Incrementing on the recorded outcome would mean a crash advances
nothing and the row is claimed again immediately, in a loop, at one attempt per
minute until somebody notices.

**`claimed_at` doubles as "when the last attempt started"**, which is why no
`next_attempt_at` column is needed: the backoff is a function of `attempts`
computed in the predicate, and [§2.4](#24-data-model)/010's columns are sufficient as declared.

The run, with what is synchronous marked:

```
1. claim a batch                        one statement, committed         ≤ 50 rows
2. for each claimed row, ≤ 8 at a time:
     3. POST to the delivery provider   network, AbortSignal.timeout(10_000)   ← the only await
     4. record the outcome              one statement, committed
5. return 200 with { claimed, sent, deferred, dead }
```

Recording, in the three cases:

```sql
-- sent
UPDATE email_sends SET sent_at = now(), last_error = NULL WHERE id = $1;
-- transient failure: attempts was already advanced at claim, so this only annotates
UPDATE email_sends SET last_error = $2 WHERE id = $1;
-- permanent failure: jump to the ceiling so the claim predicate excludes it
UPDATE email_sends SET attempts = 8, last_error = $2 WHERE id = $1;
```

**The duplicate that at-least-once accepts is produced between step 3 and step 4,
and nowhere else.** The provider has taken the message; the process dies before
`sent_at` is written; `claimed_at` ages past the backoff; a later run claims the
row and sends it again. **That is chosen, not tolerated** ([F7.5](Ringly_PRD_v3.md#f7-5)): recording the
intent before the send would lose the message on the same crash, and the messages
here are the ones a business cannot afford to miss — [I4](Ringly_PRD_v3.md#i4) makes the 48-hour deletion
warning unconditional, and an at-most-once deletion warning is an invariant that
silently is not one.

**Three things keep the duplicate cheap**, and all three are already in the
design: the provider idempotency key usually collapses it before delivery
([§2.11.4](#2114-reason-keys-constructed-so-two-workers-agree)); every footer says to ignore the message if it has already arrived
([F7.7](Ringly_PRD_v3.md#f7-7)); and the reason key means a duplicate is only ever a redelivery of one
reason, never a second reason invented by a retry.

**A provider outage delays delivery and loses nothing** ([N7.1](Ringly_PRD_v3.md#n7-1), [§2.14.3](#2143-degradation-n7)). Rows
accumulate with `sent_at` null, calls continue to be answered throughout, and the
queue drains when the provider returns.

### 2.11.7 Retry, backoff, and what happens to a message that will never send

**Eight attempts, exponential base three from one minute, capped at four hours**:
1, 3, 9, 27, 81, 240, 240, 240 minutes — roughly **14¾ hours** from first attempt
to dead letter. _(Decision — the PRD sets no retry budget; [§2.11.10](#21110-decisions-this-section-makes-that-the-prd-does-not).)_ The number
is chosen by the tightest deadline any email has: the deletion warning must arrive
inside the 48-hour window [I4](Ringly_PRD_v3.md#i4) makes unconditional ([F9.3a](Ringly_PRD_v3.md#f9-3a)), so the whole retry
budget has to fit inside it with room for the sweeper's own lateness. A longer
budget would let a message still be retrying when the thing it warned about has
already happened.

**The taxonomy is what decides retry, and getting it wrong is expensive in both
directions** — retrying a permanent failure burns the budget on something that
cannot succeed, and dead-lettering a transient one drops a message the design
promised to deliver.

| Class         | Signals                                                                                                                                          | Treatment                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| **Transient** | Connection reset, DNS failure, request timeout, HTTP 429, any HTTP 5xx                                                                           | Retry on the schedule                            |
| **Permanent** | HTTP 422 malformed or invalid recipient, 401/403 credential or unverified domain, recipient on the provider's suppression list, payload rejected | Dead-letter immediately; do not spend attempts   |
| **Ambiguous** | Timeout _after_ the request was accepted; 502/504 from something in front of the provider                                                        | **Treated as transient** — this is the duplicate |

**Ambiguous resolves to transient deliberately.** The failure it risks is a second
copy; the failure the other choice risks is silence, and [§2.4](#24-data-model)/010 has already
decided which of those Ringly prefers.

**A 401 or 403 is permanent for the row and systemic for everything else.** A bad
API key or an unverified sending domain fails every message in the queue, so the
dispatcher treats the class as permanent per row but the endpoint returns a
non-2xx overall, which is what the timer's own failure alerting sees. Otherwise a
credential rotation gone wrong dead-letters the entire queue in one quiet run.

**A dead letter is `sent_at IS NULL AND attempts >= 8`** — one definition, not
two, which is why a permanent failure jumps `attempts` to the ceiling rather than
setting a separate flag. `last_error` says which class it was.

**Who finds out: the operator, by name and by business.** [F7.15](Ringly_PRD_v3.md#f7-15) makes
undeliverable mail a named condition on the "needs attention" queue ([F8.12](Ringly_PRD_v3.md#f8-12),
[§2.12](#212-the-operator-surface)) — **"email undeliverable"**, one row per business, carrying the kind that
failed and when. It is deliberately **not** an alert email ([F7.13](Ringly_PRD_v3.md#f7-13)'s set stays
closed): an address that bounces is a queue entry to work through, not a page in
the night, and emailing about email is its own kind of foolish.

The dispatcher's response body also carries `dead`, so the timer's own monitoring
sees a non-zero value without reading the database.

**A dead-lettered deletion warning does not stop the deletion.** The teardown gate
is `warned_at` stamped at least 48 hours earlier ([§2.4](#24-data-model)/008), not a delivery
confirmation — because under at-least-once no delivery confirmation exists, and
gating on one would make a business with a permanently invalid contact address
undeletable for ever, holding a rented number nobody is paying for. The dead
letter is how a human finds out that a particular warning went nowhere — and
under [F7.15](Ringly_PRD_v3.md#f7-15) it is a named queue condition rather than a number in a panel, which
is the difference between someone noticing and someone theoretically being able
to. _(Decision; [§2.11.10](#21110-decisions-this-section-makes-that-the-prd-does-not).)_

### 2.11.7a Delivered is not the same as accepted — the bounce webhook

**The retry loop above covers the wrong half of the problem.** It knows whether
Resend _accepted_ the message. It cannot know whether the recipient's mail server
did, because that happens seconds to hours later, on somebody else's
infrastructure, long after the dispatcher recorded `sent_at` and moved on.

That second failure is the one [F7.15](Ringly_PRD_v3.md#f7-15) calls the dangerous one, and it is the
common one: **a contact address that is wrong, dead, or full produces it every
single time**, and it looks like success at every point except the inbox. [F1.11](Ringly_PRD_v3.md#f1-11)
verifies the address at onboarding, which catches it being wrong on day one and
says nothing about it going bad on day four hundred.

**So Ringly subscribes to Resend's webhook.**

```
POST /api/webhooks/resend          signature-verified before parsing (N6.3)

email.bounced     → UPDATE email_sends SET bounced_at = now(), last_error = $2
                     WHERE provider_message_id = $1        ← permanent
email.complained  → same, plus the address is treated as suppressed
email.delivered   → subscribed to, deliberately not stored
```

- **`provider_message_id` is the id Resend returns from the send**, stored at
  step 4 of [§2.11.6](#2116-the-dispatcher-claim-send-record). It is the only join between a queue row and a delivery
  event, so a send that does not record it is a message whose fate is
  unknowable.
- **`email.delivered` is subscribed to and thrown away.** Nothing in the design
  acts on a success, storing one would double the write volume of the whole email
  path, and a row that is neither bounced nor complained is already the answer.
  It is subscribed to only so that a gap in the event stream is visible if
  somebody ever needs to debug one.
- **`email.delivery_delayed` is not permanent** and is ignored; the recipient's
  server is still trying, and Resend will follow it with a `delivered` or a
  `bounced`.

**Undeliverable therefore has two definitions and one meaning:**

```sql
-- the condition behind F8.12's "email undeliverable" row
WHERE (sent_at IS NULL AND attempts >= 8)   -- never got out of Ringly
   OR bounced_at IS NOT NULL                -- got out, and came back
```

Both mean the same thing to the business — **they were not told** — which is why
they are one queue condition and not two. What differs is the operator's next
move, and `last_error` is what distinguishes them.

**A bounce is not retried.** A hard bounce is the recipient's server stating a
permanent fact, and re-sending is how a sending domain's reputation is destroyed
([F7.11](Ringly_PRD_v3.md#f7-11) exists to contain that blast radius, not to license ignoring it).

### 2.11.8 Format, and the single unsubscribable email

Plain and utilitarian ([F7.6](Ringly_PRD_v3.md#f7-6)) — no images, no web fonts, no columns, no marketing
voice. These are messages about money and service interruptions and should read
like a utility bill, surviving Gmail clipping and Outlook. Fixed structure
([F7.7](Ringly_PRD_v3.md#f7-7)), at most one call to action. **Every email states what happened, what it
means for the reader, and what happens next if they do nothing** ([F7.8](Ringly_PRD_v3.md#f7-8)). Amounts
carry currency and dates are absolute, never relative ([F7.9](Ringly_PRD_v3.md#f7-9)), because delivery may
be delayed by up to the whole retry budget above. **Subject lines stay under about
60 characters, state the situation rather than tease it, and never carry urgency
the body does not justify** ([F7.10](Ringly_PRD_v3.md#f7-10)).

Two of those are checkable rather than reviewable, so they are checked: the
60-character bound is asserted against every registry entry's `subject` over
representative props, and the footer line is in the shared layout component rather
than in each template, so **[F7.7](Ringly_PRD_v3.md#f7-7)'s "on every email, without exception" is
structural** — there is no template that could omit it.

**Transactional mail cannot be unsubscribed from** ([F7.4](Ringly_PRD_v3.md#f7-4)). A business cannot opt
out of being told its payment failed or its data is about to be deleted. Only the
stats digest is optional, and three things follow:

- **The opt-out is a nullable `digest_opted_out_at` on `businesses`, added by
  migration 010** — [F7](Ringly_PRD_v3.md#f7--email)'s migration, not 005's, because it is [F7](Ringly_PRD_v3.md#f7--email)'s concern and 005
  ships a phase earlier ([§2.16](#216-delivery-plan)). _(Decision — the PRD gives the business the
  control ([F7.4](Ringly_PRD_v3.md#f7-4)) and neither [§2.4](#24-data-model) revision records where it lives; [§2.11.10](#21110-decisions-this-section-makes-that-the-prd-does-not).)_
- **`suppressedWhen` is evaluated at enqueue, not at send**, consistent with
  rendering ([§2.11.5](#2115-rendering-happens-at-enqueue-not-at-send)). A business that opts out after the digest is queued
  receives that one and no more — acceptable for the only optional email, and the
  alternative would make the queue's contents stop being a promise.
- **`List-Unsubscribe` is set on the digest and on nothing else.** A one-click
  unsubscribe header on a dunning email is an invitation to suppress exactly the
  messages [F7.4](Ringly_PRD_v3.md#f7-4) says cannot be suppressed, and once a provider records a
  suppression the deletion warning stops being deliverable.

### 2.11.9 Operator alerts are a different product on the same machinery

Read on a phone, at an inconvenient moment ([F7.12](Ringly_PRD_v3.md#f7-12)). Each **leads with the business
name and the money at stake**, and says what happens if it is ignored. No
reassurance, no marketing voice.

**They share the table, the reason keys, the claim loop and the retry schedule,
and differ in four places** — because the alternative is a second at-least-once
machine with its own way of losing messages:

| Where they differ         | Business email                                             | Operator alert                                                                                            |
| ------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Recipient resolution      | `businesses.contact_email` ([F7.1](Ringly_PRD_v3.md#f7-1)) | Ringly's alert address, from configuration ([F7.1](Ringly_PRD_v3.md#f7-1))                                |
| `email_sends.business_id` | Who it is going to                                         | Who it is **about** — never the recipient                                                                 |
| Suppression               | The digest may be suppressed                               | Never; the type makes it unwritable ([§2.11.1](#2111-the-registry-is-a-type-not-a-list-of-documentation)) |
| Subject construction      | States the situation                                       | Business name **and** figure, in that order                                                               |

**The subject is the alert.** An operator triaging from a notification preview
gets the name and the number or gets nothing useful, so the builder truncates the
business name and never the money:

```ts
subject: (p) =>
  `${clip(p.businessName, 28)} — cap reached, ${money(p.absorbedCents)} absorbed`,
```

**The failed-unbind alert is the one with no other symptom** ([F7.13a](Ringly_PRD_v3.md#f7-13a), [§2.5.3](#253-bind-and-unbind-are-verified-by-reading-provider-state-back)).
Every other component believes service has stopped, so the alert is the only
thing standing between an unmetered answering number and someone happening to
look. It carries the same urgency as a cap breach, because it is money leaving.
It is also why its enqueue sits in the unbind's read-back path rather than in a
sweeper: nothing else will ever revisit that business to notice.

**An unactivated business is raised before its 10-day clock runs out** ([F8.6a](Ringly_PRD_v3.md#f8-6a)),
**72 hours ahead** _(decision — [F8.6a](Ringly_PRD_v3.md#f8-6a) requires room to act and names no
interval; [§2.11.10](#21110-decisions-this-section-makes-that-the-prd-does-not))_, keyed on the deadline's `due_at` so a paused and resumed
clock re-raises at the right time, exactly as the deletion warning does. Stuck
means it _cannot_ activate and Ringly is the blocker ([F1.13a](Ringly_PRD_v3.md#f1-13a)); expiring means it
_has not_, for any reason, and is about to be deleted with its number released.
After that the number is gone to the carrier and the account is a stranger — an
outcome worth one email to avoid, given a signup already cost enrichment, a
number, and up to five calls.

**Moving them to Slack is a transport change, not a rewrite** ([F7.14](Ringly_PRD_v3.md#f7-14), [§1.9](Ringly_PRD_v3.md#19-deferred)), and
the design is already shaped for it: kinds, reason keys, the queue table, the
claim loop and the retry schedule are all transport-independent, and the only
thing an operator entry holds that is email-specific is its `template`. The move
adds a second `deliver()` selected on `identity === "operator"` and leaves
everything that makes delivery reliable untouched.

### 2.11.10 Decisions this section makes that the PRD does not

Flagged rather than buried, because each is a place where an implementer would
otherwise guess:

| Decision                                                                                                                                                     | Reasoning                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Eight attempts, base-3 backoff capped at 4 hours (≈14¾ h total)**                                                                                          | Sized to fit inside [I4](Ringly_PRD_v3.md#i4)'s 48-hour warning window ([F9.3a](Ringly_PRD_v3.md#f9-3a)) with slack for the sweeper                                                                                                                                                                                                                                |
| **Batch of 50, concurrency of 8, 10 s per send**                                                                                                             | Drains far faster than the minutely cadence at [N2.1](Ringly_PRD_v3.md#n2-1)'s volumes; small enough that a stuck batch is one minute of lag                                                                                                                                                                                                                       |
| **~~A dead letter alerts nobody~~ — resolved: it is a named "needs attention" condition ([F7.15](Ringly_PRD_v3.md#f7-15), [F8.12](Ringly_PRD_v3.md#f8-12))** | This section flagged it as the constraint most worth pushing back into the PRD, and the PRD took it. It is a queue condition, not an alert email — [F7.13](Ringly_PRD_v3.md#f7-13)'s set stays closed                                                                                                                                                              |
| **Teardown gates on `warned_at`, not on delivery confirmation**                                                                                              | At-least-once yields no confirmation; gating on one makes a bad address block deletion for ever                                                                                                                                                                                                                                                                    |
| **`digest_opted_out_at` on `businesses`, in migration 010**                                                                                                  | [F7.4](Ringly_PRD_v3.md#f7-4) gives the control and no [§2.4](#24-data-model) revision records where it lives; it is [F7](Ringly_PRD_v3.md#f7--email)'s concern                                                                                                                                                                                                    |
| **Suppression and rendering both evaluated at enqueue**                                                                                                      | One rule instead of two, and consistent with [§2.13.4](#2134-teardown-in-order)'s requirement that the tenant may be gone                                                                                                                                                                                                                                          |
| **Four sending _subdomains_, not four addresses on one domain**                                                                                              | [F7.11](Ringly_PRD_v3.md#f7-11)'s protection is reputational, and reputation is per domain                                                                                                                                                                                                                                                                         |
| **The per-kind identity mapping in [§2.11.3](#2113-four-sending-identities-and-how-a-template-is-bound-to-one)**                                             | [F7.11](Ringly_PRD_v3.md#f7-11) fixes four streams and does not assign kinds to them                                                                                                                                                                                                                                                                               |
| **`deletion_warning` sends from `service`, not `billing`**                                                                                                   | It fires on three clocks and only two involve money; what the reader loses is the number answering                                                                                                                                                                                                                                                                 |
| **Follow-up cadences: grace at days 3 and 6, suspension every 14 days to day 56; cancellation countdown at days 3 and 6**                                    | [F6.11](Ringly_PRD_v3.md#f6-11) and [F6.11b-i](Ringly_PRD_v3.md#f6-11b-i) require follow-ups and set no cadence. The offsets are the key's second component ([§2.11.3](#2113-four-sending-identities-and-how-a-template-is-bound-to-one)) so they are deterministic, and they stop short of the deletion warning so the last thing a business reads is the warning |

**Testing this section**

_Observable_ — what arrives, to whom, from which identity, when, and what it
says; that nothing outside the registry ever arrives; that a business opted out of
the digest still receives everything else.

_Internal_ — the registry file, template components, the queue table, the worker,
the delivery vendor, the claim SQL, the backoff schedule, the literal reason-key
strings, the attempt ceiling, and which migration carries the opt-out column.

_Behaviours owed to the catalogue_

- Each registry email is sent at the moment its requirement says, and not before.
- Nothing outside the registry is ever sent.
- A worker retry after a dropped delivery sends the message — a second copy is
  acceptable, silence is not.
- A worker dying between sending and recording still leaves the business having
  received the message.
- One outage produces one reason to email, however many calls it fails.
- The deletion email arrives even though the business it describes no longer
  exists.
- The provider being down delays mail and loses none; calls keep working.
- Billing, service, reports and operator mail arrive from four distinct
  addresses.
- A business can opt out of the digest and cannot opt out of a deletion warning.
- Dates in emails are absolute.
- The deletion warning arrives 48 hours ahead, on every path.
- The business and the operator are both told when a business is deleted.
- Two dispatchers running at the same moment never both claim the same queued
  message.
- Two components that independently decide to send the same digest for the same
  period produce one queued message.
- One calendar outage produces both a business email and an operator alert, and
  one of each.
- A provider outage lasting hours delivers the message when it returns, still
  inside the 48-hour window.
- A message to an address the provider rejects outright stops being retried
  rather than consuming its whole budget, and the deletion it warned about still
  happens.
- A deletion warning is sent again, for the new date, after a paused clock is
  resumed to a later one.
- A business whose test-call allowance is reset and exhausted a second time is
  told a second time.
- Changing a template does not alter a message already queued.
- An operator alert's subject carries the business name and the figure.
- The number-release alert is raised once and the operator's queue keeps showing
  the business until it is resolved.
- Every email's footer tells the reader to ignore it if it has already arrived.

## 2.12 The operator surface

`/ops` — the only screen that reads across tenants, and therefore a walled
garden ([F8.1](Ringly_PRD_v3.md#f8-1)).

**Its own module, its own routes, its own database role, no shared session with
the business app.** No business owner may reach it by any route with any
credential.

**The borrowed view is a render, not an impersonation** ([F8.2e](Ringly_PRD_v3.md#f8-2e)). The operator
picks a business by name and sees that business's dashboard as it sees it,
banner-marked, **read-only — every control absent rather than disabled**. There
is no customer-deletion control to hide: the product has none ([§2.13.5](#2135-customer-pii)).

**"Needs attention" is a table of named conditions, not a feeling** ([F8.12](Ringly_PRD_v3.md#f8-12)).
Every row is a business, the condition, how long it has been in it, and what the
operator can do, ordered by how little time is left to act. The conditions are
enumerated in [F8.12](Ringly_PRD_v3.md#f8-12) and are derived from lifecycle, billing, incident and
**delivery** state — never stored separately, because a second copy of "is this
suspended" is a second thing that can be wrong.

**"Email undeliverable" is the one condition whose source is not a Ringly state
machine** ([F7.15](Ringly_PRD_v3.md#f7-15)). It comes from `email_sends`: a row that exhausted its attempts
without leaving Ringly, or one that Resend accepted and the recipient's server
bounced ([§2.11.7a](#2117a-delivered-is-not-the-same-as-accepted--the-bounce-webhook)). Both mean the business was not told something the design
assumed it had been told, and both are unfixable by anything automatic —
so the operator's action is to reach them another way and correct the address.

It is a condition and **not** an alert email ([F7.13](Ringly_PRD_v3.md#f7-13)'s set stays closed), which is
the right shape: emailing an operator about email that is not arriving has an
obvious flaw, and a bouncing address is work to schedule rather than an
emergency.

**Four controls, and they are the only ones** ([F8.10](Ringly_PRD_v3.md#f8-10), [F8.13](Ringly_PRD_v3.md#f8-13), [F9.1b](Ringly_PRD_v3.md#f9-1b), [F9.1c](Ringly_PRD_v3.md#f9-1c)):
pause or resume a deletion clock; reset the test-call allowance **and rebind the
agent, as one action** (either alone leaves the business exactly as stuck); set a
business's cancelled status; and **mark a cancellation revoked**.

**Revoked is deliberately not the same control as cleared** ([F6.10a](Ringly_PRD_v3.md#f6-10a)). Clearing is
for a cancellation that should never have been recorded; revoking is a business
changing its mind inside the window, and it makes the usage served during that
window billable again ([F6.12a](Ringly_PRD_v3.md#f6-12a)). Collapsing them into one toggle would make a
billing outcome depend on which sentence the operator had in mind.

**A pause is an explicit act with a visible owner, never a side effect**, and
paused businesses are listed with who paused them and when.

**Testing this section**

_Observable_ — what the operator sees, in what order; which businesses appear
under which condition; what the three controls do.

_Internal_ — the module boundary, the role, the routes, how conditions are
derived.

_Behaviours owed to the catalogue_

- A business owner cannot reach `/ops` by any route or credential.
- The operator's money table sorts by margin and shows negatives as negative.
- Each named condition appears for the business in that condition and no other.
- A business in two conditions is listed once per condition.
- The borrowed view shows the business's own figures with every control absent.
- Pausing a clock stops the deletion; silence does not.
- Resetting the allowance also rebinds, and the number answers again.
- Marking cancelled stops future charges; clearing it resumes them.
- Marking a cancellation revoked resumes them **and** makes the window's usage
  billable, which clearing does not.

---

## 2.13 Lifecycle, suspension and teardown

### 2.13.1 Deadlines and the sweeper

Every lifecycle deadline is a row in `lifecycle_deadlines` with a `due_at` and a
nullable `paused_at` ([§2.4](#24-data-model)/008). The sweeper acts on rows that are **due and not
paused**. There are three clocks and they start from different events ([F6c](Ringly_PRD_v3.md#f6c--invariants)):

- **10 days** for a business that never activated ([F9.1](Ringly_PRD_v3.md#f9-1)), pausable by the
  operator.
- **60 days from the first failed charge** for non-payment and chargebacks
  ([F9.3](Ringly_PRD_v3.md#f9-3)).
- **60 days after service stops** for a business that cancelled — which is itself
  up to 7 days after the request, so up to 67 days from it ([F6.12e](Ringly_PRD_v3.md#f6-12e)).

**An unactivated business is bounded twice and the two limits are independent**
([F9.1](Ringly_PRD_v3.md#f9-1)): five test calls, and ten days. A business can exhaust its calls on day
one and sit unbound for nine more, or never call at all and be deleted on day ten
with its allowance untouched.

### 2.13.2 Unbinding is the one mechanism for stopping service

Used at three moments for three reasons ([F1.13a](Ringly_PRD_v3.md#f1-13a), [F9.3](Ringly_PRD_v3.md#f9-3), [F6.12b](Ringly_PRD_v3.md#f6-12b)). The number stays
rented to the business; it simply stops being answered. Rebinding restores
service on the same number, which is the whole point of holding it.

| Unbind when                            | Rebind when                                        |
| -------------------------------------- | -------------------------------------------------- |
| The 5th test call ends, still unbilled | It activates, or the operator resets the allowance |
| Suspension, day 7 of non-payment       | It pays ([§2.10.6](#2106-coming-back))             |
| The cancellation window closes         | It returns inside the dormant window               |

**Every one of these is verified by reading provider state back** ([§2.5.3](#253-bind-and-unbind-are-verified-by-reading-provider-state-back)). A
failed unbind is the silent one: it leaves a number answering calls Ringly has
stopped metering, and it has no other symptom.

### 2.13.3 A number leaves a business only at deletion

**Never during suspension or dormancy, however idle it looks** ([F9.4a](Ringly_PRD_v3.md#f9-4a)). A
suspended business's number is unbound, which makes it look unused; it is not.
The reusable-number query is built from **every business row that holds a
number, whatever its billing status** — filtering that query by status is the
mistake to guard against, and it would hand a suspended salon's number, the one
printed on its van, to a stranger.

**At deletion the number goes back to the provider, not into a Ringly pool**
([F9.4b](Ringly_PRD_v3.md#f9-4b)): there is no purchase price to save, a departed business's customers keep
ringing its number, and handing it back makes the carrier's 45-day quarantine the
carrier's responsibility.

### 2.13.4 Teardown, in order

```
1  capture lifetime net revenue and outstanding balance   ← from Stripe
2  assert no subscription exists  (D1 — never created; a hand-made one would
                                  otherwise survive teardown and bill a deleted
                                  business)
3  void open invoices
4  detach payment method
5  delete Stripe customer
6  EMAIL the business, and the operator (enqueue, do not await)
7  HAND THE NUMBER BACK to the provider (rental ends)     ← before the row goes
8  delete Ringly's rows AND write departed_businesses     ← ONE transaction
```

**Every step is load-bearing** ([F6.19](Ringly_PRD_v3.md#f6-19), [F9.10](Ringly_PRD_v3.md#f9-10)):

- **1 before 5** — net revenue comes from balance transactions that deleting the
  customer destroys.
- **2–7 before 8** — deleting Ringly's rows first orphans everything upstream: a
  saved card belonging to nobody, a rented number belonging to nobody.
- **6 before 8** — the contact address lives on the tenant row and
  `departed_businesses` deliberately keeps none ([F9.9](Ringly_PRD_v3.md#f9-9)). Send after the delete and
  there is nobody to send to.
- **6 before 7** — releasing the number is the first irreversible step. Emailing
  first means a send that fails outright halts teardown while the business is
  still whole. **Step 6 enqueues and moves on**: the message is rendered and
  stored at that point ([§2.4](#24-data-model)/010), so it survives step 8 deleting the very row it
  describes, and teardown never holds a rented number open while the mail
  provider retries. A template that resolved the business at send time would fail
  on the one path where it matters most.
- **7 before 8** — while the row exists the number cannot be reassigned. Release
  first and a crash leaves a row whose number is gone: visible, recoverable,
  harmless. Release after and there is a window where an unprotected number can
  be handed to a business provisioning in it.
- **8 is one transaction**, and these are the only two steps that can be — every
  other is an external call. Writing the record first leaves a business both
  present and departed; deleting first risks losing a money record permanently
  (2.1.3). Committed together there is no window and no third state.

### 2.13.5 Customer PII

**Destroyed on exactly one occasion, automatically** ([F9.1a](Ringly_PRD_v3.md#f9-1a)): when the business
itself is deleted. When a lifecycle deadline expires, customers, appointments and
calls are ordinary tenant rows caught by step 8 of [§2.13.4](#2134-teardown-in-order) — **in the same
transaction that writes the departure record**. Nobody requests it and nobody
performs it.

**There is no per-customer deletion, and the schema says so.** An earlier design
gave the business a self-serve control to erase one caller by phone number; that
requirement is withdrawn ([F9.1a](Ringly_PRD_v3.md#f9-1a)). What replaces it is an absence with teeth:

- `appointments.customer_id` is **NOT NULL** with no path that makes it null
  ([§2.4](#24-data-model)/005). There is no `set null`, so there is no orphaned appointment to
  reason about and no half-deleted customer to render.
- There is **no lookup from a phone number to a customer for the purpose of
  erasing them**, which would have been the per-customer view the dashboard
  exists to exclude ([F5.11](Ringly_PRD_v3.md#f5-11)) arriving through a side door.
- The dashboard carries no such control ([F5.15](Ringly_PRD_v3.md#f5-15)), and neither does the operator's
  borrowed view ([F8.2e](Ringly_PRD_v3.md#f8-2e)) — **absent, not hidden**, because a control that exists
  but is unreachable is a control someone will eventually make reachable.

**The engineering argument for the absence is that the alternative cannot be made
correct.** A customer's past appointments carry revenue the rollups already
counted and invoices already settled against them ([F6.16](Ringly_PRD_v3.md#f6-16)). Deleting them rewrites
settled figures; keeping them with the name stripped means the erasure was
partial while the product claimed it was complete. There is no third option, so
the product does not offer the operation.

**The cost is recorded rather than argued away** ([R23](#r23)): a business that receives a
consumer erasure request can only action it through Ringly by ending its own
account.

### 2.13.6 Call content

**Ringly stores neither transcripts nor recordings** ([F9.6](Ringly_PRD_v3.md#f9-6)); both stay with the
telephony provider and are fetched on demand. Retention is configured **on every
provisioned agent**, never inherited from a default: recordings 30 days,
transcripts at least 30 and never shorter.

**On the 10-day unactivated path, Ringly issues an explicit provider-side
delete** ([F9.5](Ringly_PRD_v3.md#f9-5)). A test call placed on day 1 is held until day 31, three weeks
after the business and every record of it are gone — the one case where "the
provider's TTL is always shorter" is false.

### 2.13.7 Retention, and why there is no export

**Everything Ringly holds lives as long as the business does** ([F9.8](Ringly_PRD_v3.md#f9-8)). No table
is aged out while a business is active: calls, customers, appointments, usage,
costs and money records are all read by the dashboards and by invoice
reconciliation, and all of those look back over months rather than days. There is
no partial or rolling deletion and no field-level expiry.

**The only thing on a 30-day clock is what Ringly does not store** — transcripts
and recordings, held by the provider ([§2.13.6](#2136-call-content)). One consequence is worth stating
because requirements keep wanting to depend on it: **call content older than 30
days is not retrievable by anyone**, Ringly included ([F9.7](Ringly_PRD_v3.md#f9-7)).

Everything Ringly does hold is destroyed when the relationship ends, on the clock
the ending sets ([§2.13.1](#2131-deadlines-and-the-sweeper)).

**Ringly offers no export, deliberately** ([N1.3](Ringly_PRD_v3.md#n1-3)). Every appointment already lives
in the business's own calendar, which it keeps. Transcripts and recordings were
never Ringly's to give. Everything else is Ringly's operational record of a
relationship that has ended. There is nothing a departing business would receive
that it does not already hold.

**Testing this section**

_Observable_ — whether the number answers; whether it can be handed to another
business; what a departed business leaves behind; what a deleted customer leaves
behind; what emails arrive and when.

_Internal_ — the deadlines table, the sweeper, the teardown implementation, the
transaction.

_Behaviours owed to the catalogue_

- An unactivated business is deleted at day 10 and its number released.
- Pausing the clock prevents that; silence does not.
- A suspended business's number is never offered to another business.
- A dormant business's number is never offered to another business.
- An unactivated business that spent its allowance keeps its number reserved.
- A deleted business's number leaves the pool.
- Nothing is deleted without a 48-hour warning, on all three paths.
- The deletion email reaches the business before the address is destroyed.
- Deletion emails both the business and the operator.
- The departure record holds identity and money and no consumer data.
- A crash between releasing the number and deleting the rows leaves recoverable
  state, not a lost record.
- There is no way to delete one customer: no control on the business dashboard,
  none on the operator's borrowed view, and no route that leaves an appointment
  without a customer.
- Customers, appointments and calls survive right up to the deletion transaction
  and are gone the moment it commits.
- The departure record exists and holds no consumer data at the same instant.
- A 10-day deletion issues a provider-side content delete; a 60-day one does not
  need to.

---

## 2.14 Cross-cutting properties

### 2.14.1 Timezone (N5)

**Every instant is stored in UTC and rendered in the business's IANA timezone**
([N5.1](Ringly_PRD_v3.md#n5-1)). **Every day, week and month boundary — availability, analytics grouping,
billing periods — is computed in the business's timezone**, not the server's and
not UTC ([N5.2](Ringly_PRD_v3.md#n5-2)).

This is not a formatting concern. A four-hour analytics window, a 30-day billing
period and an opening-hours check are all boundary computations, and getting any
of them in UTC gives a business in Los Angeles figures that are wrong for a third
of every day.

**DST is handled explicitly** ([N5.3](Ringly_PRD_v3.md#n5-3)), including the duplicated hour in autumn and
the skipped hour in spring. A booking at a local time that does not exist is
refused; a local time that happens twice resolves to the first pass and the agent
states the full date and time back.

### 2.14.2 Security and compliance (N6)

- **Provider refresh tokens are encrypted at rest** ([N6.1](Ringly_PRD_v3.md#n6-1)).
- **Card data never touches Ringly infrastructure** ([N6.2](Ringly_PRD_v3.md#n6-2), [F6.3](Ringly_PRD_v3.md#f6-3)), which is what
  keeps the product outside PCI-DSS scope beyond SAQ-A. Ringly stores provider
  identifiers only.
- **Every inbound webhook verifies the provider's signature before acting**
  ([N6.3](Ringly_PRD_v3.md#n6-3)), using the vendor's own verification helper. Never a hand-rolled
  comparison — for Retell that means the SDK's `verify`, for Stripe
  `constructEvent`.
- **Customer PII is destroyed wholesale when the tenant leaves and at no other
  time** ([N6.4](Ringly_PRD_v3.md#n6-4), [§2.13.5](#2135-customer-pii)). It needs no human in the loop because there is no
  control to press: it happens in the teardown transaction or not at all.
- **Ringly is a service provider to the business, not a controller of the
  caller's data** ([N6.5](Ringly_PRD_v3.md#n6-5)). Every consumer request arrives through the business,
  and Ringly's duty is to be able to action it, not to adjudicate it.
- **`business_type` offers no healthcare option** ([§1.4](Ringly_PRD_v3.md#14-scope)) and the existing enum
  value is removed. Callers to a clinic disclose PHI and Ringly holds no BAA.

### 2.14.3 Degradation (N7)

| Dependency          | If it is down                                                                           |
| ------------------- | --------------------------------------------------------------------------------------- |
| Telephony           | **Total outage.** Not survivable by design                                              |
| Database            | **Total outage.** Not survivable                                                        |
| Application host    | **Total outage**                                                                        |
| Scheduling provider | **Booking fails audibly** ([§2.6.4](#264-fail-closed-concretely)). Enquiries still work |
| Payments            | Calls continue. Charges queue and settle later; usage accrues locally                   |
| Email               | Calls continue. Mail retries; delivery is delayed, nothing is lost                      |
| Enrichment          | New onboarding degrades to manual entry; existing businesses unaffected                 |

**A failure in a non-critical dependency must never stop an existing business
answering calls** ([N7.1](Ringly_PRD_v3.md#n7-1)). **Every degraded path is logged, surfaced to the
business, and alerted to the operator — silent degradation is a defect** ([N7.3](Ringly_PRD_v3.md#n7-3)).

### 2.14.4 Serving cost and the unauthenticated surface (N4, N9)

**Per-business fixed monthly infrastructure cost must not grow faster than
linearly with tenants** ([N4.1](Ringly_PRD_v3.md#n4-1)). The three rules that hold it: configuration on
the call path is cached rather than re-read ([N4.2](Ringly_PRD_v3.md#n4-2), [§2.6.6](#266-configuration-on-the-call-path)); dashboards are served
from pre-aggregated data ([N4.3](Ringly_PRD_v3.md#n4-3), [§2.9.2](#292-the-rollup)); every paid third-party call is
attributable per business ([N4.4](Ringly_PRD_v3.md#n4-4)).

**Onboarding enrichment is a paid endpoint reachable without a login** ([N9.1](Ringly_PRD_v3.md#n9-1)) —
Places, a website crawl and a model call. It carries a simple per-IP limit and a
daily spend ceiling, above which it **degrades to manual entry rather than
continuing to spend**. Both are configuration.

**Sized for the traffic actually expected, which is low.** This is a cost
guardrail, not an anti-abuse system, and **visibility is doing most of the work**
([N9.2](Ringly_PRD_v3.md#n9-2)): the spend is attributable before a business exists, so a runaway appears
in the operator's cost figures rather than as unexplained margin loss.

**Nothing chargeable beyond enrichment happens before a Google sign-in** ([N9.3](Ringly_PRD_v3.md#n9-3)).
That is the real bound: a bot that gets through the limiter costs one enrichment
call, never a phone number.

### 2.14.5 Durability of money records (N10)

**The strictest requirement in the document** (2.1.3). The money tables are
`billing_events`, `usage_records`, `billing_periods`, `pricing_policy` and
`departed_businesses` ([N10.1](Ringly_PRD_v3.md#n10-1)) — named so the protections apply to a definite
list.

- **Two copies**: point-in-time recovery on the primary database, and automated
  backups replicated to a second region, retained ≥ 90 days ([N10.2](Ringly_PRD_v3.md#n10-2)).
- **RPO ≤ 1 hour, RTO ≤ 4 hours** ([N10.3](Ringly_PRD_v3.md#n10-3)). An hour is below any billing interval
  in this design, so at most an hour of usage records — never a settled charge —
  is at risk.
- **Nothing is hard-deleted or updated in place once settled** ([N10.4](Ringly_PRD_v3.md#n10-4)).
  Corrections are new rows.
- **Restores are exercised on a schedule and the result recorded** ([N10.5](Ringly_PRD_v3.md#n10-5)). A
  backup never restored is a belief.
- **Deleting a business is not an exception** ([N10.6](Ringly_PRD_v3.md#n10-6)): the departure record is
  written by the transaction that removes the tenant and outlives it.
- **Stripe is a second copy of the payments, though not of the reasoning**
  ([N10.7](Ringly_PRD_v3.md#n10-7)). It does not hold which period a payment settled, under which policy
  version, against how many seconds, clamped by how much.

**Deferred deliberately** ([§1.9](Ringly_PRD_v3.md#19-deferred)): a third copy outside the provider account. Both
copies live in one account and share its fate. Recorded as a decision rather than
an oversight.

**Testing this section**

_Observable_ — figures rendered in the business's own timezone; a booking refused
at a nonexistent local time; that a webhook without a valid signature changes
nothing; that onboarding degrades rather than spends; that a local write failing
after a charge does not lose the charge.

_Internal_ — encryption, backup configuration, rate-limiter internals, the
signature helpers.

_Behaviours owed to the catalogue_

- A business in one timezone and a business in another group the same UTC instant
  into different days and different four-hour windows.
- A billing period boundary falls at the right local moment on both sides of a
  DST transition.
- A booking at a local time the clocks skip is refused; one at an hour that
  happens twice resolves to the first and is stated back.
- An unsigned or wrongly-signed webhook, from either provider, is rejected and
  changes nothing.
- Enrichment past the daily spend ceiling falls back to manual entry.
- Enrichment spend is attributable before a business exists.
- No number is bought before a sign-in.
- A local write failing immediately after a successful charge does not lose the
  charge, and the business is never asked to pay twice.

---

## 2.15 Test strategy and the TDD workflow

**This section is the reason the previous thirteen have Testing blocks.** The
suite is written before the implementation, and it can only be written first if
the design has already said what will be observable.

### 2.15.1 The loop

For each requirement:

1. **Derive scenarios** from the requirement, using its section's Testing block.
   A scenario is a sentence about what someone does and what then becomes true.
2. **Write the scenario as a failing test** against the harness. It fails with
   `NotImplementedError` because the adapter member does not exist yet — which is
   a legitimate red, and distinguishable from a wrong answer.
3. **Implement the adapter member**, so the test fails for the right reason: the
   product does not do this yet.
4. **Implement the product** until it passes.
5. **Never change the test to match the implementation.** If the test was wrong,
   the requirement was misread — go back to the PRD.

### 2.15.2 The one rule

**A test body may not name anything the implementation could rename.** No table
names, no column names, no routes, no selectors, no SQL, no vendor identifiers,
no internal state names. Those live in the harness and nowhere else.

```
await caller(aCustomerNumber()).calls(salon).andAsksToBook({ service: 'Cut', at: 'Tue 2pm' })
await system.advanceTo(day(45))
expect(await billingHistory(salon)).toMatchObject([{ status: 'in_progress' }])
```

If a spec wants a column name, **the projection is missing** — add it to the
harness. This is what makes the suite survive the rewrite it is being written
against: none of [§2.4](#24-data-model)'s tables appears in a single test body, so none of them is
pinned by a test.

**The fakes are named for the capability, not the supplier** — `calendar`, not
`google`; `telephony`, not `retell`. [§2.7](#27-scheduling-providers) already treats the scheduling provider
as abstract; the test vocabulary agrees.

### 2.15.3 The harness

Split by **direction, not by ownership**, so that "does the number answer?" and
"which numbers are held?" do not land in different files:

| File             | Holds                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| `types.ts`       | The vocabulary — money, days, outcomes, read models                                            |
| `world.ts`       | `aBusiness()` and per-test lifecycle                                                           |
| `actors.ts`      | Writes: prospect · caller · owner · operator · system                                          |
| `projections.ts` | Reads, **including reads of the fakes**                                                        |
| `fakes.ts`       | Arranging vendors: calendar · telephony · email · payments · classifier · enrichment · storage |
| `pending.ts`     | `notImplemented()`, naming the requirement held                                                |

**Actors drive Ringly through surfaces the product actually exposes** — telephony
webhooks for a caller, the app's own routes for an owner, `/ops` for the
operator. **Nothing reaches into the database to make something true.** If a
state is not reachable through the product, a test may not assume it.

**Refusals name their type.** `rejects.toThrow(Refused)`, never a bare
`rejects.toThrow()` — every unimplemented adapter member rejects with
`NotImplementedError`, so the bare form passes against an implementation that
does not exist. The two error types are deliberately unrelated.

### 2.15.4 What is faked, and what is not

| Edge           | Test double                              | Why                                                                                     |
| -------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| **The caller** | Simulated telephony webhook payloads     | Fast and deterministic. Tests Ringly's handling, not the agent                          |
| **Payments**   | **Real, in test mode, with test clocks** | A declined card must genuinely be a declined card                                       |
| **Calendar**   | Fake                                     | Proves Ringly's reaction to an outage, not that Google fails that way                   |
| **Telephony**  | Fake                                     | Bind/unbind read-back needs a provider that can lie                                     |
| **Email**      | Fake                                     | Assertions are on content, never on transport                                           |
| **Classifier** | Fake                                     | It is a model call; tests inject the label so everything downstream stays deterministic |
| **Enrichment** | Fake                                     | Degradation to manual entry has to be arrangeable                                       |

**A fake must be able to fail.** One that only ever succeeds proves nothing about
the fail-closed requirements, which are among the most important behaviours in
the product. Every fake exposes its failure modes as first-class controls, and
**arranged failure is per-business, not global**, so parallel specs cannot break
each other.

**Time is moved, not waited on.** `system.advanceTo(day(45))` moves Ringly's
clock and the payment provider's test clock together and then runs whatever work
has become due — because in production, time passing is what causes that work,
and two hundred tests each remembering to trigger the sweeper is a defect
waiting to happen.

### 2.15.5 The adapter can hide real bugs

**This is the failure mode to watch for, and it is silent.** A projection is only
as honest as its implementation. If `billingHistory()` reads the database while
the real dashboard calls an API, **every test passes while the API is broken**.

Three rules keep it honest:

1. **Projections read. They never compute.** A projection that derives an answer
   is testing the harness's arithmetic, not the product's.
2. **A projection goes through the same path the product does**, as soon as that
   path exists.
3. **A fake must be able to fail.**

### 2.15.6 What the suite cannot prove

Held here so that green is never mistaken for done:

- **That the agent sounds right, or says the disclosure aloud.** The caller is
  simulated. Only a human hears the agent ([A1](Ringly_PRD_v3.md#a1)).
- **That the real vendors fail the way the fakes do.** A simulated calendar
  outage proves Ringly's reaction, not Google's behaviour.
- **That the classifier labels a real transcript correctly.** That is a model
  evaluation with its own dataset, not a scenario.
- **Scale.** [N2.1](Ringly_PRD_v3.md#n2-1)'s 10,000 × 10,000 is a load exercise ([A2](Ringly_PRD_v3.md#a2)), not an assertion.
- **That a restore works.** [N10.5](Ringly_PRD_v3.md#n10-5) is a drill ([A3](Ringly_PRD_v3.md#a3)).
- **Legal sufficiency** of the recording disclosure. Testable: that the default
  text is used verbatim, that a business cannot alter it, that it is configured
  on every provisioned agent.

### 2.15.7 What changes in the existing harness

The harness in `tests/behaviour/` is kept — its architecture is what this section
describes, and it was written against the PRD rather than against code, which is
why it survives a from-scratch design. It needs four corrections:

1. **Requirement citations are renumbered** throughout. Every `F5.x`–`F10.x`
   reference is on the pre-renumber scheme.
2. **Recurrence is removed**: `andAsksToSetUpRecurring`, `andChooses`,
   `setsRecurrenceHorizon`, `AppointmentView.seriesId`, the `recurring_change`
   email kind, and the `recurrence_materialiser` worker. In its place, a caller
   must still be able to **ask** for something repeating, so that [F2.2a](Ringly_PRD_v3.md#f2-2a)'s
   first-instance-only behaviour can be asserted — the request survives, the
   series does not.
3. **`CallAnalytics` follows the new dashboard**: `callsThatBooked` becomes
   `appointmentsBooked`, and the chart projection takes a grouping and a filter
   rather than exposing two fixed views ([F5.4b](Ringly_PRD_v3.md#f5-4b)).
4. **Per-customer deletion is removed**: `owner.deletesCustomer`, and
   `AppointmentView.customerName`'s `"__erased__"` value, which modelled a state
   the product no longer has ([F9.1a](Ringly_PRD_v3.md#f9-1a)). `AppointmentView.customer` stops being
   nullable, because there are no anonymous bookings ([F2.12](Ringly_PRD_v3.md#f2-12)) — the harness had
   assumed both, and neither was ever a requirement.
5. **Phase labels are removed, not re-mapped.** Every stub carried a delivery
   phase alongside the requirement it holds. Build order is downstream of the
   design (2.1.5a) and is expected to be re-cut, so a label there made the test
   scaffolding encode a plan it has no stake in — and one that would need
   re-mapping every time the plan moved. What a member _holds_ is a fact about
   the requirement and does not move; that is all it carries now.

The scenario manifest and `CATALOGUE_SIZE` are regenerated with the catalogue
([§2.19](#219-scenario-catalogue)), not before.

---

## 2.16 Delivery plan

**Provisional, and downstream of everything above it (2.1.5a).** This section is
_derived from_ the design; it does not constrain it. Nothing in §2.1–§2.15 is
decided by what a phase contains, and re-cutting these phases must never require
editing a schema or a mechanism. If it ever does, the design has picked up a
dependency on its own build order and that is the defect, not the plan.

Ordered by dependency, not by layer. Each phase is deliverable and leaves `main`
deployable; anything spanning more than one PR lives behind a feature flag.

| Phase                           | Delivers                                                                                                                                | Needs | Migration                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------- |
| **0 — Harness**                 | [§2.15](#215-test-strategy-and-the-tdd-workflow) corrections; fakes; time control; the catalogue as `test.todo`                         | —     | —                            |
| **1 — Foundations**             | Tenancy, isolation, call path, booking, fail-closed, scheduling interface                                                               | 0     | 005, 006                     |
| **2 — Email plumbing**          | Registry, templates, idempotency, four identities, dispatcher                                                                           | 1     | 010                          |
| **3 — Onboarding + activation** | Intake, enrichment, consent, checklist, Activate, bind read-back                                                                        | 1, 2  | 005 (already run in Phase 1) |
| **4 — Billing**                 | Policy, periods, settlement, cap, grace, Stripe division                                                                                | 3     | 007                          |
| **5 — Lifecycle**               | Deadlines, sweeper, unbind/rebind, suspension, teardown, PII deletion                                                                   | 4     | 008                          |
| **6 — Catalogue + hours**       | Editing, versioning, propagation                                                                                                        | 1     | —                            |
| **7 — Analytics**               | Classification, rollup, cost records                                                                                                    | 1, 4  | 009                          |
| **8 — Business dashboard**      | Tiles, the chart, trends, billing history, status, controls                                                                             | 6, 7  | —                            |
| **9 — Operator dashboard**      | Money table, needs-attention queue, borrowed view, controls                                                                             | 5, 7  | 011                          |
| **10 — Hardening**              | DST, load exercise ([A2](Ringly_PRD_v3.md#a2)), restore drill ([A3](Ringly_PRD_v3.md#a3)), manual vendor QA ([A1](Ringly_PRD_v3.md#a1)) | all   | —                            |

**Why this order.** Email is phase 2 because almost everything after it needs to
tell a business something, and retrofitting idempotency to a system that already
sends is how duplicates ship. Billing precedes lifecycle because suspension and
teardown are defined in terms of what is owed. Analytics is late because nothing
depends on it and it is the largest body of arithmetic. The operator dashboard is
last of the product phases because it reads everything else.

**Phase 0 is not optional and is not a spike.** The suite is the specification's
executable half; building it after the product would make it a description of
what was built rather than a check on it.

---

## 2.17 Verified vendor capabilities

_Verified 2026-07-30, and carried forward unchanged: no vendor in this design is
new, because [N7](Ringly_PRD_v3.md#n7--third-party-dependencies-and-degradation) fixes the dependency list. Re-verify before anything
commits to Stripe's configuration surface._

- **Stripe** _(billing model re-verified 2026-08-01 for [D1](#d1))_ — a subscription
  bills the recurring fee **one service interval in advance** and combines it
  with the closing period's metered usage **on one invoice at the period
  boundary**, which is why [§2.10.8](#2108-the-division-with-the-payment-provider) uses none; prebilling "doesn't apply to any
  usage-based prices in a subscription", so it is not a way out.
  **`pause_collection` is documented ambiguously** on the case that matters: the
  guide says invoices "created before the `resumes_at` date remain in `draft`…
  and `auto_advance` is set to `false`" and also that invoices "created before
  subscriptions are paused continue to be retried unless you void them", and the
  API reference does not distinguish an already-open invoice at all. **Unresolved
  and deliberately not depended upon** ([D1](#d1), [R21](#r21)).
  **Not verified: whether one open invoice is still retried on day 59** — Smart
  Retries runs about two months and suspension needs 59 days ([A4](Ringly_PRD_v3.md#a4), [R27](#r27)).
- **Stripe** — `SetupIntent` stores a card off-session; usage-based billing via
  Meters; billing thresholds exist and are deliberately unused; dunning,
  receipts, proration and the customer portal are each independently
  configurable, which is what makes [§2.10.8](#2108-the-division-with-the-payment-provider) possible. Disputes: **$15 fee,
  non-refundable in the US**, 7–21 days to submit evidence, 2–3 months to
  resolve.
- **Retell** — ~600ms end-to-end budget; `speak_during_execution` and
  configurable backchannelling cover tool latency ([F2.6](Ringly_PRD_v3.md#f2-6)); retention is
  **per-agent, 1 day to 2 years**; recording URLs are **signed and expire**, so
  they must be fetched at view time; SOC 2, GDPR and HIPAA-capable but **PHI
  requires a BAA**. Cost $0.13–0.31/min all-in.
- **Google Calendar** — `calendar.events` is a **sensitive** scope requiring
  verification; refresh tokens are revoked after 7 days while the app is in
  _Testing_; granular consent means calendar can be declined independently of
  sign-in ([F1.7a](Ringly_PRD_v3.md#f1-7a)); `events.list` exposes event ids where `freebusy` does not,
  which is why [§2.7](#27-scheduling-providers) uses it.
- **Resend** _(verified 2026-08-01)_ — the selected delivery provider ([N7](Ringly_PRD_v3.md#n7--third-party-dependencies-and-degradation)).
  Idempotent sends via an **`Idempotency-Key` header**, max **256 characters**,
  with a **24-hour** window — which the ≈14¾-hour retry ladder fits inside
  ([§2.11.7](#2117-retry-backoff-and-what-happens-to-a-message-that-will-never-send)). Webhooks cover the delivery lifecycle: **`email.bounced`**
  (recipient's server permanently rejected it), `email.complained` (delivered,
  then marked as spam), `email.delivery_delayed` (temporary, still trying),
  plus `sent` / `delivered` / `failed` / `suppressed`. `email.bounced` is what
  makes [F7.15](Ringly_PRD_v3.md#f7-15)'s second failure class observable at all ([§2.11.7a](#2117a-delivered-is-not-the-same-as-accepted--the-bounce-webhook)).

  **Not yet verified to the standard of the three above**: the exact rate limit
  on the send endpoint, which the docs do not state. [§2.11.10](#21110-decisions-this-section-makes-that-the-prd-does-not)'s batch-of-50 and
  concurrency-of-8 are sized on volume rather than on a published ceiling, and
  should be checked against a real account before any real mail is sent.

---

## 2.18 Risks and open questions

**Open questions carried from the PRD**

- <a id="q1"></a>**Q1 — the per-connected-minute rate.** Held as configuration ([F6.8](Ringly_PRD_v3.md#f6-8)), so
  billing can be built and tested with a placeholder but **cannot be switched on
  for real customers until it is set**.
- <a id="q3"></a>**Q3 — Ringly's contact email address** ([F9.2](Ringly_PRD_v3.md#f9-2)). The single channel for
  cancellation, deletion and reactivation.
- <a id="q6"></a>**Q6 — where the application is hosted** ([N8](Ringly_PRD_v3.md#n8--hosting-undecided-and-the-application-must-stay-portable)). Does not block a phase; 2.1.6
  keeps the design portable while it is open. Must be settled before the first
  paying customer.

**The risk register.** Numbers are stable across revisions and are cited from
the PRD and from commit messages, so a retired risk keeps its number rather than
freeing it.

- <a id="r1"></a>**R1 — The shipped code fails open; the product requires fail-closed.** A
  specification change, not only a bug fix ([F2.7](Ringly_PRD_v3.md#f2-7)).
- <a id="r2"></a>**R2 — LAUNCH BLOCKER: Google OAuth verification not submitted.** Refresh
  tokens are revoked after 7 days while the app is in _Testing_; with a mandatory
  calendar and fail-closed booking, every business stops taking bookings a week
  after signup. **Weeks of review, and entirely independent of engineering** — the
  calendar-week cost is the risk, so it is submitted as early as an application
  can be, not when the code that depends on it is written.
- <a id="r3"></a>**R3 — Cross-tenant leakage via the service role.** Mitigated by [§2.3.1](#231-row-level-security-is-the-floor-not-the-ceiling); must
  stay test-enforced ([N1.2](Ringly_PRD_v3.md#n1-2)).
- <a id="r4"></a>**R4 — 005 cannot apply over existing overlapping appointments.** Needs a data
  audit before the migration runs.
- <a id="r5"></a>**R5 — Provider capability mismatch.** Declared, not assumed ([§2.7](#27-scheduling-providers)).
- <a id="r6"></a>**R6 — Live busy-checks cost real money per turn.** Accepted: a stale conflict
  check is worse (2.1.1).
- <a id="r7"></a>**R7 — Retired.** The number is left unused rather than reassigned, so
  references in earlier documents and commits still resolve.
- <a id="r8"></a>**R8 — Unbooked calls are pure cost.** At $0.13–0.31/min, $100 covers roughly
  320–770 minutes of unbillable calling. [F8](Ringly_PRD_v3.md#f8--operator-dashboard-ringly-internal) exists partly to measure it, and the
  $500 cap is unbounded within a period ([F6.9b](Ringly_PRD_v3.md#f6-9b)) — the largest deliberate giveaway
  in the model, absorbed on purpose and surfaced per business ([F8.2a](Ringly_PRD_v3.md#f8-2a)).
- <a id="r9"></a>**R9 — Switching calendar provider is out of scope.** Not designed, not built.
- <a id="r10"></a>**R10 — Retention depends on a provider setting.** Per-agent, 1 day to 2 years;
  must be set explicitly at provisioning, never inherited ([F9.6](Ringly_PRD_v3.md#f9-6)).
- <a id="r11"></a>**R11 — PHI.** Resolved by excluding healthcare ([§1.4](Ringly_PRD_v3.md#14-scope), [§2.14.2](#2142-security-and-compliance-n6)).
- <a id="r12"></a>**R12 — Caller authentication is weaker than caller ID** ([§2.6.5](#265-identifying-an-existing-appointment)). Deliberate;
  revisit if abused.
- <a id="r13"></a>**R13 — Appointments edited directly in the owner's calendar drift.** Conflict
  checks stay correct because busy is read live; Ringly's stored time may not be.
  Sync-back is not built.
- <a id="r14"></a>**R14 — Hours change; timezone changes are the dangerous half.** Editing hours
  is a first-class control ([F3.5](Ringly_PRD_v3.md#f3-5)); **timezone deliberately is not** ([F3.6](Ringly_PRD_v3.md#f3-6)),
  because it re-interprets every stored instant and every period boundary. The
  residual risk is an appointment left outside newly-narrowed hours; accepted,
  because moving it would break a promise already made to a caller Ringly cannot
  contact ([§1.4](Ringly_PRD_v3.md#14-scope)).
- <a id="r15"></a>**R15 — Long-running disputes outlive the business.** A chargeback resolving
  after day 60 lands on a deleted account. Accepted, no special handling ([F6.17](Ringly_PRD_v3.md#f6-17)).
- <a id="r16"></a>**R16 — The host is not chosen** ([Q6](Ringly_PRD_v3.md#q6), [N8](Ringly_PRD_v3.md#n8--hosting-undecided-and-the-application-must-stay-portable)). Low while 2.1.6 holds, and rising
  the longer it stays open: the cost of moving is proportional to how much has
  been built on top. Decide before the first paying customer.
- <a id="r17"></a>**R17 — The enrichment endpoint is unauthenticated and spends money** ([N9](Ringly_PRD_v3.md#n9--cost-control-on-the-unauthenticated-surface)).
  **Low, and deliberately treated as low** — onboarding volume is expected to be
  a handful of businesses a day, so the mitigation is a per-IP limit, a daily
  ceiling and caching, not an abuse system. Residual: a determined abuser can
  burn the daily ceiling and take new signups down to manual entry for the rest
  of that day. Accepted over building machinery for traffic that does not exist;
  the cost figures ([N9.2](Ringly_PRD_v3.md#n9-2)) are what would change the assessment.
- <a id="r18"></a>**R18 — The 10-day path deletes a business while the provider still holds its
  calls** ([F9.5](Ringly_PRD_v3.md#f9-5)). Needs an explicit provider-side delete on that path only; the
  general "the TTL expires first" argument does not cover it ([§2.13.6](#2136-call-content)).
- <a id="r19"></a>**R19 — No caller has any way to reach Ringly** ([§1.4](Ringly_PRD_v3.md#14-scope), [F9.1a](Ringly_PRD_v3.md#f9-1a)). Accepted: Ringly
  is a service provider, not the caller's counterparty ([N6.5](Ringly_PRD_v3.md#n6-5)). **No longer
  narrowed** — the self-serve per-customer deletion that previously softened this
  is withdrawn ([R23](#r23)).
- <a id="r20"></a>**R20 — The agent has no fallback** ([F2.10](Ringly_PRD_v3.md#f2-10)). Anything it cannot handle is a
  dropped call and a lost customer, with no transfer and no message taken. The
  `dropped` metric ([F5.4](Ringly_PRD_v3.md#f5-4)) exists to show how often; revisit when it is measured
  rather than guessed.
- <a id="r21"></a>**R21 — Retired, dissolved by [D1](#d1) (2026-08-01).** It held that suspension must
  stop one payment-provider behaviour ([F6.11b](Ringly_PRD_v3.md#f6-11b), no new invoices) while preserving
  another ([F6.11b-i](Ringly_PRD_v3.md#f6-11b-i), the open invoice still retried), that the two are normally
  configured together, and that **both failure directions are silent**. It was
  the strongest argument for [D1](#d1): `pause_collection` is the only lever, and
  Stripe's documentation does not state unambiguously whether `keep_as_draft`
  disables `auto_advance` on an invoice that was already open — while `void` and
  `mark_uncollectible` stop collection by definition. With no subscription there
  is nothing to pause and neither failure is reachable. **The acceptance test
  survives the risk** and stays in the catalogue: suspend, cross a would-be period
  boundary, restore, then assert that no new invoice was raised and that the
  original was retried throughout.
- <a id="r27"></a>**R27 — Stripe stops retrying before suspension ends, and Ringly has to finish
  the job.** [F6.11b-i](Ringly_PRD_v3.md#f6-11b-i) makes "the retries that never stopped" the entire recovery
  path, and [F6.11d](Ringly_PRD_v3.md#f6-11d) case (a) needs one invoice attempted from a day-1 decline to a
  day-60 deletion — **59 days against a Smart Retries window of roughly two
  months**. If the window closes first, a recoverable business is quietly
  un-chased for exactly the days when chasing matters most, and **nothing in the
  system notices**: the invoice is still open, the business is still suspended,
  and every component is behaving correctly on its own terms. That is the same
  silent shape [R21](#r21) had, relocated.
  - **The window question is not caused by [D1](#d1)** — it would be identical under a
    subscription. **The remedy is**: with no subscription, the only thing that can
    take over is Ringly ([F6.20a](Ringly_PRD_v3.md#f6-20a)).
  - **It contradicts [F6.20](Ringly_PRD_v3.md#f6-20) as originally written** ("Ringly builds no retry
    loop"), which is why [F6.20a](Ringly_PRD_v3.md#f6-20a) now carves out the tail of suspension explicitly
    rather than leaving the design quietly at odds with the requirement.
  - **Ringly retries only after Stripe has stopped, never alongside it.** The
    trigger is provider state — an invoice `open`, unpaid, with
    `next_payment_attempt` null, on a business still inside suspension — not a
    date Ringly computes. Two systems charging one card is a double charge, which
    is worse than the gap it closes.
  - Answered by **[A4](Ringly_PRD_v3.md#a4)** with a test clock. If the window already covers day 59,
    [F6.20a](Ringly_PRD_v3.md#f6-20a) never fires and this risk closes.

- <a id="r28"></a>**R28 — [D1](#d1) puts Ringly's own scheduler on the billing critical path.** Under a
  subscription Stripe raises the invoice whether or not Ringly is healthy; under
  [D1](#d1) a settlement worker that stops means nobody is charged and no period opens.
  **Bounded rather than unbounded**: periods and deadlines are stored rows, not
  computed offsets ([§2.4](#24-data-model)/008), so a late run catches up and computes the same
  boundaries — [F6.16](Ringly_PRD_v3.md#f6-16) and [§2.5.5](#255-decisions-this-section-makes-and-one-correction)'s decision 7 both depend on that already. The
  residual is **delayed revenue and a silence nobody hears** until someone looks
  at the operator dashboard, which is the argument for the worker's own failure
  alerting rather than for a subscription.

- <a id="r29"></a>**R29 — Stripe becomes less legible to anyone not reading Ringly's dashboard.**
  Without a subscription object a customer in Stripe is a list of invoices with
  no recurring relationship, so "is this business active, and on what terms" is
  answerable only from Ringly. That is fine for the operator ([F8](Ringly_PRD_v3.md#f8--operator-dashboard-ringly-internal) exists) and
  costs something for everyone else: Stripe's dashboard analytics — MRR, churn,
  subscriber counts — and revenue-recognition schedules a subscription would
  generate on its own. **Not a v3 problem; a real one the first time somebody
  does accrual accounting or reads the account in diligence.** Accepted as the
  known price of D1.

- <a id="r30"></a>**R30 — a later move to plans, tiers or annual billing is a migration, not a
  setting.** [§1.9](Ringly_PRD_v3.md#19-deferred) rules out plan changes and coupons for v3, but [F6.15](Ringly_PRD_v3.md#f6-15) expects the
  commercial terms to change once real usage is observed. If that change is ever
  "plans" rather than "different numbers", adopting subscriptions then means doing
  it with live paying customers and open invoices. **Accepted**: [F6.15](Ringly_PRD_v3.md#f6-15)'s own list
  of what does not change — 30-day periods, the two-phase lifecycle — is the shape
  [D1](#d1) is built for, and designing for a pivot that may never come is what [§1.9](Ringly_PRD_v3.md#19-deferred)
  forbids.

- <a id="r31"></a>**R31 — Retired before it was written: Stripe's Card Account Updater is not
  subscription-only.** The worry was that dropping the subscription would worsen
  involuntary churn from expired and reissued cards. It does not: Stripe updates
  **saved payment method details** whenever a network reports a replacement,
  independently of what charges them, and support is widest in the US — which is
  the only market Ringly serves ([§1.4](Ringly_PRD_v3.md#14-scope)). Recorded because it is the first thing a
  reviewer will reasonably fear about [D1](#d1), and the answer is no.
- <a id="r22"></a>**R22 — Every backup of the money records lives in one provider account**
  ([N10.2](Ringly_PRD_v3.md#n10-2)). A credential compromise or an account closure takes point-in-time
  recovery and the cross-region copies together. **Accepted for v3 and deferred**
  ([§1.9](Ringly_PRD_v3.md#19-deferred)): the failure is rare, and Stripe independently holds the payments
  ([N10.7](Ringly_PRD_v3.md#n10-7)) — though not which period they settled or under which terms, which is
  precisely the part that would be lost.
- <a id="r23"></a>**R23 — A business cannot action a consumer erasure request through Ringly.**
  Per-customer deletion is withdrawn ([F9.1a](Ringly_PRD_v3.md#f9-1a)), so the only way to remove one
  caller's data is to delete the whole account. Ringly is the processor and the
  business is the controller ([N6.5](Ringly_PRD_v3.md#n6-5)), so the obligation sits with the business —
  but Ringly's ability to assist with it is now all-or-nothing. **Accepted
  deliberately**, on the grounds that a partial deletion either rewrites settled
  figures ([F6.16](Ringly_PRD_v3.md#f6-16)) or claims a completeness it does not have, and that a rarely
  used deletion path is the one most likely to be wrong when it is finally
  exercised. Revisit if a business actually receives such a request, or if the
  processor obligation is tested.
- <a id="r24"></a>**R24 — A model call decides what is billable.** The outcome classifier drives
  usage billing ([F6.6](Ringly_PRD_v3.md#f6-6)), and a model is not deterministic. Mitigated by failing in
  the business's favour: an unclassified call is counted, excluded from outcomes,
  and **not billed** ([§2.9.1](#291-outcome-classification)). The residual risk is under-billing, which is the
  right direction to be wrong in.
- <a id="r25"></a>**R25 — A silent unbind failure leaks revenue with no other symptom.** Every
  other component believes service has stopped, so nothing else in the system
  would ever notice ([F1.12a-ii](Ringly_PRD_v3.md#f1-12a-ii)). Mitigated by reading provider state back on
  every bind and unbind, under its own operator alert ([§2.5.3](#253-bind-and-unbind-are-verified-by-reading-provider-state-back), [F7.13a](Ringly_PRD_v3.md#f7-13a)).
- <a id="r26"></a>**R26 — Test-mode payment clocks make the behaviour suite slow.** Advancing one
  is a server-side job polled to completion. Mitigated by giving the suite its
  own runner and timeout and keeping it out of the fast unit suite ([§2.15](#215-test-strategy-and-the-tdd-workflow)).

---

## 2.19 Scenario catalogue

**To be derived, next.** The previous catalogue is withdrawn: it was numbered
against the pre-renumber requirements and contained a group for recurring
appointments, which the product no longer has.

The replacement is derived from the **Behaviours owed to the catalogue** lists in
[§2.2](#22-architecture)–[§2.14](#214-cross-cutting-properties), which is why those lists exist. Each scenario names the requirement
it holds, belongs to exactly one group, and is written as something a person does
and what then becomes true. Until it lands, `tests/behaviour/harness/scenarios.ts`
and its accounting test still describe the old catalogue and are stale.

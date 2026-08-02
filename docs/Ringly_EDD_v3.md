# Ringly — Engineering Design (v3.0)

_Written 2026-08-01 against [`Ringly_PRD_v3.md`](./Ringly_PRD_v3.md), which is
the document this one is answerable to. Supersedes Part 2 of
`Ringly_PRD_EDD_v2.md`._

> **Read the PRD first.** Every `F` and `N` reference here points into it. This
> design is derived from those requirements rather than from the code in this
> repository, and **where the two disagree the code is what changes**.

> **Where to start.** **§2.1** is the six properties every later section cites
> instead of re-arguing. Every design section then ends with a **Testing** block
> naming what is observable from outside, what is internal and may never appear in
> a test body, and the behaviours that section owes the scenario catalogue.
> **§2.15** is the test strategy those blocks feed; **§2.16** is the delivery
> plan; **§2.18** carries the risk register, whose numbers are cited from the PRD
> and from commit messages and are therefore stable.

> **Not yet written: the scenario catalogue and the requirement coverage map**
> (§2.19). Until they land, `tests/behaviour/` still describes the withdrawn
> catalogue.

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

**The test suite is written first.** §2.15 sets out the loop; each section's
Testing block is what that loop consumes.

---

## 2.1 What the design is answerable to

Six properties come out of the PRD and constrain every decision below. They are
listed here so that a later section can say "because 2.1.3" instead of
re-arguing.

**2.1.1 — A booking Ringly cannot verify is worse than no booking.** F2.7 and
N7.2 make the scheduling provider a hard dependency of the write path: if the
calendar cannot be read, nothing is written and the caller is told to ring back.
This removes every design in which booking proceeds optimistically and
reconciles later. It also means the provider's latency is on the call path and
inside N3's budget, which shapes §2.6 and §2.7.

**2.1.2 — There is no channel to the calling customer.** §1.4 is absolute: the
agent reading a booking back during the call is the entire confirmation. Nothing
in this design may grow a notification path to a caller, and every event that
would otherwise want one — a failure, a change, a deletion — resolves to telling
the **owner** instead. It is also why customer PII is thin (a name and a phone
number) and why deleting it is cheap.

**2.1.3 — The money records are the strictest thing in the system.** N10 names
five tables that are never hard-deleted, never updated in place once settled,
and must survive losing a region. Everything else can be rebuilt from a provider
or asked for again; what a business was charged, under which policy version, and
against how many seconds of usage exists nowhere else in full. This forces
append-only ledgers, versioned pricing policy, and the transaction at the end of
teardown (§2.13).

**2.1.4 — Exactly one act starts billing.** F1.12b enumerates, negatively, every
thing that must not: call volume, elapsed time, a confirmed test call, a stored
card, an operator. There is therefore exactly one code path that can create
period 1 and take the first $100, and it is reached only from the Activate
button. This is a structural claim, not a policy one — a second path is a defect
even if it never fires.

**2.1.5 — Nothing may degrade with total platform size.** N2.1 targets 10,000
businesses × 10,000 customers, order 10⁸ rows in `calls` and `appointments`.
N2.2 permits degradation only as a function of the requesting tenant's own size.
Every tenant table therefore leads its primary index with `business_id`, and no
dashboard query is allowed to scan raw call history (N4.3) — which is what makes
the rollup in §2.9 mandatory rather than an optimisation.

**2.1.6 — The host is undecided and must stay that way.** N8 leaves Vercel and
Cloud Run both open. No host-specific primitive is adopted (N8.2): no proprietary
cron, queue, or key-value product. Background work is specified as idempotent HTTP
endpoints driven by an external timer (§2.2), which both platforms can do and
neither owns.

---

## 2.2 Architecture

**One deployable, one database, and a timer.** That is the whole of it, and the
simplicity is deliberate: 2.1.6 forbids the managed queue or scheduler that
would otherwise absorb the background work.

### 2.2.1 The four surfaces

The application serves four kinds of traffic that differ in who is
authenticated, and the difference matters more than the code layout:

| Surface               | Who is authenticated                       | Isolation                                                             |
| --------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| **Onboarding**        | Nobody, until the Google sign-in           | No tenant exists yet; spend-capped (N9)                               |
| **Business app**      | The owner's Google identity (F1.7)         | Row-level security, scoped to one business (N1.1)                     |
| **`/ops`**            | The operator, separately                   | The only cross-tenant reader in the system; its own module (§2.12)    |
| **Provider webhooks** | Nobody — a signature, not a session (N6.3) | Service role, so every query scopes by business **explicitly** (N1.2) |

The webhook surface is the dangerous one and is treated as such throughout: it
runs without RLS, it is on the call path under N3's budget, and it is where a
missing `business_id` predicate becomes a cross-tenant read rather than an
error.

### 2.2.2 Request paths and background work

**Nothing that a caller is waiting on is done in the background, and nothing a
caller is not waiting on is done in the foreground.** N3.2 states the rule; the
split falls out of it.

On the call path (§2.6): resolve the tenant, check availability, write the
booking, answer. Off it: persisting the call record, metering usage,
classifying the outcome, rolling up analytics, sending mail.

**Six workers, each an idempotent HTTP endpoint invoked by an external timer**
(N8.3), which both candidate hosts can drive and neither owns (N8.1). Idempotent is the load-bearing word: the timer may fire twice, a
deploy may overlap a run, and neither may produce a second charge or a second
email.

| Worker                     | Cadence         | Owns                                                                     |
| -------------------------- | --------------- | ------------------------------------------------------------------------ |
| **Analytics rollup**       | Nightly, per tz | Yesterday's `daily_call_rollups` and `cost_records` for every business   |
| **Billing settlement**     | Hourly          | Periods due to open or settle; the cap clamp (§2.10)                     |
| **Lifecycle sweeper**      | Hourly          | Deadlines that have come due and are not paused; suspension; teardown    |
| **Email dispatcher**       | Minutely        | Sending what is queued, with retry (§2.11)                               |
| **Billing reconciliation** | Daily           | Suspended businesses that owe nothing and were never restored (F6.10b-i) |
| **Calendar health probe**  | Every 5 min     | Businesses with an open calendar incident (§2.6.4)                       |
| **Classification**         | Hourly          | Submits and reaps outcome-classification batches (§2.9.1)                |

That is seven rows against "six workers" because **classification and the
calendar probe are the same deployment concern and different jobs**; count them
as you like. What matters is that each is a URL, each processes only rows that
have come due, and each is safe to invoke twice.

There is no recurrence materialiser. Recurring appointments left the product
(§1.4), and the worker that generated future occurrences went with them.

**Hourly, not daily, for settlement and the sweeper**, because both carry
deadlines a business feels: a period opening late means a business is served
without a period to bill it to, and a suspension arriving a day late is a free
day nobody decided to give. Both are cheap — they process only rows that have
come due, which is also what satisfies N2.3: a worker's cost is bounded by the
number of due rows, not by total platform size, so steady-state lag stays bounded
as tenants arrive.

**Why not a queue.** Every job above is a scan of rows that have become due,
which a table already expresses. A queue would add a second source of truth
about what is outstanding, a second thing to keep exactly-once, and a host
dependency 2.1.6 forbids. `lifecycle_deadlines` and the pending-email table are
the queues.

### 2.2.3 What runs where

Everything in one region in the US (N8.4), alongside the database, because the
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
  or the enrichment provider is down (N7.1).

---

## 2.3 Multi-tenancy and isolation

**Two mechanisms, because one is not enough** (N1.1, N1.2).

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
- N1.2 requires that scoping to be covered by tests, so it is a behaviour in
  §2.6's list rather than a convention in a style guide.

### 2.3.2 `/ops` is the only thing that reads across tenants

And it is the one screen that must (F8.1, F8.2a). It is a separate module with
its own database role, its own routes, and no shared session with the business
app. **The operator's view of a business's dashboard is a render, not an
impersonation** (F8.2e): no business session is created and no business
credential is used.

### 2.3.3 Physical layout

One Postgres database, one schema, `business_id` on every tenant table. Not a
schema or a database per tenant: 10,000 schemas breaks migrations, connection
pooling, and every cross-tenant query the operator needs.

**Every index on a tenant table leads with `business_id`.** This is the whole of
N2.2 in one rule — a query that begins by narrowing to one business cannot
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

**Nothing here is scaffolded in advance** (§1.9). There is no dormant column for
a feature that may arrive, and no table for recurrence.

### 005 — foundations

```
businesses(id pk, name, address, timezone, website, business_type,
           contact_email, contact_email_verified_at,
           phone_number, telephony_agent_id, agent_bound_at,
           billing_status, activated_at,
           booking_horizon_days default 70 check between 7 and 180,
           test_calls_used, created_at)

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
```

The decisions in that block that are load-bearing:

**`is_test_call` is written at the time of the call, never derived** (F1.13c).
Billing status changes; a call's history must not. Deriving it from today's
status would reclassify every test call the instant a business activated.

**`duration_minutes` is on the appointment, `price` is not** (F3.4). Duration is
locked at booking and never moves, or appointments booked around it silently
overlap. Price resolves at the _time of the appointment_, so it is looked up
from `service_versions` rather than copied — the business charges its customer
after the appointment happens, and the price it will collect is the current one.

**A deleted service keeps its versions.** `services.deleted_at` is a soft delete
and `service_versions` rows are never removed, which is what makes F3.4's "an
appointment is valued at the last known price" a query rather than a stamped
copy. An appointment never becomes unpriceable because the catalogue moved on.

**`customers` is unique on `(business_id, phone)`**, because a customer's
identity is their phone number (F2.4). The same person ringing from two phones
becomes two records and Ringly cannot tell; F2.4 accepts that explicitly.

**`appointments.service_id` is NOT NULL, and that is the same decision as the
soft delete above.** They are a pair and neither survives alone. Because a
deleted service keeps its row and its versions, the foreign key target always
exists, so the column can never legitimately be null — and if it were nulled the
appointment would become precisely what F3.4 forbids: unpriceable, because
nulling the reference is exactly how the link to the last known price is lost.
`on delete restrict` rather than `set null`, so an implementation that tries to
hard-delete a service fails loudly instead of quietly producing that state.

**`appointments.customer_id` is NOT NULL, and there is no path that ever makes it
null.** Two rules meet here and both point the same way. **No appointment is
booked without the caller's number** (F2.12) — there are no anonymous bookings,
so it is never null at creation. And **there is no per-customer deletion**
(F9.1a) — customers are destroyed only when the business is, in the transaction
that removes it (§2.13.5), so there is never a surviving appointment whose
customer has gone. A nullable column here would model a state the product does
not have and invite a `set null` that silently orphans revenue the rollups have
already counted.

**`calls` has no `created_at`, deliberately.** A call already carries
`started_at` and `ended_at`, and the row is written seconds after the second of
them, so a creation timestamp would be a third near-identical instant that
nothing reads — scaffolding of exactly the kind §1.9 forbids. **The timestamp
that does earn its place is `classified_at`**, because it is genuinely later than
the call and the rollup has to reason about that gap (§2.9.2).

**`calls.calendar_incident_id` records that a call was refused because the
calendar could not be read**, written at the time of the refusal in the same
spirit as `is_test_call`. It is what makes "how many customers did this outage
turn away" answerable, and **the answer is a query rather than a counter** —
counting the calls that point at an incident cannot drift from the calls
themselves, where a maintained tally on `calendar_incidents` would be a second
copy of a fact and therefore a second thing that can be wrong.

It cannot be derived without this column, which is why it is a column. A
refused booking ends `dropped`, but so does a caller the agent could not help
(F2.10), and an enquiry during an outage still succeeds (F4.5) — outcome alone
cannot separate "we lost this customer to the calendar" from "we lost this one
anyway".

### 006 — scheduling credentials (F4)

```
scheduling_credentials(business_id pk, provider, encrypted_refresh_token,
                       granted_scopes, connected_at, revoked_at, last_ok_at)

calendar_incidents(id pk, business_id fk, opened_at, closed_at, last_error)
```

`provider` exists from the first migration even though Google is the only value
(F4.2), because F4.3 requires a second provider to arrive without touching
booking logic and a column added later means a backfill on 10⁴ rows.

`calendar_incidents` is what makes F2.7's "one email per incident, not one per
lost customer" expressible: the open incident is a row, not a counter. The first
failure opens it and sends; later failures attach to it silently; the first
successful read closes it.

**What the incident is worth reading for is how much it cost**, and that is
carried by the calls that point at it (§2.4/005). The dashboard banner, the
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

billing_events(id pk, business_id fk, kind, amount_cents,
               provider_ref, period_id fk null, occurred_at)
```

**Pricing is policy data, not code** (F6.15, F6.8). The fixed fee, the cap, the
per-minute rate, the test-call allowance and **the set of outcomes that count as
billable** all live in a versioned row with an effective date. Each
`billing_periods` row records which version it settled under, which is the whole
of F6.16: a change to commercial terms never rewrites history, because history
points at the terms it ran under.

**`usage_records.period_id` is nullable, and the null case is a requirement**
(F6.11c-ii). When the failed charge _was_ a period's settlement, that period
closes the same day and the grace week that follows has no open period to bill
to. Those seconds are recorded and never charged. A non-null constraint here
would force the design to invent a period to hold them — which is exactly the
$100 charge F6.11c refuses to manufacture.

**`billing_events` is the append-only ledger** (F6.14, N10.4). Every charge,
refund, failure and chargeback is a row. Nothing in it is updated; corrections
are new rows.

**`usage_records.created_at` earns its place where `calls.created_at` did not.**
This is a money table (N10.1): it is append-only, corrections arrive as new rows
rather than edits (N10.4), and reconciling it against the payment provider means
being able to order the writes and say what existed at a given moment. N10.3's
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
'10 days'` cannot be paused, and F9.1b requires the operator to pause exactly
that. A `due_at` with a nullable `paused_at` can.

**The table is a to-do list for the sweeper, one row per clock a business is
currently under.** The sweeper's entire query is _rows where `due_at` has passed
and `paused_at` is null_; everything else about lifecycle is which rows exist.
**Silence never pauses anything** — absent an explicit operator action the
default stands.

**`kind` is a closed set, and each has exactly one thing that creates it and one
thing that clears it.** A business usually has none; a failing one has two.

| `kind`                      | Created when                          | Due                                     | Cleared when                         | On due                              |
| --------------------------- | ------------------------------------- | --------------------------------------- | ------------------------------------ | ----------------------------------- |
| `unactivated_deletion`      | The business row is created           | +10 days (F9.1)                         | It activates                         | Teardown (§2.13.4)                  |
| `grace_expiry`              | The **first** charge fails (F6.11)    | +7 days                                 | Nothing is owed                      | Suspend: unbind the agent           |
| `nonpayment_deletion`       | The **first** charge fails (F9.3)     | +60 days                                | Nothing is owed                      | Teardown                            |
| `cancellation_window_close` | The operator marks cancelled (F6.10a) | +7 days or period end, whichever sooner | The cancellation is revoked (F6.12a) | Settle early, stop service (F6.12b) |
| `dormancy_deletion`         | The cancellation window closes        | +60 days (F6.12e)                       | The business returns                 | Teardown                            |

**Both non-payment rows are created together, at the first decline**, not one
after the other. The 60-day clock runs from the failure, not from the suspension
(F9.3), so creating it at day 7 would give away a week. It is also why
`unique (business_id, kind)` is per-kind rather than per-business: a business in
grace legitimately has two clocks running.

**`warned_at` is how F9.3a is kept unconditional.** Nothing is deleted without a
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

**`departed_businesses` carries no consumer data by construction** (F9.9) — no
caller name, no number, no appointment. It has no RLS policy and is reachable
only through `/ops`. It also carries no phone number: the number is released at
deletion (F9.4b) and recording it would outlive the business's claim to it.

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
outcomes against six four-hour windows (F5.4a). This single structure is what
serves F5.4's one chart in both of its configurations: grouping by outcome and
filtering by window is a sum along one axis, grouping by window and filtering by
outcome is a sum along the other. Two separate count arrays could not answer the
second question without a second scan, and a flat outcome count could not answer
either.

**No median column, deliberately.** A median cannot be recovered from daily
aggregates, which is why F5.16 makes it the one live query in the dashboard.

**`cost_records.business_id` is nullable** so that onboarding enrichment spend,
which happens before a business exists, is still attributable (N9.2).

### 010 — email (F7)

```
email_sends(id pk, reason_key unique, business_id (no fk), kind,
            to_address, identity, subject, body,
            queued_at, claimed_at null, sent_at null, attempts,
            last_error null, provider_idempotency_key)
```

**Delivery is at-least-once, and the row is what makes it so** (F7.5). The
dispatcher claims a row, sends, then records the send. A worker dying between the
send and the record leaves a claimed row that a later run retries — so the
message may arrive twice, and **that is the failure this design chooses**. The
alternative, recording the intent before sending, loses the message when the same
crash happens, and the messages here are the ones a business cannot afford to
miss: I4 makes the 48-hour deletion warning unconditional, and an at-most-once
deletion warning is an invariant that silently is not one.

Three things keep the duplicate cheap:

- **`provider_idempotency_key` is sent with the message**, so a redelivery is
  usually collapsed by the provider before it reaches an inbox.
- **Every template's footer says to ignore the message if it has already
  arrived** (F7.7).
- **`reason_key` is unique and is a different thing from delivery.** It carries
  F7.5's three shapes — per period, per incident, per event — and answers "is
  there a reason to send this at all", which is what stops an outage emailing a
  business once per lost customer. Delivery may repeat; a reason may not.

**`business_id` is a plain value and deliberately not a foreign key.** Teardown
enqueues the deletion email at step 6 and deletes the business at step 8
(§2.13.4), so a constrained reference would either block the deletion or take the
queued message with it — losing precisely the email whose whole purpose is to
tell someone the business is gone.

**`subject` and `body` are rendered at enqueue, not at send.** For the same
reason: by the time the dispatcher runs, the tenant row a template would read
from may no longer exist. A message that cannot be rendered after its subject has
been deleted is a message that will not be sent on the one path that needs it
most.

### 011 — operator economics (F8)

Views and indexes only; no new tenant data. Per-business revenue, cost and
margin (F8.2a) are derived from `billing_events` and `cost_records`, and the
"needs attention" queue (F8.12) is derived from lifecycle, billing and incident
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

F1 in order, with the two failure paths that matter.

### 2.5.1 The flow

1. **Free-form intake** (F1.1) — one text box, no structured fields. **The
   prompt is spoken aloud and the answer is typed** (F1.2); speech-to-text input
   is deferred, so the voice is output only and nothing depends on it.
2. **Enrichment, one request** (F1.3, F1.6) — Places for name, address, phone,
   hours, timezone and website; a website crawl and one model call for the
   service list (F1.4, ≤15 items). This is the unauthenticated paid endpoint of
   N9 and is spend-capped.
3. **The draft is shown, every field editable** (F1.5). Upload and manual entry
   are first-class fallbacks, not error states — a business whose website has no
   price list is normal.
4. **Google sign-in and calendar consent, in one dialog** (F1.7). The reason for
   every scope is stated **before** the redirect (F1.7c).
5. **Scopes actually granted are checked, never assumed** (F1.7a). Granular
   consent means sign-in can succeed while calendar is refused.
6. **Commit** — the business row is created, keyed to the Google identity, and
   **the user is told that their Google login is now their Ringly login**
   (F1.8). There is no password to set and no second account to remember, which
   is only reassuring if it is said.
7. **Number purchase and agent provisioning, in the background** (F1.9). Nothing
   chargeable to Ringly happens before this point (N9.3): a bot that gets past
   the rate limiter costs one enrichment call, never a phone number.
8. **The checklist** (F1.12) — three tasks in any order, with test calls
   remaining shown alongside.
9. **Activate** (F1.12a).

### 2.5.2 Activation touches three systems and can fail at each

F1.12a-i is a specification of what the business sees, and the design has to
make each row reachable independently.

| Fails at               | Design response                                                                                       | Business sees                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------- |
| **The card**           | Nothing else has happened yet. The charge is attempted first, precisely so this row is clean          | Declined, try another. No state |
| **Recording it**       | The charge succeeded, so Ringly owns the inconsistency: retry against its own database until it lands | Progress, then success          |
| **Binding the number** | Activation stands. The bind retries; the operator is alerted (F8.6)                                   | "Activated; number connecting"  |

**The order is charge → record → bind**, and it is chosen so that the only
failure the business is asked to act on is the only one they can act on. A card
that declines is theirs to fix. Everything after the charge is Ringly's.

**The owner presses Activate exactly once.** No failure is ever returned as
"press it again" (F1.12a-i) — the button shows progress until the sequence
resolves, because the one moment a business must not be asked to press a payment
button twice is the moment it cannot tell whether the first press took.

### 2.5.3 Bind and unbind are verified by reading provider state back

F1.12a-ii, and it is the one piece of vendor interaction the design does not
trust. A write that reports success and does not take effect is invisible until
a customer finds it.

- **After every bind and every unbind, read the provider's own record** and
  confirm it matches. Fail the operation if it does not.
- **A failed bind** raises the activation-stuck alert. A business is paying for
  a number that rings nowhere.
- **A failed unbind** raises its own alert (F7.13a) — it is the only symptom
  there is. The number is answering calls Ringly has stopped metering, and every
  other component believes service has stopped.
- **It is a read of provider state, never a placed call.** A synthetic call
  costs minutes on every bind, lands in `calls` where it corrupts both the
  test-call count and the analytics, and still proves only that something
  answered.

### 2.5.4 The test-call allowance

A call is a test call if the business had not pressed Activate when it arrived
(F1.13c) — the whole rule, with no detection and no examination of who is
calling. At the fifth, the agent is unbound and the sixth call is **not answered
at all** (F1.13a): a recorded refusal would still be a connected call and would
still cost the minutes the limit exists to bound.

The allowance is a policy value (F1.13), not a constant.

**Testing this section**

_Observable_ — what the draft contains after enrichment; which fields can be
edited; what the checklist shows; whether the Activate button is available;
whether the number answers; what the business is charged; what arrives in its
inbox; what the operator queue holds.

_Internal_ — the provisioning sequence, the OAuth flow's shape, the retry
mechanism, the agent identifier, `billing_status` values.

_Behaviours owed to the catalogue_

- One free-form submission yields name, address, phone, hours, timezone, website
  and services in a single request.
- Every enriched field can be corrected before commit, and the correction is what
  is committed.
- An unreachable website falls back to manual entry rather than failing.
- Sign-in succeeding while calendar consent is declined keeps the account and the
  draft, blocks activation, and explains why.
- The checklist can be completed in any order; none of the three items activates
  anything on its own.
- Adding a card stores it and charges nothing.
- Pressing Activate charges $100 once, opens period 1, and makes the number live.
- A declined card at activation charges nothing and changes nothing.
- A bind that silently does not take effect is detected, retried, and raised.
- An unbind that silently does not take effect is detected and raised under its
  own alert.
- The fifth test call unbinds the number; the sixth is not answered; the business
  is emailed and never charged.
- A business that never confirmed a working test call cannot activate and is
  raised as stuck.
- A business with all three items green that has not pressed Activate is not
  raised as stuck.
- Activating after the allowance is spent rebinds the number immediately.

---

## 2.6 The call path

The only latency-sensitive code in the system, and the only place where a
mistake is heard by a stranger.

### 2.6.1 Budget

N3, restated as the thing implementations are held to:

| Segment                            | p95 target | Hard ceiling | Implemented as                            |
| ---------------------------------- | ---------- | ------------ | ----------------------------------------- |
| Ringly's handler, end to end       | ≤ 400 ms   | **6000 ms**  | Route-level deadline, checked per await   |
| — of which our own datastore       | ≤ 80 ms    | 1000 ms      | `statement_timeout` on the connection     |
| — of which the scheduling provider | ≤ 250 ms   | **5000 ms**  | `AbortSignal.timeout(5000)` on the fetch  |
| Caller-perceived silence           | ≈ 0        | —            | Agent-side filler, not Ringly code (F2.6) |

**Slow is failed** (N3.1): at the ceiling the request is aborted and the booking
is refused exactly as an outage would be (2.1.1). But the ceiling sits at six
seconds, not one and a half, because **abandoning early costs a customer**
(N3) — the agent covers the wait with filler speech, and a caller who hears
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
(§2.6.4) is what notices.

### 2.6.2 Three webhooks

| Webhook        | When              | Does                                                                 |
| -------------- | ----------------- | -------------------------------------------------------------------- |
| **Call start** | The call connects | Resolves the business from the dialled number; returns tenant config |
| **Tool call**  | Mid-conversation  | Availability, book, reschedule, cancel                               |
| **Call end**   | The call hangs up | Persists the call, meters usage, queues classification               |

Every one verifies the provider's signature before acting (N6.3), using the
vendor's own helper rather than a hand-rolled comparison.

**The business is resolved once, at call start, from the number that was
dialled** — never from anything the caller says or supplies. That single fact is
what keeps N1.2 true across a surface with no session (§2.3.1).

### 2.6.3 Booking, in order

1. Resolve the requested time in the **business's** timezone (F2.5, N5.2).
2. Reject anything beyond the business's booking horizon (F2.9).
3. Reject anything outside opening hours (F2.8) — the agent answers 24 hours,
   the diary does not.
4. **Read the connected calendar and Ringly's own appointments together.** If
   the calendar read fails for any reason, stop here and refuse (F2.7, F2.7a).
5. Write the appointment and the provider event.
6. Read the booking back to the caller (F2.11).

**The write is guarded against the race that happens between offering a slot and
taking it** (F2.3a). A unique constraint on the business's own appointments is
the arbiter; the loser is told the slot has just gone and is re-offered times.
Two callers racing is not an exotic case at these volumes — it is the normal
consequence of offering the same nearest-open time to both.

**A repeating request books its first instance and stops** (F2.2a). There is no
series, nothing is materialised, and the agent says plainly that one appointment
was booked. Nothing downstream may ask whether an appointment belongs to a
series, because nothing does.

### 2.6.4 Fail-closed, concretely

When the calendar cannot be read the caller gets an apology and is asked to ring
back (F2.7); the business gets a banner and **one email per incident, not per
call**; the operator sees the business under "bookings failing" (F8.12).

**No call writes to `calendar_incidents` on the happy path.** The incident table
is touched only on a state _transition_, and both transitions happen **after the
handler has already answered the agent** (N3.2) — nothing here is on the
caller's clock.

```
read succeeds
  └─ cached incident flag clear? → do nothing. Zero writes, the common case.
  └─ flag set?                   → UPDATE calendar_incidents
                                      SET closed_at = now()
                                    WHERE business_id = $1 AND closed_at IS NULL

read fails
  └─ INSERT INTO calendar_incidents (business_id, opened_at, last_error)
       VALUES ($1, now(), $2)
       ON CONFLICT DO NOTHING
       RETURNING id
     ├─ a row came back → this call opened the incident → queue the email
     └─ nothing came back → an incident was already open → attach silently
```

**The uniqueness is a database constraint, not application discipline:**

```sql
CREATE UNIQUE INDEX one_open_incident_per_business
    ON calendar_incidents (business_id) WHERE closed_at IS NULL;
```

That partial index is what makes F2.7's "one email per incident" true under
concurrency. Forty calls failing simultaneously all attempt the insert; exactly
one wins and gets a row back, and only that one queues an email. Without it,
"check then insert" races and forty callers become forty emails on the worst
possible day for the business to receive them.

**The cached flag is an optimisation, not the correctness mechanism.** The
tenant config cache (§2.6.6) carries `hasOpenCalendarIncident` so a healthy
business does not attempt a pointless `UPDATE` on every call. If the flag is
stale the `UPDATE` is simply a no-op — it is already scoped to
`closed_at IS NULL` — and the next call or the probe closes the incident.

**The probe is what makes the banner honest when nobody rings.** Closing on "the
first successful read" is fine while calls are arriving and useless otherwise: a
business whose calendar broke at 6pm and reconnected at 8pm should not keep a
red banner all night waiting for a customer to dial. The **calendar health probe**
(§2.2.2) runs every five minutes over businesses with an open incident, performs
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

F2.4 is a matching problem, not a lookup, and the design has to be explicit
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
- **A correction re-runs the search** against the corrected values (F2.4).
- **A relative day means the next one**: "Tuesday at 2" is the nearest future
  Tuesday, and the agent states the full date back and waits for confirmation
  before acting.

### 2.6.6 Tenant config cache

The call-start webhook needs the business, its services, hours, timezone and
horizon on every call. N4.2 forbids hitting the database or a paid API for
slow-changing configuration on every call.

**A process-local cache with a 60-second TTL**, which is not a coincidence:
F3.2 requires a catalogue or hours change to reach the agent within 60 seconds,
so the TTL _is_ the propagation guarantee. A caller already mid-conversation
keeps the configuration they started with, because the config is resolved once
at call start and passed down.

No shared cache product, because 2.1.6 forbids the host dependency and a
60-second TTL over 10⁴ tenants does not need one.

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

F4.3 requires a second provider to arrive without touching booking logic. That
is an interface requirement, and it is small.

```
availability(business, window)        -> busy intervals
create(business, appointment)         -> provider event id
move(business, event id, to)          -> void
cancel(business, event id)            -> void
```

**Four operations, and everything else stays out.** The interface does not
expose provider concepts — no calendar ids, no attendee lists, no recurrence
rules (there is no recurrence to express). Booking logic in §2.6 calls only
these, so adding Microsoft 365 or CalDAV is a new implementation and a row in a
table, not a change to the code that decides whether a slot is free.

**Credentials are the provider's business too.** Refresh, revocation and scope
checking live behind the same boundary; §2.6 sees "the calendar could not be
read" and nothing more specific, which is exactly what F2.7a requires — provider
outage, timeout, revoked consent and expired credentials must be
indistinguishable at the call site because they have identical consequences.

**`events.list` rather than `freebusy`**, because reschedule and cancel need the
event id and `freebusy` does not expose it.

**The interface is shaped by what comes next, in priority order** (F4.4):
Microsoft 365 / Outlook, then CalDAV for Apple and Fastmail, then vertical
booking systems such as Square Appointments, Acuity and Calendly. The first two
fit the four operations as they stand. The third group may not — a vertical
booking system owns the appointment rather than storing an event — and that is
the point at which this interface is expected to need a second shape rather than
a third implementation. Recording it now means the eventual redesign is a known
cost, not a surprise.

**Testing this section**

_Observable_ — that a booking appears in the connected calendar; that an event
created directly by the owner is respected for conflicts but never appears in
Ringly's figures (F5.12); that all four failure modes refuse identically.

_Internal_ — the interface's method names, the vendor, the API surface, token
storage and refresh.

_Behaviours owed to the catalogue_

- A booking appears in the business's own calendar with the right time and
  duration.
- An event the owner created directly blocks that slot for callers.
- That same event never appears in the business's Ringly figures.
- Rescheduling moves the provider's event rather than creating a second one.
- Cancelling removes it.
- Revoked consent surfaces a reconnect control on the dashboard.

---

## 2.8 Catalogue and opening hours

F3, and it is mostly about time.

**A change is written on save and is authoritative from that moment** (F3.5).
No draft, no review, no operator step. The only bound is the ≤60s the agent may
take to see it (F3.2, §2.6.6).

**Price and duration resolve at different moments** (F3.4), which is why
`service_versions` exists:

- **Price** — the version in force **at the appointment's start time**, because
  these businesses charge after the appointment happens.
- **Duration** — copied onto the appointment **at booking** and never revisited.

A worked consequence: a business raises a haircut from $40 to $45 on the 10th.
An appointment booked on the 5th for the 15th is worth $45. An appointment
booked on the 5th for the 8th is worth $40. Neither changes length, and neither
overlaps its neighbours.

**Narrowing hours never moves or cancels an existing appointment** (F3.5). A
time was agreed with a customer Ringly has no way to contact (2.1.2), so
breaking it silently is worse than honouring it. Widening makes new slots
bookable immediately.

**Timezone is not self-serve** (F3.6). It is resolved once at onboarding and
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

One pipeline, two readers (F5, F8). F8.7 requires the operator's dashboard to
follow the same freshness rule as the business's, so there is one rollup and one
explanation rather than two.

### 2.9.1 Outcome classification

An outcome is a judgement — "did the caller get what they rang for" is not
mechanically derivable from a transcript — so it is produced by a model. Every
decision below follows from three constraints: it must not touch the call path,
Ringly stores no transcripts (F9.6), and an unclassified call must be safe
(§2.9.1.4).

#### 2.9.1.1 Where it runs

Not on the call path, not in the post-call webhook.
The webhook writes the call row with `outcome = null` and returns. Classification
is a **batch job** submitted by the classification worker (§2.2.2), hourly.

Batching rather than one request per call, for three reasons: the Message Batches
API is **50% cheaper** than the same requests made individually; outcomes are not
needed until the nightly rollup, so latency is irrelevant; and one submission per
business-hour is far kinder to rate limits than a request per call.

#### 2.9.1.2 The call

Anthropic's Messages API via `@anthropic-ai/sdk`, already
a dependency.

```ts
await client.messages.batches.create({
  requests: unclassified.map((call) => ({
    custom_id: call.id, // §2.9.1.5
    params: {
      model: policy.classifierModel, // config, not a constant — see below
      max_tokens: 256,
      thinking: { type: "disabled" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: OUTCOME_SCHEMA },
      },
      system: [
        {
          type: "text",
          text: rulesetPrompt(policy),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: transcript }],
    },
  })),
});
```

**`claude-opus-5`** is the default. The model id is a **`pricing_policy` column,
not a constant** — the same principle as every other number in this design
(F6.15). Trading down to a cheaper model is a cost decision with a quality
consequence, and it belongs to whoever owns the margin, not to this document.

**Thinking is disabled at `low` effort**, which is valid only at effort `high` or
below. Both documented hazards of disabling thinking are bounded here: tool calls
leaking into prose cannot happen because the request declares no tools, and
`<thinking>` tags cannot reach the outcome because the response is schema-
constrained. If label quality proves marginal the first lever is adaptive
thinking at `low` effort — **not** raising effort, which buys deliberation this
task does not need.

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
renders the dashboard's definitions panel (§2.9.4), so a ruleset change moves the
prompt, the schema, and the business's explanation together or moves none of them.

**The system prompt is the cache prefix.** It carries the ruleset and is byte-
identical across every call in the batch and across batches until the policy
version changes — the ideal shape for prompt caching (~0.1× on the cached span).
The transcript is the only volatile part and sits after the breakpoint. Opus 5's
minimum cacheable prefix is 512 tokens, which the ruleset comfortably exceeds.

#### 2.9.1.4 Failure is safe by construction

Six things can go wrong and all six
land in the same place: **the call stays unclassified, and an unclassified call is
not billed** (F6.6).

| Failure                               | Detected as                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| The batch has not returned yet        | `processing_status !== "ended"`                                                                          |
| One request errored                   | `result.type === "errored"`                                                                              |
| The batch expired (24h ceiling)       | `result.type === "expired"`                                                                              |
| Safety classifiers declined           | `stop_reason === "refusal"` — schema not honoured on a refusal, so check this **before** reading content |
| The transcript is past its 30-day TTL | Provider fetch 404s — the call is permanently unclassifiable (F9.7)                                      |
| `stop_reason === "max_tokens"`        | Truncated JSON; retry once, then leave it                                                                |

**This fails in the business's favour, deliberately** (R23). The alternative —
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
transcripts nor recordings (F9.6). The worker fetches each transcript from the
telephony provider at submission time, sends it, and never writes it anywhere.
The only durable residue of a transcript is a five-value enum.

That is also why classification cannot be deferred indefinitely: the provider's
retention is 30 days (F9.6), after which the input no longer exists. An hourly
cadence leaves ~700 hours of margin.

#### 2.9.1.7 Cost, and a gap in the cost model

At Opus 5 pricing ($5/$25 per
MTok), batch (−50%), a cached ruleset and a ~1k-token transcript, a classified
call costs on the order of **$0.003**. Against $0.13–0.31/minute of telephony it
is noise per call — but it is **not free at 10⁴ tenants**, and it is a real
per-business per-call cost.

**F8.5's cost model does not include it.** That requirement attributes "Retell
only… all per-call charges including LLM", which is the _agent's_ model, not the
classifier's. F8.5 says a cost line is added when something new is billed per
business — this is, so `cost_records` carries a `classifier` source alongside
`telephony`, and the operator's margin column reflects both. **Left as a flagged
discrepancy against F8.5 rather than resolved silently**: the requirement says
Retell is the sole cost line, and this design needs a second one.

#### 2.9.1.8 What is not tested here

Whether the model labels a real transcript
correctly is a model evaluation with its own dataset, not a scenario (§2.15.6).
The behaviour suite fakes the classifier and injects labels, so everything
downstream of the label stays deterministic.

#### 2.9.1.9 Definitions never rewrite history

Historical calls are **not**
reclassified when a ruleset changes (F5.8) — transcripts are gone, so outcomes
cannot be re-derived. Each call keeps the `outcome_ruleset_version` it was
labelled under and the dashboard says the figures are not comparable across the
change.

### 2.9.2 The rollup

Nightly, per business, in that business's timezone (N5.2). It writes one
`daily_call_rollups` row per business per day: counts, durations, appointments
booked, revenue booked, and the 5 × 6 outcome-by-window matrix.

**This is what makes N4.3 and F5.14 achievable at 10,000 tenants.** A dashboard
that scanned raw calls would degrade with total platform volume, which N2.2
forbids.

**A day can be rolled up before all of its outcomes exist**, because
classification is batched and asynchronous (§2.9.1). The rollup therefore records
`computed_at` and **recomputes any day holding a call whose `classified_at` is
later than that** — which is the reason the call carries the timestamp. Without
the rule, a call classified after its day was rolled up is counted in the totals
and missing from the outcome breakdown, and the two figures disagree permanently
with nothing on the page to explain why.

**The consequence is that today's calls are not shown**, and the dashboard must
say so in plain words (F5.16): complete to a stated date, today appears
tomorrow. A business that has just taken a call, cannot find it, and is given no
explanation concludes the product is broken — and it will do that on day one,
when it is testing exactly this.

### 2.9.3 What is live, and why each one is

| Figure                      | Source      | Why                                                        |
| --------------------------- | ----------- | ---------------------------------------------------------- |
| Call counts, outcomes       | Rollup      | Questions about shape and trend; a day old is fine         |
| **Median duration**         | **Live**    | Cannot be recovered from daily aggregates                  |
| **Billing figures**         | **Live**    | A business asking what it owes is asking about now (F5.10) |
| **Service status**          | **Live**    | "Is my phone being answered?" is never stale (F5.18)       |
| Operator money              | **Settled** | Only money actually received counts (F8.8)                 |
| Operator operational panels | **Live**    | They exist to prompt action today (F8.7)                   |

**Anything live is labelled live**, so the two kinds of figure are never read as
one (F5.16).

### 2.9.4 The business dashboard

Three things, in this order (F5):

**(a) The shape of the calls.** Two filters govern the whole page — unit
(calendar month or billing period) and range (current / past 3 / 6 / 12), and no
arbitrary date picker (F5.2). Five tiles (F5.3), one chart (F5.4), three trends
(F5.5).

**The one chart is one measure and two dimensions** (F5.4). Its measure is the
number of calls. Its dimensions are time of day and outcome, and **one groups
while the other filters, with the business choosing which way round** (F5.4b).
The 5 × 6 matrix in §2.4/009 serves both configurations from the same row, which
is why it is stored as a matrix rather than as two count arrays.

**(b) Billing history.** One table, not a chart — minutes and money are
different units and a single plot with two axes is the one construction that
reliably misleads (F5.9). The current period is the first row of that same
table, live, not a separate panel beside it.

**(c) Service status and controls.** Status at the top, never stale (F5.18).
Controls per F5.15.

**Every outcome definition is shown on the page itself**, in plain language, next
to the figures it governs (F5.7) — a business must never have to guess what
"dropped" counts. **If a definition changes, the dashboard says so prominently**
(F5.8) and states that figures before and after are not directly comparable.
Historical calls are not reclassified (§2.9.1). The definitions render from the
policy row rather than from hardcoded copy, so one change moves both the figures
and the explanation.

**Every money figure states whether it is settled** (F5.17). A charge that has
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

**Aggregate only, always** (F5.11). No transcripts, no recordings, no
per-customer breakdown — Ringly stores no call content (F9.6) and cannot
reliably identify a customer.

### 2.9.5 The operator dashboard

**The main view is money and it is a table** (F8.2a) — one row per business,
revenue, cost, margin, sortable. With thousands of businesses no chart
distinguishes them; a table sorted by margin puts the ones losing money on top,
which is the question the operator actually has.

**Reported by calendar month, not by each business's 30-day period** (F8.8). No
two businesses share a period, so per-period figures cannot be summed into
anything an accountant can use. **Only money actually received counts as
revenue, and only real incurred cost counts as cost** — neither is accrued nor
projected.

**Cost model v1 is Retell only** (F8.5): the number rental and all per-call
charges including LLM. Deliberately excluded — the database and application host
(fixed overhead, immaterial per tenant, and the host is not yet chosen) and
Places (one-off at onboarding, covered by the first $100). A cost line is added
when something new is billed per business, not in advance of it.

**Two filters govern the page** (F8.2): a range — current calendar month, past 3,
6 or 12 — and a business selector listing every business active in that range,
from which the operator picks one, several, or all.

**Two charts, and only two** (F8.2b). Margin over time, one column per calendar
month, with a **zero baseline**, because margin can go negative (R8) and a losing
month must not render as merely a shorter bar. And calls by outcome and time of
day, grouping by one and filtering the other exactly as F5.4b does for the
business — served from the same 5 × 6 matrix, summed across the selected
businesses instead of one.

**No per-business call, duration or outcome columns in the money table**
(F8.2c). Those are questions about one business and are answered by opening that
business's own dashboard, one click away and in the form the business itself
sees. The aggregate chart stays, because it answers a different question — how
calls behave across the platform — that opening one dashboard at a time cannot.

**Three operational panels, all live** (F8.7): payment reliability per business
(F8.3), so irregular payers are visible at a glance; the needs-attention queue
(§2.12); and **rented numbers that are not earning** (F8.9) — held for businesses
that never activated, are suspended, or are otherwise not paying the $100
minimum. Each is a standing cost with no revenue against it. They are live rather
than rolled up because they exist to prompt action today, and a business whose
calendar broke this morning must not first appear tomorrow.

**Platform totals across the selected range** (F8.4): revenue, cost, margin, and
the number of active businesses.

**The same outcome definitions the business sees** (F8.11), so both sides of a
support conversation are reading the same words.

**No per-customer figures anywhere** (F8.2d), for the same reason as F5.3.

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
charge on a real card. F6 is long because the failure paths are; this section
follows the same order.

### 2.10.1 States

A transition table rather than a diagram, because the side effects are the part
an implementation gets wrong:

| From         | Event                      | To           | Side effects                                                                   |
| ------------ | -------------------------- | ------------ | ------------------------------------------------------------------------------ |
| —            | Onboarding commits         | `unbilled`   | `unactivated_deletion` deadline at +10d                                        |
| `unbilled`   | **Activate pressed**       | `active`     | Charge $100, open period 1, bind agent, clear the deadline                     |
| `unbilled`   | Day 10 elapses             | _deleted_    | Teardown (§2.13.4)                                                             |
| `active`     | A charge fails             | `grace`      | `grace_expiry` +7d **and** `nonpayment_deletion` +60d, both from today         |
| `grace`      | Nothing owed               | `active`     | Clear both deadlines                                                           |
| `grace`      | Day 7 elapses              | `suspended`  | **Unbind the agent**, verified (§2.5.3). No new charge ever                    |
| `suspended`  | Nothing owed               | `active`     | Rebind, email, open a period **only if none is running** (F6.11b-iii)          |
| `suspended`  | Day 60 elapses             | _deleted_    | Teardown; debt recorded on the departure record                                |
| `active`     | Operator marks cancelled   | `cancelling` | `cancellation_window_close` at min(+7d, period end). Usage stops being billed  |
| `cancelling` | **Operator marks revoked** | **`active`** | Clear the deadline; the window's usage **becomes billable again** (F6.12a)     |
| `cancelling` | Window closes              | `dormant`    | Settle early, clamp, stop service, closing statement, `dormancy_deletion` +60d |
| `dormant`    | Business returns           | `active`     | Rebind, open a new period, charge $100 that day (F6.12e)                       |
| `dormant`    | 60 days elapse             | _deleted_    | Teardown                                                                       |

**`cancelling → active` is the transition most likely to be got wrong**, and it
is not the same as never having cancelled. Revoking makes the free usage served
during the window retroactively billable (F6.12a), so the transition rewrites
`usage_records.period_id` for the window's rows rather than merely clearing a
flag. A `cancelling → active` implemented as "unset cancelled" silently gives the
business a free week it was only ever lent.

**`grace` is not a state a business can be in twice for one debt.** The two
deadlines are created together at the first decline (§2.4/008) and cleared
together when nothing is owed; a second decline while already in `grace` starts
no second clock (F6.11c).

**`unbilled` is not a trial.** It is the state before any commercial relationship
exists. No path leads from it to `active` except the button (2.1.4).

**No test asserts on these names.** Every state above is observable through its
consequences — does the number answer, is anything owed, what arrived in the
inbox — and that is what the Testing block below permits.

### 2.10.2 A period

**Rolling 30 days from activation, never a calendar month, never extended**
(F6.11b). `starts_on` and `ends_on` are written when the period opens and never
move.

**The two charges never share a date.** The $100 is taken on the first day; that
period's usage settles on the last. Period 2 opens the day after period 1 ends,
with its own $100. A card that has gone bad therefore fails one charge at a time,
and there is only ever **one grace clock**, started by whichever failed first
(F6.11).

**Usage accrues on productive calls only** (F6.6) — a booking, a reschedule that
produced a booking, or a cancellation of a real appointment. Enquiries, wrong
numbers, dropped calls and pre-activation test calls are not billable. **Who is
calling is irrelevant**: the owner, a customer and Ringly's own developer are
billed identically, because the outcome is the only test (F6.7).

**The whole call is billable, not the minutes up to the booking** (F6.7).

**Seconds are summed across the whole period and rounded up to a minute once, at
close** (F6.7a) — not per call. A business making many short calls is not
charged a full minute for each.

### 2.10.3 Settlement and the clamp

Settlement happens at exactly three moments (F6.9a), and the $500 clamp is
applied at each:

1. **Normal period end.**
2. **A cancellation window closing** (F6.12), which settles the period early.
3. **Final deletion for non-payment** (F9.3), where the clamped figure is what
   the business is recorded as owing (F9.9) even though it is never collected.

**Usage keeps accruing past the cap and is recorded in full** (F6.9), because
Ringly needs the true number for cost and margin (F8). The cap is applied at
settlement, not during the period. On first crossing it Ringly **continues to
serve, absorbs the excess, alerts the operator, and emails the business** to say
the rest of the period is on Ringly (F6.9b). Hitting the cap is good news for
the business and reads that way.

### 2.10.4 When a charge fails

| Day  | What happens                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------ |
| 0    | Charge fails. Service continues, usage keeps accruing, business emailed                          |
| 0–7  | **Grace.** Calls answered normally. Follow-up emails. This usage **is** billable                 |
| 7    | **Suspended.** The agent is unbound. Number and all data retained                                |
| 7–60 | **Charged nothing whatsoever.** Fully recoverable — paying restores service that day             |
| ~58  | 48-hour final warning                                                                            |
| 60   | Number released, data deleted, the period settled for what was served, debt recorded permanently |

Three rules do the work, and they are the ones easiest to get wrong:

**No new period ever opens while the business owes anything** (F6.11c). Not
during grace, not during suspension. This is the single rule that stops a
failing account accumulating $100 fees for periods it never asked for and mostly
did not receive. A business in trouble is only ever dealing with one period and
one debt, and **the debt never grows while it is unpaid** — a business deciding
on day 55 whether to come back owes exactly what it owed on day 8.

**The period clock never stops, and a suspended business loses service days it
has already paid for** (F6.11b). That is the intended outcome. Extending the
period would leave a business that pays late no worse off than one that pays on
time.

**What pauses is the meter, not the collection** (F6.11b-i). The outstanding
invoice stays open and due, the payment provider keeps retrying the card, and
Ringly keeps sending follow-ups — a suspended business is chased as hard as any
other debtor. What it must never receive is a _new_ charge for a service it is
not getting.

### 2.10.5 Two failure cases that are not symmetric

F6.11d works both through in full. The design must produce both.

**(a) The fixed fee fails**, on day 1 of period _N_. Period _N_ runs to its own
end; usage in days 1–8 accrues to it and is billable; if the business is still
suspended on day 30, _N_ settles on time for what was served and **no _N+1_
opens**. Paying inside _N_ resumes it with nothing new charged; paying after _N_
has ended opens a fresh period that day with its own $100.

**(b) The usage settlement fails**, on the last day of _N_. _N_ closes that same
day and **no successor ever opens**. The grace week that follows runs with no
period open, so **that usage is not billed** (F6.11c-ii) — there is nothing to
bill it to, and inventing a period to hold it would manufacture exactly the $100
charge F6.11c refuses. **The cost is still recorded**, because what Ringly
absorbs, Ringly measures.

**Ceilings differ because the fee was collected in one case and not the other**:
case (a) tops out at $500, case (b) at $400.

### 2.10.6 Coming back

**Payment clearing is the trigger; restoration is the consequence** (F6.10b).
Ringly does not charge a suspended business to bring it back — it is already
being charged, continuously, by retries that never stopped. **The moment nothing
is outstanding, service resumes that day**: the agent is rebound (and verified,
§2.5.3) and the business is emailed.

- **"Nothing outstanding" is the test, not "a payment arrived."** Clearing one
  of two debts leaves it suspended, and the email says what remains.
- **It does not matter how it cleared** — an automatic retry, a new card, or the
  business paying the invoice by hand.
- **Where it lands** depends only on whether the period it was suspended in is
  still running (F6.11b-iii): still running, it resumes inside it with nothing
  new charged; already ended, a new period opens that day with its own $100.
- **The debt clears first, the new period's fee is charged after.** A business
  paying its way out on a day a new period opens is charged twice that day, and
  both appear separately in its billing history.
- **A decline on that new period is a fresh failure with a fresh clock**
  (F6.11b-iv), not a continuation of the one just closed.

**A business that has paid and is still not answered is the worst state in the
system** (F6.10b-i), so recovery does not depend on a single message arriving.
The daily reconciliation worker finds any suspended business that owes nothing
and restores it. A lost webhook may cost such a business hours; it must never
cost it days, and it must never cost it the account.

### 2.10.7 Cancellation

**A short reconsideration window, then settlement** (F6.12). The window runs
from the request until whichever comes first: 7 days later, or the end of the
current period.

- **Service continues unchanged** through it. A business that changes its mind
  finds everything as it was.
- **Usage stops being billed** from the request onward, though the service is
  still given. Ringly absorbs it.
- **Revoking erases the window retroactively** (F6.12a) and the usage served
  during it **becomes billable after all**. The free window is a concession for
  leaving, not a way to take a week of free service and stay. The business asks
  by emailing the same address it cancelled through, and the operator marks it
  revoked (§2.12). **A revocation is judged by when it was sent, not when it was
  read** (F9.2): the window is short and the inbox is asynchronous, so the design
  must accept one actioned after the window closed and unwind the settlement.
- **When it closes**, the period settles early for usage up to the request,
  clamped. **The $100 is not refunded, in whole or in part** (F6.12b).
- **Then 60 days dormant**, fully recoverable, number and every record retained
  (F6.12e). A business returning inside it resumes on its own number with its own
  history, on a new period charged that day.
- **A business already behind on payment cannot cancel into free service**
  (F6.11a). It is treated as non-paying and the suspension clock keeps running.

### 2.10.8 The division with the payment provider

**Stripe invoices, charges and retries; Ringly decides the amounts and writes
every message except the three Stripe already sends well** (F6.20).

| Function                                    | Owner                                      |
| ------------------------------------------- | ------------------------------------------ |
| Tax calculation                             | **Stripe Tax** — Ringly stores the amounts |
| Invoices, receipts, payment-succeeded email | **Stripe**, carrying Ringly branding       |
| Retrying failed payments                    | **Stripe** — Ringly builds no retry loop   |
| Every failure-path email                    | **Ringly**                                 |
| The $500 cap and the clamp                  | **Ringly** computes, Stripe executes       |
| Refunds                                     | Neither automatically — goodwill, by hand  |
| End-of-dunning behaviour and teardown       | **Ringly**                                 |
| Billing thresholds                          | Neither — deliberately not configured      |
| Self-service portal                         | **Disabled** (§1.9)                        |

**Stripe's dunning is switched off throughout, including during suspension**
(F6.21, F6.11b-ii). Stripe's email can say a card was declined; it cannot say
that service continues for seven days, that nothing has been deleted yet, or
what is destroyed in 48 hours. Those are Ringly's timelines and Ringly's data,
and two differently-worded messages from what looks like one company is the
failure this prevents.

**The subscription's collection is not fully paused during suspension**, because
that would stop the retries — and the retries are the entire recovery path
(F6.11b-i).

**A chargeback is treated exactly as non-payment** (F6.17): same grace, same
suspension, same 60 days. No dispute workflow, no pausing of the deletion clock,
contested or conceded by hand.

**Testing this section**

_Observable_ — what a business is charged and when; what it owes; the billing
history rows and their status; whether the number answers; what arrives in the
inbox; what the operator queue shows; the departure record.

_Internal_ — `billing_status` and every other state name, the settlement
worker, Stripe object ids, subscription configuration, invoice mechanics.

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
- A part payment does not clear the debt or restore service.
- Cancelling continues service, stops billing usage, and settles early when the
  window closes.
- Revoking inside the window makes the free usage billable again.
- A revocation sent inside the window but actioned after it closed is honoured,
  and the early settlement is unwound.
- The $100 is never refunded or prorated on any path.
- A business behind on payment cannot cancel into free service.
- A chargeback follows the non-payment path exactly.
- Policy is data: changing the fee, the cap, the rate or the billable outcome set
  affects the next period and no settled one.

---

## 2.11 Email

The only outbound channel in the product, and it goes to businesses and to the
operator — never to a caller (2.1.2).

### 2.11.1 One registry, and nothing outside it is sent

`src/emails/registry.ts` declares every email Ringly can send (F7.2). **If a
message is not in that table, it is not sent.** The table fixes, per email:
audience, sending identity, subject, transactional status, and how its
idempotency key is built.

**Templates are React Email components versioned in the repository** (F7.3),
reviewed in pull requests like any other code. No hosted template editor and no
copy living in a vendor UI, because a change to what a customer reads deserves
the same scrutiny as a change to what the code does.

**Ringly does not send the success path** (F7.3a). Receipts, invoices and
payment-succeeded notices are Stripe's. The split is by who knows the
consequence, not by who could technically send it.

### 2.11.2 Two different questions, two different keys

**How many times is there a reason to send?** — `reason_key`, unique, in F7.5's
three shapes:

- **Per period** — at most one reason per business per billing period: the
  digest, the upcoming-charge notice, the cap notice.
- **Per incident** — at most one reason per continuous failure, however many
  calls it affects: the calendar outage. An outage must never produce one email
  per lost customer (§2.6.4).
- **Per event** — one reason per discrete occurrence: a deletion warning.

**How many times is that message delivered?** — **at least once**, and possibly
twice (§2.4/010). The two are independent, and conflating them is what produced
the earlier at-most-once design: deduplicating the _reason_ is correct and
cheap, deduplicating the _delivery_ costs the message when a worker dies at the
wrong moment.

**The asymmetry is the whole argument.** A duplicate digest is noise. A duplicate
payment-failure notice is mildly confusing. A deletion warning that never arrives
breaks I4, and nobody finds out until the data is gone.

### 2.11.3 Four sending identities

Billing, service, reports and operator alerts each send from their own address
(F7.11), so a digest nobody opens can never harm the reputation of the address
that tells someone their payment failed.

### 2.11.4 Format

Plain and utilitarian (F7.6) — no images, no web fonts, no columns, no marketing
voice. These are messages about money and service interruptions and should read
like a utility bill, surviving Gmail clipping and Outlook. Fixed structure
(F7.7), at most one call to action. **Every email states what happened, what it
means for the reader, and what happens next if they do nothing** (F7.8).
Absolute dates, never relative, because delivery may be delayed (F7.9).
**Subject lines stay under about 60 characters, state the situation rather than
tease it, and never carry urgency the body does not justify** (F7.10) — these are
messages a business must be able to triage from a notification preview.

### 2.11.5 Transactional mail cannot be unsubscribed

A business cannot opt out of being told its payment failed or its data is about
to be deleted (F7.4). **Only the stats digest is optional.**

### 2.11.6 The dispatcher

Queued rows are sent by the email worker with retry. A provider outage delays
delivery and loses nothing (N7.1); calls continue throughout. **Teardown enqueues
and does not wait** (F9.3d) — see §2.13.4.

### 2.11.7 Operator alerts are a different product

Read on a phone, at an inconvenient moment (F7.12). Each **leads with the
business name and the money at stake**, and says what happens if it is ignored.
No reassurance, no marketing voice.

**The set is fixed** (F7.13): a business hit its cap, carrying cost-to-serve and
margin so an unprofitable tenant is visible immediately; a payment failed; a
calendar is unreachable; an activation is stuck; **an unactivated business is
about to expire** (F8.6a); **a number would not release** (F7.13a); and a
business was deleted — the last carrying lifetime net revenue and the amount left
owing, since deletion is the only moment those totals are final.

**The failed-unbind alert is the one with no other symptom** (F7.13a, §2.5.3).
Every other component believes service has stopped, so the alert is the only
thing standing between an unmetered answering number and someone happening to
look. It carries the same urgency as a cap breach, because it is money leaving.

**An unactivated business is raised before its 10-day clock runs out** (F8.6a),
whether or not it is stuck, and timed to leave room to act rather than fired at
the deadline. Stuck means it _cannot_ activate and Ringly is the blocker;
expiring means it _has not_, for any reason, and is about to be deleted with its
number released. After that the number is gone to the carrier and the account is
a stranger — an outcome worth one email to avoid, given a signup already cost
enrichment, a number, and up to five calls.

**Delivered by email initially**; moving them to Slack is deferred (§1.9). The
format carries the same information either way, so the move is a transport change
rather than a rewrite (F7.14).

**Testing this section**

_Observable_ — what arrives, to whom, from which identity, when, and what it
says; that nothing outside the registry ever arrives.

_Internal_ — the registry file, template components, the queue table, the worker,
the delivery vendor.

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

---

## 2.12 The operator surface

`/ops` — the only screen that reads across tenants, and therefore a walled
garden (F8.1).

**Its own module, its own routes, its own database role, no shared session with
the business app.** No business owner may reach it by any route with any
credential.

**The borrowed view is a render, not an impersonation** (F8.2e). The operator
picks a business by name and sees that business's dashboard as it sees it,
banner-marked, **read-only — every control absent rather than disabled**. There
is no customer-deletion control to hide: the product has none (§2.13.5).

**"Needs attention" is a table of named conditions, not a feeling** (F8.12).
Every row is a business, the condition, how long it has been in it, and what the
operator can do, ordered by how little time is left to act. The conditions are
enumerated in F8.12 and are derived from lifecycle, billing and incident state —
never stored separately, because a second copy of "is this suspended" is a second
thing that can be wrong.

**Four controls, and they are the only ones** (F8.10, F8.13, F9.1b, F9.1c):
pause or resume a deletion clock; reset the test-call allowance **and rebind the
agent, as one action** (either alone leaves the business exactly as stuck); set a
business's cancelled status; and **mark a cancellation revoked**.

**Revoked is deliberately not the same control as cleared** (F6.10a). Clearing is
for a cancellation that should never have been recorded; revoking is a business
changing its mind inside the window, and it makes the usage served during that
window billable again (F6.12a). Collapsing them into one toggle would make a
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
nullable `paused_at` (§2.4/008). The sweeper acts on rows that are **due and not
paused**. There are three clocks and they start from different events (F6c):

- **10 days** for a business that never activated (F9.1), pausable by the
  operator.
- **60 days from the first failed charge** for non-payment and chargebacks
  (F9.3).
- **60 days after service stops** for a business that cancelled — which is itself
  up to 7 days after the request, so up to 67 days from it (F6.12e).

**An unactivated business is bounded twice and the two limits are independent**
(F9.1): five test calls, and ten days. A business can exhaust its calls on day
one and sit unbound for nine more, or never call at all and be deleted on day ten
with its allowance untouched.

### 2.13.2 Unbinding is the one mechanism for stopping service

Used at three moments for three reasons (F1.13a, F9.3, F6.12b). The number stays
rented to the business; it simply stops being answered. Rebinding restores
service on the same number, which is the whole point of holding it.

| Unbind when                            | Rebind when                                        |
| -------------------------------------- | -------------------------------------------------- |
| The 5th test call ends, still unbilled | It activates, or the operator resets the allowance |
| Suspension, day 7 of non-payment       | It pays (§2.10.6)                                  |
| The cancellation window closes         | It returns inside the dormant window               |

**Every one of these is verified by reading provider state back** (§2.5.3). A
failed unbind is the silent one: it leaves a number answering calls Ringly has
stopped metering, and it has no other symptom.

### 2.13.3 A number leaves a business only at deletion

**Never during suspension or dormancy, however idle it looks** (F9.4a). A
suspended business's number is unbound, which makes it look unused; it is not.
The reusable-number query is built from **every business row that holds a
number, whatever its billing status** — filtering that query by status is the
mistake to guard against, and it would hand a suspended salon's number, the one
printed on its van, to a stranger.

**At deletion the number goes back to the provider, not into a Ringly pool**
(F9.4b): there is no purchase price to save, a departed business's customers keep
ringing its number, and handing it back makes the carrier's 45-day quarantine the
carrier's responsibility.

### 2.13.4 Teardown, in order

```
1  capture lifetime net revenue and outstanding balance   ← from Stripe
2  cancel subscription
3  void open invoices
4  detach payment method
5  delete Stripe customer
6  EMAIL the business, and the operator (enqueue, do not await)
7  HAND THE NUMBER BACK to the provider (rental ends)     ← before the row goes
8  delete Ringly's rows AND write departed_businesses     ← ONE transaction
```

**Every step is load-bearing** (F6.19, F9.10):

- **1 before 5** — net revenue comes from balance transactions that deleting the
  customer destroys.
- **2–7 before 8** — deleting Ringly's rows first orphans everything upstream: a
  saved card belonging to nobody, a rented number belonging to nobody.
- **6 before 8** — the contact address lives on the tenant row and
  `departed_businesses` deliberately keeps none (F9.9). Send after the delete and
  there is nobody to send to.
- **6 before 7** — releasing the number is the first irreversible step. Emailing
  first means a send that fails outright halts teardown while the business is
  still whole. **Step 6 enqueues and moves on**: the message is rendered and
  stored at that point (§2.4/010), so it survives step 8 deleting the very row it
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

**Destroyed on exactly one occasion, automatically** (F9.1a): when the business
itself is deleted. When a lifecycle deadline expires, customers, appointments and
calls are ordinary tenant rows caught by step 8 of §2.13.4 — **in the same
transaction that writes the departure record**. Nobody requests it and nobody
performs it.

**There is no per-customer deletion, and the schema says so.** An earlier design
gave the business a self-serve control to erase one caller by phone number; that
requirement is withdrawn (F9.1a). What replaces it is an absence with teeth:

- `appointments.customer_id` is **NOT NULL** with no path that makes it null
  (§2.4/005). There is no `set null`, so there is no orphaned appointment to
  reason about and no half-deleted customer to render.
- There is **no lookup from a phone number to a customer for the purpose of
  erasing them**, which would have been the per-customer view the dashboard
  exists to exclude (F5.11) arriving through a side door.
- The dashboard carries no such control (F5.15), and neither does the operator's
  borrowed view (F8.2e) — **absent, not hidden**, because a control that exists
  but is unreachable is a control someone will eventually make reachable.

**The engineering argument for the absence is that the alternative cannot be made
correct.** A customer's past appointments carry revenue the rollups already
counted and invoices already settled against them (F6.16). Deleting them rewrites
settled figures; keeping them with the name stripped means the erasure was
partial while the product claimed it was complete. There is no third option, so
the product does not offer the operation.

**The cost is recorded rather than argued away** (R23): a business that receives a
consumer erasure request can only action it through Ringly by ending its own
account.

### 2.13.6 Call content

**Ringly stores neither transcripts nor recordings** (F9.6); both stay with the
telephony provider and are fetched on demand. Retention is configured **on every
provisioned agent**, never inherited from a default: recordings 30 days,
transcripts at least 30 and never shorter.

**On the 10-day unactivated path, Ringly issues an explicit provider-side
delete** (F9.5). A test call placed on day 1 is held until day 31, three weeks
after the business and every record of it are gone — the one case where "the
provider's TTL is always shorter" is false.

### 2.13.7 Retention, and why there is no export

**Everything Ringly holds lives as long as the business does** (F9.8). No table
is aged out while a business is active: calls, customers, appointments, usage,
costs and money records are all read by the dashboards and by invoice
reconciliation, and all of those look back over months rather than days. There is
no partial or rolling deletion and no field-level expiry.

**The only thing on a 30-day clock is what Ringly does not store** — transcripts
and recordings, held by the provider (§2.13.6). One consequence is worth stating
because requirements keep wanting to depend on it: **call content older than 30
days is not retrievable by anyone**, Ringly included (F9.7).

Everything Ringly does hold is destroyed when the relationship ends, on the clock
the ending sets (§2.13.1).

**Ringly offers no export, deliberately** (N1.3). Every appointment already lives
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
(N5.1). **Every day, week and month boundary — availability, analytics grouping,
billing periods — is computed in the business's timezone**, not the server's and
not UTC (N5.2).

This is not a formatting concern. A four-hour analytics window, a 30-day billing
period and an opening-hours check are all boundary computations, and getting any
of them in UTC gives a business in Los Angeles figures that are wrong for a third
of every day.

**DST is handled explicitly** (N5.3), including the duplicated hour in autumn and
the skipped hour in spring. A booking at a local time that does not exist is
refused; a local time that happens twice resolves to the first pass and the agent
states the full date and time back.

### 2.14.2 Security and compliance (N6)

- **Provider refresh tokens are encrypted at rest** (N6.1).
- **Card data never touches Ringly infrastructure** (N6.2, F6.3), which is what
  keeps the product outside PCI-DSS scope beyond SAQ-A. Ringly stores provider
  identifiers only.
- **Every inbound webhook verifies the provider's signature before acting**
  (N6.3), using the vendor's own verification helper. Never a hand-rolled
  comparison — for Retell that means the SDK's `verify`, for Stripe
  `constructEvent`.
- **Customer PII is destroyed wholesale when the tenant leaves and at no other
  time** (N6.4, §2.13.5). It needs no human in the loop because there is no
  control to press: it happens in the teardown transaction or not at all.
- **Ringly is a service provider to the business, not a controller of the
  caller's data** (N6.5). Every consumer request arrives through the business,
  and Ringly's duty is to be able to action it, not to adjudicate it.
- **`business_type` offers no healthcare option** (§1.4) and the existing enum
  value is removed. Callers to a clinic disclose PHI and Ringly holds no BAA.

### 2.14.3 Degradation (N7)

| Dependency          | If it is down                                                           |
| ------------------- | ----------------------------------------------------------------------- |
| Telephony           | **Total outage.** Not survivable by design                              |
| Database            | **Total outage.** Not survivable                                        |
| Application host    | **Total outage**                                                        |
| Scheduling provider | **Booking fails audibly** (§2.6.4). Enquiries still work                |
| Payments            | Calls continue. Charges queue and settle later; usage accrues locally   |
| Email               | Calls continue. Mail retries; delivery is delayed, nothing is lost      |
| Enrichment          | New onboarding degrades to manual entry; existing businesses unaffected |

**A failure in a non-critical dependency must never stop an existing business
answering calls** (N7.1). **Every degraded path is logged, surfaced to the
business, and alerted to the operator — silent degradation is a defect** (N7.3).

### 2.14.4 Serving cost and the unauthenticated surface (N4, N9)

**Per-business fixed monthly infrastructure cost must not grow faster than
linearly with tenants** (N4.1). The three rules that hold it: configuration on
the call path is cached rather than re-read (N4.2, §2.6.6); dashboards are served
from pre-aggregated data (N4.3, §2.9.2); every paid third-party call is
attributable per business (N4.4).

**Onboarding enrichment is a paid endpoint reachable without a login** (N9.1) —
Places, a website crawl and a model call. It carries a simple per-IP limit and a
daily spend ceiling, above which it **degrades to manual entry rather than
continuing to spend**. Both are configuration.

**Sized for the traffic actually expected, which is low.** This is a cost
guardrail, not an anti-abuse system, and **visibility is doing most of the work**
(N9.2): the spend is attributable before a business exists, so a runaway appears
in the operator's cost figures rather than as unexplained margin loss.

**Nothing chargeable beyond enrichment happens before a Google sign-in** (N9.3).
That is the real bound: a bot that gets through the limiter costs one enrichment
call, never a phone number.

### 2.14.5 Durability of money records (N10)

**The strictest requirement in the document** (2.1.3). The money tables are
`billing_events`, `usage_records`, `billing_periods`, `pricing_policy` and
`departed_businesses` (N10.1) — named so the protections apply to a definite
list.

- **Two copies**: point-in-time recovery on the primary database, and automated
  backups replicated to a second region, retained ≥ 90 days (N10.2).
- **RPO ≤ 1 hour, RTO ≤ 4 hours** (N10.3). An hour is below any billing interval
  in this design, so at most an hour of usage records — never a settled charge —
  is at risk.
- **Nothing is hard-deleted or updated in place once settled** (N10.4).
  Corrections are new rows.
- **Restores are exercised on a schedule and the result recorded** (N10.5). A
  backup never restored is a belief.
- **Deleting a business is not an exception** (N10.6): the departure record is
  written by the transaction that removes the tenant and outlives it.
- **Stripe is a second copy of the payments, though not of the reasoning**
  (N10.7). It does not hold which period a payment settled, under which policy
  version, against how many seconds, clamped by how much.

**Deferred deliberately** (§1.9): a third copy outside the provider account. Both
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

For each requirement, in the phase that owns it:

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
against: none of §2.4's tables appears in a single test body, so none of them is
pinned by a test.

**The fakes are named for the capability, not the supplier** — `calendar`, not
`google`; `telephony`, not `retell`. §2.7 already treats the scheduling provider
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
| `pending.ts`     | `notImplemented()`, naming the requirement and the phase                                       |

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
  simulated. Only a human hears the agent (A1).
- **That the real vendors fail the way the fakes do.** A simulated calendar
  outage proves Ringly's reaction, not Google's behaviour.
- **That the classifier labels a real transcript correctly.** That is a model
  evaluation with its own dataset, not a scenario.
- **Scale.** N2.1's 10,000 × 10,000 is a load exercise (A2), not an assertion.
- **That a restore works.** N10.5 is a drill (A3).
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
   must still be able to **ask** for something repeating, so that F2.2a's
   first-instance-only behaviour can be asserted — the request survives, the
   series does not.
3. **`CallAnalytics` follows the new dashboard**: `callsThatBooked` becomes
   `appointmentsBooked`, and the chart projection takes a grouping and a filter
   rather than exposing two fixed views (F5.4b).
4. **Per-customer deletion is removed**: `owner.deletesCustomer`, and
   `AppointmentView.customerName`'s `"__erased__"` value, which modelled a state
   the product no longer has (F9.1a). `AppointmentView.customer` stops being
   nullable, because there are no anonymous bookings (F2.12) — the harness had
   assumed both, and neither was ever a requirement.
5. **Phase labels follow §2.16.**

The scenario manifest and `CATALOGUE_SIZE` are regenerated with the catalogue
(§2.19), not before.

---

## 2.16 Delivery plan

Ordered by dependency, not by layer. Each phase is deliverable and leaves `main`
deployable; anything spanning more than one PR lives behind a feature flag.

| Phase                           | Delivers                                                                  | Needs | Migration |
| ------------------------------- | ------------------------------------------------------------------------- | ----- | --------- |
| **0 — Harness**                 | §2.15 corrections; fakes; time control; the catalogue as `test.todo`      | —     | —         |
| **1 — Foundations**             | Tenancy, isolation, call path, booking, fail-closed, scheduling interface | 0     | 005, 006  |
| **2 — Email plumbing**          | Registry, templates, idempotency, four identities, dispatcher             | 1     | 010       |
| **3 — Onboarding + activation** | Intake, enrichment, consent, checklist, Activate, bind read-back          | 1, 2  | —         |
| **4 — Billing**                 | Policy, periods, settlement, cap, grace, Stripe division                  | 3     | 007       |
| **5 — Lifecycle**               | Deadlines, sweeper, unbind/rebind, suspension, teardown, PII deletion     | 4     | 008       |
| **6 — Catalogue + hours**       | Editing, versioning, propagation                                          | 1     | —         |
| **7 — Analytics**               | Classification, rollup, cost records                                      | 1, 4  | 009       |
| **8 — Business dashboard**      | Tiles, the chart, trends, billing history, status, controls               | 6, 7  | —         |
| **9 — Operator dashboard**      | Money table, needs-attention queue, borrowed view, controls               | 5, 7  | 011       |
| **10 — Hardening**              | DST, load exercise (A2), restore drill (A3), manual vendor QA (A1)        | all   | —         |

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
new, because N7 fixes the dependency list. Re-verify before Phase 4 commits to
Stripe's configuration surface._

- **Stripe** — `SetupIntent` stores a card off-session; usage-based billing via
  Meters; billing thresholds exist and are deliberately unused; dunning,
  receipts, proration and the customer portal are each independently
  configurable, which is what makes §2.10.8 possible. Disputes: **$15 fee,
  non-refundable in the US**, 7–21 days to submit evidence, 2–3 months to
  resolve.
- **Retell** — ~600ms end-to-end budget; `speak_during_execution` and
  configurable backchannelling cover tool latency (F2.6); retention is
  **per-agent, 1 day to 2 years**; recording URLs are **signed and expire**, so
  they must be fetched at view time; SOC 2, GDPR and HIPAA-capable but **PHI
  requires a BAA**. Cost $0.13–0.31/min all-in.
- **Google Calendar** — `calendar.events` is a **sensitive** scope requiring
  verification; refresh tokens are revoked after 7 days while the app is in
  _Testing_; granular consent means calendar can be declined independently of
  sign-in (F1.7a); `events.list` exposes event ids where `freebusy` does not,
  which is why §2.7 uses it.

---

## 2.18 Risks and open questions

**Open questions carried from the PRD**

- **Q1 — the per-connected-minute rate.** Held as configuration (F6.8), so
  billing can be built and tested with a placeholder but **cannot be switched on
  for real customers until it is set**. Blocks nothing before Phase 4 ships.
- **Q3 — Ringly's contact email address** (F9.2). The single channel for
  cancellation, deletion and reactivation. **Blocks Phase 5.**
- **Q6 — where the application is hosted** (N8). Does not block a phase; 2.1.6
  keeps the design portable while it is open. Must be settled before the first
  paying customer.

**The risk register.** Numbers are stable across revisions and are cited from
the PRD and from commit messages, so a retired risk keeps its number rather than
freeing it.

- **R1 — The shipped code fails open; the product requires fail-closed.** A
  specification change, not only a bug fix (F2.7). Phase 1.
- **R2 — LAUNCH BLOCKER: Google OAuth verification not submitted.** Refresh
  tokens are revoked after 7 days while the app is in _Testing_; with a mandatory
  calendar and fail-closed booking, every business stops taking bookings a week
  after signup. Weeks of review, independent of every engineering phase — start
  it in Phase 3.
- **R3 — Cross-tenant leakage via the service role.** Mitigated by §2.3.1; must
  stay test-enforced (N1.2).
- **R4 — 005 cannot apply over existing overlapping appointments.** Needs a data
  audit before the migration runs.
- **R5 — Provider capability mismatch.** Declared, not assumed (§2.7).
- **R6 — Live busy-checks cost real money per turn.** Accepted: a stale conflict
  check is worse (2.1.1).
- **R7 — Retired.** The number is left unused rather than reassigned, so
  references in earlier documents and commits still resolve.
- **R8 — Unbooked calls are pure cost.** At $0.13–0.31/min, $100 covers roughly
  320–770 minutes of unbillable calling. F8 exists partly to measure it, and the
  $500 cap is unbounded within a period (F6.9b) — the largest deliberate giveaway
  in the model, absorbed on purpose and surfaced per business (F8.2a).
- **R9 — Switching calendar provider is out of scope.** Not designed, not built.
- **R10 — Retention depends on a provider setting.** Per-agent, 1 day to 2 years;
  must be set explicitly at provisioning, never inherited (F9.6).
- **R11 — PHI.** Resolved by excluding healthcare (§1.4, §2.14.2).
- **R12 — Caller authentication is weaker than caller ID** (§2.6.5). Deliberate;
  revisit if abused.
- **R13 — Appointments edited directly in the owner's calendar drift.** Conflict
  checks stay correct because busy is read live; Ringly's stored time may not be.
  Sync-back is not built.
- **R14 — Hours change; timezone changes are the dangerous half.** Editing hours
  is a first-class control (F3.5); **timezone deliberately is not** (F3.6),
  because it re-interprets every stored instant and every period boundary. The
  residual risk is an appointment left outside newly-narrowed hours; accepted,
  because moving it would break a promise already made to a caller Ringly cannot
  contact (§1.4).
- **R15 — Long-running disputes outlive the business.** A chargeback resolving
  after day 60 lands on a deleted account. Accepted, no special handling (F6.17).
- **R16 — The host is not chosen** (Q6, N8). Low while 2.1.6 holds, and rising
  the longer it stays open: the cost of moving is proportional to how much has
  been built on top. Decide before the first paying customer.
- **R17 — The enrichment endpoint is unauthenticated and spends money** (N9).
  **Low, and deliberately treated as low** — onboarding volume is expected to be
  a handful of businesses a day, so the mitigation is a per-IP limit, a daily
  ceiling and caching, not an abuse system. Residual: a determined abuser can
  burn the daily ceiling and take new signups down to manual entry for the rest
  of that day. Accepted over building machinery for traffic that does not exist;
  the cost figures (N9.2) are what would change the assessment.
- **R18 — The 10-day path deletes a business while the provider still holds its
  calls** (F9.5). Needs an explicit provider-side delete on that path only; the
  general "the TTL expires first" argument does not cover it (§2.13.6).
- **R19 — No caller has any way to reach Ringly** (§1.4, F9.1a). Accepted: Ringly
  is a service provider, not the caller's counterparty (N6.5). **No longer
  narrowed** — the self-serve per-customer deletion that previously softened this
  is withdrawn (R23).
- **R20 — The agent has no fallback** (F2.10). Anything it cannot handle is a
  dropped call and a lost customer, with no transfer and no message taken. The
  `dropped` metric (F5.4) exists to show how often; revisit when it is measured
  rather than guessed.
- **R21 — Suspension has to stop one payment-provider behaviour and preserve
  another, and the two are usually configured together.** New invoices must stop
  (F6.11b) while the open invoice stays retried and chased (F6.11b-i). Wrong in
  one direction and a business is billed for a phone nobody answers; wrong in the
  other and a recoverable business sits un-chased until it is deleted. **Both
  failures are silent** — each system behaves correctly on its own terms.
  Mitigation: §2.10.4 and §2.10.8 are the acceptance criteria, the mechanism is
  confirmed against the live API before Phase 4, and the test covers the pair —
  suspend, cross a would-be period boundary, restore, then assert that no new
  invoice was raised and that the original was retried throughout.
- **R22 — Every backup of the money records lives in one provider account**
  (N10.2). A credential compromise or an account closure takes point-in-time
  recovery and the cross-region copies together. **Accepted for v3 and deferred**
  (§1.9): the failure is rare, and Stripe independently holds the payments
  (N10.7) — though not which period they settled or under which terms, which is
  precisely the part that would be lost.
- **R23 — A business cannot action a consumer erasure request through Ringly.**
  Per-customer deletion is withdrawn (F9.1a), so the only way to remove one
  caller's data is to delete the whole account. Ringly is the processor and the
  business is the controller (N6.5), so the obligation sits with the business —
  but Ringly's ability to assist with it is now all-or-nothing. **Accepted
  deliberately**, on the grounds that a partial deletion either rewrites settled
  figures (F6.16) or claims a completeness it does not have, and that a rarely
  used deletion path is the one most likely to be wrong when it is finally
  exercised. Revisit if a business actually receives such a request, or if the
  processor obligation is tested.
- **R24 — A model call decides what is billable.** The outcome classifier drives
  usage billing (F6.6), and a model is not deterministic. Mitigated by failing in
  the business's favour: an unclassified call is counted, excluded from outcomes,
  and **not billed** (§2.9.1). The residual risk is under-billing, which is the
  right direction to be wrong in.
- **R25 — A silent unbind failure leaks revenue with no other symptom.** Every
  other component believes service has stopped, so nothing else in the system
  would ever notice (F1.12a-ii). Mitigated by reading provider state back on
  every bind and unbind, under its own operator alert (§2.5.3, F7.13a).
- **R26 — Test-mode payment clocks make the behaviour suite slow.** Advancing one
  is a server-side job polled to completion. Mitigated by giving the suite its
  own runner and timeout and keeping it out of the fast unit suite (§2.15).

---

## 2.19 Scenario catalogue

**To be derived, next.** The previous catalogue is withdrawn: it was numbered
against the pre-renumber requirements and contained a group for recurring
appointments, which the product no longer has.

The replacement is derived from the **Behaviours owed to the catalogue** lists in
§2.2–§2.14, which is why those lists exist. Each scenario names the requirement
it holds, belongs to exactly one group, and is written as something a person does
and what then becomes true. Until it lands, `tests/behaviour/harness/scenarios.ts`
and its accounting test still describe the old catalogue and are stale.

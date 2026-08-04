# Behaviour tests

> **STALE as of 2026-08-01.** The design was rewritten from the requirements and
> the 269-scenario catalogue this directory implements was withdrawn: it was
> numbered against the pre-renumber requirements and included a group for
> recurring appointments, which the product no longer has. The harness
> architecture below still stands — `docs/Ringly_EDD_v3.md` §2.15 describes it —
> but the scenario manifest, the requirement citations throughout `harness/`, and
> the counts on this page all describe the old catalogue. The replacement is the
> next piece of work; §2.15.7 lists what changes.

Scenarios covering every requirement in `docs/Ringly_PRD_v3.md`. The strategy is
`docs/Ringly_EDD_v3.md` **§2.15**; the catalogue is **§2.19**.

## Why this directory is not called `e2e`

It would be a lie. These drive Ringly with **simulated telephony payloads** and
**faked calendar, telephony, email and enrichment**. They are integration tests
of Ringly with fake edges — thorough, but not end-to-end. `e2e/` stays free for
the real thing.

## The one rule

**A test body may not name anything the implementation could rename.** No table
names, no column names, no routes, no selectors, no SQL, no vendor identifiers.
Those live in `harness/` and nowhere else.

Test bodies use actors and projections only:

```
await caller(aCustomerNumber()).calls(biz).andAsksToBook({ service: 'Cut', at: 'Tue 2pm' })
await system.advanceTo(day(45))
expect(await billingHistory(biz)).toMatchObject([{ status: 'in_progress' }])
```

If you find yourself wanting a column name in a spec file, the projection is
missing — add it to the harness.

**The fakes are named for the capability, not the supplier** — `calendar`, not
`google`; `telephony`, not `retell`. The supplier is exactly the sort of thing
that gets renamed, and §2.6 already treats the scheduling provider as abstract.

### Refusals must name `Refused`

Roughly seventeen scenarios assert the product _declines_ something. Write them
as `rejects.toThrow(Refused)`, never a bare `rejects.toThrow()` — every adapter
member currently rejects with `NotImplementedError`, so the bare form passes
against an implementation that does not exist. That defect was found by mutation
testing and the two error types are deliberately unrelated so it cannot recur.

## ⚠️ The adapter can hide real bugs

**This is the failure mode to watch for, and it is silent.**

A projection is only as honest as its implementation. If `billingHistory()`
reads the database while the real dashboard calls an API, **every test passes
while the API is broken** — and nothing in the suite will tell you. The same
applies to any projection that takes a shortcut the product does not take.

Three rules keep it honest, and each is stated in full beside the code it
constrains rather than here, so there is one copy to keep true:

1. **Projections read. They never compute.** — `harness/projections.ts`
2. **A projection goes through the same path the product does**, as soon as that
   path exists. — `harness/projections.ts`
3. **A fake must be able to fail.** — `harness/fakes.ts`

**§2.20.3 lists what this suite cannot prove at all** — including eight
scenarios that pass on something narrower than the requirement they hold. Read
it before treating green as done.

## Layout

```
harness/
  index.ts        the only import a spec may make — barrel
  types.ts        the vocabulary: Money, Day/Instant, outcomes, read models
  pending.ts      notImplemented() / pending(), naming the requirement held
  world.ts        aBusiness() builder, per-test lifecycle
  actors.ts       writes: caller · owner · operator · system · stripe
  projections.ts  reads, including reads of the fakes — see below
  fakes.ts        arranging vendors: google · retell · resend · classifier · places
setup.ts          global afterEach teardown
harness.spec.ts   the harness testing itself
*.spec.ts         18 files to come, one per §2.21 group
```

The split is by **direction, not by ownership**: everything that reads is a
projection even when a fake is what answers it. Otherwise "does the number
answer?" and "which numbers are held?" land in different files and nobody can
say where a new read belongs.

## Running them

```sh
npm run test:behaviour
```

Separate from `npm test` on purpose: the unit suite stays fast and hermetic,
while these need a database, Stripe test mode, and the fakes standing up.

## Status

**None of the 269 scenarios is written yet.** `scenarios.spec.ts` turns the
whole of §2.21 into `test.todo`, so the runner prints `269 todo` and the gap
between what is claimed and what is covered is on its own summary line. A
scenario leaves that list by being written; an accounting test fails if one is
merely deleted.

The interface covers the call path, onboarding, billing and lifecycle well, and
the operator-dashboard and catalogue read-backs thinly — those projections are
sketched and will fill out as the surfaces they read do.
Every actor, projection and fake rejects with `NotImplementedError` naming the
requirement it holds. **It names no delivery phase**: build order is downstream
of the design (EDD §2.1.5a) and is expected to be re-cut, so a phase label here
would make the test scaffolding encode a plan it has no stake in and need
re-mapping every time that plan moved.

`harness.spec.ts` guards the scaffold **by enumeration, not by sampling**. An
earlier version tested two projections out of seventeen, and mutation testing
showed the other fifteen could be deleted with the suite still green. It now
pins the exact export set, every stub object's exact members, and asserts every
member rejects rather than throwing synchronously.

The vocabulary derives from Part 1, not from code, which is why it could be
written before the implementation exists — and why it should not need to change
when the implementation arrives.

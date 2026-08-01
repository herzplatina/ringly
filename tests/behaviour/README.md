# Behaviour tests

269 scenarios covering every requirement in `docs/Ringly_PRD_EDD_v3.md` Part 1.
The catalogue is EDD **§2.21**; the strategy behind them is **§2.20**.

## Why this directory is not called `e2e`

It would be a lie. These drive Ringly with **simulated Retell payloads** and
**faked Google, Retell and Resend**. They are integration tests of Ringly with
fake edges — thorough, but not end-to-end. `e2e/` stays free for the real thing.

## The one rule

**A test body may not name anything the implementation could rename.** No table
names, no column names, no routes, no selectors, no SQL, no vendor identifiers.
Those live in `harness/` and nowhere else.

Test bodies use actors and projections only:

```
await caller('+1555…').calls(biz).andAsksToBook({ service: 'Cut', at: 'Tue 2pm' })
await system.advanceTo(day(45))
expect(await billingHistory(biz)).toMatchObject([{ status: 'in progress' }])
```

If you find yourself wanting a column name in a spec file, the projection is
missing — add it to the harness.

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
  pending.ts      notImplemented() / pending(), naming requirement + phase
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

The **interface is complete**; the implementations are not. Every actor,
projection and fake throws `NotImplementedError` naming the requirement it holds
and the phase that will make it real (EDD §2.16). Scenarios for unbuilt phases
are `test.todo`, so the suite is always green-or-todo rather than a wall of red
nobody reads.

The vocabulary derives from Part 1, not from code, which is why it could be
written before the implementation exists — and why it should not need to change
when the implementation arrives.

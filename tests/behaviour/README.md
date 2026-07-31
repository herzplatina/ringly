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

Three rules that keep it honest:

1. **Projections read. They never compute.** The moment a projection calculates
   a clamped total, a period boundary, or an outcome, it is a second
   implementation of the product — one that can be wrong in exactly the same way
   as the first, so the test agrees with the bug. Look things up; shape the
   result; stop.
2. **A projection goes through the same path the product does, as soon as that
   path exists.** Reading the database is a temporary measure for surfaces not
   yet built, not a design choice. When the API lands, the projection moves to
   it — and no test body changes, which is the whole point.
3. **A fake must be able to fail.** A fake that only ever returns success proves
   nothing about the fail-closed requirements (F2.7), which are among the most
   important behaviours here.

**§2.20.3 lists what this suite cannot prove at all** — including eight
scenarios that pass on something narrower than the requirement they hold. Read
it before treating green as done.

## Layout

```
harness/
  index.ts        the only import a spec may make
  world.ts        per-test tenant setup and teardown
  clock.ts        time control
  actors/         caller · owner · operator · system
  projections/    serviceStatus · billingHistory · inbox · …
  fakes/          google · retell · resend · outcome classifier
  stripe.ts       real test-mode client, with test clocks
*.spec.ts         18 files, one per §2.21 group
```

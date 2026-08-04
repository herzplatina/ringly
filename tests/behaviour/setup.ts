import { resetWorld } from "./harness";

/**
 * Runs after every behaviour test (`setupFilesAfterEnv`).
 *
 * Isolation is structural, not something each spec remembers: a test that
 * leaked a payment-provider test clock or a tenant's rows into the next one
 * would fail a file that did nothing wrong, which is the most expensive kind of
 * flake to chase.
 *
 * There is no try/catch here on purpose. An earlier version swallowed
 * `NotImplementedError` so the scaffold could stay green, and mutation testing
 * showed the swallow could be widened to hide *any* teardown failure with no
 * test noticing. `resetWorld` is a no-op while unimplemented instead, so a rejection
 * from here always means a real leak.
 */
afterEach(async () => {
  await resetWorld();
});

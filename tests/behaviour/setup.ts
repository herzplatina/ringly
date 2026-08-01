import { NotImplementedError, resetWorld } from "./harness";

/**
 * Runs before every behaviour spec file (`setupFilesAfterEnv`).
 *
 * Isolation is structural, not something each spec remembers: a test that
 * leaked a Stripe test clock or a tenant's rows into the next one would fail a
 * file that did nothing wrong, which is the most expensive kind of flake to
 * chase.
 */
afterEach(async () => {
  try {
    await resetWorld();
  } catch (err) {
    // Until Phase 1 lands there is no world to reset, and the scaffold should
    // be green rather than 269 red teardowns. Narrow on purpose: this swallows
    // "not written yet" and nothing else, and stops swallowing anything the
    // day `resetWorld` gets a body.
    if (!(err instanceof NotImplementedError)) throw err;
  }
});

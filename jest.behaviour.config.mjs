import base from "./jest.base.mjs";

/**
 * Behaviour tests run separately from the unit suite.
 *
 * `npm test` stays fast and hermetic. These need a database, Stripe test mode
 * and the fakes standing up, so they get their own command rather than slowing
 * every unit run down.
 *
 * @type {import('jest').Config}
 */
const behaviourConfig = {
  ...base,
  displayName: "behaviour",
  testMatch: ["**/tests/behaviour/**/*.spec.ts"],
  setupFilesAfterEnv: ["<rootDir>/tests/behaviour/setup.ts"],
  /**
   * Runs once before anything else and refuses a live payment key or a
   * production database. This suite charges cards and deletes tenant rows;
   * "we'll be careful" is not a control.
   */
  globalSetup: "<rootDir>/tests/behaviour/global-setup.ts",
  /**
   * Advancing a Stripe test clock is a server-side job you poll to completion —
   * routinely 5-20s, against a 5s default that every single test would
   * otherwise have to override by hand.
   */
  testTimeout: 120_000,
};

export default behaviourConfig;

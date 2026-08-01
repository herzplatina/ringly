/**
 * Refuses to run the behaviour suite against anything real.
 *
 * This suite creates payment-provider customers, charges cards, and then
 * *deletes* tenant rows. Pointed at a live account or a production database it
 * would do all of that for real. Nothing else in the repo distinguishes the
 * two: the app reads one set of environment variables, and whatever is in the
 * shell is what the harness would pick up.
 *
 * So the credentials are deliberately behind names that exist in no deployed
 * environment. A live key cannot arrive here by accident — only by someone
 * pasting it into a variable with `TEST` in the name, past the assertions
 * below.
 */
export default function globalSetup(): void {
  const key = process.env.STRIPE_TEST_SECRET_KEY;
  if (key && !/^(sk|rk)_test_/.test(key)) {
    throw new Error(
      "STRIPE_TEST_SECRET_KEY is not a test-mode key. The behaviour suite " +
        "charges cards and deletes customers; it must never see a live key.",
    );
  }

  const db = process.env.BEHAVIOUR_DATABASE_URL;
  if (db && /(prod|production)/i.test(db)) {
    throw new Error(
      `BEHAVIOUR_DATABASE_URL looks like production (${db.replace(/:[^:@]*@/, ":***@")}). ` +
        "The behaviour suite truncates tenant data.",
    );
  }
}

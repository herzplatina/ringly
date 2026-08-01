import { UNWRITTEN_SCENARIOS } from "./harness/scenarios";

/**
 * One `test.todo` per scenario in EDD §2.21 that has not been written yet.
 *
 * Without this the behaviour suite reports "66 passed" and nothing else, which
 * reads as a complete suite when in fact none of the 269 product scenarios
 * exist. Jest prints these as `todo`, so the gap between what is claimed and
 * what is covered lands on the runner's own summary line.
 *
 * A scenario leaves this list by being *written*, not by being deleted — which
 * is what the accounting test below enforces.
 */

/** §2.21's own count. Written scenarios plus outstanding ones must equal it. */
const CATALOGUE_SIZE = 269;

describe("EDD §2.21 — the catalogue", () => {
  it("accounts for every scenario, so none can be quietly dropped", () => {
    const numbers = UNWRITTEN_SCENARIOS.map((s) => s.n);
    // Deleting an entry to make the todo list shorter would otherwise look
    // like progress. Until specs exist, the manifest must be the whole
    // catalogue: exactly 1..269, no gaps, no repeats.
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(numbers.length).toBe(CATALOGUE_SIZE);
    expect([...numbers].sort((a, b) => a - b)).toEqual(
      Array.from({ length: CATALOGUE_SIZE }, (_, i) => i + 1),
    );
    expect(new Set(UNWRITTEN_SCENARIOS.map((s) => s.group)).size).toBe(18);
    for (const s of UNWRITTEN_SCENARIOS) {
      expect(s.text.length).toBeGreaterThan(0);
      expect(s.holds.length).toBeGreaterThan(0);
    }
  });
});

describe("EDD §2.21 — not yet written", () => {
  for (const s of UNWRITTEN_SCENARIOS) {
    test.todo(`${s.n} [${s.group}] ${s.text} (holds ${s.holds})`);
  }
});

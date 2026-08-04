/**
 * The two errors a spec is allowed to see, and the reason they must be
 * different types.
 */

/** Thrown by any adapter member whose body has not been written yet. */
export class NotImplementedError extends Error {
  constructor(readonly holds: string) {
    super(`Not implemented — holds ${holds}`);
    this.name = "NotImplementedError";
  }
}

/**
 * The product declined to do something, on purpose.
 *
 * This type exists because of a defect found by mutation-testing the harness:
 * with every adapter member rejecting `NotImplementedError`, a spec written as
 *
 * ```ts
 * await expect(owner(biz).setsBookingHorizon(9999)).rejects.toThrow();
 * ```
 *
 * passes against an implementation that does not exist. Roughly seventeen
 * scenarios in §2.21 are refusals — 16, 21, 33, 43, 44, 47, 56, 57, 59, 63,
 * 84, 86, 177, 179, 264, 265, 267 — so seventeen tests would have certified
 * behaviour nobody had built. A refusal must therefore be a *distinct* type
 * that `NotImplementedError` cannot satisfy, and every refusal scenario must
 * name it: `rejects.toThrow(Refused)`.
 *
 * `reason` is the product's own explanation, in product language. Assert on it
 * when the scenario is about *why* — 43 (slot taken) and 56 (outside opening
 * hours) are different refusals of the same request.
 */
export class Refused extends Error {
  constructor(readonly reason: string) {
    super(`Refused — ${reason}`);
    this.name = "Refused";
  }
}

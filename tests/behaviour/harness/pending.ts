/**
 * Every adapter method is declared up front — the vocabulary derives from the
 * PRD, not from code, so it can be written before the implementation exists.
 * Each one is *implemented* only when its phase arrives (EDD §2.16).
 *
 * Until then it throws `NotImplementedError`, naming the requirement it holds
 * and the phase that will make it real. Specs for unbuilt phases use
 * `test.todo`, so the suite is always green-or-todo and never a wall of red
 * that people learn to ignore.
 */
export class NotImplementedError extends Error {
  constructor(
    readonly holds: string,
    readonly phase: string,
  ) {
    super(`Not implemented — holds ${holds}, lands in ${phase} (EDD §2.16)`);
    this.name = "NotImplementedError";
  }
}

/**
 * Synchronous contexts only — a method whose declared return type is not a
 * promise.
 *
 * @param holds Requirement ids this will satisfy, e.g. `"F1.12a"`.
 * @param phase Delivery phase from EDD §2.16, e.g. `"Phase 4 — Billing"`.
 */
export function notImplemented(holds: string, phase: string): never {
  throw new NotImplementedError(holds, phase);
}

/**
 * Asynchronous contexts — a method declared to return a promise.
 *
 * **Use this and not `notImplemented` for anything promise-returning.** A
 * declared-async function that throws synchronously is a trap: `.catch()` never
 * sees it, and one such call inside `Promise.all([...])` takes down the whole
 * expression before any of its siblings start. The two helpers exist separately
 * so the call site has to say which contract it is honouring.
 */
export function pending(holds: string, phase: string): Promise<never> {
  return Promise.reject(new NotImplementedError(holds, phase));
}

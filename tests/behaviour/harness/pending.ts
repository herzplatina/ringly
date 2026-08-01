import { NotImplementedError } from "./errors";

/**
 * Every adapter method is declared up front — the vocabulary derives from the
 * PRD, not from code, so it can be written before the implementation exists.
 * Each one is *implemented* only when its phase arrives (EDD §2.16).
 *
 * Until then it rejects with `NotImplementedError`, naming the requirement it
 * holds and the phase that will make it real, so an unimplemented path says
 * where to go rather than failing blankly.
 */

/**
 * Synchronous contexts only — a method whose declared return type is not a
 * promise.
 *
 * @param holds Requirement ids this will satisfy, e.g. `"F1.12a"`.
 * @param phase The phase in which *this adapter member* becomes implementable
 *              — the one that first ships a surface it can drive or read.
 *              Usually, but not always, the phase delivering the requirement it
 *              holds: `connectedCalendar` reads the calendar fake and works
 *              from Phase 1 even though F4 lands at Phase 7. Must be one of the
 *              names in EDD §2.16; `harness.spec.ts` checks the whole set.
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

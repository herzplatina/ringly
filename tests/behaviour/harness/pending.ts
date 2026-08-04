import { NotImplementedError } from "./errors";

/**
 * Every adapter member is declared up front — the vocabulary derives from the
 * PRD, not from code, so it can be written before the implementation exists.
 *
 * Until a member is written it rejects with `NotImplementedError` naming the
 * requirement it holds, so an unimplemented path says what it is for rather
 * than failing blankly.
 *
 * **It deliberately does not name a delivery phase.** Build order is downstream
 * of the design (EDD §2.1.5a) and is expected to be re-cut; a phase label here
 * would make the test scaffolding encode a plan it has no stake in, and would
 * need re-mapping every time that plan moved. What a member holds is a fact
 * about the requirement and does not change.
 */

/**
 * Synchronous contexts only — a member whose declared return type is not a
 * promise.
 *
 * @param holds Requirement ids this will satisfy, e.g. `"F1.12a"`.
 */
export function notImplemented(holds: string): never {
  throw new NotImplementedError(holds);
}

/**
 * Asynchronous contexts — a member declared to return a promise.
 *
 * **Use this and not `notImplemented` for anything promise-returning.** A
 * declared-async function that throws synchronously is a trap: `.catch()` never
 * sees it, and one such call inside `Promise.all([...])` takes down the whole
 * expression before any of its siblings start. The two helpers exist separately
 * so the call site has to say which contract it is honouring.
 */
export function pending(holds: string): Promise<never> {
  return Promise.reject(new NotImplementedError(holds));
}

/**
 * The only module a spec file may import.
 *
 * If something a test needs is not exported here, the answer is to add a
 * projection or an actor method — never to reach past this barrel into the
 * database, an HTTP route, or a vendor SDK. That rule is the whole reason the
 * 269 test bodies in EDD §2.21 can outlive the implementation.
 *
 * Re-exported wholesale rather than name by name. Nine more phases of methods
 * are coming, and a hand-curated list means every one of them is two edits in
 * two files — with the failure mode landing on a spec ("has no exported
 * member") rather than where the method was added. Each module already curates
 * itself by choosing what to export.
 *
 * Strategy: EDD §2.20. What this suite cannot prove: §2.20.3.
 */

export * from "./types";
export * from "./actors";
export * from "./projections";
export * from "./fakes";
export * from "./world";

/**
 * Deliberately *not* `export *`: `notImplemented` and `pending` are the
 * harness's own plumbing and a spec has no business calling either. Only the
 * error type is public, so a spec can assert on a still-unimplemented path.
 */
export { NotImplementedError } from "./pending";

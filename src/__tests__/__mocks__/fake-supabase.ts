/**
 * A small in-memory stand-in for the Supabase query builder, enough to run the
 * Retell function route end-to-end in unit tests. It applies the filter
 * operators the route actually uses, so overlap/exclusion logic is genuinely
 * exercised rather than stubbed out.
 */

export type Row = Record<string, unknown>;

/** Compare as instants when both sides look like timestamps, else as strings. */
function compare(a: unknown, b: unknown): number {
  const aTime = Date.parse(String(a));
  const bTime = Date.parse(String(b));
  if (!Number.isNaN(aTime) && !Number.isNaN(bTime)) return aTime - bTime;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

export type FakeDb = {
  client: unknown;
  tables: Record<string, Row[]>;
  inserts: Array<{ table: string; rows: Row[] }>;
  updates: Array<{ table: string; values: Row }>;
  /** Every filter applied, as "table.op(column,value)" — for asserting scoping. */
  filterLog: string[];
};

export function createFakeDb(tables: Record<string, Row[]> = {}): FakeDb {
  const state: FakeDb = {
    client: null,
    tables: JSON.parse(JSON.stringify(tables)),
    inserts: [],
    updates: [],
    filterLog: [],
  };

  let idCounter = 0;
  const nextId = () => `generated-${++idCounter}`;

  function from(table: string) {
    const predicates: Array<(row: Row) => boolean> = [];
    state.tables[table] ??= [];

    const log = (op: string, col: string, val: unknown) =>
      state.filterLog.push(`${table}.${op}(${col},${JSON.stringify(val)})`);

    const rows = () =>
      state.tables[table].filter((r) => predicates.every((p) => p(r)));

    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,

      eq: (col: string, val: unknown) => {
        log("eq", col, val);
        predicates.push((r) => r[col] === val);
        return builder;
      },
      neq: (col: string, val: unknown) => {
        log("neq", col, val);
        predicates.push((r) => r[col] !== val);
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        log("in", col, vals);
        predicates.push((r) => vals.includes(r[col]));
        return builder;
      },
      lt: (col: string, val: unknown) => {
        log("lt", col, val);
        predicates.push((r) => compare(r[col], val) < 0);
        return builder;
      },
      lte: (col: string, val: unknown) => {
        log("lte", col, val);
        predicates.push((r) => compare(r[col], val) <= 0);
        return builder;
      },
      gt: (col: string, val: unknown) => {
        log("gt", col, val);
        predicates.push((r) => compare(r[col], val) > 0);
        return builder;
      },
      gte: (col: string, val: unknown) => {
        log("gte", col, val);
        predicates.push((r) => compare(r[col], val) >= 0);
        return builder;
      },

      single: async () => ({ data: rows()[0] ?? null, error: null }),

      insert: (payload: Row | Row[]) => {
        const list = (Array.isArray(payload) ? payload : [payload]).map(
          (r) => ({
            id: nextId(),
            ...r,
          }),
        );
        state.inserts.push({ table, rows: list });
        state.tables[table].push(...list);
        return makeResult(list);
      },

      upsert: (payload: Row) => {
        const existing = state.tables[table].find(
          (r) =>
            r.business_id === payload.business_id &&
            r.phone_number === payload.phone_number,
        );
        const row = existing
          ? Object.assign(existing, payload)
          : (() => {
              const created = { id: nextId(), ...payload };
              state.tables[table].push(created);
              return created;
            })();
        state.inserts.push({ table, rows: [row] });
        return makeResult([row]);
      },

      update: (values: Row) => {
        state.updates.push({ table, values });
        const applied = {
          then: (resolve: (v: unknown) => unknown) => {
            for (const row of rows()) Object.assign(row, values);
            return Promise.resolve(resolve({ data: null, error: null }));
          },
          eq: (col: string, val: unknown) => {
            predicates.push((r) => r[col] === val);
            return applied;
          },
        };
        return applied;
      },

      // Awaiting the builder itself runs the query (list form).
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(resolve({ data: rows(), error: null })),
    };

    return builder;
  }

  /** Result of insert/upsert: awaitable, and chainable into .select().single(). */
  function makeResult(list: Row[]) {
    const result = {
      select: () => result,
      single: async () => ({ data: list[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(resolve({ data: list, error: null })),
    };
    return result;
  }

  state.client = { from };
  return state;
}

/**
 * Shared between the unit suite (`jest.config.mjs`) and the behaviour suite
 * (`jest.behaviour.config.mjs`). Only the suite-specific keys differ, and two
 * copies of the transform and module mapping would drift the first time either
 * is touched.
 *
 * The transform is **transpile-only**, but only implicitly: ts-jest skips type
 * checking because the root `tsconfig.json` sets `isolatedModules: true`. If
 * that is ever removed, this suite silently starts type-checking the whole
 * Next.js graph in every worker on every run. `npm run typecheck` is what
 * actually checks types.
 *
 * @type {import('jest').Config}
 */
const base = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "commonjs" } }],
  },
  moduleNameMapper: {
    "^server-only$": "<rootDir>/src/__tests__/__mocks__/server-only.js",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};

export default base;

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { module: "commonjs" } }],
  },
  testMatch: ["**/src/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^server-only$": "<rootDir>/src/__tests__/__mocks__/server-only.js",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};

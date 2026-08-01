import base from "./jest.base.mjs";

/** @type {import('jest').Config} */
const unitConfig = {
  ...base,
  displayName: "unit",
  testMatch: ["**/src/__tests__/**/*.test.ts"],
};

export default unitConfig;

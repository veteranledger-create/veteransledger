/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  // js-with-ts rather than plain ts-jest: the shared frontend modules are
  // ESM .js and are imported directly by their tests, so they have to be
  // compiled too rather than duplicated as fixtures.
  preset: "ts-jest/presets/js-with-ts",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/frontend"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    // .js as well as .ts: the shared frontend modules are ESM and are
    // imported directly by their tests rather than duplicated as fixtures.
    "^.+\\.[tj]sx?$": ["ts-jest", { tsconfig: "./tsconfig.test.json" }],
  },
  moduleNameMapper: {
    "^@config/(.*)$":     "<rootDir>/src/config/$1",
    "^@database/(.*)$":   "<rootDir>/src/database/$1",
    "^@middleware/(.*)$": "<rootDir>/src/middleware/$1",
    "^@modules/(.*)$":    "<rootDir>/src/modules/$1",
    "^@utilities/(.*)$":  "<rootDir>/src/utilities/$1",
    "^@validators/(.*)$": "<rootDir>/src/validators/$1",
  },
};

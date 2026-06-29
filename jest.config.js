/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "./tsconfig.test.json" }],
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

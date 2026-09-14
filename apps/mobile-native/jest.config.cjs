module.exports = {
  preset: "jest-expo",
  clearMocks: true,
  restoreMocks: true,
  moduleDirectories: ["node_modules", "<rootDir>/node_modules"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testMatch: ["<rootDir>/tests/**/*.test.ts?(x)"],
};

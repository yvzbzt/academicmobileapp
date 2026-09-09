import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      "tests/e2e/**",
      "apps/mobile-native/tests/**",
      "artifacts/**",
      ".release-evidence/**",
      ".tmp-test-run/**"
    ]
  }
});

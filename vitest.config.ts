import { defineConfig } from 'vitest/config';

/* Minimal node-environment config scoped to the pure-TS core library tests.
 * The engine/i18n modules have no RN/Expo deps, so the default node
 * environment is sufficient. Globals are left disabled — tests import from
 * `vitest` explicitly. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/__tests__/**/*.{test,spec}.ts'],
    watch: false,
  },
});

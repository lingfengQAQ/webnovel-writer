import { defineConfig } from 'vitest/config';
import { mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { diagnosticForks } from './scripts/release/ci-pool.mjs';

// Windows runners expose an 8.3 TEMP alias; fixtures and fault-injection mocks
// must use the same canonical path that the filesystem returns to production.
const testTemp = realpathSync.native(tmpdir());
const diagnostics = fileURLToPath(new URL('./.tmp/ci', import.meta.url));
if (process.env['CI']) mkdirSync(diagnostics, { recursive: true });

export default defineConfig({
  resolve: {
    // The shell-seeded primitives package only loads through the DSH shell build; unit tests use a semantic stand-in.
    alias: { '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./packages/bundle/tests/support/ui-primitives.tsx', import.meta.url)) },
  },
  test: {
    include: ['packages/*/tests/**/*.{spec,test}.ts', 'packages/*/src/**/*.{spec,test}.ts'],
    environment: 'node',
    // Many integration files spawn Git/Node processes; bound contention on CI.
    maxWorkers: process.env['CI'] ? 2 : 4,
    pool: process.env['CI'] ? diagnosticForks(diagnostics) : 'forks',
    // Keep process isolation; fatal Node reports omit environment values.
    execArgv: process.env['CI'] ? ['--report-on-fatalerror', '--report-exclude-env', `--report-directory=${diagnostics}`] : [],
    testTimeout: 15_000,
    // afterAll fixture removal retries on slow Windows runners can exceed the 10s default.
    hookTimeout: 60_000,
    env: { TEMP: testTemp, TMP: testTemp, TMPDIR: testTemp },
  },
});

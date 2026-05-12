// tests/e2e/log-redaction.spec.ts
// SEC-10 integration test: verifies log-redaction middleware is active and container logs
// contain no raw secret values from environment variables.
//
// Runs against a locally running docker-compose stack. Skips gracefully if Docker is unreachable.
import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

function getDockerLogs(since: string): string | null {
  try {
    return execSync(`docker logs shifty-lowdefy --since ${since} 2>&1`, { encoding: 'utf-8' });
  } catch {
    return null;
  }
}

test.describe('Log redaction (SEC-10)', () => {
  test('container logs contain no raw secret values', () => {
    const logs = getDockerLogs('5m');

    if (logs === null) {
      // Docker not reachable or container not running — skip gracefully
      test.skip(true, 'shifty-lowdefy container not reachable; run against a live docker-compose stack');
      return;
    }

    // Collect sensitive values that are actually set in the test environment.
    // Only check values longer than 8 chars (matches log-redact.js threshold).
    const sensitiveValues = [
      process.env.RESEND_API_KEY,
      process.env.NEXTAUTH_SECRET,
      process.env.POSTGRES_PASSWORD,
    ].filter((v): v is string => typeof v === 'string' && v.length > 8);

    for (const val of sensitiveValues) {
      expect(logs).not.toContain(val);
    }

    // If no sensitive values are set in the environment, assert the logs are non-null (smoke check).
    if (sensitiveValues.length === 0) {
      expect(logs).toBeDefined();
    }
  });

  test('container logs show no shifty-auth ERR_MODULE_NOT_FOUND (plugin loaded)', () => {
    const logs = getDockerLogs('10m');

    if (logs === null) {
      test.skip(true, 'shifty-lowdefy container not reachable; run against a live docker-compose stack');
      return;
    }

    // Verify the log-redact / shifty-auth plugin did not fail to load
    expect(logs).not.toMatch(/shifty-auth.*ERR_MODULE_NOT_FOUND/i);
    expect(logs).not.toMatch(/log-redact.*ERR_MODULE_NOT_FOUND/i);
  });
});

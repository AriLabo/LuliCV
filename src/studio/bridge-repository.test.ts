import { expect, test } from 'vitest';
import { ResumeError } from '../core/errors';
import { withTimeout } from './bridge-repository';

const hang = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));

test('a Bridge request past its deadline fails with BRIDGE_TIMEOUT and says how long it waited', async () => {
  const error = await withTimeout(0.01, hang).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ResumeError);
  expect((error as ResumeError).code).toBe('BRIDGE_TIMEOUT');
  expect((error as ResumeError).message).toContain('0.01 秒内没有响应');
});

test('other failures pass through unchanged', async () => {
  const failure = new TypeError('Failed to fetch');
  await expect(withTimeout(5, () => Promise.reject(failure))).rejects.toBe(failure);
  await expect(withTimeout(5, async () => 'ok')).resolves.toBe('ok');
});

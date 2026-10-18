import { test, expect } from 'vitest';
import { errorResult } from './guidance';
import { ResumeError } from '../../src/core/errors';
test('guidance distinguishes uncertain writes, conflicts, reads and exports without leaking raw connection data', () => {
  const unknown = new Error('secret-token');
  expect(errorResult(unknown, 'write').nextAction).toContain('原 mutationId');
  for (const category of ['read', 'export'] as const) {
    expect(JSON.stringify(errorResult(unknown, category))).not.toContain('secret-token');
    expect(errorResult(unknown, category).nextAction).not.toContain('mutationId');
  }
  expect(errorResult(new ResumeError('REVISION_CONFLICT', '更新', 8), 'write')).toMatchObject({
    currentRevision: 8,
    nextAction: expect.stringContaining('重新计算 patch'),
  });
  expect(errorResult(new ResumeError('SNAPSHOT_UNAVAILABLE', '旧版本'), 'export').nextAction).toContain(
    '可用 revision',
  );
});

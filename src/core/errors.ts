export type ErrorCode =
  | 'REVISION_CONFLICT'
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'SNAPSHOT_UNAVAILABLE'
  | 'RENDER_TIMEOUT'
  | 'WORKSPACE_LOCKED'
  | 'EXTERNAL_CHANGE'
  | 'STORAGE_FAILED'
  | 'PRIVACY_MODE'
  | 'EXPORT_PENDING'
  | 'EXPORT_DECLINED'
  | 'BRIDGE_NOT_RUNNING'
  | 'BRIDGE_TIMEOUT';
export class ResumeError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly currentRevision?: number,
  ) {
    super(message);
    this.name = 'ResumeError';
  }
}
export function conflict(revision: number): never {
  throw new ResumeError('REVISION_CONFLICT', '简历已更新，请重新读取', revision);
}
/** The text to show for anything a promise rejected with or a block threw. */
export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

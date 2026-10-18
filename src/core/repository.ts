import type { CreationIdentity, DuplicateSource } from './creation';
import type { ResumeDocument } from './types';
export interface MutationIdentity {
  baseRevision: number;
  mutationId: string;
  fingerprint: string;
}
export type Transform = (current: ResumeDocument, previous?: ResumeDocument) => ResumeDocument | null;
export interface ResumeRepository {
  list(): Promise<ResumeDocument[]>;
  get(id: string): Promise<ResumeDocument>;
  create(document: ResumeDocument, identity?: CreationIdentity, source?: DuplicateSource): Promise<ResumeDocument>;
  transact(id: string, identity: MutationIdentity, transform: Transform): Promise<ResumeDocument | null>;
  /** The resume with its privacy tokens filled in, for layout and export only. Repositories without privacy mode omit it. */
  fill?(document: ResumeDocument): ResumeDocument;
}
export interface Receipt {
  fingerprint: string;
  result: ResumeDocument | null;
}
export function receiptKey(id: string, mutationId: string): string {
  return `${id}:${mutationId}`;
}

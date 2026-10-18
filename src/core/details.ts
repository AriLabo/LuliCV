import type { BasicInformation } from './types';

/**
 * Personal details Chinese resumes often carry. Each is optional and absent until the person adds it; the page and
 * the editor show them in this order.
 */
export const DETAIL_FIELDS = [
  { id: 'gender', label: '性别' },
  { id: 'birthDate', label: '出生年月' },
  { id: 'politicalStatus', label: '政治面貌' },
  { id: 'hometown', label: '籍贯' },
  { id: 'yearsOfExperience', label: '工作年限' },
] as const satisfies ReadonlyArray<{ id: keyof BasicInformation; label: string }>;
export type DetailField = (typeof DETAIL_FIELDS)[number]['id'];
/** One short line holds all of them; a value past this is a sentence that belongs elsewhere. */
export const DETAIL_MAX_LENGTH = 20;

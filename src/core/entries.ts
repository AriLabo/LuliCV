import type { ResumeEntry } from './types';

/** The field that names an entry: company (or role), school, category, name or title; empty when unset. */
export function entryTitle(entry: ResumeEntry): string {
  return (
    ('company' in entry
      ? entry.company || entry.role
      : 'school' in entry
        ? entry.school
        : 'category' in entry
          ? entry.category
          : 'name' in entry
            ? entry.name
            : entry.title) || ''
  );
}

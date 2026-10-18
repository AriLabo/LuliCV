import { hasToken } from '../core/privacy';
import type { ResumeDocument } from '../core/types';

export function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function readJsonFile(file: File): Promise<unknown> {
  return file.text().then((text) => JSON.parse(text) as unknown);
}

export function safeFilename(value: string): string {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-') || 'resume'
  );
}

/** The PDF's file name: who and where for an application version, else the resume's name. A name that is a privacy placeholder is left out. */
export function pdfFilename(record: Pick<ResumeDocument, 'name' | 'target' | 'data'>): string {
  const owner = hasToken(record.data.basics.name) ? '' : record.data.basics.name;
  return safeFilename(
    record.target
      ? [owner, record.target.company, record.target.role].filter(Boolean).join('-') || record.name
      : record.name,
  );
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

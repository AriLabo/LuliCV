import { createHash } from 'node:crypto';
import { ResumeError } from '../../src/core/errors';

/*
 * A photo is a data URL of up to a few megabytes, which would fill an agent's context on every read. Agents get a
 * one-line summary in its place, with a fingerprint, so a summary written back unchanged (a whole /data/basics
 * replaced, say) keeps the photo it stands for. The web page and the renderer always get the photo itself.
 */
const SUMMARY = /^照片已省略（[A-Za-z]+，[\d.]+ [KM]B，#([0-9a-f]{12})；原样写回即保留原图）$/;

function fingerprint(photo: string) {
  return createHash('sha256').update(photo).digest('hex').slice(0, 12);
}
function isPhoto(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/');
}
export function photoSummary(photo: string) {
  const type = photo.slice('data:image/'.length, photo.indexOf(';')).toUpperCase();
  const bytes = ((photo.length - photo.indexOf(',') - 1) * 3) / 4;
  const size =
    bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `照片已省略（${type}，${size}，#${fingerprint(photo)}；原样写回即保留原图）`;
}

/** A response with every `photo` data URL replaced by its summary. */
export function summarizePhotos<T>(value: T): T {
  if (Array.isArray(value)) return value.map(summarizePhotos) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === 'photo' && isPhoto(item) ? photoSummary(item) : summarizePhotos(item),
    ]),
  ) as T;
}

function hasSummary(value: unknown): boolean {
  if (typeof value === 'string') return SUMMARY.test(value);
  if (Array.isArray(value)) return value.some(hasSummary);
  return !!value && typeof value === 'object' && Object.values(value).some(hasSummary);
}
function restore(value: unknown, photo: string | undefined, fail: () => never): unknown {
  if (typeof value === 'string') {
    const match = value.match(SUMMARY);
    if (!match) return value;
    if (!isPhoto(photo) || match[1] !== fingerprint(photo)) fail();
    return photo;
  }
  if (Array.isArray(value)) return value.map((item) => restore(item, photo, fail));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restore(item, photo, fail)]));
}

/** Patch operations with summaries of the photo the resume has now (`current`) turned back into the photo. */
export function restorePhotos<T>(operations: T, current: string | undefined): T {
  if (!hasSummary(operations)) return operations;
  return restore(operations, current, () => {
    throw new ResumeError(
      'VALIDATION_FAILED',
      '照片摘要只能原样写回同一份简历、对应它当前的照片；不改照片就不要写这个字段，要换照片请写入新的 PNG/JPEG/WebP data URL',
    );
  }) as T;
}

/** Imported data has no photo of its own to stand for, so a summary in it is refused with what to do instead. */
export function refusePhotoSummary(data: unknown) {
  if (hasSummary(data))
    throw new ResumeError(
      'VALIDATION_FAILED',
      '导入的数据里有照片摘要，原图不在输出里；要带照片请写入 PNG/JPEG/WebP data URL，或用 duplicate 复制已有简历',
    );
}

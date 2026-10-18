import { open } from 'node:fs/promises';
export async function syncDirectory(directory: string) {
  // Windows directory handles do not offer the POSIX directory-fsync contract.
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function syncFile(file: string) {
  const handle = await open(file, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export function isPortableFilename(name: string): boolean {
  // eslint-disable-next-line no-control-regex -- control characters are not allowed in Windows file names
  if (!name || name === '.' || name === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) return false;
  const stem = name.split('.')[0].trimEnd();
  return !/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(stem);
}

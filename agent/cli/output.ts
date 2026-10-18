import { isPortableFilename } from '../runtime/files';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { ResumeError } from '../../src/core/errors';
export async function writeOutput(root: string, destination: string, contents: Buffer) {
  if (!isPortableFilename(path.basename(destination)))
    throw new ResumeError('VALIDATION_FAILED', '输出文件名包含保留字符或设备名');
  const resolved = path.resolve(destination);
  const output = path.join(await realpath(path.dirname(resolved)), path.basename(resolved));
  const workspaceRoot = await realpath(root);
  if (
    output.startsWith(path.join(workspaceRoot, 'resumes') + path.sep) ||
    output.startsWith(path.join(workspaceRoot, '.cvslate') + path.sep) ||
    output === path.join(workspaceRoot, 'cvslate.json') ||
    output.startsWith(path.join(workspaceRoot, 'cvslate.db'))
  )
    throw new ResumeError('VALIDATION_FAILED', '输出不能覆盖工作区状态');
  let handle;
  try {
    handle = await open(output, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new ResumeError('VALIDATION_FAILED', `${output} 已存在，不会覆盖；换一个文件名或目录`);
    throw error;
  }
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await (await import('node:fs/promises')).rm(output, { force: true });
    throw error;
  }
  await handle.close();
  return output;
}

import { spawn } from 'node:child_process';
import { ResumeError } from '../../src/core/errors';
export function browserCommand(url: string, platform = process.platform): { executable: string; args: string[] } {
  const target = new URL(url);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password)
    throw new ResumeError('VALIDATION_FAILED', '只允许打开本地 Bridge');
  if (platform === 'darwin') return { executable: 'open', args: [url] };
  if (platform === 'win32') return { executable: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  if (platform === 'linux') return { executable: 'xdg-open', args: [url] };
  throw new ResumeError('VALIDATION_FAILED', '这个系统不支持自动打开浏览器；把 url 交给用户打开');
}
export async function openBrowser(url: string) {
  const command = browserCommand(url);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, { stdio: 'ignore', shell: false });
    const failure = () =>
      reject(new ResumeError('STORAGE_FAILED', '系统浏览器无法打开；Bridge 已启动，把 url 交给用户打开'));
    child.once('error', failure);
    child.once('exit', (code) => (code === 0 ? resolve() : failure()));
  });
}

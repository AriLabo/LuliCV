import { bridgeRequest } from '../cli/client';
import type { Runtime } from './server';

/** Signs in the way the web page does, through a preview entry; returns the Cookie header to send. */
export async function browserCookie(runtime: Runtime) {
  const { url } = (await (await bridgeRequest(runtime, '/api/preview-entry', 'POST', {})).json()) as { url: string };
  const response = await fetch(runtime.origin + '/api/session', {
    method: 'POST',
    headers: { 'X-Resume-Preview': new URLSearchParams(new URL(url).hash.slice(1)).get('preview')! },
  });
  if (!response.ok) throw new Error(`sign-in failed: ${response.status}`);
  return response.headers.get('set-cookie')!.split(';')[0];
}

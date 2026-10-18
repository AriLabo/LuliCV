import type { Browser } from 'playwright';
export type ChromiumSource = 'playwright' | 'chrome' | 'msedge';
export const CHROMIUM_NAMES: Record<ChromiumSource, string> = {
  playwright: 'Playwright 自带的 Chromium',
  chrome: '系统 Chrome',
  msedge: '系统 Edge',
};
// Playwright's own build first: it is pinned, so layout matches what was tested. Otherwise an installed
// Chrome or Edge, which spares a 100 MB download; it updates itself, so line breaks can shift slightly over time.
export async function launchChromium(timeout?: number): Promise<{ browser: Browser; source: ChromiumSource }> {
  const { chromium } = await import('playwright');
  let first: unknown;
  for (const source of ['playwright', 'chrome', 'msedge'] as const) {
    try {
      return {
        browser: await chromium.launch({
          ...(source === 'playwright' ? {} : { channel: source }),
          ...(timeout ? { timeout } : {}),
        }),
        source,
      };
    } catch (error) {
      first ??= error;
    }
  }
  throw new Error(
    `没有可用的 Chromium、Chrome 或 Edge：${first instanceof Error ? first.message.split('\n')[0] : String(first)}`,
  );
}

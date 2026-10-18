// Locally bundled font stacks a resume may use instead of its theme's own font.
// Every face here ships with the app; none is fetched from a remote source.
const fallback = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
export const fontOptions = [
  { id: 'noto-sans-sc', name: '思源黑体 Noto Sans SC', short: '思源黑体', stack: `"Noto Sans SC", ${fallback}` },
  { id: 'misans', name: 'MiSans', short: 'MiSans', stack: `"MiSans VF", "Noto Sans SC", ${fallback}` },
  {
    id: 'lxgw-neo-xihei',
    name: '霞鹜新晰黑（仅常规字重）',
    short: '霞鹜新晰黑',
    stack: `"LXGW Neo XiHei Local", "Noto Sans SC", ${fallback}`,
  },
] as const;
export const fontIds: readonly string[] = fontOptions.map((font) => font.id);
export function fontStack(id: string | undefined): string | undefined {
  return fontOptions.find((font) => font.id === id)?.stack;
}

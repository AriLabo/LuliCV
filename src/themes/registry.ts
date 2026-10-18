import { useSyncExternalStore } from 'react';
import { themeCatalog } from '../core/document';
import { scopeThemeCss, themeDefaults } from '../core/theme-package';
import type { ThemeManifest } from '../core/theme-types';
import type { LayoutSettings } from '@/studio/types';

export interface ThemeDefinition extends ThemeManifest {
  /** Defaults as layout settings: the theme's spacing plus its first preset's colour and font. */
  layoutDefaults: LayoutSettings;
}

// Built-in themes are the same kind of package an installed theme is: manifest.json + theme.css.
const stylesheets = import.meta.glob<string>('./*/theme.css', { query: '?raw', import: 'default', eager: true });
const manifests = import.meta.glob<ThemeManifest>('./*/manifest.json', { import: 'default', eager: true });

export const builtinThemes: ThemeDefinition[] = themeCatalog.map((entry) => {
  const manifest = Object.entries(manifests).find(([path]) => path.split('/')[1] === entry.id)?.[1];
  if (!manifest || JSON.stringify(manifest) !== JSON.stringify(entry))
    throw new Error('Theme catalog 与主题包不一致，请运行 npm run themes:generate');
  return { ...manifest, layoutDefaults: themeDefaults(manifest) as LayoutSettings };
});
const builtinMap: Record<string, ThemeDefinition> = Object.fromEntries(builtinThemes.map((theme) => [theme.id, theme]));
export const DEFAULT_THEME = 'standard';

/*
 * Themes installed in the workspace arrive from the Bridge after start-up and can change while the
 * editor is open, so they live in a small store; components read it through useThemeRegistry().
 * The Bridge validated each package before installing it; here it is only scoped and injected.
 */
export interface InstalledTheme {
  manifest: ThemeManifest;
  css: string;
}
let installed: Record<string, ThemeDefinition> = {};
let version = 0;
const listeners = new Set<() => void>();

function injectStyle(id: string, css: string | undefined) {
  if (typeof document === 'undefined') return;
  const existing = document.querySelector<HTMLStyleElement>(`style[data-rs-theme="${id}"]`);
  if (css === undefined) {
    existing?.remove();
    return;
  }
  const scoped = scopeThemeCss(id, css);
  if (existing) {
    if (existing.textContent !== scoped) existing.textContent = scoped;
    return;
  }
  const style = document.createElement('style');
  style.dataset.rsTheme = id;
  style.textContent = scoped;
  document.head.append(style);
}

/** Replaces the installed themes with the Bridge's current set; built-in ids are never overridden. */
export function setInstalledThemes(packages: InstalledTheme[]) {
  const next: Record<string, ThemeDefinition> = {};
  for (const { manifest, css } of packages) {
    if (builtinMap[manifest.id]) continue;
    next[manifest.id] = { ...manifest, layoutDefaults: themeDefaults(manifest) as LayoutSettings };
    injectStyle(manifest.id, css);
  }
  for (const id of Object.keys(installed)) if (!next[id]) injectStyle(id, undefined);
  installed = next;
  version += 1;
  for (const listener of listeners) listener();
}

export function installedThemes(): ThemeDefinition[] {
  return Object.values(installed);
}
export function hasTheme(id: string): boolean {
  return Boolean(builtinMap[id] ?? installed[id]);
}

/** The theme to render with; an id that is not installed falls back to the default theme. */
export function getTheme(id: string): ThemeDefinition {
  return builtinMap[id] ?? installed[id] ?? builtinMap[DEFAULT_THEME];
}

/** Re-renders the caller whenever installed themes change; the returned number changes with them. */
export function useThemeRegistry(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => version,
    () => version,
  );
}

// Inject each built-in stylesheet once, scoped to its theme root.
for (const [path, css] of Object.entries(stylesheets)) injectStyle(path.split('/')[1], css);

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { themeCatalog, normalizeDocument, reservedThemeIds } from './document';
import {
  appearanceForTheme,
  checkThemePackage,
  lintAppearanceCss,
  lintThemeCss,
  matchingPreset,
  MAX_APPEARANCE_CSS,
  scanThemeCss,
  scopeThemeCss,
  validateThemeManifest,
} from './theme-package';
import type { ThemeManifest } from './theme-types';
import { baseAppearance, createResumeRecord } from './defaults';

describe('theme packages', () => {
  it('built-in themes are valid packages with safe stylesheets', () => {
    expect(themeCatalog.map((theme) => theme.id)).toEqual(['standard', 'editorial', 'minimal', 'business', 'timeline']);
    for (const manifest of themeCatalog) {
      expect(validateThemeManifest(manifest)).toEqual([]);
      const css = readFileSync(`src/themes/${manifest.id}/theme.css`, 'utf8');
      expect(scanThemeCss(css)).toEqual([]);
      expect(lintThemeCss(css, manifest as never)).toEqual([]);
    }
  });
  it('rejects manifests and stylesheets that break the contract', () => {
    const bad = {
      ...themeCatalog[0],
      id: 'Bad Id',
      presets: [],
      extra: 1,
      settings: [
        {
          id: 'header',
          label: '页眉',
          type: 'select',
          default: 'x',
          options: [
            { value: 'left', label: '左' },
            { value: 'center', label: '中' },
          ],
        },
      ],
    };
    const errors = validateThemeManifest(bad);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('manifest.extra'),
        expect.stringContaining('manifest.id'),
        expect.stringContaining('manifest.presets'),
        expect.stringContaining('default 必须是其中一个选项'),
      ]),
    );
    expect(scanThemeCss('@import url("x.css"); .rs-name { background: url(https://example.com/a.png) }')).toEqual(
      expect.arrayContaining([expect.stringContaining('@import'), expect.stringContaining('https://example.com')]),
    );
    expect(scanThemeCss('@font-face { font-family: X; src: url(x.woff2) }')).toEqual(
      expect.arrayContaining([expect.stringContaining('@font-face')]),
    );
    expect(scanThemeCss('.rs-name { background: url("data:image/svg+xml;utf8,<svg/>") }')).toEqual([]);
    expect(scopeThemeCss('demo', '.rs-name { color: red; }')).toBe('.rs-theme--demo {\n.rs-name { color: red; }\n}\n');
  });
  it('cannot be tricked into loading resources or escaping its scope', () => {
    for (const css of [
      '.rs-name { background: \\75rl(https://example.com/a.png) }',
      '@\\69mport "https://example.com/x.css";',
      '.rs-name { background: u\\rl(https://example.com/a.png) }',
      '.rs-name { background: image("https://example.com/a.png") }',
      '.rs-name { background: src("https://example.com/a.png") }',
      '.rs-name { background: url( https://example.com/a.png ) }',
      ".rs-name { background: url('https://example.com/a.png') }",
      '.rs-name { background: -webkit-image-set("a.png" 1x) }',
      '.rs-name { background: url("data:image/svg+xml,<svg><image href=\'https://example.com/a.png\'/></svg>") }',
      '.rs-name { background: url("data:image/svg+xml;base64,' +
        btoa('<svg><image href="https://example.com/a.png"/></svg>') +
        '") }',
      '.rs-name { color: red; } } body { display: none } .rs-name {',
      '.rs-name { content: "}"; } body { display: none',
      '.rs-name { color: red; /* unclosed',
      '.rs-name { content: "unclosed }',
    ])
      expect(scanThemeCss(css), css).not.toEqual([]);
    expect(scanThemeCss('.rs-bullet-mark::before { content: "\\2022"; }')).toEqual([]);
    expect(scanThemeCss('.rs-name { background: url(data:image/png;base64,iVBORw0KGgo=) }')).toEqual([]);
  });
  it('checks a whole package and points out likely mistakes', () => {
    const manifest = { ...themeCatalog[0], id: 'demo-theme' };
    expect(checkThemePackage(manifest, '.rs-name { color: var(--rs-accent); }', reservedThemeIds)).toEqual({
      errors: [],
      warnings: [],
    });
    expect(checkThemePackage({ ...manifest, id: 'standard' }, '', reservedThemeIds).errors).toEqual([
      expect.stringContaining('已被内置主题占用'),
    ]);
    const warnings = lintThemeCss(
      '--own: 1pt; .rs-titel { color: #c0392b; margin: var(--own); } &.rs-set-header-center .rs-name { color: #333; } .rs-skill { gap: var(--rs-gap); }',
      manifest as never,
    );
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('.rs-titel'),
        expect.stringContaining('var(--rs-gap)'),
        expect.stringContaining('#c0392b'),
      ]),
    );
    expect(warnings).toHaveLength(3);
  });
  it('checks a resume stylesheet the same way, under its own name and limit', () => {
    expect(scanThemeCss('@import "x.css";', 'appearance.css', MAX_APPEARANCE_CSS)).toEqual([
      expect.stringMatching(/^appearance\.css .*@import/),
    ]);
    expect(
      scanThemeCss(`.rs-name { color: red; }${' '.repeat(MAX_APPEARANCE_CSS)}`, 'appearance.css', MAX_APPEARANCE_CSS),
    ).toEqual(['appearance.css 超过 20 KB']);
    // It stays across theme changes, so any theme's root and settings classes are fair targets.
    expect(
      lintAppearanceCss(
        '&.rs-theme--editorial .rs-name { margin: 0; } &.rs-set-header-center .rs-contact { flex-shrink: 0; }',
      ),
    ).toEqual([]);
    expect(
      lintAppearanceCss(
        '--own: 2pt; .rs-titel { color: #c0392b; margin: var(--own); } .rs-skill { gap: var(--rs-gap); }',
      ),
    ).toEqual([
      'appearance.css：.rs-titel 不是骨架里的类名，这条规则不会生效',
      'appearance.css：var(--rs-gap) 既不是骨架变量，也没有在自定义样式里定义',
      'appearance.css：#c0392b 是写死的彩色；强调色请用 var(--rs-accent)，否则换配色时它不会跟着变',
    ]);
  });
  it('rejects theme settings the theme does not declare', () => {
    const record = createResumeRecord();
    expect(() =>
      normalizeDocument({ ...record, appearance: { ...record.appearance, settings: { header: 'Left Side' } } }),
    ).toThrow('appearance.settings');
  });
  it("switching theme adopts its colour and font but keeps the person's spacing", () => {
    const [standard, editorial, minimal] = themeCatalog as unknown as ThemeManifest[];
    const tuned = {
      ...structuredClone(baseAppearance),
      density: 'dense' as const,
      settings: { header: 'center' },
      layout: {
        ...baseAppearance.layout,
        pageMarginMm: 11,
        baseFontPt: 9.4,
        lineHeight: 1.36,
        sectionSpacingPt: 7,
        photoEnabled: true,
        accentColor: '#123456',
        fontFamily: 'lxgw-neo-xihei',
      },
    };
    const toEditorial = appearanceForTheme(tuned, editorial);
    expect(toEditorial).toEqual({
      ...tuned,
      themeId: 'editorial',
      preset: editorial.presets[0].id,
      settings: {},
      layout: {
        ...tuned.layout,
        accentColor: editorial.presets[0].accentColor,
        fontFamily: editorial.presets[0].fontFamily,
      },
    });
    const toMinimal = appearanceForTheme(tuned, minimal);
    expect(toMinimal.layout).not.toHaveProperty('fontFamily');
    expect(toMinimal.layout.accentColor).toBe(minimal.presets[0].accentColor);
    expect(tuned.layout.fontFamily).toBe('lxgw-neo-xihei');
    expect(matchingPreset(toEditorial, editorial)?.id).toBe(editorial.presets[0].id);
    expect(matchingPreset(tuned, standard)).toBeUndefined();
    // Two presets can share a colour; the one last applied wins.
    expect(
      matchingPreset({ ...toMinimal, preset: 'navy', layout: { ...toMinimal.layout, accentColor: '#274472' } }, minimal)
        ?.id,
    ).toBe('navy');
  });
});

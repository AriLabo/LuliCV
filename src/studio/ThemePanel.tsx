import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  builtinThemes,
  getTheme,
  hasTheme,
  installedThemes,
  useThemeRegistry,
  type ThemeDefinition,
} from '@/themes/registry';
import { buildBlocks, SkeletonHeader, themeClasses, themeVariables } from '@/themes/skeleton';
import { useAppearanceCss, type AppearanceCss } from '@/themes/appearance-css';
import { appearanceForTheme, matchingPreset } from '../core/theme-package';
import { fontOptions } from '../core/fonts';
import type { Appearance, ResumeRecord } from './types';

const PAGE_WIDTH_PX = (210 / 25.4) * 96;
// A first page never holds more blocks than this; the cap keeps thumbnails of long resumes cheap.
const THUMB_BLOCKS = 48;
const HOVER_DELAY_MS = 120;

interface ThemePanelProps {
  record: ResumeRecord;
  /** "pane" replaces the editor beside the preview; "sheet" rises from the bottom on narrow screens. */
  variant: 'pane' | 'sheet';
  /** Shows a theme in the preview without saving it; undefined goes back to the resume's own theme. */
  onPreview: (themeId: string | undefined) => void;
  onApply: (themeId: string) => void;
  onPreset: (presetId: string) => void;
  onAccent: (color: string) => void;
  onFont: (fontId: string) => void;
  onClose: () => void;
}

/**
 * The person's own first page in a theme, scaled down. It is real DOM like the preview, but not a page:
 * no .page-wrap or data-a4-page, hidden from assistive technology and unreachable by keyboard.
 */
function Thumbnail({
  theme,
  appearance,
  content,
  scope,
}: {
  theme: ThemeDefinition;
  appearance: Appearance;
  content: ReactNode;
  scope: AppearanceCss['scope'];
}) {
  const ref = useRef<HTMLDivElement>(null);
  // React 18 has no inert prop; set the attribute so links in the thumbnail cannot take focus.
  useEffect(() => {
    ref.current?.setAttribute('inert', '');
  }, []);
  return (
    <div ref={ref} className="theme-thumb" aria-hidden="true">
      <div
        className={`theme-thumb__page ${themeClasses(theme, appearance)}`}
        style={themeVariables(appearance.layout)}
        {...scope}
      >
        <div className="a4-inner">{content}</div>
      </div>
    </div>
  );
}

export function ThemePanel({
  record,
  variant,
  onPreview,
  onApply,
  onPreset,
  onAccent,
  onFont,
  onClose,
}: ThemePanelProps) {
  useThemeRegistry();
  const appearance = record.appearance;
  const current = getTheme(appearance.themeId);
  const missing = !hasTheme(appearance.themeId);
  const installed = installedThemes();
  const layout = appearance.layout;
  // The resume's own stylesheet stays when the theme changes, so every thumbnail shows it.
  const custom = useAppearanceCss(appearance.css);
  const activePreset = missing ? undefined : matchingPreset(appearance, current);
  const content = useMemo(
    () => (
      <>
        <div className="resume-header-wrap">
          <SkeletonHeader data={record.data} options={layout} />
        </div>
        {buildBlocks(record.data)
          .slice(0, THUMB_BLOCKS)
          .map((block) => (
            <div key={block.id} className="resume-block" data-block-kind={block.kind}>
              {block.node}
            </div>
          ))}
      </>
    ),
    [record.data, layout],
  );

  // One timer for enter and leave, so moving from card to card never flashes back to the current theme.
  const timer = useRef<number>();
  const previewRef = useRef(onPreview);
  previewRef.current = onPreview;
  const preview = (id: string | undefined, delay = HOVER_DELAY_MS) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => previewRef.current(id), delay);
  };
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      previewRef.current(undefined);
    },
    [],
  );
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Thumbnails scale with the card width; one observer sets the factor for all of them.
  const cardsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const cards = cardsRef.current;
    if (!cards) return;
    const observer = new ResizeObserver(() => {
      const thumb = cards.querySelector<HTMLElement>('.theme-thumb');
      if (thumb) cards.style.setProperty('--thumb-scale', String(thumb.clientWidth / PAGE_WIDTH_PX));
    });
    observer.observe(cards);
    return () => observer.disconnect();
  }, []);

  const card = (theme: ThemeDefinition) => {
    const isCurrent = theme.id === appearance.themeId;
    return (
      <button
        key={theme.id}
        type="button"
        className="theme-card"
        aria-pressed={isCurrent}
        aria-label={theme.name}
        aria-describedby={`theme-desc-${theme.id}`}
        data-theme-card={theme.id}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'touch') preview(theme.id);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== 'touch') preview(undefined);
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) preview(theme.id, 0);
        }}
        onBlur={() => preview(undefined)}
        onClick={() => {
          window.clearTimeout(timer.current);
          onApply(theme.id);
        }}
      >
        <Thumbnail
          theme={theme}
          appearance={isCurrent ? appearance : appearanceForTheme(appearance, theme)}
          content={content}
          scope={custom.scope}
        />
        <span className="theme-card__title">
          <strong>{theme.name}</strong>
          {isCurrent ? (
            <span className="theme-card__current">使用中</span>
          ) : (
            <span className="theme-card__apply">点击应用</span>
          )}
        </span>
        <span className="theme-card__desc" id={`theme-desc-${theme.id}`}>
          {theme.description}
        </span>
        {theme.tags.length > 0 && (
          <span className="theme-card__tags">
            {theme.tags.slice(0, 3).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </span>
        )}
      </button>
    );
  };

  const sample = `${record.data.basics.name.trim().slice(0, 4) || '简历'} Aa`;
  const fonts = [{ id: '', short: '跟随主题', name: '跟随主题', stack: undefined }, ...fontOptions];
  return (
    <section className={`theme-panel theme-panel--${variant} studio-chrome`} aria-label="选择主题">
      <header className="theme-panel__head">
        <h2>选择主题</h2>
        <span>{variant === 'pane' ? '悬停预览你的简历 · 点击应用 · 可撤销' : '点击即应用，可撤销'}</span>
        <button type="button" className="primary-button" onClick={onClose}>
          完成
        </button>
      </header>
      <div className="theme-panel__body" ref={cardsRef}>
        {custom.style}
        {missing && (
          <p className="notice notice-warning">
            当前简历使用的主题「{appearance.themeId}」未安装，暂按「{current.name}」显示。选一个主题即可替换。
          </p>
        )}
        {installed.length > 0 && <h3>内置</h3>}
        <div className="theme-cards">{builtinThemes.map(card)}</div>
        {installed.length > 0 && (
          <>
            <h3>已安装</h3>
            <div className="theme-cards">{installed.map(card)}</div>
          </>
        )}
      </div>
      <footer className="theme-panel__foot">
        <div className="theme-panel__row">
          <span>配色</span>
          <div className="preset-swatches">
            {!missing &&
              current.presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="preset-swatch"
                  aria-pressed={activePreset?.id === preset.id}
                  onClick={() => onPreset(preset.id)}
                >
                  <i style={{ background: preset.accentColor }} />
                  {preset.name}
                </button>
              ))}
            <label
              className={`preset-swatch preset-swatch--custom${activePreset ? '' : ' is-active'}`}
              title="自定义强调色"
            >
              <i style={activePreset ? undefined : { background: layout.accentColor }} />
              自定义
              <input
                type="color"
                aria-label="自定义强调色"
                value={layout.accentColor}
                onChange={(event) => onAccent(event.target.value)}
              />
            </label>
          </div>
        </div>
        <div className="theme-panel__row">
          <span>字体</span>
          <div className="font-specimens">
            {fonts.map((font) => (
              <button
                key={font.id}
                type="button"
                className="font-specimen"
                aria-pressed={(layout.fontFamily ?? '') === font.id}
                aria-label={font.name}
                title={font.name}
                onClick={() => onFont(font.id)}
              >
                <span className="font-specimen__sample" style={font.stack ? { fontFamily: font.stack } : undefined}>
                  {sample}
                </span>
                <small>{font.short}</small>
              </button>
            ))}
          </div>
        </div>
      </footer>
    </section>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Editor } from './studio/Editor';
import { downloadBlob, pdfFilename } from './studio/files';
import { ResumePreview } from './studio/ResumePreview';
import { CustomCssNote } from './studio/CustomCssNote';
import { ThemePanel } from './studio/ThemePanel';
import { ResumeTree } from './studio/ResumeTree';
import { DocumentPanel, SourceNotice } from './studio/DocumentPanel';
import { pathTo } from './core/tree';
import { ChangeHistory } from './studio/ChangeHistory';
import { useStudioStore } from './studio/store';
import type { LayoutIssue, LayoutSettings, ResumeDocument, ResumeTarget } from './studio/types';
import { contentWarnings } from './core/document';
import { getTheme, hasTheme, useThemeRegistry } from './themes/registry';
import { appearanceForTheme, matchingPreset } from './core/theme-package';
import { layoutRanges, type SpacingKey } from './core/defaults';
import { LockIcon, previewLabels } from './studio/privacy';
import { useDetailsDismiss, useDismiss } from './studio/dismiss';
import { errorMessage } from './core/errors';
import { PrivacyDialog, type PrivacyDialogEntry } from './studio/PrivacyDialog';
import { ExportApprovalDialog } from './studio/ExportApprovalDialog';
import { Wordmark } from './studio/brand';
import { BackupPanel } from './studio/BackupPanel';

const densityNames = { comfortable: '舒适', balanced: '适中', dense: '紧凑' } as const;
const A4_WIDTH_PX = (210 / 25.4) * 96;
const SPARSE_LAST_PAGE = 0.3;
const NARROW_QUERY = '(max-width: 1099px)';
const EDIT_HINT_KEY = 'cvslate:edit-hint-seen';
const TREE_KEY = 'cvslate:tree-open';
const readSetting = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeSetting = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage may be blocked; the setting just resets. */
  }
};
const readFlag = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const writeFlag = (key: string) => {
  try {
    localStorage.setItem(key, '1');
  } catch {
    /* Private windows may block storage; the hint simply shows again. */
  }
};

/** One step tighter or looser across the four spacing controls, within the allowed ranges. */
function stepLayout(layout: LayoutSettings, direction: -1 | 1): Partial<LayoutSettings> {
  const step = (key: SpacingKey, delta: number) => {
    const { min, max } = layoutRanges[key];
    return Math.round(Math.min(max, Math.max(min, layout[key] + delta * direction)) * 100) / 100;
  };
  return {
    pageMarginMm: step('pageMarginMm', 1),
    baseFontPt: step('baseFontPt', 0.2),
    lineHeight: step('lineHeight', 0.04),
    sectionSpacingPt: step('sectionSpacingPt', 1),
  };
}

const UndoIcon = ({ redo = false }: { redo?: boolean }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" style={redo ? { transform: 'scaleX(-1)' } : undefined}>
    <path
      d="M5.5 4 2.5 7l3 3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path d="M3 7h6.5a3.5 3.5 0 0 1 0 7H8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/** A toolbar button that opens a panel; closes on outside click or Escape. */
function Popover({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDetailsDismiss(ref);
  // Open towards whichever side has room, so the panel never runs off the window.
  const place = () => {
    const details = ref.current;
    if (!details?.open) return;
    const panel = details.querySelector<HTMLElement>('.popover-panel');
    if (!panel) return;
    panel.classList.remove('popover-panel--end');
    if (panel.getBoundingClientRect().right > window.innerWidth - 8) panel.classList.add('popover-panel--end');
  };
  return (
    <details className={`popover ${className ?? ''}`} ref={ref} onToggle={place}>
      <summary>{label}</summary>
      <div className="popover-panel" role="dialog" aria-label={label}>
        {children}
      </div>
    </details>
  );
}

function MoreMenu({ children }: { children: (close: () => void) => ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  useDetailsDismiss(ref);
  return (
    <details className="menu" ref={ref}>
      <summary aria-label="更多操作">更多</summary>
      <div className="menu-panel" role="menu">
        {children(close)}
      </div>
    </details>
  );
}

function App() {
  const workspace = useStudioStore((state) => state.workspace);
  const ready = useStudioStore((state) => state.ready);
  const saveState = useStudioStore((state) => state.saveState);
  const mode = useStudioStore((state) => state.mode);
  const connected = useStudioStore((state) => state.connected);
  const conflicts = useStudioStore((state) => state.conflicts);
  const lastChange = useStudioStore((state) => state.lastChange);
  const storeError = useStudioStore((state) => state.error);
  const [actionError, setActionError] = useState<string>();
  const runAction = (action: () => Promise<void>) => {
    setActionError(undefined);
    void action().catch((error) => setActionError(errorMessage(error)));
  };
  const canUndo = useStudioStore((state) => state.canUndo);
  const canRedo = useStudioStore((state) => state.canRedo);
  const init = useStudioStore((state) => state.init);
  const undo = useStudioStore((state) => state.undo);
  const redo = useStudioStore((state) => state.redo);
  const selectResume = useStudioStore((state) => state.selectResume);
  const createResume = useStudioStore((state) => state.createResume);
  const duplicateResume = useStudioStore((state) => state.duplicateResume);
  const renameResume = useStudioStore((state) => state.renameResume);
  const deleteResume = useStudioStore((state) => state.deleteResume);
  const updateAppearance = useStudioStore((state) => state.updateAppearance);
  const setAppearance = useStudioStore((state) => state.setAppearance);
  const editStamp = useStudioStore((state) => state.editStamp);
  const updateLayout = useStudioStore((state) => state.updateLayout);
  const updateTarget = useStudioStore((state) => state.updateTarget);
  const updateMeta = useStudioStore((state) => state.updateMeta);
  const loadSourceChanges = useStudioStore((state) => state.loadSourceChanges);
  const setDensity = useStudioStore((state) => state.setDensity);
  const dismissChange = useStudioStore((state) => state.dismissChange);
  const previewRef = useRef<HTMLElement>(null);
  const [issues, setIssues] = useState<LayoutIssue[]>([]);
  const [pageFill, setPageFill] = useState<number[]>([]);
  // Side panels open on the page itself; editing is one tap away and pointed out once.
  const [view, setView] = useState<'edit' | 'preview'>(() =>
    window.matchMedia(NARROW_QUERY).matches ? 'preview' : 'edit',
  );
  const [editHint, setEditHint] = useState(() => window.matchMedia(NARROW_QUERY).matches && !readFlag(EDIT_HINT_KEY));
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  // Agent side browsers may load the page wide and then dock it; until a tab is picked, narrowing opens the page again.
  const viewPicked = useRef(false);
  // Until the person chooses, the tree opens on wide screens once there is more than one resume to organise.
  const [treePref, setTreePref] = useState(() => readSetting(TREE_KEY));
  const treeOpen = treePref ? treePref === '1' : (workspace?.resumes.length ?? 0) > 1 && window.innerWidth >= 1360;
  const [treePopover, setTreePopover] = useState(false);
  const [sourceChanges, setSourceChanges] = useState<Record<string, number>>({});
  const popoverRef = useRef<HTMLDivElement>(null);
  const [themePanel, setThemePanel] = useState(false);
  // A theme shown in the preview while hovering its card; never saved.
  const [previewTheme, setPreviewTheme] = useState<string>();
  // Offered until anything else changes, so its undo can only ever undo the theme switch.
  const [themeNotice, setThemeNotice] = useState<{ resumeId: string; stamp: number; from: string; to: string }>();
  const privacy = useStudioStore((state) => state.privacy);
  const privacyLabels = useMemo(() => previewLabels(privacy), [privacy]);
  const [privacyDialog, setPrivacyDialog] = useState<PrivacyDialogEntry>();
  const [exporting, setExporting] = useState(false);
  // The preview lays out placeholders; the Bridge's layout with the real values says how many pages the PDF will have.
  const [realPages, setRealPages] = useState<{ key: string; pages?: number }>();
  const handleIssues = useCallback((next: LayoutIssue[]) => setIssues(next), []);
  const handlePageFill = useCallback((next: number[]) => setPageFill(next), []);

  useEffect(() => {
    void init();
  }, [init]);
  useEffect(() => {
    const handleHistoryShortcut = (event: KeyboardEvent) => {
      if (event.isComposing || event.altKey || (!event.metaKey && !event.ctrlKey)) return;
      if (event.target instanceof HTMLElement && event.target.closest('#resume-json')) return;
      const key = event.key.toLowerCase();
      const wantsUndo = key === 'z' && !event.shiftKey;
      const wantsRedo = (key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.metaKey);
      if (!wantsUndo && !wantsRedo) return;
      event.preventDefault();
      if (wantsUndo) undo();
      else redo();
    };
    document.addEventListener('keydown', handleHistoryShortcut);
    return () => document.removeEventListener('keydown', handleHistoryShortcut);
  }, [redo, undo]);
  // Scale the visible A4 pages to the pane width; the hidden measuring copy stays at real size.
  useEffect(() => {
    const pane = previewRef.current;
    if (!pane) return;
    const observer = new ResizeObserver(() =>
      pane.style.setProperty(
        '--preview-zoom',
        String(Math.min(1, Math.max(0.3, (pane.clientWidth - 8) / (A4_WIDTH_PX + 60)))),
      ),
    );
    observer.observe(pane);
    return () => observer.disconnect();
  }, [ready]);
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY);
    const update = () => {
      setNarrow(query.matches);
      if (query.matches && !viewPicked.current) {
        setView('preview');
        setEditHint(!readFlag(EDIT_HINT_KEY));
      }
    };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useDismiss(popoverRef, treePopover, () => setTreePopover(false));
  // Re-read which copies have a changed source whenever any resume gets a new revision.
  const revisionKey = workspace?.resumes.map((resume) => `${resume.id}:${resume.revision}`).join('|');
  useEffect(() => {
    if (mode !== 'workspace' || !revisionKey) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void loadSourceChanges()
        .then((next) => {
          if (!cancelled) setSourceChanges(next);
        })
        .catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, revisionKey, loadSourceChanges]);
  const activeId = workspace?.activeId;
  useEffect(() => {
    setPreviewTheme(undefined);
  }, [activeId]);
  const themeVersion = useThemeRegistry();
  const activeRecord = workspace?.resumes.find((resume) => resume.id === workspace.activeId) ?? workspace?.resumes[0];
  // The hover preview is a transient copy handed to the renderer; the stored resume is untouched.
  const shownRecord = useMemo(
    () =>
      activeRecord && previewTheme && previewTheme !== activeRecord.appearance.themeId && hasTheme(previewTheme)
        ? { ...activeRecord, appearance: appearanceForTheme(activeRecord.appearance, getTheme(previewTheme)) }
        : activeRecord,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- themeVersion changes when the theme registry does, which getTheme reads
    [activeRecord, previewTheme, themeVersion],
  );
  const realKey =
    privacy?.enabled && mode === 'workspace' && activeRecord
      ? `${activeRecord.id}\u0000${(activeRecord as ResumeDocument).revision}\u0000${JSON.stringify(privacy.values)}`
      : undefined;
  useEffect(() => {
    if (!realKey || !activeRecord) return;
    let cancelled = false;
    const { id, revision } = activeRecord as ResumeDocument;
    const timer = setTimeout(() => {
      void useStudioStore
        .getState()
        .inspectSaved(id, revision)
        .then((report) => {
          if (!cancelled) setRealPages({ key: realKey, pages: report.pageCount });
        })
        .catch(() => {
          if (!cancelled) setRealPages({ key: realKey });
        });
    }, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- realKey covers the resume id and revision read here
  }, [realKey]);

  if (ready && !workspace)
    return (
      <div className="loading" role="alert">
        工作区读取失败：{useStudioStore.getState().initError}。原始数据未被覆盖。
      </div>
    );
  if (!ready || !workspace) return <div className="loading">正在打开本地工作区…</div>;
  const record = activeRecord!;
  const theme = getTheme(record.appearance.themeId);
  const layout = record.appearance.layout;
  const storage = mode === 'workspace' ? '本地工作区' : '当前浏览器';

  const themeDefaults = (id = theme.id): LayoutSettings => ({
    ...getTheme(id).layoutDefaults,
    photoEnabled: layout.photoEnabled,
  });
  const applyThemeDefaults = (id = record.appearance.themeId) => {
    const next = getTheme(id);
    updateAppearance({
      themeId: id,
      density: 'balanced',
      preset: next.presets[0].id,
      settings: {},
      layout: themeDefaults(id),
    });
  };
  const applyPreset = (presetId: string) => {
    const preset = theme.presets.find((item) => item.id === presetId);
    if (!preset) return;
    const next: LayoutSettings = { ...layout, accentColor: preset.accentColor };
    if (preset.fontFamily) next.fontFamily = preset.fontFamily;
    updateAppearance({
      preset: preset.id,
      layout: next,
      ...(preset.settings ? { settings: { ...record.appearance.settings, ...preset.settings } } : {}),
    });
  };
  const changeSetting = (id: string, value: string | boolean) =>
    updateAppearance({ settings: { ...record.appearance.settings, [id]: value } });
  const applyTheme = (id: string) => {
    setPreviewTheme(undefined);
    if (id === record.appearance.themeId) return;
    const from = hasTheme(record.appearance.themeId) ? theme.name : record.appearance.themeId;
    setAppearance(appearanceForTheme(record.appearance, getTheme(id)));
    setThemeNotice({ resumeId: record.id, stamp: useStudioStore.getState().editStamp, from, to: getTheme(id).name });
  };
  const removeCustomCss = () => {
    const { css: _removed, ...appearance } = record.appearance;
    setAppearance(appearance);
  };
  const openThemePanel = () => {
    setThemePanel(true);
    if (narrow) {
      setView('preview');
      dismissEditHint();
    }
  };
  const closeThemePanel = () => {
    setThemePanel(false);
    setPreviewTheme(undefined);
  };
  const showThemeNotice =
    themeNotice && themeNotice.resumeId === record.id && themeNotice.stamp === editStamp && canUndo;
  const previewing = shownRecord !== record ? getTheme(previewTheme!) : undefined;
  const presetName = hasTheme(record.appearance.themeId)
    ? (matchingPreset(record.appearance, theme)?.name ?? '自定义')
    : undefined;
  const themeLabel = presetName ? `${theme.name} · ${presetName}` : `${record.appearance.themeId}（未安装）`;
  const changeFont = (fontFamily: string) => {
    const next: LayoutSettings = { ...layout };
    if (fontFamily) next.fontFamily = fontFamily;
    else delete next.fontFamily;
    updateAppearance({ layout: next });
  };
  const themePanelProps = {
    record,
    onPreview: setPreviewTheme,
    onApply: applyTheme,
    onPreset: applyPreset,
    onAccent: (accentColor: string) => updateLayout({ accentColor }),
    onFont: changeFont,
    onClose: closeThemePanel,
  };
  // A private name is a placeholder here; it stays out of the file name.
  const exportName = pdfFilename(record);
  const exportPdf = async () => {
    await useStudioStore.getState().flush();
    if (useStudioStore.getState().conflicts[record.id]) throw new Error('请先处理冲突');
    if (privacy?.enabled) {
      // The page only has placeholders: the Bridge lays out the saved revision with the real values and returns the PDF.
      const saved = useStudioStore.getState().workspace?.resumes.find((resume) => resume.id === record.id) as
        ResumeDocument | undefined;
      if (!saved) return;
      setExporting(true);
      try {
        downloadBlob(await useStudioStore.getState().exportSaved(saved.id, saved.revision), `${exportName}.pdf`);
      } finally {
        setExporting(false);
      }
      return;
    }
    await document.fonts.ready;
    const previous = document.title;
    document.title = exportName;
    window.print();
    document.title = previous;
  };
  const createVariant = (parentId: string | undefined, target: ResumeTarget) =>
    duplicateResume(
      parentId ?? record.id,
      [target.company, target.role].filter(Boolean).join(' · ') || undefined,
      target,
      parentId,
    );
  const toggleTree = () => {
    const next = treeOpen ? '0' : '1';
    setTreePref(next);
    writeSetting(TREE_KEY, next);
  };
  const path = pathTo(workspace.resumes, record.id);
  const tree = (onPick: (id: string) => void) => (
    <ResumeTree
      resumes={workspace.resumes}
      activeId={record.id}
      sourceChanges={sourceChanges}
      onSelect={onPick}
      onCreateVariant={(parentId, target) => {
        createVariant(parentId, target);
        setTreePopover(false);
      }}
    />
  );

  const change =
    lastChange && (lastChange.resumeId === record.id || lastChange.created || lastChange.deleted)
      ? lastChange
      : undefined;
  const otherChange = lastChange && !change ? lastChange : undefined;
  const otherChangeName = otherChange && workspace.resumes.find((resume) => resume.id === otherChange.resumeId)?.name;
  const canUndoAgent =
    !!change &&
    !change.created &&
    !change.deleted &&
    change.revision === (record as ResumeDocument).revision &&
    !conflicts[record.id];
  const lastFill = pageFill.length > 1 ? pageFill[pageFill.length - 1] : undefined;
  const sparseLastPage = lastFill !== undefined && lastFill < SPARSE_LAST_PAGE;
  // Same content hints an agent gets from validate, so people see them without asking. Warnings about
  // appearance.css are left to whoever wrote it.
  const contentHints = contentWarnings(record as ResumeDocument).map((hint) => hint.replace(/\s*\[[\w.[\]]+\]$/, ''));
  const dismissEditHint = () => {
    if (editHint) {
      setEditHint(false);
      writeFlag(EDIT_HINT_KEY);
    }
  };
  const saveText = !connected
    ? '连接已断开，草稿保留在浏览器'
    : saveState === 'saved'
      ? `已保存到本机 · r${record.revision}`
      : saveState === 'saving'
        ? '保存中…'
        : saveState === 'conflict'
          ? '版本冲突，草稿已保留'
          : '本地保存失败';

  return (
    <div className="app-shell" data-view={view}>
      <header className="topbar studio-chrome">
        <div className="brand" role="img" aria-label="CVSlate">
          <Wordmark accent={(shownRecord ?? record).appearance.layout.accentColor} />
        </div>
        {narrow ? (
          <div className="switcher" ref={popoverRef}>
            <button
              type="button"
              className="switcher-trigger"
              aria-label="当前简历"
              data-resume-id={record.id}
              aria-expanded={treePopover}
              onClick={() => setTreePopover(!treePopover)}
            >
              <span>{record.name}</span>
              <span aria-hidden className="switcher-chevron">
                ▾
              </span>
            </button>
            {treePopover && (
              <div className="switcher-panel" role="dialog" aria-label="简历">
                {tree((id) => {
                  selectResume(id);
                  setTreePopover(false);
                })}
              </div>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              className="tree-toggle"
              aria-label={treeOpen ? '收起简历树' : '显示简历树'}
              title={treeOpen ? '收起简历树' : '显示简历树'}
              aria-pressed={treeOpen}
              onClick={toggleTree}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <rect
                  x="1.75"
                  y="2.75"
                  width="12.5"
                  height="10.5"
                  rx="2"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path d="M6 3v10" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </button>
            <nav className="crumbs" aria-label="所在位置">
              {path.map((item, index) =>
                index === path.length - 1 ? (
                  <span key={item.id} className="crumbs-here" aria-label="当前简历" data-resume-id={item.id}>
                    {item.name}
                  </span>
                ) : (
                  <span key={item.id} className="crumbs-step">
                    <button type="button" onClick={() => selectResume(item.id)}>
                      {item.name}
                    </button>
                    <span className="crumbs-sep" aria-hidden>
                      /
                    </span>
                  </span>
                ),
              )}
            </nav>
          </>
        )}
        <div className="view-tabs" role="tablist" aria-label="视图">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'edit'}
            onClick={() => {
              viewPicked.current = true;
              setView('edit');
              dismissEditHint();
              closeThemePanel();
            }}
          >
            编辑
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'preview'}
            onClick={() => {
              viewPicked.current = true;
              setView('preview');
            }}
          >
            预览
          </button>
          {editHint && (
            <div className="edit-hint" role="note">
              <span>点“编辑”修改内容，随时切回“预览”看效果</span>
              <button type="button" aria-label="知道了" onClick={dismissEditHint}>
                知道了
              </button>
            </div>
          )}
        </div>
        {mode === 'workspace' && <ChangeHistory record={record as ResumeDocument} />}
        <button type="button" className="primary-button" disabled={exporting} onClick={() => runAction(exportPdf)}>
          {exporting ? '正在导出…' : '导出 PDF'}
        </button>
      </header>
      <div className="global-notices studio-chrome">
        {conflicts[record.id] && (
          <div role="alert" className="notice notice-warning">
            <span>其他入口已更新简历。本地输入已保留，请选择恢复方式。</span>
            <div className="notice-actions">
              <button type="button" onClick={() => runAction(useStudioStore.getState().saveDraftAsNew)}>
                草稿另存为新简历
              </button>
              <button type="button" onClick={() => runAction(useStudioStore.getState().discardDraft)}>
                放弃草稿，加载最新版
              </button>
            </div>
          </div>
        )}
        {(actionError || (storeError && !conflicts[record.id])) && (
          <div role="alert" className="notice notice-error">
            {actionError || storeError}
          </div>
        )}
        {change && (
          <div role="status" className="notice notice-agent">
            <span>{change.text}</span>
            <div className="notice-actions">
              {canUndoAgent && (
                <button
                  type="button"
                  onClick={() => {
                    dismissChange();
                    runAction(useStudioStore.getState().restorePrevious);
                  }}
                >
                  撤销这次修改
                </button>
              )}
              <button type="button" className="notice-close" aria-label="关闭提示" onClick={dismissChange}>
                ×
              </button>
            </div>
          </div>
        )}
        {sourceChanges[record.id] ? (
          <SourceNotice
            key={`${record.id}:${sourceChanges[record.id]}`}
            record={record as ResumeDocument}
            resumes={workspace.resumes}
            changes={sourceChanges[record.id]}
          />
        ) : null}
        {otherChange && (
          <div role="status" className="notice notice-agent">
            <span>Agent 更新了「{otherChangeName ?? '另一份简历'}」</span>
            <div className="notice-actions">
              {otherChangeName && (
                <button type="button" onClick={() => selectResume(otherChange.resumeId)}>
                  查看
                </button>
              )}
              <button type="button" className="notice-close" aria-label="关闭提示" onClick={dismissChange}>
                ×
              </button>
            </div>
          </div>
        )}
      </div>
      <div className={`workspace${!narrow && treeOpen ? ' with-tree' : ''}`}>
        {!narrow && treeOpen && (
          <nav className="tree-pane studio-chrome" aria-label="简历树">
            {tree(selectResume)}
          </nav>
        )}
        <aside className={`editor-pane studio-chrome${themePanel && !narrow ? ' editor-pane--themes' : ''}`}>
          {themePanel && !narrow && <ThemePanel {...themePanelProps} variant="pane" />}
          <div className="editor-body" hidden={themePanel && !narrow}>
            <div className="document-actions">
              <div className="button-group">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="撤销"
                  title="撤销 (Command/Ctrl + Z)"
                  disabled={!canUndo}
                  onClick={undo}
                >
                  <UndoIcon />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="重做"
                  title="重做 (Command/Ctrl + Shift + Z)"
                  disabled={!canRedo}
                  onClick={redo}
                >
                  <UndoIcon redo />
                </button>
              </div>
              <div className="button-group">
                <button
                  type="button"
                  onClick={() => {
                    const name = window.prompt('新简历名称', '未命名简历');
                    if (name !== null) createResume(name.trim() || undefined);
                  }}
                >
                  新建
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const name = window.prompt('复制为新简历', `${record.name} 副本`);
                    if (name !== null) duplicateResume(undefined, name.trim() || undefined);
                  }}
                >
                  复制简历
                </button>
                <MoreMenu>
                  {(close) => (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close();
                          const name = window.prompt('重命名简历', record.name);
                          if (name?.trim()) renameResume(name);
                        }}
                      >
                        重命名…
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          close();
                          runAction(useStudioStore.getState().restorePrevious);
                        }}
                      >
                        恢复上一版本
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="danger-link"
                        disabled={workspace.resumes.length <= 1}
                        onClick={() => {
                          close();
                          if (window.confirm(`删除“${record.name}”？此操作会从${storage}中移除该简历。`))
                            deleteResume();
                        }}
                      >
                        删除简历
                      </button>
                    </>
                  )}
                </MoreMenu>
              </div>
              <span
                className={`save-state save-${saveState}`}
                title={mode === 'workspace' ? '保存在本机 SQLite 工作区' : '保存在本浏览器'}
              >
                {saveText}
              </span>
            </div>
            <DocumentPanel
              key={record.id}
              record={record as ResumeDocument}
              resumes={workspace.resumes}
              onTarget={updateTarget}
              onMeta={updateMeta}
            />
            <Editor data={record.data} onOpenPrivacy={() => setPrivacyDialog('vault')} />
            <BackupPanel record={record} />
          </div>
        </aside>
        <main className={`preview-pane${themePanel && narrow ? ' preview-pane--sheet' : ''}`} ref={previewRef}>
          <div className="preview-toolbar studio-chrome">
            <div className="preview-controls">
              <div className="compact-control">
                <span>主题</span>
                <button
                  type="button"
                  className="theme-trigger"
                  aria-label={`主题：${themeLabel}`}
                  aria-expanded={themePanel}
                  data-theme-id={record.appearance.themeId}
                  title={theme.description}
                  onClick={() => (themePanel ? closeThemePanel() : openThemePanel())}
                >
                  <i style={{ background: layout.accentColor }} />
                  <span>{themeLabel}</span>
                </button>
              </div>
              <label className="compact-control">
                <span>密度</span>
                <select
                  aria-label="密度"
                  value={record.appearance.density}
                  onChange={(event) =>
                    setDensity(
                      event.target.value as keyof typeof densityNames,
                      getTheme(record.appearance.themeId).layoutDefaults,
                    )
                  }
                >
                  {Object.entries(densityNames).map(([value, name]) => (
                    <option key={value} value={value}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <Popover label="页面与排版" className="layout-popover">
                <div className="settings-grid">
                  <button
                    type="button"
                    className="settings-reset settings-wide"
                    onClick={(event) => {
                      event.currentTarget.closest('details')!.open = false;
                      openThemePanel();
                    }}
                  >
                    配色和字体在「主题」里调整
                  </button>
                  {theme.settings.map((setting) =>
                    setting.type === 'toggle' ? (
                      <label key={setting.id} className="toggle">
                        <input
                          type="checkbox"
                          checked={(record.appearance.settings?.[setting.id] ?? setting.default) === true}
                          onChange={(event) => changeSetting(setting.id, event.target.checked)}
                        />
                        <span>{setting.label}</span>
                      </label>
                    ) : (
                      <label key={setting.id}>
                        <span>{setting.label}</span>
                        <select
                          aria-label={setting.label}
                          value={String(record.appearance.settings?.[setting.id] ?? setting.default)}
                          onChange={(event) => changeSetting(setting.id, event.target.value)}
                        >
                          {setting.options!.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ),
                  )}
                  <div className="settings-steps">
                    <span>整体疏密</span>
                    <button type="button" onClick={() => updateLayout(stepLayout(layout, -1))}>
                      紧凑一档
                    </button>
                    <button type="button" onClick={() => updateLayout(stepLayout(layout, 1))}>
                      宽松一档
                    </button>
                  </div>
                  <label>
                    <span>页边距 {layout.pageMarginMm} mm</span>
                    <input
                      type="range"
                      min={layoutRanges.pageMarginMm.min}
                      max={layoutRanges.pageMarginMm.max}
                      step="1"
                      value={layout.pageMarginMm}
                      onChange={(event) => updateLayout({ pageMarginMm: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span>正文字号 {layout.baseFontPt} pt</span>
                    <input
                      type="range"
                      min={layoutRanges.baseFontPt.min}
                      max={layoutRanges.baseFontPt.max}
                      step="0.1"
                      value={layout.baseFontPt}
                      onChange={(event) => updateLayout({ baseFontPt: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span>行高 {layout.lineHeight}</span>
                    <input
                      type="range"
                      min={layoutRanges.lineHeight.min}
                      max={layoutRanges.lineHeight.max}
                      step="0.02"
                      value={layout.lineHeight}
                      onChange={(event) => updateLayout({ lineHeight: Number(event.target.value) })}
                    />
                  </label>
                  <label>
                    <span>栏目间距 {layout.sectionSpacingPt} pt</span>
                    <input
                      type="range"
                      min={layoutRanges.sectionSpacingPt.min}
                      max={layoutRanges.sectionSpacingPt.max}
                      step="1"
                      value={layout.sectionSpacingPt}
                      onChange={(event) => updateLayout({ sectionSpacingPt: Number(event.target.value) })}
                    />
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={layout.photoEnabled}
                      disabled={!record.data.basics.photo}
                      onChange={(event) => updateLayout({ photoEnabled: event.target.checked })}
                    />
                    <span>显示照片</span>
                  </label>
                  <button type="button" className="settings-reset" onClick={() => applyThemeDefaults()}>
                    恢复主题推荐排版
                  </button>
                  {record.appearance.css && <CustomCssNote onRemove={removeCustomCss} />}
                </div>
              </Popover>
              {mode === 'workspace' && privacy && (
                <button
                  type="button"
                  className={`privacy-toggle${privacy.enabled ? ' is-on' : ''}`}
                  aria-label={privacy.enabled ? '隐私模式已开启，打开隐私信息' : '开启隐私模式'}
                  title={privacy.enabled ? '隐私模式已开启' : '让 agent 只看到占位'}
                  onClick={() => setPrivacyDialog(privacy.enabled ? 'vault' : 'enable')}
                >
                  <LockIcon />
                  <span>隐私模式</span>
                </button>
              )}
            </div>
            <div className="preview-status">
              {pageFill.length > 0 && (
                <span className="page-meter" title="每页内容占可用高度的比例">
                  {pageFill.map((fill, index) => (
                    <span
                      key={index}
                      className={`page-meter__page${index === pageFill.length - 1 && sparseLastPage ? ' is-sparse' : ''}`}
                    >
                      第 {index + 1} 页 {Math.round(fill * 100)}%
                    </span>
                  ))}
                </span>
              )}
              {contentHints.length > 0 && (
                <Popover label={`${contentHints.length} 条内容提示`} className="content-hints">
                  <p>不影响保存和导出，按需修改。</p>
                  <ul>
                    {contentHints.map((hint) => (
                      <li key={hint}>{hint}</li>
                    ))}
                  </ul>
                </Popover>
              )}
              <span className={issues.length ? 'qa-warning' : 'qa-ok'}>
                {issues.length ? `${issues.length} 个排版问题` : '排版检查通过'}
              </span>
            </div>
          </div>
          <div className="preview-float studio-chrome" aria-live="polite">
            {previewing && (
              <div className="float-note">
                正在预览「{previewing.name}」<span>点击应用 · 移开恢复</span>
              </div>
            )}
            {!previewing && showThemeNotice && (
              <div className="float-note">
                已换成「{themeNotice.to}」<span>原来是「{themeNotice.from}」</span>
                <button
                  type="button"
                  aria-label="撤销换主题"
                  onClick={() => {
                    setThemeNotice(undefined);
                    undo();
                  }}
                >
                  撤销
                </button>
                <button
                  type="button"
                  className="float-note__close"
                  aria-label="关闭换主题提示"
                  onClick={() => setThemeNotice(undefined)}
                >
                  ×
                </button>
              </div>
            )}
          </div>
          {issues.length > 0 && (
            <div className="notice notice-warning studio-chrome">
              {issues.map((issue, index) => (
                <span key={`${issue.code}-${index}`}>{issue.message}</span>
              ))}
            </div>
          )}
          {sparseLastPage && (
            <div className="notice notice-info studio-chrome">
              <span>
                第 {pageFill.length} 页只用了 {Math.round(lastFill! * 100)}%。可以收紧排版压到 {pageFill.length - 1}{' '}
                页，或放宽排版让页面更饱满。
              </span>
              <div className="notice-actions">
                <button type="button" onClick={() => updateLayout(stepLayout(layout, -1))}>
                  紧凑一档
                </button>
                <button type="button" onClick={() => updateLayout(stepLayout(layout, 1))}>
                  宽松一档
                </button>
              </div>
            </div>
          )}
          {realKey && realPages?.key === realKey && saveState === 'saved' && realPages.pages === undefined && (
            <div className="notice notice-info studio-chrome" role="status">
              <span>暂时无法按真实信息检查分页，导出的页数可能和预览不同。</span>
            </div>
          )}
          {realKey &&
            realPages?.key === realKey &&
            saveState === 'saved' &&
            realPages.pages !== undefined &&
            pageFill.length > 0 &&
            realPages.pages !== pageFill.length && (
              <div className="notice notice-info studio-chrome" role="status" data-real-pages={realPages.pages}>
                <span>
                  导出按真实信息排是 {realPages.pages} 页，和预览的 {pageFill.length} 页不同。
                </span>
              </div>
            )}
          <ResumePreview
            record={shownRecord!}
            privacy={privacyLabels}
            onIssues={handleIssues}
            onPageFill={handlePageFill}
          />
          {themePanel && narrow && <ThemePanel {...themePanelProps} variant="sheet" />}
        </main>
      </div>
      <PrivacyDialog entry={privacyDialog} onClose={() => setPrivacyDialog(undefined)} />
      {mode === 'workspace' && <ExportApprovalDialog />}
    </div>
  );
}

export default App;

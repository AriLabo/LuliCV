import { useRef, useState } from 'react';
import { validateAppearance } from '../core/document';
import { downloadJson, readJsonFile, safeFilename } from './files';
import { useStudioStore } from './store';
import type { Appearance, ResumeData, ResumeRecord } from './types';
import { isResumeRecord, validateResumeData } from './validation';

/** Picking a LuliCV JSON file and adding every resume in it as a new one: `input` goes in the page, `open` picks. */
export function useBackupFile() {
  const restore = useStudioStore((state) => state.restore);
  const fileRef = useRef<HTMLInputElement>(null);
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const value = await readJsonFile(file);
      if (!restore(value)) window.alert('无法识别此 JSON。请选择履栗导出的简历 JSON。');
    } catch {
      window.alert('JSON 文件读取失败。');
    }
  };
  const input = (
    <input
      ref={fileRef}
      hidden
      type="file"
      accept="application/json,.json"
      onChange={(event) => {
        void importFile(event.target.files?.[0]);
        event.target.value = '';
      }}
    />
  );
  return { open: () => fileRef.current?.click(), input };
}

// Export, file import and pasted JSON for the active resume, at the foot of the editor.
export function BackupPanel({ record }: { record: ResumeRecord }) {
  const workspace = useStudioStore((state) => state.workspace);
  const mode = useStudioStore((state) => state.mode);
  const importResumeData = useStudioStore((state) => state.importResumeData);
  const backupFile = useBackupFile();
  const [jsonDraft, setJsonDraft] = useState('');
  const [jsonStatus, setJsonStatus] = useState<{ kind: 'success' | 'error'; message: string }>();

  const parseResumeJson = ():
    { data: ResumeData; appearance?: Appearance; name?: string; complete: boolean } | undefined => {
    let value: unknown;
    try {
      value = JSON.parse(jsonDraft);
    } catch (error) {
      setJsonStatus({
        kind: 'error',
        message: `JSON 语法错误：${error instanceof Error ? error.message : '无法解析'}`,
      });
      return undefined;
    }
    if (isResumeRecord(value)) {
      const errors = validateAppearance(value.appearance);
      if (errors.length) {
        setJsonStatus({ kind: 'error', message: errors.join('\n') });
        return undefined;
      }
      setJsonStatus({ kind: 'success', message: '校验通过：完整简历格式，包含主题与排版设置。' });
      return { data: value.data, appearance: value.appearance, name: value.name, complete: true };
    }
    const errors = validateResumeData(value);
    if (errors.length) {
      const remaining = errors.length > 6 ? `\n另有 ${errors.length - 6} 个问题` : '';
      setJsonStatus({ kind: 'error', message: `${errors.slice(0, 6).join('\n')}${remaining}` });
      return undefined;
    }
    setJsonStatus({ kind: 'success', message: '校验通过：ResumeData v1，可以导入。' });
    return { data: value as ResumeData, complete: false };
  };

  const importPastedJson = (mode: 'replace-current' | 'new') => {
    const parsed = parseResumeJson();
    if (!parsed) return;
    const scope = parsed.complete ? '内容、主题和排版设置' : '内容（主题和排版设置会保留）';
    if (mode === 'replace-current' && !window.confirm(`用此 JSON 覆盖当前简历的${scope}？`)) return;
    importResumeData(parsed.data, mode, { appearance: parsed.appearance, name: parsed.name });
    setJsonStatus({
      kind: 'success',
      message:
        mode === 'replace-current'
          ? parsed.complete
            ? '已覆盖当前简历的内容、主题与排版设置。'
            : '已覆盖当前简历内容，主题与排版设置已保留。'
          : parsed.complete
            ? '已导入为新简历，并恢复主题与排版设置。'
            : '已导入为新简历，并沿用当前主题。',
    });
  };

  return (
    <details className="tool-panel tool-panel--footer">
      <summary>导出、导入与粘贴 JSON</summary>
      <div className="backup-panel">
        <div className="tool-panel-grid">
          <button type="button" onClick={() => downloadJson(record.data, `${safeFilename(record.name)}-内容.json`)}>
            导出纯内容 JSON
          </button>
          <button type="button" onClick={() => downloadJson(record, `${safeFilename(record.name)}-含样式.json`)}>
            导出当前（含样式）
          </button>
          <button
            type="button"
            onClick={() => downloadJson(workspace, `lulicv-all-${new Date().toISOString().slice(0, 10)}.json`)}
          >
            导出全部 JSON
          </button>
          <button type="button" onClick={backupFile.open}>
            从文件导入（作为新简历）
          </button>
          {backupFile.input}
        </div>
        <p className="backup-note">
          导入时文件里的每份简历都会加成新简历，不覆盖现有简历；修订记录和母版、投递版之间的关系不会带过来。
          {mode === 'workspace' ? (
            <>
              {' '}
              需要完整备份时，让 Agent 运行 <code>lulicv backup</code>。
            </>
          ) : null}
        </p>
        <div className="json-import">
          <label htmlFor="resume-json">
            <strong>粘贴 Resume JSON</strong>
            <span>支持纯内容 ResumeData v1，也支持包含模板与排版的完整简历；仅在本机解析。</span>
          </label>
          <textarea
            id="resume-json"
            rows={10}
            spellCheck={false}
            value={jsonDraft}
            placeholder={'{\n  "schemaVersion": 1,\n  "basics": { ... },\n  "sections": [ ... ]\n}'}
            onChange={(event) => {
              setJsonDraft(event.target.value);
              setJsonStatus(undefined);
            }}
          />
          <div className="json-import-actions">
            <button type="button" disabled={!jsonDraft.trim()} onClick={parseResumeJson}>
              校验 JSON
            </button>
            <button type="button" disabled={!jsonDraft.trim()} onClick={() => importPastedJson('replace-current')}>
              覆盖当前简历
            </button>
            <button type="button" disabled={!jsonDraft.trim()} onClick={() => importPastedJson('new')}>
              导入为新简历
            </button>
            <button
              type="button"
              disabled={!jsonDraft}
              onClick={() => {
                setJsonDraft('');
                setJsonStatus(undefined);
              }}
            >
              清空
            </button>
          </div>
          {jsonStatus && (
            <pre role="status" className={`json-status json-${jsonStatus.kind}`}>
              {jsonStatus.message}
            </pre>
          )}
        </div>
      </div>
    </details>
  );
}

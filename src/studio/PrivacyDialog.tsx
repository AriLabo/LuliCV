import { useEffect, useRef, useState } from 'react';
import { LINK_LIMITS } from '../core/limits';
import {
  privateFieldOptions,
  type ExportLogEntry,
  type ExportOutcome,
  type PrivacyChoices,
  type PrivacySettings,
  type PrivateField,
} from '../core/privacy';
import { privateNames, toDisplay, type PrivacyPlanSummary, type PrivateValueInfo } from './privacy';
import { errorMessage } from '../core/errors';
import { InfoTip } from './InfoTip';
import { useStudioStore } from './store';

/*
 * 隐私信息: which fields privacy mode keeps out of the resumes, and their values. Values are write-only here: the page
 * learns only whether one is filled and how long it is, and 重新填写 starts from an empty input. What the user types is
 * drawn as dots until they click 显示, so a screenshot taken meanwhile shows nothing. A CSS mask rather than
 * type="password", which would make password managers offer to save the value.
 */

export type PrivacyDialogEntry = 'vault' | 'enable';
type View =
  | { kind: 'vault' }
  | { kind: 'log'; entries: ExportLogEntry[] }
  | { kind: 'fields' }
  | { kind: 'plan'; next: PrivacySettings; summary: PrivacyPlanSummary }
  | { kind: 'disable'; summary: PrivacyPlanSummary };

const HOW = '选中的信息只存一份，简历里换成占位。网页、预览和 agent 只看到占位，导出 PDF 时才填入。';
const SCOPE =
  '隐私模式仅约束通过履栗读取简历的程序。具备本机命令执行权限的程序仍可直接读取数据文件，如需更强隔离，请为 agent 启用沙箱。可操作此浏览器的 agent 也能点击本页按钮。工作单位、学校与任职时间等信息组合后，仍可能识别个人身份。';
const OUTCOMES: Record<ExportOutcome, string> = {
  approved: 'agent 请求，你批准了',
  declined: 'agent 请求，你拒绝了',
  expired: 'agent 请求，5 分钟内没处理',
  web: '你在网页导出',
};
const when = (at: number) => {
  const date = new Date(at);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function filledText(info?: PrivateValueInfo, photo = false) {
  if (!info?.filled) return photo ? '未上传' : '未填写';
  if (info.length === undefined || !info.shape) return '已上传';
  const unit = info.shape.digit === info.length ? '位' : info.shape.han === info.length ? '个字' : '个字符';
  return `已填写 · ${info.length} ${unit}`;
}

/** One stored value: its state, and an empty input to replace it. */
function ValueRow({
  name,
  valueKey,
  info,
  photo = false,
  onError,
}: {
  name: string;
  valueKey: string;
  info?: PrivateValueInfo;
  photo?: boolean;
  onError: (text?: string) => void;
}) {
  const setPrivateValue = useStudioStore((state) => state.setPrivateValue);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async (value: string) => {
    setBusy(true);
    onError(undefined);
    try {
      await setPrivateValue(valueKey, value);
      setEditing(false);
      setText('');
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const pickPhoto = (file?: File) => {
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) {
      onError('请选择 JPEG、PNG 或 WebP 图片。');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      onError('图片超过 2MB，请先压缩后再选择。');
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => onError('图片读取失败，请换一张图片重试。');
    reader.onload = () => {
      if (typeof reader.result === 'string') void save(reader.result);
    };
    reader.readAsDataURL(file);
  };
  const filled = !!info?.filled;
  if (photo)
    return (
      <div className="privacy-value" data-private-value={valueKey}>
        <span className={filled ? 'privacy-value__state' : 'privacy-value__state is-empty'}>
          {filledText(info, true)}
        </span>
        <label className="privacy-value__action">
          {filled ? '更换' : '上传'}
          <input
            aria-label={`上传${name}`}
            hidden
            type="file"
            accept={PHOTO_TYPES.join(',')}
            disabled={busy}
            onChange={(event) => {
              pickPhoto(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
      </div>
    );
  if (editing)
    return (
      <form
        className="privacy-value privacy-value--editing"
        data-private-value={valueKey}
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) void save(text);
        }}
      >
        <span className="privacy-value__field">
          <input
            aria-label={`填写${name}`}
            className={shown ? undefined : 'is-masked'}
            value={text}
            maxLength={valueKey.startsWith('link:') ? LINK_LIMITS.url : undefined}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setEditing(false);
                setText('');
              }
            }}
          />
          {/* Keeps the caret in the input while toggling. */}
          <button
            type="button"
            className="privacy-value__reveal"
            aria-pressed={shown}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setShown(!shown)}
          >
            {shown ? '隐藏' : '显示'}
          </button>
        </span>
        <button type="submit" className="primary-button" disabled={busy || !text.trim()}>
          保存
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setText('');
          }}
        >
          取消
        </button>
        <span className="privacy-value__hint">输入内容默认遮住，截图看不到；可操作此浏览器的 agent 仍可能读到。</span>
      </form>
    );
  return (
    <div className="privacy-value" data-private-value={valueKey}>
      <span className={filled ? 'privacy-value__state' : 'privacy-value__state is-empty'}>{filledText(info)}</span>
      <button
        type="button"
        className="privacy-value__action"
        aria-label={`${filled ? '重新填写' : '填写'}${name}`}
        onClick={() => {
          onError(undefined);
          setShown(false);
          setEditing(true);
        }}
      >
        {filled ? '重新填写' : '填写'}
      </button>
    </div>
  );
}

function PlanView({
  summary,
  next,
  enabling,
  onBack,
  onConfirm,
}: {
  summary: PrivacyPlanSummary;
  next: PrivacySettings;
  enabling: boolean;
  onBack: () => void;
  onConfirm: (choices: PrivacyChoices) => Promise<void>;
}) {
  const planPrivacy = useStudioStore((state) => state.planPrivacy);
  const [choices, setChoices] = useState<PrivacyChoices>({});
  const [busy, setBusy] = useState(false);
  const unresolved = summary.conflicts.filter((conflict) => choices[conflict.field] === undefined);
  // What moves is only known once every differing value is settled; ask again with the choices.
  const [settled, setSettled] = useState<PrivacyPlanSummary>();
  useEffect(() => {
    setSettled(undefined);
    if (!summary.conflicts.length || unresolved.length) return;
    let cancelled = false;
    void planPrivacy(next, choices)
      .then((result) => {
        if (!cancelled) setSettled(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the plan is asked again only when the person changes a choice
  }, [choices]);
  const moved = (settled ?? summary).moved;
  const nothing = !moved.length && !summary.restored.length && !summary.conflicts.length;
  return (
    <>
      <div className="privacy-dialog__body">
        {nothing && (
          <p className="privacy-plan__none">
            {enabling ? '简历里还没有这些信息，开启后在「隐私信息」里填写即可。' : '简历内容不需要改动。'}
          </p>
        )}
        {moved.length > 0 && (
          <section className="privacy-plan">
            <h3>换成占位</h3>
            <ul>
              {moved.map((item) => (
                <li key={item.field}>
                  <strong>{item.label}</strong>
                  <span>
                    {item.resumes
                      ? `${item.resumes} 份简历${item.places > item.resumes ? `，正文里 ${item.places - item.resumes} 处` : ''}`
                      : '简历里没有，稍后填写'}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {summary.restored.length > 0 && (
          <section className="privacy-plan">
            <h3>写回简历</h3>
            <ul>
              {summary.restored.map((item) => (
                <li key={item.field}>
                  <strong>{item.label}</strong>
                  <span>{item.resumes} 份简历</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {summary.conflicts.map((conflict) => (
          <fieldset key={conflict.field} className="privacy-plan privacy-conflict">
            <legend>{conflict.label}在几份简历里不一样，导出时统一用哪个？</legend>
            {conflict.options.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name={`conflict-${conflict.field}`}
                  checked={choices[conflict.field] === option.value}
                  onChange={() => setChoices({ ...choices, [conflict.field]: option.value })}
                />
                <span className="privacy-conflict__value">{conflict.field === 'photo' ? '照片' : option.value}</span>
                <span className="privacy-conflict__count">{option.resumes} 份简历</span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      <footer className="privacy-dialog__footer">
        <button type="button" onClick={onBack} disabled={busy}>
          {enabling ? '改选要隐藏的信息' : '取消'}
        </button>
        <span className="privacy-dialog__spacer" />
        <button
          type="button"
          className="primary-button"
          disabled={busy || unresolved.length > 0}
          title={unresolved.length ? '先为每项选一个值' : undefined}
          onClick={() => {
            setBusy(true);
            void onConfirm(choices).finally(() => setBusy(false));
          }}
        >
          {enabling ? '开启隐私模式' : '确定'}
        </button>
      </footer>
    </>
  );
}

export function PrivacyDialog({ entry, onClose }: { entry?: PrivacyDialogEntry; onClose: () => void }) {
  const privacy = useStudioStore((state) => state.privacy);
  const planPrivacy = useStudioStore((state) => state.planPrivacy);
  const changePrivacy = useStudioStore((state) => state.changePrivacy);
  const loadExportLog = useStudioStore((state) => state.loadExportLog);
  const ref = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<View>({ kind: 'vault' });
  const [selected, setSelected] = useState<PrivateField[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const enabled = !!privacy?.enabled;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!entry) {
      if (dialog.open) dialog.close();
      return;
    }
    setError(undefined);
    setSelected(
      privacy?.enabled
        ? [...privacy.fields]
        : privateFieldOptions.filter((option) => option.byDefault).map((option) => option.id),
    );
    setView(entry === 'enable' && !privacy?.enabled ? { kind: 'fields' } : { kind: 'vault' });
    if (!dialog.open) dialog.showModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the selection resets when the dialog opens, not on every privacy update
  }, [entry]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await task();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const review = (next: PrivacySettings) =>
    run(async () => setView({ kind: 'plan', next, summary: await planPrivacy(next) }));
  const order = (fields: PrivateField[]) =>
    privateFieldOptions.map((option) => option.id).filter((id) => fields.includes(id));
  const toggle = (field: PrivateField, on: boolean) =>
    order(on ? [...selected, field] : selected.filter((item) => item !== field));
  const apply = async (next: PrivacySettings, choices: PrivacyChoices) => {
    setError(undefined);
    try {
      await changePrivacy(next, choices);
      setSelected(next.fields);
      setView({ kind: 'vault' });
      if (!next.enabled) onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const title =
    view.kind === 'log'
      ? '导出记录'
      : view.kind === 'disable'
        ? '关闭隐私模式'
        : view.kind === 'plan'
          ? enabled
            ? '确认改动'
            : '开启隐私模式'
          : view.kind === 'fields'
            ? '开启隐私模式'
            : '隐私信息';
  let content;
  if (view.kind === 'fields')
    content = (
      <>
        <div className="privacy-dialog__body">
          <p className="privacy-dialog__lead">选中的信息在简历里换成占位，导出 PDF 时才填入。</p>
          <fieldset className="privacy-fields">
            <legend>要隐藏的信息</legend>
            {privateFieldOptions.map((option) => (
              <label key={option.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(option.id)}
                  onChange={(event) => setSelected(toggle(option.id, event.target.checked))}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
        </div>
        <footer className="privacy-dialog__footer">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <span className="privacy-dialog__spacer" />
          <button
            type="button"
            className="primary-button"
            disabled={busy || !selected.length}
            onClick={() => void review({ enabled: true, fields: selected })}
          >
            下一步
          </button>
        </footer>
      </>
    );
  else if (view.kind === 'plan')
    content = (
      <PlanView
        summary={view.summary}
        next={view.next}
        enabling={!enabled}
        onBack={() => setView(enabled ? { kind: 'vault' } : { kind: 'fields' })}
        onConfirm={(choices) => apply(view.next, choices)}
      />
    );
  else if (view.kind === 'log') {
    const names = privateNames(privacy);
    content = (
      <>
        <div className="privacy-dialog__body">
          {view.entries.length ? (
            <table className="export-log">
              <thead>
                <tr>
                  <th scope="col">时间</th>
                  <th scope="col">简历</th>
                  <th scope="col">经过</th>
                </tr>
              </thead>
              <tbody>
                {view.entries.map((entry, index) => (
                  <tr key={index} className={entry.outcome === 'expired' ? 'is-muted' : undefined}>
                    <td className="export-log__time">{when(entry.at)}</td>
                    <td>
                      {toDisplay(entry.name, names)}
                      <span className="export-log__meta">
                        {' '}
                        · 第 {entry.revision} 版{entry.pages ? ` · ${entry.pages} 页` : ''}
                      </span>
                    </td>
                    <td>{OUTCOMES[entry.outcome]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="privacy-plan__none">还没有导出记录。隐私模式下每次导出 PDF，都会记在这里。</p>
          )}
        </div>
        <footer className="privacy-dialog__footer">
          <button type="button" onClick={() => setView({ kind: 'vault' })}>
            返回
          </button>
          <span className="privacy-dialog__spacer" />
          <button type="button" className="primary-button" onClick={onClose}>
            完成
          </button>
        </footer>
      </>
    );
  } else if (view.kind === 'disable')
    content = (
      <>
        <div className="privacy-dialog__body">
          <p className="privacy-dialog__lead">
            隐私信息写回简历，预览和 agent 都会看到真实内容。已填写的值仍留在本机。
          </p>
          {view.summary.restored.some((item) => item.resumes > 0) && (
            <ul className="privacy-plan privacy-plan--plain">
              {view.summary.restored
                .filter((item) => item.resumes > 0)
                .map((item) => (
                  <li key={item.field}>
                    <strong>{item.label}</strong>
                    <span>{item.resumes} 份简历</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
        <footer className="privacy-dialog__footer">
          <button type="button" onClick={() => setView({ kind: 'vault' })} disabled={busy}>
            返回
          </button>
          <span className="privacy-dialog__spacer" />
          <button
            type="button"
            className="danger-button"
            disabled={busy}
            onClick={() => void run(() => apply({ enabled: false, fields: privacy!.fields }, {}))}
          >
            关闭隐私模式
          </button>
        </footer>
      </>
    );
  else
    content = (
      <>
        <div className="privacy-dialog__body">
          <table className="privacy-vault">
            <tbody>
              {privateFieldOptions.map((option) => {
                const on = enabled && privacy!.fields.includes(option.id);
                const links = option.id === 'links' && on ? privacy!.values.links : [];
                return [
                  <tr key={option.id} className={on ? undefined : 'is-off'} data-private-row={option.id}>
                    <th scope="row">
                      <label>
                        <input
                          type="checkbox"
                          checked={on}
                          disabled={busy || (on && privacy!.fields.length === 1)}
                          title={
                            on && privacy!.fields.length === 1 ? '至少隐藏一项；不再需要可关闭隐私模式' : undefined
                          }
                          onChange={(event) =>
                            void review({ enabled: true, fields: toggle(option.id, event.target.checked) })
                          }
                        />
                        <span>{option.label}</span>
                      </label>
                    </th>
                    <td>
                      {!on ? (
                        <span className="privacy-value__off">不隐藏</span>
                      ) : option.id === 'links' ? (
                        <span className="privacy-value__off">
                          {links.length ? `${links.length} 个链接` : '添加链接后出现在这里'}
                        </span>
                      ) : (
                        <ValueRow
                          name={option.label}
                          valueKey={option.id}
                          info={privacy!.values.fields[option.id]}
                          photo={option.id === 'photo'}
                          onError={setError}
                        />
                      )}
                    </td>
                  </tr>,
                  ...links.map((link) => (
                    <tr key={link.key} className="privacy-vault__sub">
                      <th scope="row">
                        <span>{link.label || '未命名链接'}</span>
                      </th>
                      <td>
                        <ValueRow name={`链接${link.label}`} valueKey={link.key} info={link} onError={setError} />
                      </td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
        <footer className="privacy-dialog__footer">
          <button
            type="button"
            className="danger-link"
            disabled={busy}
            onClick={() =>
              void run(async () =>
                setView({ kind: 'disable', summary: await planPrivacy({ enabled: false, fields: privacy!.fields }) }),
              )
            }
          >
            关闭隐私模式…
          </button>
          <span className="privacy-dialog__spacer" />
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(async () => setView({ kind: 'log', entries: await loadExportLog() }))}
          >
            导出记录
          </button>
          <button type="button" className="primary-button" onClick={onClose}>
            完成
          </button>
        </footer>
      </>
    );

  return (
    <dialog
      ref={ref}
      className="privacy-dialog"
      aria-labelledby="privacy-dialog-title"
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <header className="privacy-dialog__head">
        <div className="privacy-dialog__title">
          <h2 id="privacy-dialog-title">{title}</h2>
          {(view.kind === 'vault' || view.kind === 'fields') && (
            <InfoTip label="关于隐私模式">
              <span>{HOW}</span>
              {view.kind === 'vault' && <span>已保存的信息不再显示，可在导出的 PDF 里核对。</span>}
              <span>
                <strong>保护范围</strong>
                {SCOPE}
              </span>
            </InfoTip>
          )}
          {view.kind === 'log' && (
            <InfoTip label="关于导出记录">
              <span>只记录导出的时间、简历和版本，以及是谁导出的，不保存 PDF。</span>
              <span>保留最近 50 条，只存在本机。</span>
            </InfoTip>
          )}
        </div>
        <button type="button" className="privacy-dialog__close" aria-label="关闭" onClick={onClose}>
          ×
        </button>
      </header>
      {error && (
        <div role="alert" className="notice notice-error privacy-dialog__error">
          {error}
        </div>
      )}
      {entry && content}
    </dialog>
  );
}

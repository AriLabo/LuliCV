import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createId } from './ids';
import { toggleBold } from './inline-format';
import { useStudioStore } from './store';
import { fromDisplay, LockIcon, privateNames, sealedSite, toDisplay, type PrivacyState } from './privacy';
import { useDetailsDismiss } from './dismiss';
import { LINK_LIMITS } from '../core/limits';
import {
  LINK_ICON_OPTIONS,
  LINK_PRESETS,
  LINK_SHOW_OPTIONS,
  LONG_LINK_ADDRESS,
  linkIcon,
  linkIconLabel,
  linkParts,
  linkPlatform,
  shortUrl,
  sitePlatform,
} from '../core/links';
import { DETAIL_FIELDS, DETAIL_MAX_LENGTH, type DetailField } from '../core/details';
import { tokenFor, type PrivateField } from '../core/privacy';
import type {
  EducationEntry,
  ExperienceEntry,
  LinkIcon,
  LinkItem,
  LinkPlatform,
  LinkShow,
  ProjectEntry,
  ResumeData,
  ResumeEntry,
  ResumeSection,
  SectionType,
  SkillEntry,
} from './types';

const PRIVACY_NOTE_KEY = 'lulicv:privacy-note-dismissed';

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/** Privacy mode as the editor needs it: which fields are private, their placeholder names, and the way to the vault. */
const EditorPrivacy = createContext<{ privacy?: PrivacyState; names: Map<string, string>; onOpen: () => void }>({
  names: new Map(),
  onOpen: () => {},
});

/**
 * A basic field kept in the vault. It is never typed here: each keystroke would be stored as a new value. The resume
 * holds the placeholder or nothing, and the value itself is filled in from 隐私信息.
 */
function PrivateBasicField({
  label,
  field,
  value,
  onChange,
}: {
  label: string;
  field: PrivateField;
  value: string;
  onChange: (value: string) => void;
}) {
  const { privacy, onOpen } = useContext(EditorPrivacy);
  const filled = privacy?.values.fields[field]?.filled;
  return (
    <div className="field field--private" data-private-field={field}>
      <span>{label}</span>
      <div className="private-field">
        <LockIcon />
        {value ? (
          <span className="private-field__token">{value}</span>
        ) : (
          <span className="private-field__empty">未写入简历</span>
        )}
        {value && !filled && <span className="private-field__missing">未填写</span>}
        {value ? (
          <button
            type="button"
            className="private-field__action"
            aria-label={`从简历移除${label}`}
            onClick={() => onChange('')}
          >
            移除
          </button>
        ) : (
          <button
            type="button"
            className="private-field__action"
            aria-label={`把${label}占位写入简历`}
            onClick={() => onChange(tokenFor(field))}
          >
            写入
          </button>
        )}
        <button type="button" className="private-field__action" onClick={onOpen}>
          隐私信息
        </button>
      </div>
    </div>
  );
}

/** A field that commits on blur or Enter, for values the Bridge stores as private as soon as they arrive. */
function CommitField({
  label,
  value,
  onChange,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText(value);
  }, [value]);
  const commit = () => {
    if (text !== value) onChange(text);
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={text}
        maxLength={maxLength}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setText(value);
        }}
      />
    </label>
  );
}

/** Comma-separated list input that keeps the raw text while typing, so separators and spaces survive. */
function ListField({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const parse = (text: string) =>
    text
      .split(/[,，、]/)
      .map((part) => part.trim())
      .filter(Boolean);
  const [text, setText] = useState(items.join(', '));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current && parse(text).join('\u0000') !== items.join('\u0000')) setText(items.join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only an outside change to items resets the text being typed
  }, [items]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={text}
        onFocus={() => {
          focused.current = true;
        }}
        onBlur={() => {
          focused.current = false;
          setText(parse(text).join(', '));
        }}
        onChange={(event) => {
          setText(event.target.value);
          const next = parse(event.target.value);
          if (next.join('\u0000') !== items.join('\u0000')) onChange(next);
        }}
      />
    </label>
  );
}

function InlineTextArea({
  value,
  onChange,
  rows,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  rows: number;
  label: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const applyBold = () => {
    const textarea = ref.current;
    if (!textarea) return;
    const result = toggleBold(value, textarea.selectionStart, textarea.selectionEnd);
    onChange(result.value);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  };
  return (
    <div className="inline-format-editor">
      <textarea
        ref={ref}
        aria-label={label}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
            event.preventDefault();
            applyBold();
          }
        }}
      />
      <button
        type="button"
        className="inline-bold-button"
        aria-label={`加粗${label}中的选中文字`}
        title="加粗选中文字（Ctrl/⌘ B）"
        onMouseDown={(event) => event.preventDefault()}
        onClick={applyBold}
      >
        <strong>B</strong>
      </button>
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <InlineTextArea label={label} rows={3} value={value} placeholder={placeholder} onChange={onChange} />
    </div>
  );
}

function reorder<T>(items: T[], index: number, offset: number): T[] {
  const target = index + offset;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function emptyEntry(type: SectionType): ResumeEntry | undefined {
  if (type === 'experience')
    return {
      id: createId('experience'),
      company: '',
      role: '',
      location: '',
      startDate: '',
      endDate: '',
      description: '',
      bullets: [''],
    };
  if (type === 'projects')
    return { id: createId('project'), name: '', subtitle: '', date: '', link: '', description: '', bullets: [''] };
  if (type === 'education')
    return { id: createId('education'), school: '', degree: '', major: '', date: '', additional: '', bullets: [] };
  if (type === 'skills') return { id: createId('skill'), category: '', items: [] };
  if (type === 'custom')
    return { id: createId('custom'), title: '', subtitle: '', date: '', link: '', description: '', bullets: [''] };
  return undefined;
}

function newSection(type: SectionType): ResumeSection {
  const names: Record<SectionType, string> = {
    summary: '个人简介',
    experience: '工作经历',
    projects: '项目经历',
    education: '教育背景',
    skills: '专业技能',
    custom: '自定义栏目',
  };
  const entry = emptyEntry(type);
  return {
    id: createId(type),
    type,
    title: names[type],
    visible: true,
    layout: { pageBreakBefore: false },
    text: type === 'summary' ? '' : undefined,
    entries: entry ? [entry] : [],
  };
}

function EntryActions({
  index,
  count,
  onMove,
  onDuplicate,
  onDelete,
}: {
  index: number;
  count: number;
  onMove: (offset: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="inline-actions">
      <button type="button" disabled={index === 0} onClick={() => onMove(-1)}>
        上移
      </button>
      <button type="button" disabled={index === count - 1} onClick={() => onMove(1)}>
        下移
      </button>
      <button type="button" onClick={onDuplicate}>
        复制
      </button>
      <button type="button" className="danger-link" onClick={onDelete}>
        删除
      </button>
    </div>
  );
}

function BulletsEditor({ bullets, onChange }: { bullets: string[]; onChange: (bullets: string[]) => void }) {
  return (
    <div className="bullets-editor">
      <div className="field-title">要点</div>
      {bullets.map((bullet, index) => (
        <div className="bullet-edit" key={index}>
          <InlineTextArea
            label={`第 ${index + 1} 条要点`}
            rows={2}
            value={bullet}
            onChange={(value) => onChange(bullets.map((item, itemIndex) => (itemIndex === index ? value : item)))}
          />
          <div className="stack-actions">
            <button
              type="button"
              aria-label="上移要点"
              disabled={index === 0}
              onClick={() => onChange(reorder(bullets, index, -1))}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="下移要点"
              disabled={index === bullets.length - 1}
              onClick={() => onChange(reorder(bullets, index, 1))}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="删除要点"
              onClick={() => onChange(bullets.filter((_, itemIndex) => itemIndex !== index))}
            >
              ×
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="subtle-button" onClick={() => onChange([...bullets, ''])}>
        ＋ 添加要点
      </button>
    </div>
  );
}

function EntryEditor({
  section,
  entry,
  index,
  updateSection,
}: {
  section: ResumeSection;
  entry: ResumeEntry;
  index: number;
  updateSection: (next: ResumeSection) => void;
}) {
  const update = (updater: (current: ResumeEntry) => ResumeEntry) =>
    updateSection({
      ...section,
      entries: section.entries.map((item) => (item.id === entry.id ? updater(item) : item)),
    });
  const actions = (
    <EntryActions
      index={index}
      count={section.entries.length}
      onMove={(offset) => updateSection({ ...section, entries: reorder(section.entries, index, offset) })}
      onDuplicate={() =>
        updateSection({
          ...section,
          entries: [
            ...section.entries.slice(0, index + 1),
            { ...structuredClone(entry), id: createId('entry') },
            ...section.entries.slice(index + 1),
          ],
        })
      }
      onDelete={() => updateSection({ ...section, entries: section.entries.filter((item) => item.id !== entry.id) })}
    />
  );

  if ('company' in entry) {
    const current: ExperienceEntry = entry;
    return (
      <div className="entry-card">
        {actions}
        <div className="field-grid">
          <Field
            label="公司"
            value={current.company}
            onChange={(value) => update((item) => ({ ...(item as ExperienceEntry), company: value }))}
          />
          <Field
            label="职位"
            value={current.role}
            onChange={(value) => update((item) => ({ ...(item as ExperienceEntry), role: value }))}
          />
          <Field
            label="地点"
            value={current.location}
            onChange={(value) => update((item) => ({ ...(item as ExperienceEntry), location: value }))}
          />
          <Field
            label="开始日期"
            value={current.startDate}
            onChange={(value) => update((item) => ({ ...(item as ExperienceEntry), startDate: value }))}
          />
          <Field
            label="结束日期"
            value={current.endDate}
            onChange={(value) => update((item) => ({ ...(item as ExperienceEntry), endDate: value }))}
          />
        </div>
        <TextArea
          label="说明（可选）"
          value={current.description}
          onChange={(value) => update((item) => ({ ...(item as ExperienceEntry), description: value }))}
        />
        <BulletsEditor
          bullets={current.bullets}
          onChange={(bullets) => update((item) => ({ ...(item as ExperienceEntry), bullets }))}
        />
      </div>
    );
  }
  if ('school' in entry) {
    const current: EducationEntry = entry;
    return (
      <div className="entry-card">
        {actions}
        <div className="field-grid">
          <Field
            label="学校"
            value={current.school}
            onChange={(value) => update((item) => ({ ...(item as EducationEntry), school: value }))}
          />
          <Field
            label="学位"
            value={current.degree}
            onChange={(value) => update((item) => ({ ...(item as EducationEntry), degree: value }))}
          />
          <Field
            label="专业"
            value={current.major}
            onChange={(value) => update((item) => ({ ...(item as EducationEntry), major: value }))}
          />
          <Field
            label="日期"
            value={current.date}
            onChange={(value) => update((item) => ({ ...(item as EducationEntry), date: value }))}
          />
        </div>
        <TextArea
          label="补充文字"
          value={current.additional}
          onChange={(value) => update((item) => ({ ...(item as EducationEntry), additional: value }))}
        />
        <BulletsEditor
          bullets={current.bullets}
          onChange={(bullets) => update((item) => ({ ...(item as EducationEntry), bullets }))}
        />
      </div>
    );
  }
  if ('category' in entry) {
    const current: SkillEntry = entry;
    return (
      <div className="entry-card">
        {actions}
        <div className="field-grid">
          <Field
            label="分类"
            value={current.category}
            onChange={(value) => update((item) => ({ ...(item as SkillEntry), category: value }))}
          />
          <ListField
            label="技能项（用逗号或顿号分隔）"
            items={current.items}
            onChange={(items) => update((item) => ({ ...(item as SkillEntry), items }))}
          />
        </div>
      </div>
    );
  }
  if ('name' in entry) {
    const current: ProjectEntry = entry;
    return (
      <div className="entry-card">
        {actions}
        <div className="field-grid">
          <Field
            label="项目名称"
            value={current.name}
            onChange={(value) => update((item) => ({ ...(item as ProjectEntry), name: value }))}
          />
          <Field
            label="角色 / 副标题"
            value={current.subtitle}
            onChange={(value) => update((item) => ({ ...(item as ProjectEntry), subtitle: value }))}
          />
          <Field
            label="日期"
            value={current.date}
            onChange={(value) => update((item) => ({ ...(item as ProjectEntry), date: value }))}
          />
          <Field
            label="链接"
            value={current.link}
            onChange={(value) => update((item) => ({ ...(item as ProjectEntry), link: value }))}
          />
        </div>
        <TextArea
          label="说明（可选）"
          value={current.description}
          onChange={(value) => update((item) => ({ ...(item as ProjectEntry), description: value }))}
        />
        <BulletsEditor
          bullets={current.bullets}
          onChange={(bullets) => update((item) => ({ ...(item as ProjectEntry), bullets }))}
        />
      </div>
    );
  }
  const current = entry;
  return (
    <div className="entry-card">
      {actions}
      <div className="field-grid">
        <Field
          label="标题"
          value={current.title}
          onChange={(value) => update((item) => ('title' in item ? { ...item, title: value } : item))}
        />
        <Field
          label="副标题"
          value={current.subtitle}
          onChange={(value) => update((item) => ('title' in item ? { ...item, subtitle: value } : item))}
        />
        <Field
          label="日期"
          value={current.date}
          onChange={(value) => update((item) => ('title' in item ? { ...item, date: value } : item))}
        />
        <Field
          label="链接"
          value={current.link}
          onChange={(value) => update((item) => ('title' in item ? { ...item, link: value } : item))}
        />
      </div>
      <TextArea
        label="说明"
        value={current.description}
        onChange={(value) => update((item) => ('title' in item ? { ...item, description: value } : item))}
      />
      <BulletsEditor
        bullets={current.bullets}
        onChange={(bullets) => update((item) => ('title' in item ? { ...item, bullets } : item))}
      />
    </div>
  );
}

const basicLabels = { name: '姓名', phone: '电话', email: '邮箱', location: '地点' } as const;

const detailPlaceholders: Record<DetailField, string> = {
  gender: '',
  birthDate: '如 2000.05',
  politicalStatus: '如 群众、共青团员、中共党员',
  hometown: '如 上海',
  yearsOfExperience: '如 3 年',
};

/** An added detail: a text box, or 男/女 for gender, with 移除 beside the label. Left empty, it folds away on blur. */
function DetailInput({
  field,
  label,
  value,
  autoFocus,
  onChange,
  onFocus,
  onBlur,
  onRemove,
}: {
  field: DetailField;
  label: string;
  value: string;
  autoFocus: boolean;
  onChange: (value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onRemove: () => void;
}) {
  const id = useId();
  const control =
    field === 'gender' ? (
      <select
        id={id}
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <option value="">请选择</option>
        {['男', '女', ...(value && !['男', '女'].includes(value) ? [value] : [])].map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    ) : (
      <input
        id={id}
        autoFocus={autoFocus}
        value={value}
        placeholder={detailPlaceholders[field]}
        maxLength={DETAIL_MAX_LENGTH}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    );
  return (
    <div className="field" data-detail={field}>
      <div className="field__head">
        <label htmlFor={id}>{label}</label>
        <button type="button" className="field__remove" aria-label={`移除${label}`} onClick={onRemove}>
          移除
        </button>
      </div>
      {control}
    </div>
  );
}

function AddLinkMenu({ onAdd }: { onAdd: (label: string) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useDetailsDismiss(ref);
  const add = (label: string) => {
    if (ref.current) ref.current.open = false;
    onAdd(label);
  };
  return (
    <details className="menu add-link" ref={ref}>
      <summary className="subtle-button">＋ 添加链接</summary>
      <div className="menu-panel" role="menu">
        {LINK_PRESETS.map((label) => (
          <button type="button" role="menuitem" key={label} onClick={() => add(label)}>
            {label}
          </button>
        ))}
        <hr />
        <button type="button" role="menuitem" onClick={() => add('')}>
          其他链接
        </button>
      </div>
    </details>
  );
}

/** What the page will crowd or leave off for this link's 显示 choice, if anything. */
function linkHint(link: LinkItem): { text: string; warn: boolean } | undefined {
  const { address } = linkParts(link);
  if (address && shortUrl(address).length > LONG_LINK_ADDRESS)
    return { text: '网址较长，可以改成只显示名称', warn: true };
  if (link.show === 'label' && link.url.trim())
    return { text: 'PDF 里点名称能打开网址，打印到纸上看不到网址', warn: false };
  return undefined;
}

/**
 * One link: its name and address, then what the page prints, its icon and the row actions. `sealed`: privacy mode
 * keeps the address; `site`: the platform of the address it keeps.
 */
function LinkRow({
  link,
  index,
  count,
  sealed,
  site,
  onChange,
  onMove,
  onRemove,
}: {
  link: LinkItem;
  index: number;
  count: number;
  sealed: boolean;
  site?: LinkPlatform;
  onChange: (link: LinkItem) => void;
  onMove: (offset: number) => void;
  onRemove: () => void;
}) {
  const { onOpen } = useContext(EditorPrivacy);
  const hintId = useId();
  const hint = linkHint(link);
  const setUrl = (url: string) => onChange({ ...link, url });
  // 自动 names the icon the link gets with no choice, so it changes as the address does.
  const automatic = { ...link, icon: undefined };
  const autoIcon = linkIcon(automatic, linkPlatform(automatic, sitePlatform(link.url) ?? site));
  const setIcon = (icon: string) => {
    const { icon: _previous, ...rest } = link;
    onChange(icon ? { ...rest, icon: icon as LinkIcon } : rest);
  };
  return (
    <div className="link-editor">
      <div className="link-editor__fields">
        <Field
          label="名称"
          maxLength={LINK_LIMITS.label}
          placeholder="如：小红书 @账号名"
          value={link.label}
          onChange={(label) => onChange({ ...link, label })}
        />
        {sealed && link.url.startsWith('【') ? (
          <div className="field field--private">
            <span>网址</span>
            <div className="private-field">
              <LockIcon />
              <span className="private-field__token">{link.url}</span>
              <button type="button" className="private-field__action" onClick={onOpen}>
                隐私信息
              </button>
            </div>
          </div>
        ) : sealed ? (
          <CommitField label="网址" maxLength={LINK_LIMITS.url} value={link.url} onChange={setUrl} />
        ) : (
          <Field
            label="网址"
            maxLength={LINK_LIMITS.url}
            placeholder={link.label === 'GitHub' ? 'https://github.com/用户名' : undefined}
            value={link.url}
            onChange={setUrl}
          />
        )}
      </div>
      <div className="link-editor__options">
        <label className="field">
          <span>显示</span>
          <select
            value={link.show ?? 'url'}
            aria-describedby={hint ? hintId : undefined}
            onChange={(event) => onChange({ ...link, show: event.target.value as LinkShow })}
          >
            {LINK_SHOW_OPTIONS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>图标</span>
          <select value={link.icon ?? ''} onChange={(event) => setIcon(event.target.value)}>
            <option value="">自动（{linkIconLabel(autoIcon)}）</option>
            {LINK_ICON_OPTIONS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="link-editor__hint" id={hintId} data-warn={hint?.warn || undefined}>
          {hint?.text}
        </p>
        <div className="inline-actions">
          <button type="button" disabled={index === 0} onClick={() => onMove(-1)}>
            上移
          </button>
          <button type="button" disabled={index === count - 1} onClick={() => onMove(1)}>
            下移
          </button>
          <button type="button" className="danger-link" onClick={onRemove}>
            删除
          </button>
        </div>
      </div>
    </div>
  );
}

export function Editor({ data: stored, onOpenPrivacy = () => {} }: { data: ResumeData; onOpenPrivacy?: () => void }) {
  const rawUpdate = useStudioStore((state) => state.updateData);
  const updateLayout = useStudioStore((state) => state.updateLayout);
  const mode = useStudioStore((state) => state.mode);
  const privacy = useStudioStore((state) => state.privacy);
  // In privacy mode the editor works on 【手机号】-style placeholders; the stored resume keeps {{private:phone}} tokens.
  const names = useMemo(() => privateNames(privacy), [privacy]);
  const data = useMemo(() => toDisplay(stored, names), [stored, names]);
  const updateData = (updater: (current: ResumeData) => ResumeData) =>
    rawUpdate((current) => fromDisplay(updater(toDisplay(current, names)), names));
  const privateField = (field: PrivateField) => !!privacy?.enabled && privacy.fields.includes(field);
  const basicField = (field: keyof typeof basicLabels, input: { type?: string } = {}) =>
    privateField(field) ? (
      <PrivateBasicField
        key={field}
        label={basicLabels[field]}
        field={field}
        value={data.basics[field] ?? ''}
        onChange={(value) => updateBasics({ [field]: value })}
      />
    ) : (
      <Field
        key={field}
        label={basicLabels[field]}
        {...input}
        value={data.basics[field] ?? ''}
        onChange={(value) => updateBasics({ [field]: value })}
      />
    );
  const privatePhoto = privateField('photo');
  const privateLinks = privateField('links');
  const [newType, setNewType] = useState<SectionType>('custom');
  const [photoStatus, setPhotoStatus] = useState('');
  const updateBasics = (patch: Partial<ResumeData['basics']>) =>
    updateData((current) => ({ ...current, basics: { ...current.basics, ...patch } }));
  // A preset prints its address; 其他链接 is usually an account, whose name says more than its address.
  const addLink = (label: string) =>
    updateData((current) => ({
      ...current,
      basics: {
        ...current.basics,
        links: [
          ...current.basics.links,
          { id: createId('link'), label, url: '', ...(label ? {} : { show: 'label' as const }) },
        ],
      },
    }));
  // Details exist only once added: a detail shows while it has a value, was just added or is being edited, and leaving it empty drops the key.
  const [openedDetails, setOpenedDetails] = useState<DetailField[]>([]);
  const removeDetail = (field: DetailField) => {
    setOpenedDetails((opened) => opened.filter((item) => item !== field));
    updateData((current) => {
      const { [field]: _removed, ...basics } = current.basics;
      return { ...current, basics };
    });
  };
  const addDetail = (field: DetailField) => {
    if (privateField(field as PrivateField)) updateBasics({ [field]: tokenFor(field as PrivateField) });
    else setOpenedDetails((opened) => [...opened, field]);
  };
  const shownDetails = DETAIL_FIELDS.filter(({ id }) => data.basics[id]?.trim() || openedDetails.includes(id));
  const detailField = ({ id, label }: (typeof DETAIL_FIELDS)[number]) =>
    privateField(id as PrivateField) ? (
      <PrivateBasicField
        key={id}
        label={label}
        field={id as PrivateField}
        value={data.basics[id] ?? ''}
        onChange={(value) => (value ? updateBasics({ [id]: value }) : removeDetail(id))}
      />
    ) : (
      // Focus only one that was just added from the 补充信息 row, never one that loads with the resume.
      <DetailInput
        key={id}
        field={id}
        label={label}
        value={data.basics[id] ?? ''}
        autoFocus={openedDetails.includes(id)}
        onChange={(value) => updateBasics({ [id]: value })}
        onRemove={() => removeDetail(id)}
        onFocus={() => setOpenedDetails((opened) => (opened.includes(id) ? opened : [...opened, id]))}
        onBlur={() => {
          if (data.basics[id]?.trim()) setOpenedDetails((opened) => opened.filter((item) => item !== id));
          else removeDetail(id);
        }}
      />
    );
  const updateSection = (next: ResumeSection) =>
    updateData((current) => ({
      ...current,
      sections: current.sections.map((section) => (section.id === next.id ? next : section)),
    }));
  const onPhoto = (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoStatus('请选择 JPEG、PNG 或 WebP 图片。');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setPhotoStatus('图片超过 2MB，请先压缩后再选择。');
      return;
    }
    setPhotoStatus('正在读取照片…');
    const reader = new FileReader();
    reader.onerror = () => setPhotoStatus('图片读取失败，请换一张图片重试。');
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        setPhotoStatus('图片读取失败，请换一张图片重试。');
        return;
      }
      const image = new Image();
      image.onerror = () => setPhotoStatus('浏览器无法显示这张图片，请改用 JPEG、PNG 或 WebP。');
      image.onload = () => {
        updateBasics({ photo: reader.result as string });
        updateLayout({ photoEnabled: true });
        setPhotoStatus('照片已加载，并已在简历中显示。');
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const [noteDismissed, setNoteDismissed] = useState(() => {
    try {
      return localStorage.getItem(PRIVACY_NOTE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const dismissNote = () => {
    setNoteDismissed(true);
    try {
      localStorage.setItem(PRIVACY_NOTE_KEY, '1');
    } catch {
      /* Private windows may block storage; the note simply shows again. */
    }
  };

  return (
    <EditorPrivacy.Provider value={{ privacy, names, onOpen: onOpenPrivacy }}>
      <div className="editor-content">
        {privacy?.enabled && !noteDismissed && (
          <div className="privacy-editor-note" role="note">
            <LockIcon />
            <span>【】是隐私占位，导出 PDF 时换成真实内容，可以删除、挪动或复制。</span>
            <button type="button" onClick={dismissNote}>
              知道了
            </button>
          </div>
        )}
        <section className="editor-section" data-testid="basic-section">
          <h2>基本信息</h2>
          <div className="field-grid">
            {basicField('name')}
            <Field label="目标职位" value={data.basics.headline} onChange={(headline) => updateBasics({ headline })} />
            {basicField('phone')}
            {basicField('email', { type: 'email' })}
            {basicField('location')}
            {shownDetails.map(detailField)}
          </div>
          {privatePhoto ? (
            <div className="photo-picker photo-picker--private">
              <LockIcon />
              <span>
                {data.basics.photo ? '简历使用隐私信息里的照片' : '简历里没有照片'}
                {data.basics.photo && !privacy?.values.fields.photo?.filled ? '（未上传）' : ''}
              </span>
              {data.basics.photo ? (
                <button
                  type="button"
                  className="danger-link"
                  onClick={() => {
                    updateBasics({ photo: undefined });
                    updateLayout({ photoEnabled: false });
                  }}
                >
                  移除照片
                </button>
              ) : (
                <button
                  type="button"
                  className="subtle-button"
                  onClick={() => {
                    updateBasics({ photo: tokenFor('photo') });
                    updateLayout({ photoEnabled: true });
                  }}
                >
                  放入照片
                </button>
              )}
              <button type="button" className="subtle-button" onClick={onOpenPrivacy}>
                隐私信息
              </button>
            </div>
          ) : (
            <div className="photo-picker">
              {data.basics.photo && (
                <img className="photo-picker__preview" src={data.basics.photo} alt="已选择的本地照片" />
              )}
              <label className="subtle-button">
                {data.basics.photo ? '更换本地照片' : '选择本地照片'}
                <input
                  aria-label="选择本地照片文件"
                  hidden
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    onPhoto(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              </label>
              {data.basics.photo && (
                <button
                  type="button"
                  className="danger-link"
                  onClick={() => {
                    updateBasics({ photo: undefined });
                    updateLayout({ photoEnabled: false });
                    setPhotoStatus('照片已从当前简历移除。');
                  }}
                >
                  移除照片
                </button>
              )}
              <span>
                JPEG / PNG / WebP，最大 2MB，{mode === 'workspace' ? '保存在本地工作区' : '仅保存在当前浏览器'}
              </span>
              {photoStatus && (
                <span className="photo-picker__status" role="status">
                  {photoStatus}
                </span>
              )}
            </div>
          )}
          {shownDetails.length < DETAIL_FIELDS.length && (
            <div className="detail-adder">
              <span>补充信息</span>
              {DETAIL_FIELDS.filter((field) => !shownDetails.includes(field)).map(({ id, label }) => (
                <button type="button" key={id} className="subtle-button" onClick={() => addDetail(id)}>
                  ＋ {label}
                </button>
              ))}
            </div>
          )}
        </section>
        <section className="editor-section">
          <h2>链接</h2>
          {data.basics.links.map((link, index) => (
            <LinkRow
              key={link.id}
              link={link}
              index={index}
              count={data.basics.links.length}
              sealed={privateLinks}
              site={sealedSite(privacy, stored.basics.links[index]?.url ?? '')}
              onChange={(next) =>
                updateBasics({ links: data.basics.links.map((item) => (item.id === link.id ? next : item)) })
              }
              onMove={(offset) => updateBasics({ links: reorder(data.basics.links, index, offset) })}
              onRemove={() => updateBasics({ links: data.basics.links.filter((item) => item.id !== link.id) })}
            />
          ))}
          {data.basics.links.length < LINK_LIMITS.count ? (
            <AddLinkMenu onAdd={addLink} />
          ) : (
            <p className="link-limit">最多 {LINK_LIMITS.count} 个链接</p>
          )}
        </section>

        {data.sections.map((section, sectionIndex) => (
          <section className="editor-section" key={section.id} data-section-type={section.type}>
            <div className="section-editor-head">
              <input
                className="section-title-input"
                aria-label="栏目标题"
                value={section.title}
                onChange={(event) => updateSection({ ...section, title: event.target.value })}
              />
              <div className="inline-actions">
                <button
                  type="button"
                  disabled={sectionIndex === 0}
                  onClick={() =>
                    updateData((current) => ({ ...current, sections: reorder(current.sections, sectionIndex, -1) }))
                  }
                >
                  上移
                </button>
                <button
                  type="button"
                  disabled={sectionIndex === data.sections.length - 1}
                  onClick={() =>
                    updateData((current) => ({ ...current, sections: reorder(current.sections, sectionIndex, 1) }))
                  }
                >
                  下移
                </button>
                <button
                  type="button"
                  className="section-break"
                  aria-pressed={section.layout.pageBreakBefore}
                  title="在这个栏目前换页"
                  onClick={() =>
                    updateSection({
                      ...section,
                      layout: { ...section.layout, pageBreakBefore: !section.layout.pageBreakBefore },
                    })
                  }
                >
                  从新页开始
                </button>
                <button type="button" onClick={() => updateSection({ ...section, visible: !section.visible })}>
                  {section.visible ? '隐藏' : '显示'}
                </button>
                <button
                  type="button"
                  className="danger-link"
                  onClick={() =>
                    updateData((current) => ({
                      ...current,
                      sections: current.sections.filter((item) => item.id !== section.id),
                    }))
                  }
                >
                  删除栏目
                </button>
              </div>
            </div>
            {section.type === 'summary' ? (
              <TextArea
                label="内容"
                value={section.text ?? ''}
                onChange={(text) => updateSection({ ...section, text })}
              />
            ) : (
              <>
                {section.entries.map((entry, index) => (
                  <EntryEditor
                    key={entry.id}
                    section={section}
                    entry={entry}
                    index={index}
                    updateSection={updateSection}
                  />
                ))}
                <button
                  type="button"
                  className="add-entry"
                  onClick={() => {
                    const entry = emptyEntry(section.type);
                    if (entry) updateSection({ ...section, entries: [...section.entries, entry] });
                  }}
                >
                  ＋ 添加条目
                </button>
              </>
            )}
          </section>
        ))}
        <section className="add-section">
          <select value={newType} onChange={(event) => setNewType(event.target.value as SectionType)}>
            <option value="custom">自定义栏目</option>
            <option value="summary">个人简介</option>
            <option value="experience">工作经历</option>
            <option value="projects">项目经历</option>
            <option value="education">教育背景</option>
            <option value="skills">专业技能</option>
          </select>
          <button
            type="button"
            onClick={() =>
              updateData((current) => ({ ...current, sections: [...current.sections, newSection(newType)] }))
            }
          >
            ＋ 添加栏目
          </button>
        </section>
      </div>
    </EditorPrivacy.Provider>
  );
}

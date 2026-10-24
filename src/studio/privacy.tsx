import { createContext, useContext, type ReactNode } from 'react';
import {
  isPrivateToken,
  mapStrings,
  privateDisplayNames,
  type PrivacyPlan,
  type PrivacySettings,
  type PrivateField,
} from '../core/privacy';
import type { LinkPlatform } from '../core/types';

/*
 * The web page in privacy mode never holds a private value: resumes carry tokens such as {{private:phone}}, shown as
 * 【手机号】 in the editor and as a 手机号 label in the preview. The Bridge sends each stored value's character shape
 * (how many Han characters, digits, letters) so a label takes about as much room as the real value will.
 */

export interface PrivateShape {
  han: number;
  digit: number;
  latin: number;
  other: number;
}
export interface PrivateValueInfo {
  filled: boolean;
  length?: number;
  shape?: PrivateShape;
}
export interface PrivacyState extends PrivacySettings {
  values: {
    fields: Partial<Record<PrivateField, PrivateValueInfo>>;
    links: Array<{ key: string; label: string; site?: LinkPlatform } & PrivateValueInfo>;
  };
}

export type PrivacyPlanSummary = PrivacySettings & Pick<PrivacyPlan<unknown>, 'moved' | 'restored' | 'conflicts'>;

const TOKEN_SPLIT = /(\{\{private:[^{}]*\}\})/;
const keyOf = (token: string) => token.slice('{{private:'.length, -2);

/** The placeholder name of every token the person can use now, e.g. phone → 手机号, link:abc → 链接·领英. */
export function privateNames(privacy?: PrivacyState): Map<string, string> {
  const names = new Map<string, string>();
  if (!privacy?.enabled) return names;
  for (const field of privacy.fields) if (field !== 'links') names.set(field, privateDisplayNames[field]);
  const used = new Set(names.values());
  for (const link of privacy.values.links) {
    const base = `链接·${link.label || link.key.slice('link:'.length)}`;
    let name = base;
    for (let index = 2; used.has(name); index++) name = `${base} ${index}`;
    used.add(name);
    names.set(link.key, name);
  }
  return names;
}

/** Tokens as the editor shows them: {{private:phone}} → 【手机号】. Unknown tokens stay as they are. */
export function toDisplay<T>(value: T, names: Map<string, string>): T {
  if (!names.size) return value;
  return mapStrings(value, (text) =>
    text.includes('{{private:')
      ? text
          .split(TOKEN_SPLIT)
          .map((part, index) => (index % 2 && names.has(keyOf(part)) ? `【${names.get(keyOf(part))}】` : part))
          .join('')
      : text,
  );
}

/** What the editor wrote, back to tokens: 【手机号】 → {{private:phone}}, whether it was shown there or typed. */
export function fromDisplay<T>(value: T, names: Map<string, string>): T {
  if (!names.size) return value;
  const byName = new Map([...names].map(([key, name]) => [name, key]));
  const pattern = new RegExp(
    `【(${[...byName.keys()].map((name) => name.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&')).join('|')})】`,
    'g',
  );
  return mapStrings(value, (text) =>
    text.includes('【') ? text.replace(pattern, (_, name: string) => `{{private:${byName.get(name)}}}`) : text,
  );
}

/** Rough advance widths in em, enough to keep a label on the same line as the real value would be. */
const widthOf = (shape: PrivateShape) => shape.han + (shape.digit + shape.latin) * 0.56 + shape.other * 0.4;
const nameWidth = (name: string) =>
  widthOf({
    han: name.match(/\p{Script=Han}/gu)?.length ?? 0,
    digit: 0,
    latin: name.match(/[\w·]/g)?.length ?? 0,
    other: 0,
  });

/** `site`: for a link, the platform its hidden address is on, so the preview shows the icon the PDF will. */
export interface PreviewLabel {
  name: string;
  width?: number;
  empty: boolean;
  site?: LinkPlatform;
}
/** Labels for the preview, keyed by token key; null outside privacy mode. */
export function previewLabels(privacy?: PrivacyState): Map<string, PreviewLabel> | null {
  if (!privacy?.enabled) return null;
  const labels = new Map<string, PreviewLabel>();
  for (const [key, name] of privateNames(privacy)) {
    const link = key.startsWith('link:') ? privacy.values.links.find((item) => item.key === key) : undefined;
    const info = link ?? privacy.values.fields[key as PrivateField];
    labels.set(key, {
      name: link ? name.slice('链接·'.length) : name,
      width: info?.shape && widthOf(info.shape),
      empty: !info?.filled,
      site: link?.site,
    });
  }
  return labels;
}
export const PrivateLabels = createContext<Map<string, PreviewLabel> | null>(null);

/** The platform of a link address privacy mode keeps from the page, as the Bridge reports it; undefined for anything else. */
export function sealedSite(privacy: PrivacyState | undefined, url: string): LinkPlatform | undefined {
  const text = url.trim();
  return isPrivateToken(text) ? privacy?.values.links.find((link) => link.key === keyOf(text))?.site : undefined;
}

/** sealedSite for the preview, which knows privacy mode through the labels it draws. */
export function useSealedSite(): (url: string) => LinkPlatform | undefined {
  const labels = useContext(PrivateLabels);
  return (url) => (isPrivateToken(url.trim()) ? labels?.get(keyOf(url.trim()))?.site : undefined);
}

function PrivateLabel({ tokenKey }: { tokenKey: string }) {
  const label = useContext(PrivateLabels)?.get(tokenKey);
  const name =
    label?.name ?? (tokenKey.startsWith('link') ? '链接' : (privateDisplayNames[tokenKey as PrivateField] ?? tokenKey));
  const natural = nameWidth(name);
  const width = Math.max(label?.width ?? natural, 1);
  return (
    <span
      className={`rs-private${label?.empty ? ' rs-private--empty' : ''}`}
      data-private={tokenKey}
      style={{ width: `${width}em` }}
    >
      <span style={natural > width ? { fontSize: `${Math.max(0.55, width / natural)}em` } : undefined}>{name}</span>
    </span>
  );
}

/** The icon privacy mode marks things with. The top-bar toggle shows it `open` while privacy mode is off and `solid` while it is on. */
export const LockIcon = ({ variant }: { variant?: 'open' | 'solid' }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="lock-icon">
    {variant === 'solid' ? (
      <rect x="3" y="6.8" width="10" height="7.2" rx="1.6" fill="currentColor" />
    ) : (
      <rect x="3.25" y="7" width="9.5" height="6.75" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
    )}
    <path
      d={variant === 'open' ? 'M5.5 7V5a2.5 2.5 0 0 1 4.9-.7' : 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    />
  </svg>
);

/** Text with each token drawn as its label; plain text passes through untouched. */
export function privateText(text: string): ReactNode {
  if (!text.includes('{{private:')) return text;
  return text
    .split(TOKEN_SPLIT)
    .map((part, index) => (index % 2 ? <PrivateLabel key={index} tokenKey={keyOf(part)} /> : part || null));
}

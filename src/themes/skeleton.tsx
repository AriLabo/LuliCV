import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { Globe, Link, Mail, MapPin, Phone, type LucideIcon } from 'lucide-react';
import { renderInlineText } from '../studio/inline-format';
import { privateText, useSealedSite } from '../studio/privacy';
import { hasToken, isPrivateToken } from '../core/privacy';
import { fontStack } from '../core/fonts';
import { DETAIL_FIELDS } from '../core/details';
import { linkCode, linkIcon, linkIconLabel, linkParts, linkPlatform, shortUrl, sitePlatform } from '../core/links';
import { PLATFORM_ICON_PATHS } from './platform-icons';
import type {
  Appearance,
  EducationEntry,
  ExperienceEntry,
  LayoutSettings,
  LinkIcon,
  LinkItem,
  LinkPlatform,
  ProjectEntry,
  ResumeData,
  ResumeEntry,
  SkillEntry,
  ThemeBlock,
} from '@/studio/types';
import type { ThemeManifest } from '../core/theme-types';

/*
 * The single-column skeleton every theme renders through. Its class names and CSS variables are the
 * public contract a theme stylesheet targets (engine 1); themes change how things look, never what
 * the DOM contains, so pagination, links and exported text stay the same for every theme.
 *
 *   .rs-header (.rs-header--photo)   .rs-identity  .rs-name  .rs-headline
 *   .rs-contacts  .rs-contact[data-kind][data-code]  .rs-contact-icon[data-icon]  .rs-contact-label  .rs-contact-value
 *   .rs-details  .rs-detail[data-kind]  .rs-detail-label  .rs-detail-value   gender, birth date and the like, one line
 *   .rs-photo
 *   .rs-section-title  .rs-section-index  h2  .rs-section-rule
 *   .rs-entry-head  .rs-entry-main  .rs-entry-title  .rs-entry-subtitle  .rs-entry-meta  .rs-entry-location  .rs-entry-date
 *   .rs-summary  .rs-description  .rs-bullet  .rs-bullet-mark  .rs-skill  .rs-skill-category  .rs-skill-items
 *   .rs-private (.rs-private--empty)  .rs-photo--private   privacy-mode placeholders, web preview only (export has real values)
 *   Root: .rs-theme .rs-theme--<id> plus .rs-set-<setting>-<value> / .rs-set-<toggle> for theme settings.
 *   Variables: --rs-accent --rs-font-size --rs-line-height --rs-section-space --rs-page-margin --rs-font-family
 */

export function href(value: string): string {
  if (!value) return '';
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  return `https://${value}`;
}

/** Lets a long address wrap after a slash or query mark rather than inside a word. */
function breakable(text: string): ReactNode {
  const parts = text.split(/(?<=[/?&#])/);
  return parts.length === 1
    ? text
    : parts.map((part, index) => (
        <Fragment key={index}>
          {part}
          {index < parts.length - 1 && <wbr />}
        </Fragment>
      ));
}

type ContactIcon = 'phone' | 'email' | 'location' | Exclude<LinkIcon, 'none'>;
const lineIcons: Record<Exclude<ContactIcon, LinkPlatform>, LucideIcon> = {
  phone: Phone,
  email: Mail,
  location: MapPin,
  link: Link,
  globe: Globe,
};

/**
 * Line icons are stroked like the text beside them; platform marks are their own filled shapes. Several marks touch
 * the edge of their box, so they may overflow it rather than lose their anti-aliased rim.
 */
function ContactIconView({ icon }: { icon: ContactIcon }) {
  if (Object.hasOwn(PLATFORM_ICON_PATHS, icon))
    return (
      <svg
        className="rs-contact-icon"
        data-icon={icon}
        viewBox="0 0 24 24"
        fill="currentColor"
        overflow="visible"
        aria-hidden="true"
      >
        <path d={PLATFORM_ICON_PATHS[icon as LinkPlatform]} />
      </svg>
    );
  const Icon = lineIcons[icon as Exclude<ContactIcon, LinkPlatform>];
  return <Icon className="rs-contact-icon" data-icon={icon} aria-hidden="true" strokeWidth={2.25} />;
}

/** One item of the contact line. A value holding a privacy placeholder links nowhere; a link may show no icon. */
interface Contact {
  kind: 'phone' | 'email' | 'location' | 'link';
  icon?: ContactIcon;
  code: string;
  label: string;
  value: ReactNode;
  url?: string;
}

function plainContact(
  kind: Contact['kind'],
  code: string,
  label: string,
  value: string,
  url?: string,
): Contact | undefined {
  return value
    ? { kind, icon: kind, code, label, value: privateText(value), url: hasToken(value) ? undefined : url }
    : undefined;
}

/**
 * A link prints its name, its address or both (see linkParts); it is clickable only when it has an address. Its icon
 * and code follow its platform (see linkPlatform); `sealedSite` gives the site of an address privacy mode hides.
 */
function linkContact(link: LinkItem, sealedSite: (url: string) => LinkPlatform | undefined): Contact | undefined {
  const { name, address } = linkParts(link);
  if (!name && !address) return undefined;
  const sealed = hasToken(link.url);
  const platform = linkPlatform(link, sitePlatform(link.url) ?? sealedSite(link.url));
  const icon = linkIcon(link, platform);
  const value = (
    <>
      {name && privateText(name)}
      {name && address && ' '}
      {address && (sealed ? privateText(address) : breakable(shortUrl(address)))}
    </>
  );
  return {
    kind: 'link',
    icon: icon === 'none' ? undefined : icon,
    code: linkCode(link, platform),
    label: link.label.trim() || (platform ? linkIconLabel(platform) : '链接'),
    value,
    url: link.url.trim() && !sealed ? href(link.url.trim()) : undefined,
  };
}

export function SkeletonHeader({ data, options }: { data: ResumeData; options: LayoutSettings }) {
  const basics = data.basics;
  const sealedSite = useSealedSite();
  const withPhoto = options.photoEnabled && Boolean(basics.photo);
  const contacts = [
    plainContact('phone', 'TEL', '电话', basics.phone, `tel:${basics.phone}`),
    plainContact('email', 'MAIL', '邮箱', basics.email, `mailto:${basics.email}`),
    plainContact('location', 'LOC', '地点', basics.location),
    ...basics.links.map((link) => linkContact(link, sealedSite)),
  ].filter((item): item is Contact => Boolean(item));
  const details = DETAIL_FIELDS.filter((field) => basics[field.id]?.trim());
  return (
    <header className={`rs-header${withPhoto ? ' rs-header--photo' : ''}`}>
      <div className="rs-identity">
        <h1 className="rs-name">{basics.name ? privateText(basics.name) : '未命名'}</h1>
        {basics.headline && <p className="rs-headline">{privateText(basics.headline)}</p>}
        {contacts.length > 0 && (
          <div className="rs-contacts">
            {contacts.map((item, index) => {
              const content = (
                <>
                  {item.icon && <ContactIconView icon={item.icon} />}
                  <span className="rs-contact-label">{item.label}</span>
                  <span className="rs-contact-value">{item.value}</span>
                </>
              );
              const props = { className: 'rs-contact', 'data-kind': item.kind, 'data-code': item.code };
              return item.url ? (
                <a key={`${item.kind}-${index}`} href={item.url} {...props}>
                  {content}
                </a>
              ) : (
                <span key={`${item.kind}-${index}`} {...props}>
                  {content}
                </span>
              );
            })}
          </div>
        )}
        {/* Every detail keeps its label in the DOM; the stylesheet decides which ones show (籍贯 does, 男 needs none). */}
        {details.length > 0 && (
          <p className="rs-details">
            {details.map(({ id, label }) => (
              <span key={id} className="rs-detail" data-kind={id}>
                <span className="rs-detail-label">{label}</span>
                <span className="rs-detail-value">{privateText(basics[id]!)}</span>
              </span>
            ))}
          </p>
        )}
      </div>
      {/* In privacy mode the photo is a placeholder box the theme sizes like the real one. */}
      {withPhoto &&
        (isPrivateToken(basics.photo!) ? (
          <div className="rs-photo rs-photo--private" role="img" aria-label="照片占位">
            照片
          </div>
        ) : (
          <img className="rs-photo" src={basics.photo} alt="简历照片" />
        ))}
    </header>
  );
}

function dateRange(start: string, end: string): string {
  return [start, end].filter(Boolean).join(' — ');
}

/** Plain text from the resume, with privacy placeholders drawn as labels. */
const shown = (value: ReactNode) => (typeof value === 'string' ? privateText(value) : value);

function entryHeader(
  title: ReactNode,
  subtitle: ReactNode,
  date: string,
  location: string | undefined,
  link: string | undefined,
): ReactNode {
  return (
    <div className="rs-entry-head">
      <div className="rs-entry-main">
        <strong className="rs-entry-title">
          {link && !hasToken(link) ? <a href={href(link)}>{shown(title)}</a> : shown(title)}
        </strong>
        {subtitle && <span className="rs-entry-subtitle">{shown(subtitle)}</span>}
      </div>
      {(date || location) && (
        <div className="rs-entry-meta">
          <span className="rs-entry-location">{location && privateText(location)}</span>
          <span className="rs-entry-date">{privateText(date)}</span>
        </div>
      )}
    </div>
  );
}

function isExperience(entry: ResumeEntry): entry is ExperienceEntry {
  return 'company' in entry;
}
function isProject(entry: ResumeEntry): entry is ProjectEntry {
  return 'subtitle' in entry && 'name' in entry;
}
function isEducation(entry: ResumeEntry): entry is EducationEntry {
  return 'school' in entry;
}
function isSkill(entry: ResumeEntry): entry is SkillEntry {
  return 'category' in entry;
}

function entryContinuation(title: ReactNode): ReactNode {
  return (
    <div className="resume-entry-continuation">
      <strong>{shown(title)}</strong>
      <span>（续）</span>
    </div>
  );
}

function pushText(
  blocks: ThemeBlock[],
  id: string,
  text: string,
  className: string,
  groupId: string | undefined,
  continuation?: ReactNode,
): void {
  if (!text.trim()) return;
  blocks.push({
    id,
    kind: 'content',
    groupId,
    continuation,
    node: <p className={className}>{renderInlineText(text)}</p>,
  });
}

function pushBullets(blocks: ThemeBlock[], entry: ResumeEntry, groupId: string, continuation?: ReactNode): void {
  if (!('bullets' in entry)) return;
  entry.bullets.filter(Boolean).forEach((bullet, index) =>
    blocks.push({
      id: `${entry.id}-bullet-${index}`,
      kind: 'bullet',
      groupId,
      continuation,
      node: (
        <div className="rs-bullet">
          <span className="rs-bullet-mark" aria-hidden>
            •
          </span>
          <p>{renderInlineText(bullet)}</p>
        </div>
      ),
    }),
  );
}

/** The printable units in reading order, with the pagination hints the paginator relies on. */
export function buildBlocks(data: ResumeData): ThemeBlock[] {
  const blocks: ThemeBlock[] = [];
  let sectionNumber = 0;
  for (const section of data.sections.filter((item) => item.visible)) {
    // A section with nothing in it prints no heading, an empty summary included.
    if (!section.text?.trim() && (section.type === 'summary' || !section.entries.length)) continue;
    sectionNumber += 1;
    blocks.push({
      id: `${section.id}-title`,
      kind: 'section-title',
      keepWithNext: true,
      breakBefore: section.layout.pageBreakBefore,
      node: (
        <div className="rs-section-title">
          <span className="rs-section-index" aria-hidden>
            {String(sectionNumber).padStart(2, '0')} /
          </span>
          <h2>{privateText(section.title)}</h2>
          <span className="rs-section-rule" />
        </div>
      ),
    });
    if (section.type === 'summary') {
      pushText(blocks, `${section.id}-text`, section.text ?? '', 'rs-summary', undefined);
      continue;
    }
    for (const entry of section.entries) {
      const groupId = `${section.id}:${entry.id}`;
      let header: ReactNode | undefined;
      let continuationTitle: ReactNode | undefined;
      let description = '';
      if (isExperience(entry)) {
        header = entryHeader(
          entry.role,
          entry.company,
          dateRange(entry.startDate, entry.endDate),
          entry.location,
          undefined,
        );
        continuationTitle = entry.role;
        description = entry.description;
      } else if (isEducation(entry)) {
        header = entryHeader(
          entry.school,
          [entry.degree, entry.major].filter(Boolean).join(' · '),
          entry.date,
          undefined,
          undefined,
        );
        continuationTitle = entry.school || [entry.degree, entry.major].filter(Boolean).join(' · ');
        description = entry.additional;
      } else if (isProject(entry)) {
        header = entryHeader(entry.name, entry.subtitle, entry.date, undefined, entry.link);
        continuationTitle = entry.name;
        description = entry.description;
      } else if (isSkill(entry)) {
        blocks.push({
          // One group for all rows, so a skills section never leaves a single row on either page.
          id: entry.id,
          kind: 'content',
          groupId: section.id,
          node: (
            <div className="rs-skill">
              <strong className="rs-skill-category">{privateText(entry.category)}</strong>
              <span className="rs-skill-items">{renderInlineText(entry.items.join('、'))}</span>
            </div>
          ),
        });
        continue;
      } else if ('title' in entry) {
        header = entryHeader(entry.title, entry.subtitle, entry.date, undefined, entry.link);
        continuationTitle = entry.title;
        description = entry.description;
      }
      const continuation = continuationTitle ? entryContinuation(continuationTitle) : undefined;
      if (header)
        blocks.push({
          id: `${entry.id}-head`,
          kind: 'entry-header',
          keepWithNext: Boolean(description || ('bullets' in entry && entry.bullets.some(Boolean))),
          groupId,
          node: header,
        });
      pushText(blocks, `${entry.id}-description`, description, 'rs-description', groupId, continuation);
      pushBullets(blocks, entry, groupId, continuation);
    }
  }
  return blocks;
}

export function themeVariables(options: LayoutSettings): CSSProperties {
  return {
    '--rs-accent': options.accentColor,
    '--rs-font-size': `${options.baseFontPt}pt`,
    '--rs-line-height': options.lineHeight,
    '--rs-section-space': `${options.sectionSpacingPt}pt`,
    '--rs-page-margin': `${options.pageMarginMm}mm`,
    ...(fontStack(options.fontFamily) ? { '--rs-font-family': fontStack(options.fontFamily) } : {}),
  } as CSSProperties;
}

/** Root classes for a theme and the person's choices among its declared settings. */
export function themeClasses(
  theme: Pick<ThemeManifest, 'id' | 'settings'>,
  appearance: Pick<Appearance, 'settings'>,
): string {
  const classes = ['rs-theme', `rs-theme--${theme.id}`];
  for (const setting of theme.settings) {
    const value = appearance.settings?.[setting.id] ?? setting.default;
    if (setting.type === 'toggle') {
      if (value === true) classes.push(`rs-set-${setting.id}`);
    } else if (typeof value === 'string' && setting.options?.some((option) => option.value === value))
      classes.push(`rs-set-${setting.id}-${value}`);
  }
  return classes.join(' ');
}

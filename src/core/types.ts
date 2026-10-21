export type Density = 'comfortable' | 'balanced' | 'dense';
export type SectionType = 'summary' | 'experience' | 'projects' | 'education' | 'skills' | 'custom';

/** What a link prints in the header: its address, its name (an account name, say) or both. */
export type LinkShow = 'url' | 'label' | 'both';
/** A platform whose own mark a link can show. */
export type LinkPlatform = 'xiaohongshu' | 'douyin' | 'bilibili' | 'weibo' | 'zhihu' | 'wechat' | 'github' | 'linkedin';
/** The mark before a link: none, a generic link or globe, or a platform's own. */
export type LinkIcon = 'none' | 'link' | 'globe' | LinkPlatform;
export interface LinkItem {
  id: string;
  label: string;
  /** May be empty when the name is printed: an account with only an ID, such as a WeChat ID. */
  url: string;
  /** Absent: the address. */
  show?: LinkShow;
  /** Absent: chosen from the address, so it follows a changed address (see linkIcon). */
  icon?: LinkIcon;
}
export interface BasicInformation {
  name: string;
  headline: string;
  phone: string;
  email: string;
  location: string;
  links: LinkItem[];
  photo?: string;
  /** Optional personal details, see DETAIL_FIELDS. */
  gender?: string;
  birthDate?: string;
  politicalStatus?: string;
  hometown?: string;
  yearsOfExperience?: string;
}

export interface EntryBase {
  id: string;
  bullets: string[];
}
export interface ExperienceEntry extends EntryBase {
  company: string;
  role: string;
  location: string;
  startDate: string;
  endDate: string;
  description: string;
}
export interface ProjectEntry extends EntryBase {
  name: string;
  subtitle: string;
  date: string;
  link: string;
  description: string;
}
export interface EducationEntry extends EntryBase {
  school: string;
  degree: string;
  major: string;
  date: string;
  additional: string;
}
export interface SkillEntry {
  id: string;
  category: string;
  items: string[];
}
export interface CustomEntry extends EntryBase {
  title: string;
  subtitle: string;
  date: string;
  link: string;
  description: string;
}
export type ResumeEntry = ExperienceEntry | ProjectEntry | EducationEntry | SkillEntry | CustomEntry;

export interface SectionLayoutHints {
  pageBreakBefore: boolean;
}

export interface ResumeSection {
  id: string;
  type: SectionType;
  title: string;
  visible: boolean;
  layout: SectionLayoutHints;
  text?: string;
  entries: ResumeEntry[];
}

export interface ResumeData {
  schemaVersion: 1;
  basics: BasicInformation;
  sections: ResumeSection[];
}

export interface LayoutSettings {
  pageMarginMm: number;
  baseFontPt: number;
  lineHeight: number;
  sectionSpacingPt: number;
  accentColor: string;
  photoEnabled: boolean;
  /** Optional bundled font replacing the theme's own font; absent means the theme font. */
  fontFamily?: string;
}

export interface Appearance {
  themeId: string;
  density: Density;
  layout: LayoutSettings;
  /** The theme preset last applied (colour and font pairing); informational, the values live in layout. */
  preset?: string;
  /** Values for the options the theme declares (e.g. header style); unknown keys are ignored when rendering. */
  settings?: Record<string, string | boolean>;
  /**
   * This resume's own stylesheet over the skeleton, applied after the theme's and kept when the theme
   * changes. Checked like a theme's (see scanThemeCss); absent when the resume has none.
   */
  css?: string;
}

/** The job a tailored resume is written for. Document metadata, never resume content. */
export interface ResumeTarget {
  company: string;
  role: string;
  jd: string;
}
/** The resume this one was duplicated from, recorded by the repository. */
export interface ResumeSource {
  id: string;
  revision: number;
}

export interface ResumeRecord {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  data: ResumeData;
  appearance: Appearance;
  target?: ResumeTarget;
  source?: ResumeSource;
  /** Where the resume sits in the tree. Organisation only: nothing is inherited from the parent. */
  parentId?: string;
  /** One line on what a base resume is for, e.g. which roles it targets; read by people and agents. */
  purpose?: string;
  /** A built-in example, not the user's own resume; copies inherit it. Cleared once the user says so. */
  sample?: true;
}

export interface ResumeWorkspace {
  version: 1;
  activeId: string;
  resumes: ResumeRecord[];
}

export interface ResumeDocument extends ResumeRecord {
  documentVersion: 1;
  revision: number;
}
export interface DocumentWorkspace {
  version: 1;
  activeId: string;
  resumes: ResumeDocument[];
}
export interface ValidationReport {
  errors: string[];
  warnings: string[];
}

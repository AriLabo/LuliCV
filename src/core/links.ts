import type { LinkIcon, LinkItem, LinkPlatform, LinkShow } from './types';

/** Common links offered when adding one. Their name is a category, so by default they print the address. */
export const LINK_PRESETS = ['个人网站', 'GitHub', '作品集', '博客'] as const;

/** What a link may print in the header, in the order the editor offers them. */
export const LINK_SHOW_OPTIONS = [
  { id: 'url', label: '网址' },
  { id: 'label', label: '名称' },
  { id: 'both', label: '名称＋网址' },
] as const satisfies ReadonlyArray<{ id: LinkShow; label: string }>;

/** Past this many characters an address crowds the header; the editor suggests printing the name instead. */
export const LONG_LINK_ADDRESS = 40;

/** A web address as a resume prints it: no scheme, www or trailing slash; the link itself keeps the full address. */
export function shortUrl(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');
}

/**
 * The parts of a link the header prints. Absent `show` prints the address; a name chosen but left empty prints the
 * address instead. Both parts empty: the link is not shown.
 */
export function linkParts(link: LinkItem): { name: string; address: string } {
  const show = link.show ?? 'url';
  const name = show === 'url' ? '' : link.label.trim();
  const address = show === 'label' && name ? '' : link.url.trim();
  return { name, address };
}

/**
 * The platforms a link can show the mark of, in the order the editor offers them: the name the editor shows, the
 * code the editorial theme prints, the sites that are theirs (subdomains included) and how a link name mentions them.
 */
const PLATFORMS: Record<LinkPlatform, { label: string; code: string; hosts: readonly string[]; name: RegExp }> = {
  xiaohongshu: { label: '小红书', code: 'XHS', hosts: ['xiaohongshu.com', 'xhslink.com'], name: /小红书/ },
  douyin: { label: '抖音', code: 'DY', hosts: ['douyin.com', 'iesdouyin.com'], name: /抖音/ },
  bilibili: { label: 'B 站', code: 'BILI', hosts: ['bilibili.com', 'b23.tv'], name: /b\s?站|bilibili|哔哩哔哩/i },
  weibo: { label: '微博', code: 'WB', hosts: ['weibo.com', 'weibo.cn'], name: /微博/ },
  zhihu: { label: '知乎', code: 'ZH', hosts: ['zhihu.com'], name: /知乎/ },
  wechat: { label: '微信', code: 'WX', hosts: ['weixin.qq.com'], name: /微信|公众号/ },
  github: { label: 'GitHub', code: 'GIT', hosts: ['github.com'], name: /github/i },
  linkedin: { label: 'LinkedIn', code: 'IN', hosts: ['linkedin.com', 'linkedin.cn'], name: /linkedin|领英/i },
};
const isPlatform = (icon: LinkIcon | undefined): icon is LinkPlatform => !!icon && Object.hasOwn(PLATFORMS, icon);

/** The icons a link may choose, in the order the editor offers them; leaving the choice out is 自动. */
export const LINK_ICON_OPTIONS: ReadonlyArray<{ id: LinkIcon; label: string }> = [
  { id: 'none', label: '不显示' },
  { id: 'link', label: '链接' },
  { id: 'globe', label: '地球' },
  ...Object.entries(PLATFORMS).map(([id, { label }]) => ({ id: id as LinkPlatform, label })),
];

/** Codes for the presets that are not a platform, in the style of TEL and MAIL. */
const PRESET_CODES: Record<string, string> = { 个人网站: 'WEB', 作品集: 'WORK', 博客: 'BLOG' };

/** The platform whose site an address is on, by host name: www.xiaohongshu.com and xhslink.com are both 小红书. */
export function sitePlatform(url: string): LinkPlatform | undefined {
  const host = url
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .split(/[/?#:]/)[0]
    .toLowerCase();
  if (!host) return undefined;
  return (Object.keys(PLATFORMS) as LinkPlatform[]).find((id) =>
    PLATFORMS[id].hosts.some((site) => host === site || host.endsWith(`.${site}`)),
  );
}

/**
 * The platform a link is on: its own platform icon if one was chosen, else its address's site, else a platform its
 * name mentions (小红书 @账号名 with a short link or no address). `site` stands in for the address's site when privacy
 * mode keeps the address from the page.
 */
export function linkPlatform(link: LinkItem, site = sitePlatform(link.url)): LinkPlatform | undefined {
  if (isPlatform(link.icon)) return link.icon;
  return site ?? (Object.keys(PLATFORMS) as LinkPlatform[]).find((id) => PLATFORMS[id].name.test(link.label));
}

/** The icon a link shows: its own choice, else its platform's, else a globe for 个人网站 and a plain link otherwise. */
export function linkIcon(link: LinkItem, platform = linkPlatform(link)): LinkIcon {
  return link.icon ?? platform ?? (link.label.trim() === '个人网站' ? 'globe' : 'link');
}

/** The code the editorial theme prints before a link: its platform's, a preset's, or LINK. */
export function linkCode(link: LinkItem, platform = linkPlatform(link)): string {
  return platform ? PLATFORMS[platform].code : (PRESET_CODES[link.label.trim()] ?? 'LINK');
}

/** How the editor names an icon: 小红书, 地球. */
export const linkIconLabel = (icon: LinkIcon) => LINK_ICON_OPTIONS.find((option) => option.id === icon)!.label;

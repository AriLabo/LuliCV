import { describe, expect, it } from 'vitest';
import { linkCode, linkIcon, linkPlatform, sitePlatform } from './links';
import type { LinkItem } from './types';

const link = (label: string, url: string, icon?: LinkItem['icon']): LinkItem => ({
  id: 'link-a',
  label,
  url,
  ...(icon && { icon }),
});

describe('link platforms', () => {
  it('reads the platform from the host, subdomains and short links included', () => {
    expect(sitePlatform('https://www.xiaohongshu.com/user/profile/demo')).toBe('xiaohongshu');
    expect(sitePlatform('http://xhslink.com/a/demo')).toBe('xiaohongshu');
    expect(sitePlatform('v.douyin.com/demo/')).toBe('douyin');
    expect(sitePlatform('GitHub.com/demo')).toBe('github');
    expect(sitePlatform('https://space.bilibili.com:443/123')).toBe('bilibili');
  });
  it('does not take a look-alike host or a path for the site', () => {
    expect(sitePlatform('https://notgithub.com/demo')).toBeUndefined();
    expect(sitePlatform('https://example.com/github.com')).toBeUndefined();
    expect(sitePlatform('')).toBeUndefined();
  });
  it('prefers a chosen platform, then the address, then a platform the name mentions', () => {
    expect(linkPlatform(link('GitHub', 'https://www.zhihu.com/people/demo', 'weibo'))).toBe('weibo');
    expect(linkPlatform(link('GitHub', 'https://www.zhihu.com/people/demo'))).toBe('zhihu');
    expect(linkPlatform(link('B站 UID 123456789', ''))).toBe('bilibili');
    expect(linkPlatform(link('个人网站', 'example.com'))).toBeUndefined();
    expect(linkPlatform(link('主页', '{{private:link:a}}'), 'linkedin')).toBe('linkedin');
  });
});

describe('link icons and codes', () => {
  it('shows the chosen icon, else the platform, else a globe for 个人网站 and a plain link', () => {
    expect(linkIcon(link('小红书 @林夏的耳饰铺', 'xhslink.com/a/demo', 'none'))).toBe('none');
    expect(linkIcon(link('个人网站', 'example.com', 'link'))).toBe('link');
    expect(linkIcon(link('小红书 @林夏的耳饰铺', 'xhslink.com/a/demo'))).toBe('xiaohongshu');
    expect(linkIcon(link(' 个人网站 ', 'example.com'))).toBe('globe');
    expect(linkIcon(link('作品集', 'example.com'))).toBe('link');
  });
  it('codes a platform or a preset, and calls every other link LINK', () => {
    expect(linkCode(link('GitHub', 'github.com/demo'))).toBe('GIT');
    expect(linkCode(link('作品集', 'example.com'))).toBe('WORK');
    expect(linkCode(link('作品集', 'example.com', 'globe'))).toBe('WORK');
    expect(linkCode(link('耳饰账号', 'example.org'))).toBe('LINK');
  });
});

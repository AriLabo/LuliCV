import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  fromDisplay,
  previewLabels,
  PrivateLabels,
  privateNames,
  privateText,
  sealedSite,
  toDisplay,
  type PrivacyState,
} from './privacy';

const privacy: PrivacyState = {
  enabled: true,
  fields: ['name', 'phone', 'links'],
  values: {
    fields: {
      name: { filled: true, length: 2, shape: { han: 2, digit: 0, latin: 0, other: 0 } },
      phone: { filled: false },
    },
    links: [
      { key: 'link:a', label: '领英', filled: true, site: 'linkedin' },
      { key: 'link:b', label: '领英', filled: true },
    ],
  },
};

describe('privacy placeholders on the web page', () => {
  it('names each token, keeping link names apart', () => {
    expect([...privateNames(privacy)]).toEqual([
      ['name', '姓名'],
      ['phone', '手机号'],
      ['link:a', '链接·领英'],
      ['link:b', '链接·领英 2'],
    ]);
    expect(privateNames({ ...privacy, enabled: false }).size).toBe(0);
  });

  it('round-trips tokens through the editor display, including ones the person typed', () => {
    const names = privateNames(privacy);
    const stored = {
      summary: '欢迎联系{{private:name}}，电话 {{private:phone}}',
      url: '{{private:link:b}}',
      other: '{{private:email}}',
      count: 3,
    };
    const shown = toDisplay(stored, names);
    expect(shown).toEqual({
      summary: '欢迎联系【姓名】，电话 【手机号】',
      url: '【链接·领英 2】',
      other: '{{private:email}}',
      count: 3,
    });
    expect(fromDisplay(shown, names)).toEqual(stored);
    expect(fromDisplay({ text: '【手机号】 / 【邮箱】' }, names)).toEqual({ text: '{{private:phone}} / 【邮箱】' });
  });

  it('draws tokens as labels sized from the value shape', () => {
    const labels = previewLabels(privacy)!;
    expect(labels.get('name')).toEqual({ name: '姓名', width: 2, empty: false });
    expect(labels.get('phone')).toMatchObject({ name: '手机号', empty: true });
    expect(labels.get('link:a')?.name).toBe('领英');
    const html = renderToStaticMarkup(
      <PrivateLabels.Provider value={labels}>{privateText('联系{{private:name}}')}</PrivateLabels.Provider>,
    );
    expect(html).toContain('data-private="name"');
    expect(html).not.toContain('{{private:');
    expect(privateText('没有占位')).toBe('没有占位');
  });

  it('knows the platform of a hidden link address, for its icon', () => {
    expect(previewLabels(privacy)!.get('link:a')?.site).toBe('linkedin');
    expect(sealedSite(privacy, ' {{private:link:a}} ')).toBe('linkedin');
    expect(sealedSite(privacy, '{{private:link:b}}')).toBeUndefined();
    expect(sealedSite(privacy, 'linkedin.com/in/demo')).toBeUndefined();
  });
});

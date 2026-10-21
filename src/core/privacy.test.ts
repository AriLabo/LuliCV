import { describe, expect, it } from 'vitest';
import { sampleRecord } from './fixtures';
import { normalizeDocument } from './document';
import { createResumeRecord, sampleResumeInput } from './defaults';
import {
  defaultPrivacy,
  describePrivate,
  emptyStore,
  fillPrivate,
  loosens,
  normalizePrivacy,
  planPrivacy,
  PrivacyView,
  sealPrivate,
  setPrivateValue,
  type PrivacySettings,
  type PrivateField,
  type PrivateStore,
} from './privacy';
import type { ResumeDocument } from './types';

const all: PrivacySettings = { enabled: true, fields: ['name', 'phone', 'email', 'photo', 'location', 'links'] };
const off: PrivacySettings = { enabled: false, fields: all.fields };
function person(name: string, phone: string, email: string): ResumeDocument {
  const document = normalizeDocument(sampleRecord(`${name} · 后端`));
  Object.assign(document.data.basics, {
    name,
    phone,
    email,
    links: [
      { id: 'wechat', label: '微信', url: 'wx-example-zs' },
      { id: 'site', label: '个人网站', url: 'https://example.com' },
    ],
  });
  document.data.sections[0].text = `联系 ${name}：138 0000 0000，或写信到 ${email.toUpperCase()}；作品见 example.com/work，不是 myexample.com`;
  return document;
}
const real = ['张三', '13800000000', '138 0000 0000', 'example@example.com', 'EXAMPLE@EXAMPLE.COM', 'wx-example-zs'];
const leaks = (value: unknown) => real.filter((text) => JSON.stringify(value).includes(text));
/** Privacy mode turned on over the given resumes, as the Bridge does it. */
function enable(documents: ResumeDocument[], settings = all, choices = {}, history: ResumeDocument[] = documents) {
  return planPrivacy({ settings: defaultPrivacy, store: emptyStore(), documents, history }, settings, choices);
}
const sealed = (document: ResumeDocument, store: PrivateStore, settings = all) =>
  sealPrivate(document, settings, store);

describe('privacy settings', () => {
  it('accepts known fields only and lets agents tighten but never loosen', () => {
    expect(normalizePrivacy({ enabled: true, fields: ['email', 'name'] })).toEqual({
      enabled: true,
      fields: ['name', 'email'],
    });
    for (const bad of [
      null,
      [],
      { enabled: 'yes', fields: [] },
      { enabled: true, fields: ['salary'] },
      { enabled: true, fields: [], extra: 1 },
    ])
      expect(() => normalizePrivacy(bad)).toThrow();
    const on = { enabled: true, fields: defaultPrivacy.fields };
    expect(loosens(defaultPrivacy, on)).toBe(false);
    expect(loosens(on, { enabled: true, fields: [...on.fields, 'links'] })).toBe(false);
    expect(loosens(on, { enabled: false, fields: on.fields })).toBe(true);
    expect(loosens(on, { enabled: true, fields: ['name'] })).toBe(true);
  });
});

describe('turning privacy mode on and off', () => {
  const mine = person('张三', '13800000000', 'example@example.com');

  it('moves every value into the store and leaves tokens in the resume, in any common formatting', () => {
    const plan = enable([mine]);
    expect(plan.conflicts).toEqual([]);
    const [stored] = plan.documents;
    expect(leaks(stored)).toEqual([]);
    expect(stored.data.basics).toMatchObject({
      name: '{{private:name}}',
      phone: '{{private:phone}}',
      email: '{{private:email}}',
      links: [
        { id: 'wechat', label: '微信', url: '{{private:link:wechat}}' },
        { id: 'site', label: '个人网站', url: '{{private:link:site}}' },
      ],
    });
    expect(stored.name).toBe('{{private:name}} · 后端');
    expect(stored.data.sections[0].text).toBe(
      '联系 {{private:name}}：{{private:phone}}，或写信到 {{private:email}}；作品见 {{private:link:site}}/work，不是 myexample.com',
    );
    // A private value is replaced wherever it appears, even where it is not personal (the city of a job).
    expect(stored.data.sections[1].entries[0]).toEqual({
      ...mine.data.sections[1].entries[0],
      location: '{{private:location}}',
    });
    expect(plan.store.values).toMatchObject({
      name: '张三',
      phone: '13800000000',
      email: 'example@example.com',
      'link:wechat': 'wx-example-zs',
    });
    expect(plan.store.labels).toEqual({ 'link:wechat': '微信', 'link:site': '个人网站' });
    expect(plan.moved.find((item) => item.field === 'phone')).toEqual({
      field: 'phone',
      label: '电话',
      resumes: 1,
      places: 2,
    });
    // Export puts back exactly the value, in its stored formatting.
    expect(fillPrivate(stored, plan.settings, plan.store).data.basics).toEqual(mine.data.basics);
  });
  it('covers personal details in their own field only, since their short words also turn up in ordinary text', () => {
    const detailed = structuredClone(mine);
    Object.assign(detailed.data.basics, {
      gender: '男',
      birthDate: '2000.05',
      politicalStatus: '群众',
      hometown: '杭州',
    });
    detailed.data.sections[0].text = '2000.05 起在杭州参加群众文化活动';
    const settings = { enabled: true, fields: defaultPrivacy.fields };
    expect(settings.fields).toEqual(expect.arrayContaining(['birthDate', 'hometown', 'politicalStatus']));
    const plan = enable([detailed], settings);
    const [stored] = plan.documents;
    expect(stored.data.basics).toMatchObject({
      gender: '男',
      birthDate: '{{private:birthDate}}',
      politicalStatus: '{{private:politicalStatus}}',
      hometown: '{{private:hometown}}',
    });
    expect(stored.data.sections[0].text).toBe('2000.05 起在杭州参加群众文化活动');
    expect(plan.store.values).toMatchObject({ birthDate: '2000.05', politicalStatus: '群众', hometown: '杭州' });
    expect(fillPrivate(stored, plan.settings, plan.store).data.basics).toEqual(detailed.data.basics);
    const view = new PrivacyView(plan.settings, plan.store);
    expect(view.patterns().some(({ field }) => ['birthDate', 'hometown', 'politicalStatus'].includes(field))).toBe(
      false,
    );
    expect(view.mask(detailed).data.basics).toMatchObject({
      birthDate: '{{private:birthDate}}',
      hometown: '{{private:hometown}}',
    });
  });
  it('leaves fields that are not private', () => {
    const plan = enable([mine], { enabled: true, fields: ['phone'] });
    expect(plan.documents[0].data.basics).toMatchObject({
      name: '张三',
      phone: '{{private:phone}}',
      email: 'example@example.com',
    });
    expect(Object.keys(plan.store.values)).toEqual(['phone']);
  });
  it('asks which value to export when the resumes disagree, and covers the others', () => {
    const other = person('张三', '13911112222', 'example@example.com');
    const plan = enable([mine, other]);
    expect(plan.documents).toEqual([]);
    expect(plan.conflicts).toEqual([
      {
        field: 'phone',
        label: '电话',
        options: [
          { value: '13800000000', resumes: 1, mentions: 2 },
          { value: '13911112222', resumes: 1, mentions: 0 },
        ],
      },
    ]);
    const chosen = enable([mine, other], all, { phone: '139-1111-2222' });
    expect(chosen.conflicts).toEqual([]);
    expect(chosen.store.values.phone).toBe('13911112222');
    expect(chosen.store.aliases).toContainEqual({ key: 'phone', value: '13800000000' });
    expect(chosen.documents.map((document) => document.data.basics.phone)).toEqual([
      '{{private:phone}}',
      '{{private:phone}}',
    ]);
    expect(leaks(chosen.documents)).toEqual([]);
  });
  it('covers values that only older revisions had', () => {
    const older = person('张三', '13700000000', 'old@example.org');
    const plan = enable([mine], all, {}, [older, mine]);
    expect(plan.store.aliases).toEqual(
      expect.arrayContaining([
        { key: 'phone', value: '13700000000' },
        { key: 'email', value: 'old@example.org' },
      ]),
    );
    expect(new PrivacyView(all, plan.store).mask(older).data.sections[0].text).not.toContain(
      'old@example.org'.toUpperCase(),
    );
  });
  it('fills the values back when turned off, and keeps them for older revisions', () => {
    const on = enable([mine]);
    const [stored] = on.documents;
    const turnedOff = planPrivacy({ settings: all, store: on.store, documents: [stored], history: [] }, off);
    expect(turnedOff.documents[0].data.basics).toEqual(mine.data.basics);
    expect(turnedOff.documents[0].name).toBe(mine.name);
    // Other spellings in the text come back in the stored formatting.
    expect(turnedOff.documents[0].data.sections[0].text).toBe(
      '联系 张三：13800000000，或写信到 example@example.com；作品见 https://example.com/work，不是 myexample.com',
    );
    expect(turnedOff.restored.find((item) => item.field === 'name')).toEqual({
      field: 'name',
      label: '姓名',
      resumes: 1,
    });
    // A tokenized revision restored later is filled from the inactive store.
    expect(sealPrivate(stored, off, turnedOff.store).document.data).toEqual(turnedOff.documents[0].data);
    // Removing one field fills only that one.
    const fewer = planPrivacy(
      { settings: all, store: on.store, documents: [stored], history: [] },
      { enabled: true, fields: all.fields.filter((field) => field !== 'phone') },
    );
    expect(fewer.documents[0].data.basics).toMatchObject({ phone: '13800000000', name: '{{private:name}}' });
    expect(fewer.documents[0].data.sections[0].text).toContain('：13800000000，');
  });
  it('starts again from the resumes when a field is made private again', () => {
    const on = enable([mine]);
    const turnedOff = planPrivacy({ settings: all, store: on.store, documents: on.documents, history: [] }, off);
    const changed = structuredClone(turnedOff.documents[0]);
    changed.data.basics.phone = '13911112222';
    const again = planPrivacy({ settings: off, store: turnedOff.store, documents: [changed], history: [] }, all);
    expect(again.store.values.phone).toBe('13911112222');
    expect(again.store.aliases).toContainEqual({ key: 'phone', value: '13800000000' });
  });
});

describe('sealing a write', () => {
  const {
    store,
    documents: [stored],
  } = enable([person('张三', '13800000000', 'example@example.com')]);

  it('stores tokens as they are and turns real values typed anywhere into tokens, with a note', () => {
    expect(sealed(stored, store)).toEqual({ document: stored, store, notes: [] });
    const edited = structuredClone(stored);
    edited.data.basics.phone = '138-0000-0000';
    edited.data.sections[1].title = '张三的工作经历 {{private:email}}';
    const result = sealed(edited, store);
    expect(result.document.data.basics.phone).toBe('{{private:phone}}');
    expect(result.document.data.sections[1].title).toBe('{{private:name}}的工作经历 {{private:email}}');
    expect(result.notes).toEqual(['写入的姓名已换成 {{private:name}}', '写入的电话已换成 {{private:phone}}']);
    expect(result.store).toEqual(store);
  });
  it('lets tokens be copied and moved, but not invented', () => {
    const copied = structuredClone(stored);
    copied.data.basics.headline = '{{private:phone}} · {{private:link:wechat}}';
    expect(sealed(copied, store).document.data.basics.headline).toBe('{{private:phone}} · {{private:link:wechat}}');
    for (const token of ['{{private:salary}}', '{{private:link:unknown}}', '{{private:link}}', '{{private:other}}']) {
      const invented = structuredClone(stored);
      invented.data.basics.headline = token;
      expect(() => sealed(invented, store), token).toThrow('不是可用的隐私占位');
    }
    // A token of a field that is no longer private gets its value back.
    const phone = structuredClone(stored);
    phone.data.basics.headline = '{{private:phone}}';
    expect(
      sealed(phone, store, { enabled: true, fields: ['name'] as PrivateField[] }).document.data.basics.headline,
    ).toBe('13800000000');
  });
  it('refuses a different value in a private field, which changes only through the store', () => {
    const edited = structuredClone(stored);
    edited.data.basics.phone = '13700000000';
    expect(() => sealed(edited, store)).toThrow('隐私信息');
  });
  it('takes a value into the store when the field has none yet, and a new link as its own key', () => {
    const empty = structuredClone(store);
    delete empty.values.location;
    const edited = structuredClone(stored);
    edited.data.basics.location = '杭州';
    edited.data.basics.links.push({ id: 'wechat', label: '领英', url: 'https://linkedin.example.com/in/example' });
    const result = sealed(edited, empty);
    expect(result.document.data.basics.location).toBe('{{private:location}}');
    expect(result.document.data.basics.links[2].url).toBe('{{private:link:wechat-2}}');
    expect(result.store.values).toMatchObject({
      location: '杭州',
      'link:wechat-2': 'https://linkedin.example.com/in/example',
    });
    expect(result.store.labels['link:wechat-2']).toBe('领英');
    expect(result.notes).toEqual([
      '所在地已收进隐私信息，简历里换成 {{private:location}}',
      '链接「领英」的地址已收进隐私信息，简历里换成 {{private:link:wechat-2}}',
    ]);
  });
  it('keeps a link name readable but covers the real name inside it', () => {
    const edited = structuredClone(stored);
    edited.data.basics.links.push(
      { id: 'xhs', label: '小红书 @张三的耳饰铺', url: '', show: 'label' },
      { id: 'shop', label: '小红书 @耳饰小铺', url: '', show: 'label' },
    );
    const labels = sealed(edited, store).document.data.basics.links.map((link) => link.label);
    expect(labels.slice(-2)).toEqual(['小红书 @{{private:name}}的耳饰铺', '小红书 @耳饰小铺']);
  });
  it('never replaces inside a token or in the theme settings', () => {
    const tricky = { ...store, values: { ...store.values, name: 'private' } };
    const edited = structuredClone(stored);
    edited.data.basics.headline = 'private {{private:phone}}';
    expect(sealed(edited, tricky).document.data.basics.headline).toBe('{{private:name}} {{private:phone}}');
    const themed = structuredClone(stored);
    (themed.appearance as unknown as Record<string, unknown>).themeId = '张三';
    expect(sealed(themed, store).document.appearance.themeId).toBe('张三');
  });
  it('does nothing with privacy mode off', () => {
    const plain = person('张三', '13800000000', 'example@example.com');
    expect(sealPrivate(plain, off, store)).toEqual({ document: plain, store, notes: [] });
  });
});

describe('the stored values', () => {
  const { store } = enable([person('张三', '13800000000', 'example@example.com')]);

  it('are replaced one at a time, keeping the old value covered', () => {
    const next = setPrivateValue(all, store, 'phone', ' 13911112222 ');
    expect(next.values.phone).toBe('13911112222');
    expect(next.aliases).toContainEqual({ key: 'phone', value: '13800000000' });
    expect(setPrivateValue(all, next, 'phone', '13800000000').aliases).toContainEqual({
      key: 'phone',
      value: '13911112222',
    });
    expect(setPrivateValue(all, store, 'photo', 'data:image/png;base64,iVBORw0KGgo=').values.photo).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    );
  });
  it('refuse fields that are not private, unknown links, tokens and bad photos', () => {
    expect(() => setPrivateValue({ enabled: true, fields: ['name'] }, store, 'phone', '1')).toThrow('不是已开启');
    expect(() => setPrivateValue(off, store, 'name', '李四')).toThrow('不是已开启');
    expect(() => setPrivateValue(all, store, 'link:unknown', 'x')).toThrow('没有链接');
    expect(() => setPrivateValue(all, store, 'name', '{{private:email}}')).toThrow('占位');
    expect(() => setPrivateValue(all, store, 'photo', 'https://example.com/a.png')).toThrow('data URL');
    expect(() => setPrivateValue(all, store, 'name', 42)).toThrow('字符串');
    expect(() => setPrivateValue(all, store, 'link:wechat', `https://example.com/${'a'.repeat(481)}`)).toThrow(
      '链接最多 500 个字符',
    );
  });
  it('are described by whether they are filled, and their shape for the web page only', () => {
    const description = describePrivate(all, store);
    expect(JSON.stringify(description)).not.toMatch(/张三|13800000000|example@example\.com|wx-example-zs/);
    expect(description.fields.name).toEqual({
      filled: true,
      length: 2,
      shape: { han: 2, digit: 0, latin: 0, other: 0 },
    });
    expect(description.fields.photo).toEqual({ filled: false });
    expect(description.links).toEqual([
      { key: 'link:wechat', label: '微信', filled: true, length: 13, shape: { han: 0, digit: 0, latin: 11, other: 2 } },
      {
        key: 'link:site',
        label: '个人网站',
        filled: true,
        length: 19,
        shape: { han: 0, digit: 0, latin: 15, other: 4 },
      },
    ]);
    expect(describePrivate(all, store, false).fields.phone).toEqual({ filled: true });
    expect(describePrivate(off, store)).toEqual({ fields: {}, links: [] });
  });
  it('tell the web page which platform a link is on, so its icon matches the exported PDF', () => {
    const linked = setPrivateValue(all, store, 'link:site', 'https://www.xiaohongshu.com/user/profile/demo');
    expect(describePrivate(all, linked).links.map((link) => link.site)).toEqual([undefined, 'xiaohongshu']);
    expect(describePrivate(all, linked, false).links[1]).not.toHaveProperty('site');
  });
});

describe('PrivacyView', () => {
  const mine = person('张三', '13800000000', 'example@example.com');
  const { store } = enable([mine]);
  const view = new PrivacyView(all, store);

  it('masks real values left in revisions from before privacy mode, and anything a response quotes', () => {
    const masked = view.mask(mine);
    expect(leaks(masked)).toEqual([]);
    expect(masked.data.basics.links[0].url).toBe('{{private:link:wechat}}');
    expect(
      view.protect({ message: '张三 的简历里有 example@example.com', pages: ['张三'] }, (key) => key === 'pages'),
    ).toEqual({ message: '{{private:name}} 的简历里有 {{private:email}}', pages: ['张三'] });
  });
  it('shows a private field that holds an unknown value as its token, and an unknown link as the generic one', () => {
    const odd = structuredClone(mine);
    odd.data.basics.phone = '13700000000';
    odd.data.basics.links[0].url = 'https://unknown.example.org';
    expect(view.mask(odd).data.basics).toMatchObject({
      phone: '{{private:phone}}',
      links: [{ url: '{{private:link}}' }, { url: '{{private:link:site}}' }],
    });
  });
  it('gives the renderer patterns for every private value but never for the photo', () => {
    const withPhoto = setPrivateValue(all, store, 'photo', 'data:image/png;base64,iVBORw0KGgo=');
    const patterns = new PrivacyView(all, withPhoto).patterns().map(({ pattern }) => new RegExp(pattern, 'i'));
    for (const text of ['张三', '138-0000-0000', '+86 138 0000 0000', 'Example@Example.com', 'www.example.com'])
      expect(
        patterns.some((pattern) => pattern.test(text)),
        text,
      ).toBe(true);
    expect(patterns.some((pattern) => pattern.test('iVBORw0KGgo'))).toBe(false);
  });
});

describe('the built-in example', () => {
  const saved = normalizeDocument({ ...createResumeRecord(), ...sampleResumeInput() });
  const example = () => structuredClone(saved);
  // Lives in 上海 and links example.com, both of which the example's own text also mentions.
  const mine = person('张三', '13900000000', 'zhangsan@example.org');
  const exposed = (value: unknown) =>
    ['张三', '13900000000', 'zhangsan@example.org', 'wx-example-zs'].filter((text) =>
      JSON.stringify(value).includes(text),
    );
  const fictitious = (document: ResumeDocument) =>
    expect(document.data.basics).toMatchObject({
      name: '林夏',
      phone: '13800000000',
      email: 'linxia@example.com',
      location: '杭州',
      links: [{ url: '' }, { url: 'https://example.com/linxia' }],
    });

  it('keeps its fictitious details out of the store when saved in privacy mode', () => {
    const empty = sealed(example(), emptyStore());
    expect(empty.document).toEqual(example());
    fictitious(empty.document);
    expect(empty).toMatchObject({ store: emptyStore(), notes: [] });
    // With the person's own details stored, saving the example is neither refused nor filled with them.
    const { store } = enable([mine]);
    const result = sealed(example(), store);
    expect(result.document).toEqual(example());
    expect(result.store).toEqual(store);
    expect(new PrivacyView(all, store).mask(example())).toEqual(example());
  });
  it('treats anything else in it as private, so a sample mark alone exempts nothing', () => {
    const typed = example();
    typed.data.basics.name = '张三';
    const result = sealed(typed, emptyStore());
    expect(result.document.data.basics).toMatchObject({ name: '{{private:name}}', phone: '13800000000' });
    expect(result.store.values).toEqual({ name: '张三' });
    // A file that carries the mark but someone's real details.
    const marked = { ...mine, sample: true as const };
    expect(exposed(sealed(marked, emptyStore()).document)).toEqual([]);
    expect(exposed(new PrivacyView(all, enable([mine]).store).mask(marked))).toEqual([]);
    // Without the mark, the example's details are handled like anyone's.
    const { sample: _mark, ...unmarked } = example();
    expect(sealed(unmarked, emptyStore()).store.values).toMatchObject({ name: '林夏', phone: '13800000000' });
  });
  it('leaves only the example’s own wording as it is, not the same city typed anywhere else', () => {
    const { store } = enable([mine]);
    const typed = example();
    typed.data.sections[0].text += '现居上海。';
    const [first, second] = typed.data.sections[1].entries as Array<{ location: string; company: string }>;
    first.location = '上海';
    for (const document of [sealed(typed, store).document, new PrivacyView(all, store).mask(typed)]) {
      const [mineNow, exampleStill] = document.data.sections[1].entries as (typeof first)[];
      expect(document.data.sections[0].text).toMatch(/现居\{\{private:location\}\}。$/);
      expect(mineNow.location).toBe('{{private:location}}');
      expect(exampleStill).toMatchObject({ location: '上海', company: second.company });
    }
  });
  it('gives way to the person’s details once the mark is cleared, and stores none of the example’s', () => {
    const { sample: _mark, ...cleared } = example();
    const { store } = enable([mine]);
    for (const before of [store, emptyStore()]) {
      const result = sealPrivate(cleared, all, before, example());
      expect(result.store).toEqual(before);
      expect(result.document.data.basics).toMatchObject({
        name: '{{private:name}}',
        phone: '{{private:phone}}',
        email: '{{private:email}}',
        location: '{{private:location}}',
        links: [{ url: '' }, { url: '' }],
      });
    }
  });
  it('takes no part when privacy mode is turned on next to the person’s own resume', () => {
    const plan = enable([mine, example()]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.store.values).toMatchObject({ name: '张三', phone: '13900000000', email: 'zhangsan@example.org' });
    expect(Object.values(plan.store.values)).not.toContain('https://example.com/linxia');
    expect(plan.store.aliases).toEqual([]);
    expect(plan.documents).toHaveLength(1);
    expect(plan.documents[0].data.basics.name).toBe('{{private:name}}');
  });
});

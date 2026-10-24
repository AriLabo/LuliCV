import { expect, it } from 'vitest';
import { normalizeDocument } from '../core/document';
import { sampleRecord } from './fixtures';
import { formatChanges, listChanges, summarizeChanges } from '../core/change-summary';
import type { ExperienceEntry, ResumeDocument } from '../core/types';

const base = () => normalizeDocument(sampleRecord());
const edit = (document: ResumeDocument, change: (copy: ResumeDocument) => void) => {
  const copy = structuredClone(document);
  change(copy);
  return copy;
};

it('describes edits in readable Chinese', () => {
  const before = base();
  const after = edit(before, (copy) => {
    copy.data.basics.headline = '后端工程师';
    (copy.data.sections[1].entries[0] as ExperienceEntry).bullets[1] = '改写后的成果';
    copy.appearance.themeId = 'minimal';
    copy.name = '新名字';
  });
  expect(summarizeChanges(before, after)).toEqual([
    '简历名称',
    '主题',
    '基本信息 · 目标职位',
    '「工作经历」 · 「示例科技有限公司」 · 第 2 条要点',
  ]);
  expect(
    summarizeChanges(
      before,
      edit(before, (copy) => {
        (copy.data.sections[1].entries[0] as ExperienceEntry).bullets.push('新增的成果');
      }),
    ),
  ).toEqual(['「工作经历」 · 「示例科技有限公司」 · 要点']);
  expect(formatChanges(['简历名称', '投递目标', '基本信息 · 邮箱', '基本信息 · 电话'])).toBe(
    '简历名称、投递目标、基本信息 · 邮箱 等 4 处',
  );
  expect(formatChanges([])).toBe('');
});

it('names deleted sections and entries from the version before, and moves as a new order', () => {
  const before = base();
  // Removing the first section shifts every index; matching by id still names only what went away.
  const withoutSummary = edit(before, (copy) => {
    copy.data.sections.shift();
  });
  expect(summarizeChanges(before, withoutSummary)).toEqual(['「个人简介」栏目（已删除）']);
  const withoutEntry = edit(before, (copy) => {
    copy.data.sections[4].entries.shift();
  });
  expect(summarizeChanges(before, withoutEntry)).toEqual(['「专业技能」 · 「工程」（已删除）']);
  const added = edit(before, (copy) => {
    copy.data.sections.push({
      id: 'awards',
      type: 'custom',
      title: '获奖情况',
      visible: true,
      layout: { pageBreakBefore: false },
      entries: [],
    });
  });
  expect(summarizeChanges(before, added)).toEqual(['「获奖情况」栏目（新增）']);
  const moved = edit(before, (copy) => {
    copy.data.sections.splice(1, 2, copy.data.sections[2], copy.data.sections[1]);
    copy.data.sections[4].entries.reverse();
  });
  expect(summarizeChanges(before, moved)).toEqual(['「专业技能」 · 条目顺序', '栏目顺序']);
  const renamed = edit(before, (copy) => {
    copy.data.sections[1].title = '实习经历';
  });
  expect(summarizeChanges(before, renamed)).toEqual(['「工作经历」 · 标题（改为「实习经历」）']);
});

it('reads each change from any version by id, not by position', () => {
  const before = base();
  const after = edit(before, (copy) => {
    copy.data.sections.shift();
    copy.data.sections[3].entries.reverse();
  });
  const [deleted, moved] = listChanges(before, after);
  // The deleted section is found in the version that has it and is absent from the one that does not.
  expect(deleted.pick(before)).toEqual(before.data.sections[0]);
  expect(deleted.pick(after)).toBeUndefined();
  // The entry order is read from the section's own id, wherever that section now sits.
  expect(moved.pick(after)).toEqual(after.data.sections[3].entries.map((entry) => entry.id));
  expect(moved.pick(before)).toEqual(before.data.sections[4].entries.map((entry) => entry.id));
});

it('groups consecutive commits from one source, an agent round included, but never a restore', async () => {
  const { groupRevisions } = await import('./ChangeHistory');
  const minute = 60_000;
  const revision = (number: number, source: string, at: number, changes: string[], restoredFrom?: number) => ({
    revision: number,
    source,
    createdAt: at * minute,
    created: number === 1,
    changes,
    ...(restoredFrom ? { restoredFrom } : {}),
  });
  const groups = groupRevisions([
    revision(9, 'human', 21, ['简历名称']),
    revision(8, 'human', 20.5, [], 4),
    revision(7, 'agent', 20, ['基本信息 · 邮箱']),
    revision(6, 'agent', 10, ['基本信息 · 目标职位']),
    revision(5, 'agent', 9.9, ['简历名称']),
    revision(4, 'human', 9, ['基本信息 · 姓名']),
    revision(3, 'human', 8, ['基本信息 · 姓名', '基本信息 · 邮箱']),
    revision(2, 'human', 1, ['基本信息 · 电话']),
    revision(1, 'human', 0.5, []),
  ]);
  expect(groups.map((group) => [group.source, group.from, group.to, group.count, group.restoredFrom])).toEqual([
    ['human', 9, 9, 1, undefined],
    ['human', 8, 8, 1, 4],
    ['agent', 7, 7, 1, undefined],
    ['agent', 5, 6, 2, undefined],
    ['human', 3, 4, 2, undefined],
    ['human', 2, 2, 1, undefined],
    ['human', 1, 1, 1, undefined],
  ]);
  expect(groups[3].changes).toEqual(['基本信息 · 目标职位', '简历名称']);
  expect(groups[4].changes).toEqual(['基本信息 · 姓名', '基本信息 · 邮箱']);
  expect(groups[6].created).toBe(true);
});

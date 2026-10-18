import { describe, expect, it } from 'vitest';
import { cloneSample } from './fixtures';
import { chineseTypographyWarnings } from './typography';
import type { ExperienceEntry } from './types';

describe('chineseTypographyWarnings', () => {
  it('passes the shipped sample', () => {
    expect(chineseTypographyWarnings(cloneSample())).toEqual([]);
  });
  it('flags clear mistakes with the place, a quote and the data path', () => {
    const data = cloneSample();
    const bullets = (data.sections[1].entries[0] as ExperienceEntry).bullets;
    bullets[0] = '负责核心平台,持续改善稳定性';
    data.basics.headline = '后端工程师（Ｇｏ）';
    const warnings = chineseTypographyWarnings(data);
    expect(warnings).toContainEqual(
      expect.stringMatching(
        /^「工作经历」 · 示例科技有限公司 · 第 1 条要点：中文句子中间用了半角标点.*「.*平台,持续.*」\[sections\[1\]\.entries\[0\]\.bullets\[0\]\]$/,
      ),
    );
    expect(warnings).toContainEqual(expect.stringMatching(/^基本信息 · 目标职位：有全角字母或数字/));
  });
  it('leaves consistent personal style and standard connectors alone', () => {
    const data = cloneSample();
    const entry = data.sections[1].entries[0] as ExperienceEntry;
    // Half-width brackets everywhere, a single-dash connector, a comma before Latin text.
    entry.bullets = [
      '设计灰度发布—自动回滚流程(MTTR 缩短 62%)',
      '负责网关(高并发)与订单链路',
      'Built a gateway, cut p99 by 70%.',
      '熟悉 Go, Java 与 Kafka',
    ];
    entry.startDate = '2021.04';
    entry.endDate = '2022.06';
    expect(chineseTypographyWarnings(data)).toEqual([]);
  });
  it('reports mixed styles once, pointing at the less used one', () => {
    const data = cloneSample();
    const entry = data.sections[1].entries[0] as ExperienceEntry;
    entry.bullets = ['负责网关（高并发）建设', '主导订单（核心链路）重构', '推动规范(工程效率)落地'];
    entry.startDate = '2021-04';
    const warnings = chineseTypographyWarnings(data);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^中文括号写法不统一：多数用全角（），1 处用了半角\(\)：「工作经历」 · 示例科技有限公司 · 第 3 条要点/,
    );
    entry.endDate = '2022.06';
    expect(chineseTypographyWarnings(data)).toContainEqual(expect.stringMatching(/^日期写法不统一/));
  });
});

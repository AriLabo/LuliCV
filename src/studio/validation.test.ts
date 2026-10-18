import { describe, expect, it } from 'vitest';
import { sampleResume } from './fixtures';
import { isResumeData, validateResumeData } from './validation';

describe('ResumeData validation', () => {
  it('accepts the complete v1 fixture', () => {
    expect(validateResumeData(sampleResume)).toEqual([]);
    expect(isResumeData(sampleResume)).toBe(true);
  });

  it('reports nested fields with useful paths', () => {
    const value = structuredClone(sampleResume) as unknown as Record<string, unknown>;
    const sections = value.sections as Array<Record<string, unknown>>;
    delete sections[0].layout;
    const experience = (sections[1].entries as Array<Record<string, unknown>>)[0];
    experience.bullets = ['ok', 42];
    delete experience.company;

    const errors = validateResumeData(value);
    expect(errors).toContain('sections[0].layout 缺失，应为对象');
    expect(errors).toContain('sections[1].entries[0].bullets[1] 必须是字符串');
    expect(errors).toContain('sections[1].entries[0].company 缺失，应为字符串');
    // One message per problem, all in Chinese: no echo of the schema validator's English.
    expect(errors).toHaveLength(3);
  });

  it('checks the optional personal details as short strings, letting a privacy placeholder through', () => {
    const value = structuredClone(sampleResume);
    Object.assign(value.basics, {
      gender: '男',
      birthDate: '{{private:birthDate}}',
      politicalStatus: '群众',
      hometown: '上海',
      yearsOfExperience: '3 年',
    });
    expect(validateResumeData(value)).toEqual([]);
    (value.basics as unknown as Record<string, unknown>).gender = 1;
    value.basics.hometown = '上'.repeat(21);
    const errors = validateResumeData(value);
    expect(errors).toContain('basics.gender 必须是字符串');
    expect(errors).toContain('basics.hometown（籍贯）最多 20 个字');
  });

  it('rejects duplicate stable ids', () => {
    const value = structuredClone(sampleResume);
    value.sections[1].id = value.sections[0].id;
    value.sections[2].entries[0].id = value.sections[1].entries[0].id;

    const errors = validateResumeData(value);
    expect(errors.some((error) => error.includes('栏目重复'))).toBe(true);
    expect(errors.some((error) => error.includes('条目重复'))).toBe(true);
    expect(isResumeData(value)).toBe(false);
  });

  it('refuses blank ids, unknown fields and an unknown section type', () => {
    const value = structuredClone(sampleResume) as unknown as Record<string, unknown>;
    const sections = value.sections as Array<Record<string, unknown>>;
    sections[1].id = '  ';
    (sections[2].entries as Array<Record<string, unknown>>)[0].tags = ['x'];
    sections[3].type = 'awards';
    expect(validateResumeData(value)).toEqual([
      'sections[1].id 不能为空',
      'sections[2].entries[0].tags 不是可用的字段',
      'sections[3].type 必须是 summary、experience、projects、education、skills、custom',
    ]);
  });
});

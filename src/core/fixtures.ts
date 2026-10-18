import type { ResumeData } from './types';

const layout = { pageBreakBefore: false };

export const sampleResume: ResumeData = {
  schemaVersion: 1,
  basics: {
    name: '张三',
    headline: '高级软件工程师 · Agent 应用开发',
    phone: '13800000000',
    email: 'example@example.com',
    location: '上海',
    links: [
      { id: 'link-site', label: '个人网站', url: 'https://example.com' },
      { id: 'link-github', label: 'GitHub', url: 'https://github.com/example' },
    ],
  },
  sections: [
    {
      id: 'summary',
      type: 'summary',
      title: '个人简介',
      visible: true,
      layout: { ...layout },
      entries: [],
      text: '专注于可靠、可维护的软件系统，擅长把复杂需求拆成清晰的产品与工程方案。',
    },
    {
      id: 'experience',
      type: 'experience',
      title: '工作经历',
      visible: true,
      layout: { ...layout },
      entries: [
        {
          id: 'experience-1',
          company: '示例科技有限公司',
          role: '高级软件工程师',
          location: '上海',
          startDate: '2021.04',
          endDate: '至今',
          description: '',
          bullets: [
            '负责核心业务平台的架构与交付，持续改善稳定性、性能和开发体验。',
            '推动跨团队协作与工程规范落地，将关键流程的交付周期缩短约 30%。',
          ],
        },
      ],
    },
    {
      id: 'projects',
      type: 'projects',
      title: '项目经历',
      visible: true,
      layout: { ...layout },
      entries: [
        {
          id: 'project-1',
          name: '本地知识工作台',
          subtitle: '技术负责人',
          date: '2023 — 2024',
          link: 'https://example.com/project',
          description: '',
          bullets: ['设计并实现离线优先的数据模型、检索体验和可扩展渲染层。'],
        },
      ],
    },
    {
      id: 'education',
      type: 'education',
      title: '教育背景',
      visible: true,
      layout: { ...layout },
      entries: [
        {
          id: 'education-1',
          school: '示例大学',
          degree: '工学学士',
          major: '计算机科学与技术',
          date: '2013 — 2017',
          additional: '',
          bullets: [],
        },
      ],
    },
    {
      id: 'skills',
      type: 'skills',
      title: '专业技能',
      visible: true,
      layout: { ...layout },
      entries: [
        { id: 'skill-1', category: '工程', items: ['TypeScript', 'React', 'Node.js', 'Playwright'] },
        { id: 'skill-2', category: '方法', items: ['系统设计', '性能优化', '技术写作'] },
      ],
    },
  ],
};

export function cloneSample(): ResumeData {
  return structuredClone(sampleResume);
}

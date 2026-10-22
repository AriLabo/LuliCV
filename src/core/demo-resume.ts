import type { ResumeData } from './types';

const layout = { pageBreakBefore: false };

/**
 * The built-in example people try LuliCV on: a fictitious content-operations resume. Shown on an empty workspace and
 * created by the editor's 使用这份示例 and `lulicv import --sample`. Tests use `sampleResume` in fixtures.ts instead.
 */
export const demoResume: ResumeData = {
  schemaVersion: 1,
  basics: {
    name: '林夏',
    headline: '内容运营 · 新媒体运营',
    phone: '13800000000',
    email: 'linxia@example.com',
    location: '杭州',
    yearsOfExperience: '7 年',
    links: [
      { id: 'link-xhs', label: '林夏的内容笔记', url: '', show: 'label', icon: 'xiaohongshu' },
      { id: 'link-portfolio', label: '作品集', url: 'https://example.com/linxia', show: 'both' },
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
      text: '7 年内容运营经验，熟悉小红书、抖音和微信生态。习惯从用户需求出发做选题，用数据复盘调整内容方向，主导过品牌账号和会员社群从 0 到 1 的搭建。',
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
          company: '杭州青禾生活科技有限公司',
          role: '内容运营主管',
          location: '杭州',
          startDate: '2022.03',
          endDate: '至今',
          description: '家居生活方式品牌，负责品牌自有内容渠道。',
          bullets: [
            '负责小红书、抖音和微信公众号的内容规划，搭建选题库和月度内容日历，带领 3 人内容小组稳定产出图文与短视频。',
            '策划“一人食厨房”系列短视频，品牌抖音账号粉丝从 8 万增长到 35 万。',
            '建立每周内容复盘，按选题、封面和发布时间拆解互动数据，结论用于下个月的选题排期。',
            '与电商团队配合策划 618、双 11 的种草内容和新品上市节奏。',
          ],
        },
        {
          id: 'experience-2',
          company: '上海拾光文化传媒有限公司',
          role: '新媒体运营',
          location: '上海',
          startDate: '2019.07',
          endDate: '2022.02',
          description: '',
          bullets: [
            '负责 2 个读书与生活方式类公众号的日常运营，独立完成选题、撰稿、排版和推送，累计发布原创文章 300 余篇。',
            '策划“21 天读书打卡”社群活动，连续做了三期，共 6,000 余名用户参与。',
            '对接 40 余位作者和博主，负责约稿、审稿和发布排期。',
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
          name: '品牌会员社群搭建',
          subtitle: '项目负责人',
          date: '2023.04 — 2023.12',
          link: '',
          description: '',
          bullets: [
            '设计新人、活跃和沉睡三层会员的社群运营节奏，制定欢迎语、每周话题和福利日等固定动作。',
            '8 个月内社群用户达到 1.5 万，社群用户的复购率高于非社群用户。',
          ],
        },
        {
          id: 'project-2',
          name: '小红书账号冷启动',
          subtitle: '内容策划',
          date: '2022.04 — 2022.09',
          link: '',
          description: '',
          bullets: [
            '调研同类账号，确定“小户型收纳”切入点，统一封面和标题风格。',
            '半年内发布笔记 120 篇，账号粉丝从 0 增长到 4.2 万。',
          ],
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
          school: '临江大学',
          degree: '文学学士',
          major: '新闻学',
          date: '2015 — 2019',
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
        { id: 'skill-1', category: '内容', items: ['选题策划', '短视频脚本', '文案撰写', '社群运营'] },
        { id: 'skill-2', category: '工具', items: ['剪映', 'Premiere', 'Canva', '秀米'] },
        { id: 'skill-3', category: '数据', items: ['平台后台数据分析', 'Excel 数据透视表', '飞瓜数据'] },
      ],
    },
  ],
};

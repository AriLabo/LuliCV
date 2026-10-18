import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { renderInlineText, toggleBold } from './inline-format';

describe('inline emphasis', () => {
  it('wraps and unwraps the selected text with readable markers', () => {
    expect(toggleBold('使用 React 构建', 3, 8)).toEqual({
      value: '使用 **React** 构建',
      selectionStart: 5,
      selectionEnd: 10,
    });
    expect(toggleBold('使用 **React** 构建', 5, 10)).toEqual({
      value: '使用 React 构建',
      selectionStart: 3,
      selectionEnd: 8,
    });
  });

  it('renders emphasis as semantic strong text without interpreting HTML', () => {
    const html = renderToStaticMarkup(<>{renderInlineText('命中率 **90%**，保留 <script> 文本')}</>);
    expect(html).toContain('<strong class="resume-inline-strong">90%</strong>');
    expect(html).toContain('&lt;script&gt;');
  });
});

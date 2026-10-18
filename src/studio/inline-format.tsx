import { Fragment, type ReactNode } from 'react';
import { privateText } from './privacy';

export interface FormatSelection {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export function toggleBold(value: string, selectionStart: number, selectionEnd: number): FormatSelection {
  const selected = value.slice(selectionStart, selectionEnd);
  const wrappedOutside =
    selectionStart >= 2 &&
    value.slice(selectionStart - 2, selectionStart) === '**' &&
    value.slice(selectionEnd, selectionEnd + 2) === '**';

  if (wrappedOutside) {
    return {
      value: `${value.slice(0, selectionStart - 2)}${selected}${value.slice(selectionEnd + 2)}`,
      selectionStart: selectionStart - 2,
      selectionEnd: selectionEnd - 2,
    };
  }

  if (selected.startsWith('**') && selected.endsWith('**') && selected.length >= 4) {
    const content = selected.slice(2, -2);
    return {
      value: `${value.slice(0, selectionStart)}${content}${value.slice(selectionEnd)}`,
      selectionStart,
      selectionEnd: selectionStart + content.length,
    };
  }

  if (!selected) {
    return {
      value: `${value.slice(0, selectionStart)}****${value.slice(selectionEnd)}`,
      selectionStart: selectionStart + 2,
      selectionEnd: selectionStart + 2,
    };
  }

  return {
    value: `${value.slice(0, selectionStart)}**${selected}**${value.slice(selectionEnd)}`,
    selectionStart: selectionStart + 2,
    selectionEnd: selectionEnd + 2,
  };
}

export function renderInlineText(value: string): ReactNode {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*([\s\S]+?)\*\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index > cursor) nodes.push(privateText(value.slice(cursor, match.index)));
    nodes.push(
      <strong className="resume-inline-strong" key={`${match.index}-${match[0]}`}>
        {privateText(match[1])}
      </strong>,
    );
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) nodes.push(privateText(value.slice(cursor)));
  return nodes.length ? nodes.map((node, index) => <Fragment key={index}>{node}</Fragment>) : privateText(value);
}

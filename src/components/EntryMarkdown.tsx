'use client';

import { createContext, useContext } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { inspectChecklistLine, toggleChecklistLine } from '@/lib/checklist';

type Props = {
  body: string;
  autoChecklist: boolean;
  disabled: boolean;
  onToggle: (body: string) => void;
};

const ChecklistContext = createContext<Props | null>(null);

type MarkdownNode = {
  type: string;
  tagName?: string;
  value?: string;
  children?: MarkdownNode[];
};

function itemLabel(node: MarkdownNode): string {
  if (node.type === 'text') return node.value ?? '';
  if (node.tagName === 'input' || node.tagName === 'ul' || node.tagName === 'ol') return '';
  return node.children?.map(itemLabel).join('') ?? '';
}

const components: Components = {
  input: () => null,
  li: function ChecklistItem({ node, children, className, ...props }) {
    const context = useContext(ChecklistContext);
    if (!context) return <li {...props} className={className}>{children}</li>;
    const { body, autoChecklist, disabled, onToggle } = context;
    const offset = node?.position?.start.offset;
    const line = offset === undefined ? null : inspectChecklistLine(body, offset);
    const nested = node?.children.some(child => child.type === 'element' && (child.tagName === 'ul' || child.tagName === 'ol'));
    const interactive = line && (line.explicit || (autoChecklist && !nested));
    const label = itemLabel(node as MarkdownNode).trim().replace(/\s+/g, ' ') || '項目';
    return <li {...props} className={[className, interactive && 'markdown-check-item', interactive && line.checked && 'markdown-check-checked'].filter(Boolean).join(' ') || undefined}>
      {interactive && <button
        type="button"
        role="checkbox"
        aria-checked={line.checked}
        aria-label={label}
        className="markdown-check-toggle"
        style={{ minWidth: 44, minHeight: 44 }}
        disabled={disabled}
        onClick={() => onToggle(toggleChecklistLine(body, offset!))}
      />}
      {children}
    </li>;
  },
};

export default function EntryMarkdown(props: Props) {
  return <ChecklistContext.Provider value={props}>
    <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} components={components}>{props.body}</ReactMarkdown>
  </ChecklistContext.Provider>;
}

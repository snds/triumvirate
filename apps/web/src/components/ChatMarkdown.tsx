import { memo } from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Element, Text } from 'hast';
import { ItemChip } from './ItemChip.tsx';
import { BuildCard, type Build } from './BuildCard.tsx';
import { Sk } from './Skeleton.tsx';

// react-markdown strips unknown URL schemes; keep our item: links, sanitize everything else as usual.
const urlTransform = (url: string) => (url.startsWith('item:') ? url : defaultUrlTransform(url));

const components: Components = {
  a: ({ href, children }) => {
    if (href?.startsWith('item:')) return <ItemChip id={href.slice(5)} label={textOf(children)} />;
    return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
  },
  // ```build blocks become build cards; other code renders normally.
  pre: ({ node, children }) => {
    const code = node?.children[0] as Element | undefined;
    const classes = (code?.properties?.className as string[] | undefined) ?? [];
    if (code?.tagName === 'code' && classes.includes('language-build')) {
      const raw = (code.children[0] as Text | undefined)?.value ?? '';
      const build = parseBuild(raw);
      // While streaming, the JSON is incomplete; show a placeholder until it closes.
      return build ? <div className="reveal__content"><BuildCard build={build} /></div> : (
        <div className="build-pending" role="status">
          <span className="visually-hidden">Putting the build together</span>
          <div className="sk-row" aria-hidden><Sk kind="round" style={{ width: 40, height: 40 }} /><div className="sk-stack"><Sk kind="title" style={{ width: '60%' }} /><Sk kind="line" style={{ width: '38%' }} /></div></div>
          <div className="sk-row" aria-hidden>{[0, 1, 2, 3].map((i) => <Sk key={i} kind="block" style={{ width: 36, height: 36 }} />)}</div>
          <Sk kind="line" style={{ width: '80%' }} />
        </div>
      );
    }
    return <pre>{children}</pre>;
  },
  table: ({ children }) => <div className="md-table"><table>{children}</table></div>,
};

function parseBuild(raw: string): Build | undefined {
  try { return JSON.parse(raw) as Build; } catch { return undefined; }
}

function textOf(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(textOf).join('');
  return '';
}

// Memoized: finished replies never re-parse when the chat re-renders during a new stream.
export const ChatMarkdown = memo(function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="md">
      <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>{text}</Markdown>
    </div>
  );
});

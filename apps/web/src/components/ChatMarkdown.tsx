import { memo } from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Element, Text } from 'hast';
import { ItemChip } from './ItemChip.tsx';
import { BuildCard, type Build } from './BuildCard.tsx';

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
      return build ? <BuildCard build={build} /> : <div className="build-pending"><span className="spinner" /> Putting the build together…</div>;
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

import { useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import type { Element } from 'hast';

interface MarkdownMessageProps {
  content: string;
  accent?: 'purple' | 'violet';
  size?: 'sm' | 'xs';
}

const ACCENTS = {
  purple: {
    text: 'text-dd-purple-dark',
    ring: 'focus:ring-dd-purple/40',
    code: 'bg-dd-purple/5 text-dd-purple-dark border border-dd-purple/10',
    bullet: 'text-dd-purple-light',
    ordinal: 'text-dd-purple',
  },
  violet: {
    text: 'text-violet-400',
    ring: 'focus:ring-violet-400/40',
    code: 'bg-violet-500/10 text-violet-400',
    bullet: 'text-violet-400',
    ordinal: 'text-violet-400',
  },
} as const;

type Accent = (typeof ACCENTS)[keyof typeof ACCENTS];

// Preview/source toggle + copy toolbar for AI-returned markdown. Rendering
// goes through react-markdown + remark-gfm (tables, strikethrough, task
// lists) instead of the old hand-rolled line-by-line parser, and stays
// text-only (no rehype-raw) since content is model-generated and unsanitized.
export default function MarkdownMessage({ content, accent = 'purple', size = 'sm' }: MarkdownMessageProps) {
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const a = ACCENTS[accent];
  const textSize = size === 'xs' ? 'text-xs' : 'text-sm';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  return (
    <div className="group/msg relative">
      <div className="absolute -top-2.5 right-0 hidden group-hover/msg:flex items-center gap-0.5 bg-surface-subtle border border-border rounded-full shadow-xs px-1 py-0.5 z-10">
        <button
          onClick={() => setMode((m) => (m === 'preview' ? 'source' : 'preview'))}
          title={mode === 'preview' ? 'View raw markdown' : 'View rendered preview'}
          className="px-1.5 py-0.5 rounded-full hover:bg-surface-sunken text-ink-faint hover:text-ink-muted text-[10px] leading-none font-mono"
        >
          {mode === 'preview' ? '{ }' : 'Aa'}
        </button>
        <button
          onClick={copy}
          title="Copy markdown"
          className="px-1.5 py-0.5 rounded-full hover:bg-surface-sunken text-ink-faint hover:text-ink-muted text-[10px] leading-none"
        >
          ⧉
        </button>
      </div>

      {mode === 'source' ? (
        <pre className={`${textSize} font-mono whitespace-pre-wrap break-words rounded-lg p-2.5 bg-surface-sunken border border-border text-ink-muted`}>
          {content}
        </pre>
      ) : (
        <div className={`${textSize} space-y-1.5`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={buildComponents(a, textSize)}>
            {content}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

function buildComponents(a: Accent, textSize: string) {
  return {
    h1: ({ children }: { children?: ReactNode }) => <p className={`${textSize === 'xs' ? 'text-sm' : 'text-base'} font-bold text-ink mt-3 mb-1 first:mt-0`}>{children}</p>,
    h2: ({ children }: { children?: ReactNode }) => <p className={`${textSize} font-bold text-ink mt-2 mb-1 first:mt-0`}>{children}</p>,
    h3: ({ children }: { children?: ReactNode }) => <p className={`${textSize} font-semibold text-ink-muted mt-2 first:mt-0`}>{children}</p>,
    p: ({ children }: { children?: ReactNode }) => <p className={`${textSize} text-ink-muted leading-relaxed`}>{children}</p>,
    strong: ({ children }: { children?: ReactNode }) => <strong className="font-semibold text-ink">{children}</strong>,
    em: ({ children }: { children?: ReactNode }) => <em className="text-ink-muted">{children}</em>,
    a: ({ href, children }: { href?: string; children?: ReactNode }) => (
      <a href={href} target="_blank" rel="noreferrer" className={`${a.text} underline underline-offset-2`}>{children}</a>
    ),
    hr: () => <hr className="my-3 border-border" />,
    ul: ({ children }: { children?: ReactNode }) => (
      <ul className={`list-disc pl-5 ${a.bullet.replace('text-', 'marker:text-')} space-y-1 my-1 ${textSize} text-ink-muted`}>{children}</ul>
    ),
    ol: ({ children }: { children?: ReactNode }) => (
      <ol className={`list-decimal pl-5 ${a.ordinal.replace('text-', 'marker:text-')} marker:font-semibold space-y-1 my-1 ${textSize} text-ink-muted`}>{children}</ol>
    ),
    li: ({ children }: { children?: ReactNode }) => <li className="pl-0.5">{children}</li>,
    // react-markdown v10 no longer passes an `inline` flag to `code` — a fenced
    // block's node spans multiple source lines, an inline span never does.
    code: ({ className, children, node }: { className?: string; children?: ReactNode; node?: Element }) => {
      const isBlock = node?.position ? node.position.start.line !== node.position.end.line : false;
      return isBlock ? (
        <code className={className}>{children}</code>
      ) : (
        <code className={`${a.code} text-xs px-1 py-0.5 rounded font-mono`}>{children}</code>
      );
    },
    pre: ({ children }: { children?: ReactNode }) => (
      <pre className="bg-gray-800 text-green-300 text-xs rounded-lg p-3 overflow-x-auto my-2 font-mono">{children}</pre>
    ),
    table: ({ children }: { children?: ReactNode }) => (
      <div className="overflow-x-auto my-2 rounded-lg border border-border">
        <table className="w-full text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: ReactNode }) => <thead className="bg-surface-sunken">{children}</thead>,
    th: ({ children }: { children?: ReactNode }) => <th className="text-left font-semibold text-ink px-2 py-1.5 border-b border-border">{children}</th>,
    td: ({ children }: { children?: ReactNode }) => <td className="px-2 py-1.5 border-b border-border text-ink-muted align-top">{children}</td>,
    blockquote: ({ children }: { children?: ReactNode }) => (
      <blockquote className={`border-l-2 ${a.text.replace('text-', 'border-')} pl-3 italic text-ink-faint my-1`}>{children}</blockquote>
    ),
  };
}

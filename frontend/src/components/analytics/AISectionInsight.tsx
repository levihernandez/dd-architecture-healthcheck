import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useOrgScanContext } from '../../context/OrgScanContext';
import { aiSettingsApi } from '../../services/api';

function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="font-semibold text-gray-900">{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="bg-violet-50 text-violet-700 text-xs px-1 py-0.5 rounded font-mono">{part.slice(1, -1)}</code>;
    return part;
  });
}

function MiniMarkdown({ content, streaming }: { content: string; streaming: boolean }) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      elements.push(
        <pre key={i} className="bg-gray-900 text-green-300 text-xs rounded p-2 overflow-x-auto my-1.5 font-mono">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      i++; continue;
    }

    const hm = line.match(/^(#{1,3})\s+(.+)/);
    if (hm) {
      const cls = hm[1].length === 1 ? 'text-sm font-bold text-gray-900 mt-3 mb-1' : 'text-xs font-bold text-gray-700 mt-2';
      elements.push(<div key={i} className={cls}>{hm[2]}</div>);
      i++; continue;
    }

    if (line.match(/^[\-\*]\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[\-\*]\s/)) { items.push(lines[i].slice(2)); i++; }
      elements.push(
        <ul key={i} className="space-y-0.5 my-1">
          {items.map((it, j) => (
            <li key={j} className="flex gap-1.5 text-sm text-gray-700">
              <span className="text-violet-400 shrink-0 mt-0.5">▸</span>
              <span>{renderInline(it)}</span>
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (line.match(/^\d+\.\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\d+\.\s/)) { items.push(lines[i].replace(/^\d+\.\s/, '')); i++; }
      elements.push(
        <ol key={i} className="space-y-0.5 my-1">
          {items.map((it, j) => (
            <li key={j} className="flex gap-1.5 text-sm text-gray-700">
              <span className="text-violet-600 font-bold shrink-0 w-4">{j + 1}.</span>
              <span>{renderInline(it)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    if (line.match(/^---+$/)) { elements.push(<hr key={i} className="my-2 border-gray-200" />); i++; continue; }
    if (line.trim() === '') { elements.push(<div key={i} className="h-1.5" />); i++; continue; }

    elements.push(
      <p key={i} className="text-sm text-gray-700 leading-relaxed">{renderInline(line)}</p>
    );
    i++;
  }

  return (
    <div className="space-y-0.5">
      {elements}
      {streaming && <span className="inline-block w-0.5 h-3.5 bg-violet-500 ml-0.5 animate-pulse" />}
    </div>
  );
}

interface AISectionInsightProps {
  section: string;
  prompt: string;
}

export function AISectionInsight({ section, prompt }: AISectionInsightProps) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const { selectedOrgId, selectedScanId } = useOrgScanContext();
  const { data: aiSettings } = useQuery({ queryKey: ['ai-settings'], queryFn: aiSettingsApi.get });

  const aiConfigured = aiSettings && (aiSettings.provider !== 'none' || aiSettings.envProvider);

  const analyze = async () => {
    if (streaming || !selectedOrgId) return;
    setContent('');
    setError('');
    setStreaming(true);
    abortRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: selectedOrgId,
          scanId: selectedScanId || undefined,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const rawChunk = decoder.decode(value, { stream: true });
        for (const line of rawChunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data) as { type: string; content: string };
            if (parsed.type === 'token') {
              acc += parsed.content;
              setContent(acc);
            } else if (parsed.type === 'error') {
              setError(parsed.content);
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError('Connection failed. Check AI Settings.');
      }
    } finally {
      setStreaming(false);
    }
  };

  const handleOpen = () => {
    setOpen(true);
    if (!content && !streaming) analyze();
  };

  return (
    <>
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition-colors font-medium whitespace-nowrap"
      >
        ✨ AI Insights
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="relative w-[560px] max-h-[80vh] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-violet-600 text-white shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base">✨</span>
                <span className="font-semibold text-sm">{section}</span>
                {streaming && (
                  <span className="text-xs text-violet-200 animate-pulse ml-1">Analyzing…</span>
                )}
                {!aiConfigured && (
                  <Link to="/ai-settings" onClick={() => setOpen(false)} className="text-xs bg-amber-400/80 text-amber-900 px-2 py-0.5 rounded-full hover:bg-amber-400 ml-1">
                    ⚙ Configure AI
                  </Link>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {streaming && (
                  <button
                    onClick={() => abortRef.current?.abort()}
                    className="text-xs bg-white/20 px-2 py-0.5 rounded hover:bg-white/30 transition-colors"
                  >
                    Stop
                  </button>
                )}
                {content && !streaming && (
                  <button
                    onClick={() => { setContent(''); analyze(); }}
                    className="text-xs bg-white/20 px-2 py-0.5 rounded hover:bg-white/30 transition-colors"
                  >
                    ↺ Re-analyze
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-0.5 rounded hover:bg-white/20 transition-colors"
                  aria-label="Close"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {!content && !error && streaming && (
                <div className="flex gap-1.5 py-4">
                  {[0, 150, 300].map(d => (
                    <div key={d} className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                  ))}
                </div>
              )}
              {!content && !error && !streaming && (
                <div className="text-center py-8 text-gray-400">
                  <div className="text-3xl mb-2">✨</div>
                  <div className="text-sm">
                    {!selectedOrgId
                      ? 'Select an org in the header to get AI insights'
                      : !aiConfigured
                      ? <span>Configure an <Link to="/ai-settings" onClick={() => setOpen(false)} className="text-violet-600 underline">AI provider</Link> to use this feature</span>
                      : 'Click Re-analyze to generate insights'
                    }
                  </div>
                </div>
              )}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
              {content && <MiniMarkdown content={content} streaming={streaming} />}
            </div>

            {/* Footer */}
            <div className="shrink-0 px-4 py-2.5 border-t border-gray-100 flex items-center justify-between bg-gray-50">
              <span className="text-xs text-gray-400">
                {aiSettings?.provider && aiSettings.provider !== 'none'
                  ? `${aiSettings.provider}${aiSettings.model ? ` · ${aiSettings.model}` : ''}`
                  : aiSettings?.envProvider
                  ? aiSettings.envProvider
                  : 'No AI provider configured'}
              </span>
              <Link to="/chat" onClick={() => setOpen(false)} className="text-xs text-violet-500 hover:text-violet-700">
                Open full AI Advisor →
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

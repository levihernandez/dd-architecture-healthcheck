import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useOrgAndScanFilters } from '../../hooks/useFilters';
import { aiSettingsApi } from '../../services/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: boolean;
}

const QUICK_CHIPS = [
  { icon: '📊', label: 'Custom Metrics', prompt: 'Assess my custom metric usage. Identify the top cardinality drivers, estimate my current volume vs standard allotment, and give me a prioritized action plan to control on-demand metric costs.' },
  { icon: '🪵', label: 'Log Indexing', prompt: 'Review my log indexing configuration. Identify indexes without exclusion filters, assess retention vs query frequency, flag rate-limited indexes, and recommend where to implement Flex Logs to reduce indexing spend.' },
  { icon: '🏷', label: 'Tagging Plan', prompt: 'Analyze my Unified Service Tagging (UST) gaps across all four keys (env/service/version/team). Generate a step-by-step remediation plan with owner assignments, rollout sequence, and validation steps.' },
  { icon: '⚡', label: 'Quick Wins', prompt: 'Identify my top 5 quick wins to reduce Datadog spend or improve observability quality in the next 30 days. Focus on low-effort, high-impact actions with specific implementation steps.' },
  { icon: '💰', label: 'FinOps Plan', prompt: 'Generate a comprehensive FinOps action plan. Quantify my estimated spend profile by product area, identify the top 10 cost reduction levers, and create a phased 90-day optimization roadmap.' },
];

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

function MarkdownContent({ content }: { content: string }) {
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
        <pre key={i} className="bg-gray-900 text-green-300 text-xs rounded p-2 overflow-x-auto my-1 font-mono">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
      i++; continue;
    }

    const hm = line.match(/^(#{1,3})\s+(.+)/);
    if (hm) {
      const cls = hm[1].length === 1 ? 'text-sm font-bold text-gray-900 mt-2 mb-0.5' : 'text-xs font-bold text-gray-800 mt-1.5';
      elements.push(<p key={i} className={cls}>{hm[2]}</p>);
      i++; continue;
    }

    if (line.match(/^[\-\*]\s/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^[\-\*]\s/)) { items.push(lines[i].slice(2)); i++; }
      elements.push(
        <ul key={i} className="space-y-0.5 my-0.5">
          {items.map((it, j) => (
            <li key={j} className="flex gap-1.5 text-xs text-gray-700">
              <span className="text-violet-400 shrink-0">▸</span>
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
        <ol key={i} className="space-y-0.5 my-0.5">
          {items.map((it, j) => (
            <li key={j} className="flex gap-1.5 text-xs text-gray-700">
              <span className="text-violet-600 font-semibold shrink-0 w-3">{j + 1}.</span>
              <span>{renderInline(it)}</span>
            </li>
          ))}
        </ol>
      );
      continue;
    }

    if (line.trim() === '') { elements.push(<div key={i} className="h-1" />); i++; continue; }

    elements.push(<p key={i} className="text-xs text-gray-700 leading-relaxed">{renderInline(line)}</p>);
    i++;
  }

  return <div className="space-y-0.5">{elements}</div>;
}

export default function FloatingChat() {
  const [open, setOpen] = useState(false);
  const { orgs, scans, selectedOrgId, selectedScanId, setSelectedOrgId, setSelectedScanId } = useOrgAndScanFilters();
  const { data: aiSettings } = useQuery({ queryKey: ['ai-settings'], queryFn: aiSettingsApi.get });
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [unread, setUnread] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setUnread(0);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;
    if (!selectedOrgId) { alert('Select an org first'); return; }

    const userMessage: Message = { role: 'user', content: text.trim() };
    const nextMessages = [...messages, userMessage];
    setMessages([...nextMessages, { role: 'assistant', content: '', streaming: true }]);
    setInput('');
    setIsStreaming(true);

    abortRef.current = new AbortController();

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: selectedOrgId,
          scanId: selectedScanId || undefined,
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';

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
              assistantContent += parsed.content;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: assistantContent, streaming: true };
                return updated;
              });
            } else if (parsed.type === 'error') {
              assistantContent = `Error: ${parsed.content}`;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: assistantContent, error: true };
                return updated;
              });
            }
          } catch { /* skip */ }
        }
      }

      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: assistantContent };
        return updated;
      });

      if (!open) setUnread(u => u + 1);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: `Error: ${(err as Error).message}`, error: true };
          return updated;
        });
      } else {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...updated[updated.length - 1], content: updated[updated.length - 1].content + ' *(stopped)*', streaming: false };
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [messages, isStreaming, selectedOrgId, selectedScanId, open]);

  const aiConfigured = aiSettings && (aiSettings.provider !== 'none' || aiSettings.envProvider);

  return (
    <>
      {/* Panel */}
      {open && (
        <div
          className="fixed bottom-20 right-5 z-50 flex flex-col bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
          style={{ width: 380, height: 560 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 bg-violet-600 text-white shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold">AI Advisor</span>
              {aiConfigured ? (
                <span className="text-xs bg-white/20 px-1.5 py-0.5 rounded-full truncate max-w-[120px]">
                  {aiSettings.provider !== 'none' ? aiSettings.provider : aiSettings.envProvider}
                  {aiSettings.model ? ` · ${aiSettings.model}` : ''}
                </span>
              ) : (
                <Link to="/ai-settings" onClick={() => setOpen(false)} className="text-xs bg-amber-400/80 text-amber-900 px-1.5 py-0.5 rounded-full hover:bg-amber-400">
                  ⚙ Configure
                </Link>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <select
                className="text-xs bg-white/10 border border-white/20 text-white rounded px-1.5 py-0.5 cursor-pointer max-w-[110px]"
                value={selectedOrgId}
                onChange={(e) => { setSelectedOrgId(e.target.value); setMessages([]); }}
              >
                {orgs.length === 0 && <option value="">No orgs</option>}
                {orgs.map(o => <option key={o.id} value={o.id} className="text-gray-900">{o.name}</option>)}
              </select>
              <button
                onClick={() => setOpen(false)}
                className="p-0.5 rounded hover:bg-white/20 transition-colors text-white/80 hover:text-white"
                aria-label="Close chat"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Quick chips */}
          <div className="flex gap-1.5 px-3 py-2 overflow-x-auto shrink-0 border-b border-gray-100 bg-gray-50">
            {QUICK_CHIPS.map(c => (
              <button
                key={c.label}
                onClick={() => send(c.prompt)}
                disabled={isStreaming || !selectedOrgId}
                className="shrink-0 flex items-center gap-1 text-xs bg-white border border-gray-200 rounded-full px-2.5 py-1 text-gray-600 hover:bg-violet-50 hover:border-violet-200 hover:text-violet-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <span>{c.icon}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-gray-400">
                <div className="text-3xl">✨</div>
                <div className="text-xs text-gray-500">
                  {selectedOrgId
                    ? 'Ask anything about your Datadog setup, or pick a quick assessment above.'
                    : 'Select an org from the dropdown to get started.'}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-5 h-5 rounded-full bg-violet-600 flex items-center justify-center text-white text-[9px] font-bold shrink-0 mt-0.5">
                    DD
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 ${
                    msg.role === 'user'
                      ? 'bg-violet-600 text-white rounded-br-sm'
                      : msg.error
                      ? 'bg-red-50 border border-red-200 rounded-bl-sm'
                      : 'bg-gray-50 border border-gray-200 shadow-sm rounded-bl-sm'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
                  ) : (
                    <>
                      {msg.content ? (
                        <MarkdownContent content={msg.content} />
                      ) : (
                        <div className="flex gap-1 py-0.5">
                          {[0, 150, 300].map(d => (
                            <div key={d} className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                          ))}
                        </div>
                      )}
                      {msg.streaming && msg.content && (
                        <span className="inline-block w-0.5 h-3 bg-violet-500 ml-0.5 animate-pulse" />
                      )}
                    </>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-gray-600 text-[9px] font-bold shrink-0 mt-0.5">
                    You
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-gray-200 bg-white px-3 py-2">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
                }}
                placeholder={selectedOrgId ? 'Ask about your setup…' : 'Select an org first…'}
                disabled={!selectedOrgId}
                rows={1}
                className="flex-1 resize-none text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400 max-h-24 overflow-y-auto disabled:opacity-50"
                style={{ lineHeight: '1.5' }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
                }}
              />
              {isStreaming ? (
                <button
                  onClick={() => abortRef.current?.abort()}
                  className="shrink-0 px-2.5 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim() || !selectedOrgId}
                  className="shrink-0 px-2.5 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-medium hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Send
                </button>
              )}
            </div>
            <div className="flex items-center justify-between mt-1">
              <button
                onClick={() => setMessages([])}
                className="text-[10px] text-gray-400 hover:text-gray-600"
              >
                Clear
              </button>
              <Link
                to="/chat"
                onClick={() => setOpen(false)}
                className="text-[10px] text-violet-500 hover:text-violet-700"
              >
                Open full view →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setOpen(o => !o)}
        className="fixed bottom-5 right-5 z-50 w-14 h-14 rounded-full bg-violet-600 text-white shadow-lg hover:bg-violet-700 hover:shadow-xl transition-all flex items-center justify-center"
        aria-label="Open AI Chat"
      >
        {open ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        ) : (
          <span className="relative">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
                {unread}
              </span>
            )}
          </span>
        )}
      </button>
    </>
  );
}

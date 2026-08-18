import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useOrgAndScanFilters } from '../../hooks/useFilters';
import { useCurrentPage } from '../../hooks/useCurrentPage';
import { aiSettingsApi } from '../../services/api';
import { streamChat } from '../../lib/chat-client';
import MarkdownMessage from './MarkdownMessage';

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

export default function FloatingChat() {
  const [open, setOpen] = useState(false);
  const { orgs, scans, selectedOrgId, selectedScanId, setSelectedOrgId, setSelectedScanId } = useOrgAndScanFilters();
  const currentPage = useCurrentPage();
  const { data: aiSettings } = useQuery({ queryKey: ['ai-settings'], queryFn: aiSettingsApi.get });
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [unread, setUnread] = useState(0);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
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

  const send = useCallback(async (text: string, baseHistory?: Message[]) => {
    if (!text.trim() || isStreaming) return;
    if (!selectedOrgId) { toast.error('Select an org first'); return; }

    const userMessage: Message = { role: 'user', content: text.trim() };
    const nextMessages = [...(baseHistory ?? messages), userMessage];
    setMessages([...nextMessages, { role: 'assistant', content: '', streaming: true }]);
    setInput('');
    setIsStreaming(true);

    abortRef.current = new AbortController();

    let assistantContent = '';
    try {
      await streamChat(
        {
          orgId: selectedOrgId,
          scanId: selectedScanId || undefined,
          page: currentPage?.path,
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          signal: abortRef.current.signal,
        },
        (delta) => {
          assistantContent += delta;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: assistantContent, streaming: true };
            return updated;
          });
        },
        (errMsg) => {
          assistantContent = `Error: ${errMsg}`;
          setMessages(prev => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'assistant', content: assistantContent, error: true };
            return updated;
          });
        }
      );

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
  }, [messages, isStreaming, selectedOrgId, selectedScanId, open, currentPage]);

  const aiConfigured = aiSettings && (aiSettings.provider !== 'none' || aiSettings.envProvider);

  const editAndResend = (index: number, newText: string) => {
    if (isStreaming || !newText.trim()) return;
    send(newText, messages.slice(0, index));
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  return (
    <>
      {/* Panel */}
      <div
        className={`fixed top-1/2 -translate-y-1/2 right-0 z-50 flex flex-col bg-surface-subtle rounded-l-2xl shadow-2xl border border-border overflow-hidden transition-all duration-300 ease-out ${
          open
            ? 'translate-x-0 opacity-100 pointer-events-auto'
            : 'translate-x-full opacity-0 pointer-events-none'
        }`}
        style={{ width: 380, height: 560 }}
      >
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2.5 bg-violet-600 text-white shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-semibold">AI Advisor</span>
              {aiConfigured ? (
                <span className="text-xs bg-surface-subtle/20 px-1.5 py-0.5 rounded-full truncate max-w-[120px]">
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
                className="text-xs bg-surface-subtle/10 border border-white/20 text-white rounded px-1.5 py-0.5 cursor-pointer max-w-[110px]"
                value={selectedOrgId}
                onChange={(e) => { setSelectedOrgId(e.target.value); setMessages([]); }}
              >
                {orgs.length === 0 && <option value="">No orgs</option>}
                {orgs.map(o => <option key={o.id} value={o.id} className="text-ink">{o.name}</option>)}
              </select>
              <button
                onClick={() => setOpen(false)}
                className="p-0.5 rounded hover:bg-surface-subtle/20 transition-colors text-white/80 hover:text-white"
                aria-label="Close chat"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {currentPage && (
            <div className="px-3 py-1 text-[10px] text-ink-faint bg-surface-sunken border-b border-gray-100" title="Assessments focus on this page's domain when relevant">
              📍 Focused on <span className="font-medium text-ink-muted">{currentPage.label}</span>
            </div>
          )}

          {/* Quick chips */}
          <div className="flex gap-1.5 px-3 py-2 overflow-x-auto shrink-0 border-b border-gray-100 bg-surface-sunken">
            {QUICK_CHIPS.map(c => (
              <button
                key={c.label}
                onClick={() => send(c.prompt)}
                disabled={isStreaming || !selectedOrgId}
                className="shrink-0 flex items-center gap-1 text-xs bg-surface-subtle border border-border rounded-full px-2.5 py-1 text-ink-muted hover:bg-violet-500/10 hover:border-violet-500/30 hover:text-violet-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                <span>{c.icon}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-ink-faint">
                <div className="text-3xl">✨</div>
                <div className="text-xs text-ink-faint">
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
                      ? 'bg-red-500/10 border border-red-500/30 rounded-bl-sm'
                      : 'bg-surface-sunken border border-border shadow-sm rounded-bl-sm'
                  }`}
                >
                  {msg.role === 'user' ? (
                    editingIndex === i ? (
                      <div className="space-y-1 min-w-[12rem]">
                        <textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={Math.min(8, Math.max(2, editDraft.split('\n').length))}
                          autoFocus
                          className="w-full resize-y text-xs rounded-lg border border-white/30 bg-white/10 text-white placeholder-white/50 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-white/60"
                        />
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => setEditingIndex(null)} className="text-[10px] px-1.5 py-0.5 rounded text-white/70 hover:text-white">Cancel</button>
                          <button
                            onClick={() => { setEditingIndex(null); editAndResend(i, editDraft); }}
                            className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-white text-violet-700 hover:bg-white/90"
                          >
                            Save &amp; resend
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="group/msg relative">
                        <p className="text-xs whitespace-pre-wrap pr-1">{msg.content}</p>
                        <div className="absolute -top-2 right-0 hidden group-hover/msg:flex items-center gap-0.5 bg-white rounded-full shadow-xs px-1 py-0.5">
                          <button
                            onClick={() => { setEditingIndex(i); setEditDraft(msg.content); }}
                            disabled={isStreaming}
                            title="Edit and resend"
                            className="px-1 py-0.5 rounded-full hover:bg-surface-sunken text-ink-faint hover:text-ink-muted text-[9px] leading-none disabled:opacity-40"
                          >
                            ✎
                          </button>
                          <button
                            onClick={() => copyToClipboard(msg.content)}
                            title="Copy"
                            className="px-1 py-0.5 rounded-full hover:bg-surface-sunken text-ink-faint hover:text-ink-muted text-[9px] leading-none"
                          >
                            ⧉
                          </button>
                        </div>
                      </div>
                    )
                  ) : (
                    <>
                      {msg.content ? (
                        <MarkdownMessage content={msg.content} accent="violet" size="xs" />
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
                  <div className="w-5 h-5 rounded-full bg-surface-sunken flex items-center justify-center text-ink-muted text-[9px] font-bold shrink-0 mt-0.5">
                    You
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-border bg-surface-subtle px-3 py-2">
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
                className="flex-1 resize-none text-xs border border-border rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-400 max-h-24 overflow-y-auto disabled:opacity-50"
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
                className="text-[10px] text-ink-faint hover:text-ink-muted"
              >
                Clear
              </button>
              <Link
                to="/chat"
                onClick={() => setOpen(false)}
                className="text-[10px] text-violet-500 hover:text-violet-400"
              >
                Open full view →
              </Link>
            </div>
          </div>
        </>
      </div>

      {/* Toggle tab */}
      <button
        onClick={() => setOpen(o => !o)}
        className={`fixed top-1/2 -translate-y-1/2 z-50 w-8 h-16 rounded-l-xl bg-violet-600 text-white shadow-lg hover:bg-violet-700 hover:w-9 transition-all flex items-center justify-center ${
          open ? 'right-[380px]' : 'right-0'
        }`}
        aria-label={open ? 'Close AI Chat' : 'Open AI Chat'}
      >
        <span className="relative">
          <svg
            className={`w-5 h-5 transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {!open && unread > 0 && (
            <span className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">
              {unread}
            </span>
          )}
        </span>
      </button>
    </>
  );
}

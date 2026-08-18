import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useOrgAndScanFilters } from '../hooks/useFilters';
import { useCurrentPage } from '../hooks/useCurrentPage';
import { aiSettingsApi } from '../services/api';
import { streamChat } from '../lib/chat-client';
import PageHeader from '../components/ui/PageHeader';
import MarkdownMessage from '../components/chat/MarkdownMessage';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  error?: boolean;
}

const QUICK_PROMPTS = [
  {
    icon: '📊',
    label: 'Custom Metrics',
    prompt: 'Assess my custom metric usage. Identify the top cardinality drivers, estimate my current volume vs standard allotment, and give me a prioritized action plan to control on-demand metric costs.',
  },
  {
    icon: '🪵',
    label: 'Log Indexing',
    prompt: 'Review my log indexing configuration. Identify indexes without exclusion filters, assess retention vs query frequency, flag rate-limited indexes, and recommend where to implement Flex Logs to reduce indexing spend.',
  },
  {
    icon: '🔍',
    label: 'APM Sampling',
    prompt: 'Evaluate my APM trace sampling strategy. Estimate current ingestion and indexing volumes, identify services that need guaranteed retention, and recommend retention filter tuning to optimize spend without losing critical visibility.',
  },
  {
    icon: '🧪',
    label: 'Synthetics',
    prompt: 'Review my Synthetics test configuration. Identify browser tests replaceable with API tests, flag over-frequent or over-located tests, and calculate the monthly run reduction from each optimization.',
  },
  {
    icon: '🏷',
    label: 'Tagging Plan',
    prompt: 'Analyze my Unified Service Tagging (UST) gaps across all four keys (env/service/version/team). Generate a step-by-step remediation plan with owner assignments, rollout sequence, and validation steps.',
  },
  {
    icon: '🖥',
    label: 'Host Allotment',
    prompt: 'Assess my infrastructure footprint. Break down host count by tier, estimate allotment consumption, identify untagged hosts that inflate costs without attribution, and flag any containers or cloud accounts generating unexpected metric volume.',
  },
  {
    icon: '⚡',
    label: 'Quick Wins',
    prompt: 'Identify my top 5 quick wins to reduce Datadog spend or improve observability quality in the next 30 days. Focus on low-effort, high-impact actions with specific implementation steps.',
  },
  {
    icon: '👤',
    label: 'RUM Coverage',
    prompt: 'Review my RUM and frontend observability configuration. Assess session sampling rates, replay coverage, identify gaps in user journey monitoring, and recommend session and replay sampling thresholds for cost-effective coverage.',
  },
  {
    icon: '📦',
    label: 'Product Utilization',
    prompt: 'Evaluate which Datadog products I\'m using effectively vs underutilizing. Identify products I may be paying for but not leveraging, and give me an activation roadmap to maximize value from my current investment.',
  },
  {
    icon: '💰',
    label: 'FinOps Plan',
    prompt: 'Generate a comprehensive FinOps action plan. Quantify my estimated spend profile by product area, identify the top 10 cost reduction levers, and create a phased 90-day optimization roadmap with expected savings for each initiative.',
  },
];

export default function AIChatAssistant() {
  const { orgs, scans, selectedOrgId, selectedScanId } = useOrgAndScanFilters();
  const currentPage = useCurrentPage();
  const { data: aiSettings } = useQuery({ queryKey: ['ai-settings'], queryFn: aiSettingsApi.get });
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Welcome message when org/scan selected
  useEffect(() => {
    if (selectedOrgId && selectedScanId && messages.length === 0) {
      const orgName = orgs.find(o => o.id === selectedOrgId)?.name ?? 'your org';
      setMessages([{
        role: 'assistant',
        content: `I've loaded the latest scan data for **${orgName}**. I have full visibility into your infrastructure inventory, tagging coverage, log indexes, APM services, Synthetics tests, custom metric profile, and all scan findings.\n\nAsk me anything about your Datadog setup, or pick a quick prompt on the left to run a focused assessment.`,
      }]);
    }
  }, [selectedOrgId, selectedScanId]);

  // `baseHistory` lets an edited-and-resent user message replace the tail of
  // the conversation (itself + the old reply) instead of appending after it.
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
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: updated[updated.length - 1].content + ' *(stopped)*' };
          return updated;
        });
      } else {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            role: 'assistant',
            content: `Connection error: ${(err as Error).message}`,
            error: true,
          };
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [messages, isStreaming, selectedOrgId, selectedScanId, currentPage]);

  const stop = () => {
    abortRef.current?.abort();
  };

  // Drop the edited message and everything after it (its old reply included),
  // then resend the edited text as a fresh turn.
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const providerConfigured = aiSettings && (aiSettings.provider !== 'none' || aiSettings.envProvider);

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="AI Chat Advisor"
        subtitle="Ask anything about your Datadog setup — grounded in your latest scan data."
        actions={
          providerConfigured ? (
            <span className="badge bg-green-500/15 text-green-400">
              {aiSettings!.provider !== 'none' ? aiSettings!.provider : aiSettings!.envProvider}
              {aiSettings!.model ? ` · ${aiSettings!.model}` : ''}
            </span>
          ) : (
            <Link to="/ai-settings" className="badge bg-amber-500/15 text-amber-400 hover:bg-amber-200">
              ⚙ Configure AI provider
            </Link>
          )
        }
      />

      <div className="flex flex-1 min-h-[560px] rounded-lg border border-border bg-surface-subtle shadow-xs overflow-hidden">
        {/* Quick prompts sidebar */}
        <div className="w-56 shrink-0 bg-surface-subtle border-r border-border flex flex-col overflow-hidden">
          <div className="px-3 pt-4 pb-2">
            <div className="text-xs font-semibold text-ink-faint uppercase tracking-wider">Quick Assessments</div>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p.label}
                onClick={() => send(p.prompt)}
                disabled={isStreaming || !selectedOrgId}
                className="w-full text-left px-2.5 py-2 rounded-lg text-xs text-ink-muted hover:bg-dd-purple/5 hover:text-dd-purple-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed group"
              >
                <span className="text-base mr-1.5">{p.icon}</span>
                <span className="font-medium">{p.label}</span>
              </button>
            ))}
          </div>
          <div className="px-3 py-3 border-t border-border">
            <button
              onClick={() => { setMessages([]); }}
              disabled={messages.length === 0}
              className="w-full text-xs text-ink-faint hover:text-ink-muted py-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Clear conversation
            </button>
          </div>
        </div>

        {/* Main chat area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-ink-faint">
                <div className="text-4xl">✨</div>
                <div className="text-sm font-medium text-ink-muted">Select an org and scan, then ask anything about your Datadog setup.</div>
                <div className="text-xs">Or pick a quick assessment from the left panel.</div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-dd-purple flex items-center justify-center text-white text-xs font-bold shrink-0 mt-0.5">
                    DD
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-dd-purple text-white rounded-br-sm'
                      : msg.error
                      ? 'bg-red-500/10 border border-red-500/30 rounded-bl-sm'
                      : 'bg-surface-subtle border border-border shadow-xs rounded-bl-sm'
                  }`}
                >
                  {msg.role === 'user' ? (
                    editingIndex === i ? (
                      <div className="space-y-1.5 min-w-[16rem]">
                        <textarea
                          value={editDraft}
                          onChange={(e) => setEditDraft(e.target.value)}
                          rows={Math.min(10, Math.max(2, editDraft.split('\n').length))}
                          autoFocus
                          className="w-full resize-y text-sm rounded-lg border border-white/30 bg-white/10 text-white placeholder-white/50 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-white/60"
                        />
                        <div className="flex gap-1.5 justify-end">
                          <button onClick={() => setEditingIndex(null)} className="text-xs px-2 py-1 rounded text-white/70 hover:text-white">Cancel</button>
                          <button
                            onClick={() => { setEditingIndex(null); editAndResend(i, editDraft); }}
                            className="text-xs px-2 py-1 rounded font-medium bg-white text-dd-purple-dark hover:bg-white/90"
                          >
                            Save &amp; resend
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="group/msg relative">
                        <p className="text-sm whitespace-pre-wrap pr-1">{msg.content}</p>
                        <div className="absolute -top-2.5 right-0 hidden group-hover/msg:flex items-center gap-0.5 bg-white rounded-full shadow-xs px-1 py-0.5">
                          <button
                            onClick={() => { setEditingIndex(i); setEditDraft(msg.content); }}
                            disabled={isStreaming}
                            title="Edit and resend"
                            className="px-1.5 py-0.5 rounded-full hover:bg-surface-sunken text-ink-faint hover:text-ink-muted text-[10px] leading-none disabled:opacity-40"
                          >
                            ✎
                          </button>
                          <button
                            onClick={() => copyToClipboard(msg.content)}
                            title="Copy"
                            className="px-1.5 py-0.5 rounded-full hover:bg-surface-sunken text-ink-faint hover:text-ink-muted text-[10px] leading-none"
                          >
                            ⧉
                          </button>
                        </div>
                      </div>
                    )
                  ) : (
                    <>
                      {msg.content ? (
                        <MarkdownMessage content={msg.content} accent="purple" size="sm" />
                      ) : (
                        <div className="flex gap-1 py-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-dd-purple-light animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-dd-purple-light animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-1.5 h-1.5 rounded-full bg-dd-purple-light animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      )}
                      {msg.streaming && msg.content && (
                        <span className="inline-block w-0.5 h-3.5 bg-dd-purple ml-0.5 animate-pulse" />
                      )}
                    </>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="w-7 h-7 rounded-full bg-surface-sunken flex items-center justify-center text-ink-muted text-xs font-bold shrink-0 mt-0.5">
                    You
                  </div>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <div className="shrink-0 border-t border-border bg-surface-subtle px-4 py-3">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={selectedOrgId ? 'Ask about your Datadog setup… (Enter to send, Shift+Enter for newline)' : 'Select an org to start…'}
                disabled={!selectedOrgId}
                rows={1}
                className="flex-1 resize-none input text-sm py-2.5 max-h-36 overflow-y-auto disabled:opacity-50"
                style={{ lineHeight: '1.5' }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 144)}px`;
                }}
              />
              {isStreaming ? (
                <button onClick={stop} className="btn-danger shrink-0">
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim() || !selectedOrgId}
                  className="btn-primary shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              )}
            </div>
            <div className="text-xs text-ink-faint mt-1.5 flex items-center gap-1">
              <span>Context: {selectedOrgId ? `${orgs.find(o => o.id === selectedOrgId)?.name ?? ''}` : 'no org'}</span>
              {selectedScanId && <span>· scan {new Date(scans.find(s => s.id === selectedScanId)?.startedAt ?? '').toLocaleDateString()}</span>}
              {currentPage && <span title="Assessments focus on this page's domain when relevant">· 📍 {currentPage.label}</span>}
              {aiSettings?.provider && aiSettings.provider !== 'none'
                ? <span className="ml-auto text-green-400">✓ {aiSettings.provider} · {aiSettings.model}</span>
                : <Link to="/ai-settings" className="ml-auto text-amber-400 hover:underline">Configure AI provider →</Link>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
